'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { Server } = require('socket.io');
const axios = require('axios');
const { Chess } = require('chess.js');
const { analyzeGame } = require('./analysis');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4, pingInterval: 10000, pingTimeout: 10000 });

// ───────────────────────── الإعدادات الخاصة بـ Render ─────────────────────────
const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');

const TIME_CONTROLS = {
    '1+0':  { base: 60,  inc: 0,  label: '1+0' },
    '2+1':  { base: 120, inc: 1,  label: '2+1' },
    '3+0':  { base: 180, inc: 0,  label: '3+0' },
    '3+2':  { base: 180, inc: 2,  label: '3+2' },
    '5+0':  { base: 300, inc: 0,  label: '5+0' },
    '10+0': { base: 600, inc: 0,  label: '10+0' },
    '15+10': { base: 900, inc: 10, label: '15+10' }
};
const DEFAULT_TC = '3+0';

function categoryOf(tc) {
    const est = tc.base + 40 * tc.inc;
    return est < 180 ? 'bullet' : est < 480 ? 'blitz' : 'rapid';
}
const CATEGORIES = ['bullet', 'blitz', 'rapid'];
const MAX_CHAT_LENGTH = 200;
const START_RATING = 1200;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

const rooms = new Map();
const live = new Map();
const queues = {};
Object.keys(TIME_CONTROLS).forEach((id) => { queues[id] = []; });

// ───────────────────────── قاعدة البيانات والملفات ─────────────────────────
let db = { players: {}, users: {} };
let dirty = false;
let saveTimer = null;
let mongoColl = null;

async function loadDb() {
    if (process.env.MONGODB_URI) {
        try {
            const { MongoClient } = require('mongodb');
            const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
            await client.connect();
            mongoColl = client.db(process.env.MONGODB_DB || 'chess').collection('state');
            const doc = await mongoColl.findOne({ _id: 'db' });
            if (doc && doc.json) db = JSON.parse(doc.json);
            console.log('Storage: MongoDB');
        } catch (e) {
            console.error('MongoDB unavailable, falling back to file storage:', e.message);
            mongoColl = null;
        }
    }
    if (!mongoColl) {
        try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = { players: {}, users: {} }; }
        console.log('Storage: file ' + DB_FILE);
    }
    if (!db || typeof db.players !== 'object') db = { players: {}, users: {} };
    if (!db.users || typeof db.users !== 'object') db.users = {};
}

function saveSoon() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; flushDb(); }, 2000);
}

async function flushDb() {
    if (!dirty) return;
    dirty = false;
    let json = JSON.stringify(db);
    if (mongoColl) {
        try { await mongoColl.updateOne({ _id: 'db' }, { $set: { json } }, { upsert: true }); }
        catch (e) { dirty = true; }
        return;
    }
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, DB_FILE);
    } catch (e) {
        console.error('DB save error:', e.message);
    }
}

function newPlayer() {
    const r = {};
    CATEGORIES.forEach((c) => { r[c] = { r: START_RATING, n: 0 }; });
    return { name: '', created: Date.now(), last: Date.now(), r, w: 0, l: 0, d: 0, games: 0 };
}

function ratingOf(token, cat) {
    const p = db.players[token];
    return p && p.r[cat] ? p.r[cat].r : START_RATING;
}

function publicRatings(token) {
    const p = db.players[token];
    const out = {};
    CATEGORIES.forEach((c) => { out[c] = p && p.r[c] ? p.r[c].r : START_RATING; });
    return out;
}

function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

// ───────────────────────── إعدادات Express (الملفات الثابتة) ─────────────────────────
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname), { maxAge: '5m' }));
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, online: io.engine.clientsCount }));

// ───────────────────────── Socket.IO ─────────────────────────
io.on('connection', (socket) => {
    socket.data.token = null;

    socket.on('hello', (data) => {
        data = data && typeof data === 'object' ? data : {};
        let token = typeof data.token === 'string' && TOKEN_RE.test(data.token) ? data.token : null;
        let rec = token ? db.players[token] : null;
        if (!rec) {
            token = crypto.randomBytes(18).toString('base64url');
            rec = db.players[token] = newPlayer();
            saveSoon();
        }
        socket.data.token = token;
        socket.emit('welcome', { token, name: rec.name, ratings: publicRatings(token), online: io.engine.clientsCount });
    });

    // أحداث لعبة مونوبولي
    socket.on('monopoly_roll', () => {
        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        socket.emit('monopoly_rolled', { dice: [dice1, dice2], total: dice1 + dice2 });
    });

    socket.on('disconnect', () => {});
});

// ───────────────────────── تشغيل السيرفر ─────────────────────────
loadDb().then(() => {
    server.listen(PORT, () => {
        console.log('Gaming Platform server successfully running on port ' + PORT);
    });
}).catch((e) => {
    console.error('Failed to start server:', e);
    process.exit(1);
});

module.exports = { server, io, app, rooms, live, db: () => db };
