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
const safety = require('./safety');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4, pingInterval: 10000, pingTimeout: 10000 });

// ───────────────────────── الإعدادات ─────────────────────────
const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');

// أنظمة الوقت: base بالثواني، inc زيادة بالثواني لكل حركة
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
// الفئة (للتصنيف) حسب المدة التقديرية: base + 40*inc
function categoryOf(tc) {
    const est = tc.base + 40 * tc.inc;
    return est < 180 ? 'bullet' : est < 480 ? 'blitz' : 'rapid';
}
const CATEGORIES = ['bullet', 'blitz', 'rapid'];

const MAX_CHAT_LENGTH = 200;
const STOCKFISH_URL = 'https://stockfish.online/api/s/v2.php';
const GRACE_PLAYING_MS = 30000;     // مهلة إعادة الاتصال أثناء المباراة
const GRACE_IDLE_MS = 90000;        // أثناء الانتظار أو ضد الحاسوب
const START_RATING = 1200;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

const rooms = new Map();            // roomId -> room
const live = new Map();             // token -> { socketId, roomId, color, specId, grace }
const queues = {};                  // tcId -> [{ token, rating, since }]
Object.keys(TIME_CONTROLS).forEach((id) => { queues[id] = []; });

// ───────────────────────── قاعدة اللاعبين (ملف JSON) ─────────────────────────
let db = { players: {}, users: {} };
let dirty = false;
let saveTimer = null;
let mongoColl = null;

async function loadDb() {
    // تخزين دائم اختياري: اضبط MONGODB_URI (مثلًا من MongoDB Atlas المجاني)
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
    if (!db.clubs || typeof db.clubs !== 'object') db.clubs = {};
    // تنظيف حسابات الضيوف الفارغة القديمة (الحسابات المسجلة لا تُحذف أبدًا)
    const cutoff = Date.now() - 14 * 86400000;
    for (const [t, p] of Object.entries(db.players)) {
        if (!p.games && !p.user && (p.last || 0) < cutoff) delete db.players[t];
    }
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
    if (json.length > 12e6) {        // حد مستند MongoDB الواحد 16MB: نقلّص المباريات المحفوظة
        for (const p of Object.values(db.players)) {
            if (Array.isArray(p.hist)) { p.hist = p.hist.slice(0, 5); p.hist.forEach((g) => { g.an = null; }); }
        }
        json = JSON.stringify(db);
        console.warn('DB pruned: saved games trimmed (size ' + json.length + ')');
    }
    if (mongoColl) {
        try { await mongoColl.updateOne({ _id: 'db' }, { $set: { json } }, { upsert: true }); }
        catch (e) { dirty = true; console.error('DB save error:', e.message); }
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
function leaderboard(cat) {
    if (!CATEGORIES.includes(cat)) cat = 'blitz';
    const rows = [];
    for (const p of Object.values(db.players)) {
        if (p.r[cat] && p.r[cat].n > 0) {
            rows.push({ name: p.name || 'لاعب مجهول', rating: p.r[cat].r, games: p.r[cat].n });
        }
    }
    rows.sort((a, b) => b.rating - a.rating || b.games - a.games);
    return rows.slice(0, 20);
}
// تحديث إيلو
function eloUpdate(room, result) {
    const cat = room.cat;
    const tw = room.players.w, tb = room.players.b;
    const pw = db.players[tw], pb = db.players[tb];
    if (!pw || !pb) return null;
    const rw = pw.r[cat], rb = pb.r[cat];
    const sw = result.winner === 'w' ? 1 : result.winner === 'b' ? 0 : 0.5;
    const ew = 1 / (1 + Math.pow(10, (rb.r - rw.r) / 400));
    const kw = rw.n < 20 ? 40 : 32, kb = rb.n < 20 ? 40 : 32;
    const dw = Math.round(kw * (sw - ew));
    const db_ = Math.round(kb * ((1 - sw) - (1 - ew)));
    rw.r = Math.max(100, rw.r + dw); rw.n++;
    rb.r = Math.max(100, rb.r + db_); rb.n++;
    pw.games++; pb.games++;
    if (sw === 1) { pw.w++; pb.l++; } else if (sw === 0) { pw.l++; pb.w++; } else { pw.d++; pb.d++; }
    saveSoon();
    return { w: dw, b: db_, ratings: { w: rw.r, b: rb.r } };
}

// ───────────────────────── أدوات مساعدة ─────────────────────────
const other = (c) => (c === 'w' ? 'b' : 'w');

function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}
function cleanChat(v) {
    return String(v).replace(/[\u0000-\u001f\u007f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
}
function makeRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id;
    do {
        id = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
    } while (rooms.has(id));
    return id;
}
function resolveTc(data) {
    let id = data && typeof data.tc === 'string' ? data.tc : null;
    if (!id && data && data.timeSec) id = (Number(data.timeSec) / 60) + '+0';   // توافق مع الصيغة القديمة
    return TIME_CONTROLS[id] ? id : null;
}

function emitTo(token, ev, payload) {
    const l = live.get(token);
    if (l && l.socketId) io.to(l.socketId).emit(ev, payload);
}
function emitPlayers(room, ev, payload) {
    ['w', 'b'].forEach((c) => { if (room.players[c]) emitTo(room.players[c], ev, payload); });
}
function isConnected(token) {
    const l = live.get(token);
    return !!(l && l.socketId);
}
function socketOf(token) {
    const l = live.get(token);
    return l && l.socketId ? io.sockets.sockets.get(l.socketId) : null;
}

// شطرنج فيشر (960): ترتيب عشوائي للصف الخلفي، الفيلان على لونين مختلفين، الملك بين القلعتين.
// تُلعب بدون تبييت (حقل التبييت في FEN هو «-») لأن مكتبة اللعب لا تدعم تبييت 960.
function chess960Fen() {
    const row = new Array(8).fill(null);
    const pick = (arr) => arr[crypto.randomInt(arr.length)];
    const free = () => row.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    row[pick([0, 2, 4, 6])] = 'b';
    row[pick([1, 3, 5, 7])] = 'b';
    row[pick(free())] = 'q';
    row[pick(free())] = 'n';
    row[pick(free())] = 'n';
    const f = free();
    row[f[0]] = 'r'; row[f[1]] = 'k'; row[f[2]] = 'r';
    const back = row.join('');
    return back + '/pppppppp/8/8/8/8/PPPPPPPP/' + back.toUpperCase() + ' w - - 0 1';
}
function resolveVariant(data) { return data && data.variant === '960' ? '960' : 'std'; }
function freshGame(room) {
    room.startFen = room.variant === '960' ? chess960Fen() : null;
    return room.startFen ? new Chess(room.startFen) : new Chess();
}

function makeGameId() { return crypto.randomBytes(6).toString('hex'); }

function newRoom(type, tcId, variant) {
    const tc = TIME_CONTROLS[tcId];
    const room = {
        id: makeRoomId(),
        type,                       // 'multi' | 'ai'
        tcId,
        tc,
        cat: categoryOf(tc),
        timeSec: tc.base,
        incMs: tc.inc * 1000,
        rated: false,
        variant: variant === '960' ? '960' : 'std',
        startFen: null,
        gameId: makeGameId(),
        createdAt: Date.now(),
        game: null,
        players: { w: null, b: null },   // tokens
        names: { w: '', b: '' },
        ratings: { w: null, b: null },
        disc: { w: null, b: null },      // وقت انتهاء مهلة إعادة الاتصال
        spectators: new Set(),
        matched: false,
        aiColor: null,
        aiLevel: 10,
        aiBusy: false,
        notifiedFallback: false,
        clocks: { w: tc.base * 1000, b: tc.base * 1000 },
        running: false,
        plies: 0,
        lastTick: Date.now(),
        timer: null,
        lastMove: null,
        over: false,
        overAt: 0,
        result: null,
        closed: false,
        rematch: { w: false, b: false },
        drawOffer: null,
        lastDrawPly: { w: -9, b: -9 }
    };
    room.game = freshGame(room);
    rooms.set(room.id, room);
    return room;
}

function seat(token, room, color) {
    const p = db.players[token];
    room.players[color] = token;
    room.names[color] = (p && p.name) || '';
    const l = live.get(token);
    l.roomId = room.id;
    l.color = color;
    const s = socketOf(token);
    if (s) s.join(room.id);
}

function startMatch(room) {
    room.matched = true;
    ['w', 'b'].forEach((c) => { room.ratings[c] = ratingOf(room.players[c], room.cat); });
    ['w', 'b'].forEach((c) => emitTo(room.players[c], 'game_start', gameStartPayload(room, c)));
    broadcast(room);
}

function gameStartPayload(room, color, resumed) {
    return {
        color, mode: room.type, roomId: room.id, tc: room.tcId, rated: room.rated,
        cat: room.cat, ratings: room.ratings, variant: room.variant, resumed: !!resumed
    };
}

function resetForRematch(room) {
    clearTimeout(room.timer);
    [room.players.w, room.players.b] = [room.players.b, room.players.w];
    [room.names.w, room.names.b] = [room.names.b, room.names.w];
    [room.disc.w, room.disc.b] = [room.disc.b, room.disc.w];
    for (const c of ['w', 'b']) {
        const l = live.get(room.players[c]);
        if (l) l.color = c;
    }
    room.game = freshGame(room);
    room.gameId = makeGameId();
    room.mt = null;
    room.clocks = { w: room.tc.base * 1000, b: room.tc.base * 1000 };
    room.running = false;
    room.plies = 0;
    room.lastTick = Date.now();
    room.lastMove = null;
    room.over = false;
    room.overAt = 0;
    room.result = null;
    room.rematch = { w: false, b: false };
    room.drawOffer = null;
    room.lastDrawPly = { w: -9, b: -9 };
}

function publicState(room) {
    return {
        fen: room.game.fen(),
        startFen: room.startFen,
        variant: room.variant,
        gameId: room.gameId,
        turn: room.game.turn(),
        check: room.game.inCheck(),
        lastMove: room.lastMove,
        history: room.game.history(),
        names: room.names,
        ratings: room.ratings,
        rated: room.rated,
        tc: room.tcId,
        inc: room.incMs,
        moveCount: room.plies,
        clocks: room.clocks,
        tickAt: room.lastTick,
        serverNow: Date.now(),
        running: room.running,
        frozen: room.type === 'ai' && room.game.turn() === room.aiColor,   // ساعة الحاسوب لا تعدّ أثناء التفكير
        over: room.over,
        result: room.result,
        drawOffer: room.drawOffer,
        disc: room.disc,
        spectators: room.spectators.size,
        rematch: room.rematch
    };
}
function broadcast(room) {
    io.to(room.id).emit('state', publicState(room));
}

function closeRoom(room) {
    if (room.closed) return;
    clearTimeout(room.timer);
    room.closed = true;
    io.to(room.id).emit('room_closed');
    for (const t of room.spectators) {
        const l = live.get(t);
        if (l) l.specId = null;
    }
    io.in(room.id).socketsLeave(room.id);
    rooms.delete(room.id);
}

// ───────────────────────── الساعة ─────────────────────────
function scheduleFlag(room) {
    clearTimeout(room.timer);
    if (room.over || !room.running) return;
    const side = room.game.turn();
    if (room.type === 'ai' && side === room.aiColor) return;   // الحاسوب لا يخسر بسبب بطء الشبكة
    room.timer = setTimeout(() => onFlag(room, side), Math.max(0, room.clocks[side]) + 5);
}

// هل يستطيع هذا اللون نظريًا إنهاء المباراة بكش مات؟ (للتعادل عند نفاد وقت الخصم)
function canMate(fen, color) {
    const placement = fen.split(' ')[0];
    let minors = 0;
    for (const ch of placement) {
        const isMine = color === 'w' ? ch === ch.toUpperCase() : ch === ch.toLowerCase();
        if (!isMine || !/[a-z]/i.test(ch)) continue;
        const t = ch.toLowerCase();
        if (t === 'p' || t === 'r' || t === 'q') return true;
        if (t === 'n' || t === 'b') minors++;
    }
    return minors >= 2;
}

function timeoutResult(room, loser) {
    const winner = other(loser);
    if (!canMate(room.game.fen(), winner)) return { winner: null, reason: 'timevsinsufficient' };
    return { winner, reason: 'timeout' };
}

function onFlag(room, side) {
    if (room.over || room.closed || room.game.turn() !== side) return;
    room.clocks[side] = 0;
    endGame(room, timeoutResult(room, side));
}

const MAX_SAVED_GAMES = 20;
function saveGameRecords(room) {
    if (room.plies < 2 || !room.result || room.result.reason === 'aborted') return;
    const hist = room.game.history();
    ['w', 'b'].forEach((c) => {
        const t = room.players[c];
        const rec = t && db.players[t];
        if (!rec || !rec.user) return;
        if (!Array.isArray(rec.hist)) rec.hist = [];
        rec.hist.unshift({
            id: room.gameId, t: Date.now(), w: room.names.w || 'الأبيض', b: room.names.b || 'الأسود', c,
            tc: room.tcId, rated: !!room.rated, v: room.variant, sf: room.startFen, h: hist,
            res: { winner: room.result.winner || null, reason: room.result.reason }, ai: room.type === 'ai', an: null
        });
        if (rec.hist.length > MAX_SAVED_GAMES) rec.hist.length = MAX_SAVED_GAMES;
    });
    saveSoon();
}

// مؤشرات غش تُسجَّل للمراجعة اليدوية فقط (لا عقوبة تلقائية)
function fairPlayCheck(room) {
    if (room.type !== 'multi' || !room.rated || !room.matched || !room.mt || room.plies < 20) return;
    ['w', 'b'].forEach((c) => {
        const tok = room.players[c];
        const rec = tok && db.players[tok];
        if (!rec) return;
        const sig = safety.gameSignals({ moves: room.mt[c].slice(3), baseMs: room.timeSec * 1000, rated: true });
        safety.addFlags(rec, sig, room.gameId);
        if (rec.hist) safety.addFlags(rec, safety.risingSignals(rec.hist), room.gameId);
        if (sig.length) saveSoon();
    });
}

function endGame(room, result) {
    if (room.over) return;
    room.over = true;
    room.overAt = Date.now();
    room.result = result;
    room.drawOffer = null;
    clearTimeout(room.timer);
    room.lastTick = Date.now();
    if (room.rated && room.matched && room.plies >= 2 && result.reason !== 'aborted') {
        const ch = eloUpdate(room, result);
        if (ch) {
            room.result.delta = { w: ch.w, b: ch.b };
            room.result.newRatings = ch.ratings;
        }
    }
    try { fairPlayCheck(room); } catch (e) { /* لا يُعطّل إنهاء المباراة */ }
    saveGameRecords(room);
    broadcast(room);
    // أبلغ الغرفة بأن زر الإعادة لم يعد متاحًا إن غاب أحد الطرفين
    ['w', 'b'].forEach((c) => {
        if (!room.players[c] && room.type === 'multi') emitPlayers(room, 'opponent_left');
    });
}

// ───────────────────────── تطبيق الحركة ─────────────────────────
function applyMove(room, color, { from, to, promotion }) {
    if (room.over || room.closed || !room.matched || room.game.turn() !== color) return false;

    const now = Date.now();
    const wasRunning = room.running;
    let spent = 0;
    if (wasRunning) {
        spent = now - room.lastTick;
        // تفكير الحاسوب لا يُحتسب كاملًا (زمن الشبكة ليس تفكيرًا)
        if (room.type === 'ai' && color === room.aiColor) spent = Math.min(spent, 1200);
        room.clocks[color] -= spent;
        if (room.clocks[color] <= 0) {
            room.clocks[color] = 0;
            endGame(room, timeoutResult(room, color));
            return false;
        }
    }

    let mv;
    try {
        const promo = ['q', 'r', 'b', 'n'].includes(promotion) ? promotion : 'q';
        mv = room.game.move({ from, to, promotion: promo });
    } catch (e) {
        if (wasRunning) room.clocks[color] += spent;      // حركة غير قانونية: نعيد الوقت
        return false;
    }

    if (room.type === 'multi' && wasRunning) { room.mt = room.mt || { w: [], b: [] }; room.mt[color].push(spent); }
    room.plies++;
    room.lastMove = { from: mv.from, to: mv.to, san: mv.san, captured: !!mv.captured };
    if (wasRunning) room.clocks[color] += room.incMs;     // زيادة الوقت بعد الحركة
    if (!room.running && room.plies >= 2) room.running = true;
    room.lastTick = now;

    if (room.drawOffer && room.drawOffer !== color) {
        room.drawOffer = null;
        emitPlayers(room, 'draw_cleared');
    }

    const g = room.game;
    if (g.isCheckmate()) {
        endGame(room, { winner: color, reason: 'checkmate' });
    } else if (g.isStalemate()) {
        endGame(room, { winner: null, reason: 'stalemate' });
    } else if (g.isInsufficientMaterial()) {
        endGame(room, { winner: null, reason: 'insufficient' });
    } else if (g.isThreefoldRepetition()) {
        endGame(room, { winner: null, reason: 'repetition' });
    } else if (g.isDraw()) {
        endGame(room, { winner: null, reason: 'fifty' });
    } else {
        scheduleFlag(room);
        broadcast(room);
        if (room.type === 'ai' && g.turn() === room.aiColor) aiTurn(room);
    }
    return true;
}

// ───────────────────────── الذكاء الاصطناعي ─────────────────────────
let stockfishDownUntil = 0;
let analysisRunning = 0;

async function fetchStockfish(room) {
    if (Date.now() < stockfishDownUntil) return null;
    try {
        const res = await axios.get(STOCKFISH_URL, {
            params: { fen: room.game.fen(), depth: Math.min(15, room.aiLevel) },
            timeout: 6000
        });
        const text = res.data && res.data.success ? String(res.data.bestmove || '') : '';
        const m = /bestmove\s+([a-h][1-8])([a-h][1-8])([qrbn])?/.exec(text);
        if (m) return { from: m[1], to: m[2], promotion: m[3] };
        stockfishDownUntil = Date.now() + 30000;
    } catch (e) {
        console.error('Stockfish API error:', e.message);
        stockfishDownUntil = Date.now() + 60000;        // لا نكرر المحاولة فورًا
    }
    return null;
}

function localEngineMove(fen, level) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
        let w;
        try {
            w = new Worker(path.join(__dirname, 'engine-worker.js'), { workerData: { fen, level, timeMs: 1500 } });
        } catch (e) { return resolve(null); }
        const t = setTimeout(() => { w.terminate(); finish(null); }, 4000);
        w.once('message', (m) => finish(m && m.move));
        w.once('error', () => finish(null));
        w.once('exit', () => finish(null));
    });
}

function randomLegal(room) {
    const legal = room.game.moves({ verbose: true });
    if (!legal.length) return null;
    const p = legal[Math.floor(Math.random() * legal.length)];
    return { from: p.from, to: p.to, promotion: p.promotion };
}

async function aiTurn(room) {
    if (room.over || room.closed || room.aiBusy || room.game.turn() !== room.aiColor) return;
    room.aiBusy = true;
    try {
        let move = await fetchStockfish(room);
        if (!move) {
            move = await localEngineMove(room.game.fen(), room.aiLevel);
            if (!room.notifiedFallback) {
                room.notifiedFallback = true;
                emitPlayers(room, 'notice', 'محرك Stockfish غير متاح الآن، يلعب الحاسوب بمحرك احتياطي أبسط.');
            }
        }
        if (room.over || room.closed || room.game.turn() !== room.aiColor) return;
        if (!move) move = randomLegal(room);
        if (!move) return;
        if (!applyMove(room, room.aiColor, move)) {
            const alt = randomLegal(room);             // حركة الخادم الخارجي كانت غير صالحة
            if (alt) applyMove(room, room.aiColor, alt);
        }
    } finally {
        room.aiBusy = false;
    }
}

// ───────────────────────── المغادرة وإعادة الاتصال ─────────────────────────
function removeFromQueues(token) {
    for (const id of Object.keys(queues)) {
        queues[id] = queues[id].filter((e) => e.token !== token);
    }
}

// يُخرج اللاعب من مقعده. forfeit=true تعني أن مغادرته أثناء المباراة خسارة.
function leaveRoom(token, forfeit) {
    const l = live.get(token);
    if (!l) return;
    clearTimeout(l.grace);
    l.grace = null;
    const room = rooms.get(l.roomId);
    const spec = rooms.get(l.specId);
    l.roomId = null;
    l.color = null;
    l.specId = null;
    if (spec) spec.spectators.delete(token);
    const s = socketOf(token);
    if (s) {
        if (room) s.leave(room.id);
        if (spec) s.leave(spec.id);
    }
    if (!room) return;

    if (room.type === 'ai') return closeRoom(room);

    const color = room.players.w === token ? 'w' : room.players.b === token ? 'b' : null;
    if (!color) return;
    room.players[color] = null;
    room.disc[color] = null;

    if (room.matched && !room.over && room.players[other(color)]) {
        if (forfeit && room.plies >= 2) endGame(room, { winner: other(color), reason: 'abandoned' });
        else endGame(room, { winner: null, reason: 'aborted' });
    }
    emitPlayers(room, 'opponent_left');
    broadcast(room);
    if (!room.players.w && !room.players.b) closeRoom(room);
}

function onDisconnect(socket) {
    const token = socket.data.token;
    if (!token) return;
    const l = live.get(token);
    if (!l || l.socketId !== socket.id) return;     // استُبدل باتصال أحدث
    removeFromQueues(token);
    l.socketId = null;
    pushToFriends(token);

    const room = rooms.get(l.roomId);
    const spec = rooms.get(l.specId);
    if (spec) { spec.spectators.delete(token); l.specId = null; }
    if (!room) { live.delete(token); return; }

    const playing = room.type === 'multi' && room.matched && !room.over;
    const grace = playing ? GRACE_PLAYING_MS : GRACE_IDLE_MS;
    const color = l.color;
    if (playing) {
        room.disc[color] = Date.now() + grace;
        emitPlayers(room, 'opp_disconnected', { until: room.disc[color] });
        broadcast(room);
    }
    clearTimeout(l.grace);
    l.grace = setTimeout(() => {
        const cur = live.get(token);
        if (!cur || cur.socketId) return;
        leaveRoom(token, true);
        live.delete(token);
    }, grace);
}

// ───────────────────────── البحث عن خصم ─────────────────────────
function matchWindow(ms) {
    return ms >= 60000 ? Infinity : 100 + Math.floor(ms / 5000) * 50;
}
function createMatch(tcId, ta, tb) {
    const room = newRoom('multi', tcId);
    room.rated = true;
    const aWhite = Math.random() < 0.5;
    seat(aWhite ? ta : tb, room, 'w');
    seat(aWhite ? tb : ta, room, 'b');
    startMatch(room);
}
function tryMatch(tcId) {
    const q = queues[tcId];
    const now = Date.now();
    q.sort((a, b) => a.since - b.since);
    for (let i = 0; i < q.length; i++) {
        if (!isConnected(q[i].token)) { q.splice(i, 1); return true; }
        for (let j = i + 1; j < q.length; j++) {
            const a = q[i], b = q[j];
            const win = Math.max(matchWindow(now - a.since), matchWindow(now - b.since));
            if (isConnected(b.token) && Math.abs(a.rating - b.rating) <= win) {
                q.splice(j, 1);
                q.splice(i, 1);
                createMatch(tcId, a.token, b.token);
                return true;
            }
        }
    }
    return false;
}
function runMatchmaking() {
    for (const id of Object.keys(queues)) {
        while (tryMatch(id)) { /* استمر حتى لا يبقى زوجان متوافقان */ }
    }
}
const matchTimer = setInterval(runMatchmaking, 2000);
matchTimer.unref();

// تنظيف دوري للغرف المهجورة
const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
        const anyone = ['w', 'b'].some((c) => room.players[c] && isConnected(room.players[c]));
        if (!room.matched && now - room.createdAt > 20 * 60000) closeRoom(room);
        else if (room.over && now - room.overAt > 60 * 60000) closeRoom(room);
        else if (!anyone && !room.over && now - room.lastTick > 10 * 60000) closeRoom(room);
    }
}, 60000);
sweepTimer.unref();

// ───────────────────────── Express ─────────────────────────
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval' https://code.jquery.com https://cdnjs.cloudflare.com https://unpkg.com",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://cdn.jsdelivr.net",
        "connect-src 'self' ws: wss:",
        "base-uri 'none'",
        "form-action 'none'"
    ].join('; '));
    next();
});

const nm = (p) => path.join(__dirname, 'node_modules', p);
app.use('/vendor/jquery', express.static(nm('jquery/dist'), { maxAge: '7d' }));
app.use('/vendor/chessboard', express.static(nm('@chrisoakman/chessboardjs/dist'), { maxAge: '7d' }));
app.use('/vendor/chess', express.static(nm('chess-legacy'), { maxAge: '7d' }));
// Stockfish (WASM) لتحليل المباريات داخل متصفح اللاعب. الحزمة اختيارية، فإن غابت يعمل التحليل على الخادم.
function findStockfish() {
    const root = nm('stockfish');
    try {
        if (!fs.existsSync(root)) return null;
        const files = [];
        const walk = (dir, depth) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.name === 'node_modules') continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) { if (depth < 3) walk(full, depth + 1); }
                else if (/\.js$/i.test(e.name)) files.push(path.relative(root, full).split(path.sep).join('/'));
            }
        };
        walk(root, 0);
        let best = null;
        for (const rel of files) {
            const base = path.basename(rel).toLowerCase();
            if (/thread|multi|worker|test|index|cli|node/.test(base)) continue;      // نريد نسخة أحادية الخيط تعمل داخل Worker
            const hasWasm = fs.existsSync(path.join(root, rel.replace(/\.js$/i, '.wasm')));
            let score = 0;
            if (hasWasm && /single/.test(base) && /lite/.test(base)) score = 4;
            else if (hasWasm && /single/.test(base)) score = 3;
            else if (/asm/.test(base)) score = 2;
            else if (base === 'stockfish.js' && !hasWasm && /(^|\/)src\//.test(rel) && fs.statSync(path.join(root, rel)).size > 300000) score = 1;
            if (score && (!best || score > best.score || (score === best.score && rel > best.rel))) best = { rel, score };
        }
        return best ? best.rel : null;
    } catch (e) {
        console.error('stockfish discovery failed:', e.message);
        return null;
    }
}
let sfFile;
app.get('/vendor/stockfish/manifest.json', (req, res) => {
    if (sfFile === undefined) { sfFile = findStockfish(); console.log('Browser Stockfish: ' + (sfFile || 'not installed')); }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ file: sfFile });
});
app.use('/vendor/stockfish', express.static(nm('stockfish'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

// ───── لوحة المشرف (تتطلب المتغير ADMIN_KEY في Render) ─────
function adminOk(req) {
    const key = process.env.ADMIN_KEY;
    const got = String(req.query.key || '');
    if (!key || key.length < 12 || got.length !== key.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key));
}
app.get('/admin/safety', (req, res) => {
    if (!adminOk(req)) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.json(safety.summary(db));
});
app.get('/admin/mute', (req, res) => {
    if (!adminOk(req)) return res.status(404).end();
    const tok = db.users[String(req.query.user || '').toLowerCase().replace(/^@/, '')];
    if (!tok || !db.players[tok]) return res.status(404).json({ ok: false, error: 'مستخدم غير موجود' });
    const hours = Math.max(0, Math.min(24 * 365, parseFloat(req.query.hours) || 0));
    db.players[tok].mutedUntil = hours ? Date.now() + hours * 3600 * 1000 : 0;
    saveSoon();
    res.json({ ok: true, hours });
});
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, online: io.engine.clientsCount }));
app.get('/api/leaderboard', (req, res) => res.json({ cat: req.query.cat, rows: leaderboard(String(req.query.cat || 'blitz')) }));

// ───────────────────────── Socket.IO ─────────────────────────
// ───────────────────────── الحسابات والأصدقاء ─────────────────────────
const scryptAsync = (pw, salt) => new Promise((res, rej) => {
    crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k)));
});
async function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const key = await scryptAsync(pw, salt);
    return { s: salt.toString('hex'), h: key.toString('hex') };
}
async function verifyPassword(pw, rec) {
    const key = await scryptAsync(pw, Buffer.from(rec.s, 'hex'));
    const want = Buffer.from(rec.h, 'hex');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
}
function cleanUser(v) {
    return String(v == null ? '' : v).normalize('NFC').replace(/[^\w\u0600-\u06FF]/g, '').slice(0, 20);
}
function validateCreds(u, pw) {
    if (u.length < 3) return 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل (حروف وأرقام و _ فقط).';
    if (typeof pw !== 'string' || pw.length < 6) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
    if (pw.length > 100) return 'كلمة المرور طويلة جدًا.';
    return null;
}
const loginFails = new Map();           // مفتاح -> { n, until }
function tooManyFails(key) {
    const f = loginFails.get(key);
    if (!f) return false;
    if (Date.now() > f.until) { loginFails.delete(key); return false; }
    return f.n >= 6;
}
function addFail(key) {
    const f = loginFails.get(key);
    if (!f || Date.now() > f.until) loginFails.set(key, { n: 1, until: Date.now() + 10 * 60000 });
    else f.n++;
}
const uname = (t) => (db.players[t] && db.players[t].user) || null;
function ensureSocial(rec) {
    rec.friends = rec.friends || [];
    rec.reqIn = rec.reqIn || [];
    rec.reqOut = rec.reqOut || [];
}
function statusOf(t) {
    const l = live.get(t);
    if (!l || !l.socketId) return 'offline';
    const room = rooms.get(l.roomId);
    if (room && room.matched && !room.over) return 'playing';
    for (const id of Object.keys(queues)) if (queues[id].some((e) => e.token === t)) return 'searching';
    return 'online';
}
function watchRoom(t) {
    const l = live.get(t);
    const room = l && rooms.get(l.roomId);
    return room && room.type === 'multi' && room.matched && !room.over && room.plies >= 2 ? room.id : null;
}
function friendsPayload(token) {
    const rec = db.players[token];
    ensureSocial(rec);
    return {
        friends: rec.friends.filter(uname).map((t) => ({ username: uname(t), status: statusOf(t), rating: ratingOf(t, 'blitz'), watch: watchRoom(t) })),
        incoming: rec.reqIn.map(uname).filter(Boolean),
        outgoing: rec.reqOut.map(uname).filter(Boolean)
    };
}
function pushFriends(token) {
    const rec = db.players[token];
    const l = live.get(token);
    if (rec && rec.user && l && l.socketId) io.to(l.socketId).emit('friends', friendsPayload(token));
}
function pushToFriends(token) {
    const rec = db.players[token];
    if (rec && rec.user && rec.friends) rec.friends.forEach(pushFriends);
}
function unlink(a, b) {
    [[a, b], [b, a]].forEach(([x, y]) => {
        const r = db.players[x];
        if (!r) return;
        ensureSocial(r);
        r.friends = r.friends.filter((t) => t !== y);
        r.reqIn = r.reqIn.filter((t) => t !== y);
        r.reqOut = r.reqOut.filter((t) => t !== y);
    });
}
function link(a, b) {
    unlink(a, b);
    db.players[a].friends.push(b);
    db.players[b].friends.push(a);
}

function sendWelcome(socket, token, rec) {
    socket.emit('welcome', {
        token, name: rec.name, user: rec.user || null,
        ratings: publicRatings(token), online: io.engine.clientsCount,
        pz: rec.user && rec.pz ? rec.pz : null
    });
}

// يربط اتصالًا بسجل لاعب (وهو أيضًا ما يستأنف المباراة الجارية)
function attach(socket, token, rec) {
    const prev = live.get(token);
    let entry;
    if (prev) {
        clearTimeout(prev.grace);
        prev.grace = null;
        if (prev.socketId && prev.socketId !== socket.id) {
            const old = io.sockets.sockets.get(prev.socketId);
            if (old) { old.data.token = null; old.emit('replaced'); old.disconnect(true); }
        }
        entry = prev;
        entry.socketId = socket.id;
    } else {
        entry = { socketId: socket.id, roomId: null, color: null, specId: null, grace: null };
        live.set(token, entry);
    }
    socket.data.token = token;
    sendWelcome(socket, token, rec);
    if (rec.user) { pushFriends(token); pushToFriends(token); }

    const room = rooms.get(entry.roomId);
    if (room && !room.closed) {
        socket.join(room.id);
        const color = entry.color;
        room.disc[color] = null;
        if (room.matched) {
            socket.emit('game_start', gameStartPayload(room, color, true));
            socket.emit('state', publicState(room));
            if (room.drawOffer && room.drawOffer !== color) socket.emit('draw_offered');
            emitPlayers(room, 'opp_reconnected');
            broadcast(room);
        } else {
            socket.emit('room_created', { roomId: room.id, tc: room.tcId });
        }
    } else if (entry.roomId) {
        entry.roomId = null;
        entry.color = null;
    }
    if (!rooms.get(entry.specId)) entry.specId = null;
}

function playerCtx(socket) {
    const token = socket.data.token;
    if (!token) return null;
    const l = live.get(token);
    if (!l || l.socketId !== socket.id) return null;
    const room = rooms.get(l.roomId);
    return { token, l, room, color: l.color };
}

app.get('/monopoly-board.json', (req, res) => res.json(require('./monopoly').BOARD));
// دعوة لاعب إلى مباراة ودّية (للأصدقاء ولأعضاء النادي). تعيد نص الخطأ أو null
function sendInvite(socket, token, target, data) {
    const st = statusOf(target);
    if (st === 'offline') return 'اللاعب غير متصل الآن.';
    if (st === 'playing') return 'اللاعب في مباراة الآن.';
    const inviter = db.players[token];
    const tcId = resolveTc(data) || DEFAULT_TC;
    removeFromQueues(token);
    leaveRoom(token, true);
    const room = newRoom('multi', tcId, resolveVariant(data));
    seat(token, room, 'w');
    socket.emit('room_created', { roomId: room.id, tc: tcId, variant: room.variant });
    emitTo(target, 'invite', { from: inviter.user, roomId: room.id, tc: tcId, variant: room.variant });
    return null;
}

// الأندية
const clubs = require('./clubs').init({
    getDb: () => db, saveSoon, playerCtx, emitTo, uname, ratingOf, statusOf, safety,
    tokenOfUser: (n) => db.users[cleanUser(n).toLowerCase()] || null,
    challenge: (socket, token, target) => sendInvite(socket, token, target, {})
});

// الدردشة الصوتية في ملك المدينة (WebRTC). voice يغلّف io ليتتبّع عضوية الغرف من رسائل الخادم نفسه
const voice = require('./voice').init({ io, nameOf: (t) => (db.players[t] && db.players[t].name) || 'لاعب' });
require('./monopoly').attach(voice.wrapIo(io), { nameOf: (t) => (db.players[t] && db.players[t].name) || 'لاعب' });

io.on('connection', (socket) => {
    socket.data.token = null;
    socket.data.bucket = { tokens: 40, t: Date.now() };
    socket.data.chatLog = [];

    // تحديد المعدل: ~20 حدثًا في الثانية مع دفعة 40
    socket.use((packet, next) => {
        const b = socket.data.bucket;
        const now = Date.now();
        b.tokens = Math.min(40, b.tokens + ((now - b.t) / 1000) * 20);
        b.t = now;
        if (b.tokens < 1) return next(new Error('rate_limited'));
        b.tokens -= 1;
        next();
    });

    // أول حدث يجب أن يرسله العميل: التعريف بنفسه (أو إنشاء هوية جديدة)
    socket.on('hello', (data) => {
        data = data && typeof data === 'object' ? data : {};
        let token = typeof data.token === 'string' && TOKEN_RE.test(data.token) ? data.token : null;
        let rec = token ? db.players[token] : null;
        let changed = false;
        if (!rec) {
            token = crypto.randomBytes(18).toString('base64url');
            rec = db.players[token] = newPlayer();
            changed = true;
        }
        const nm_ = safety.safeName(cleanName(data.name), 'لاعب');
        if (nm_ && !rec.user && rec.name !== nm_) { rec.name = nm_; changed = true; }
        rec.last = Date.now();
        if (changed) saveSoon();
        attach(socket, token, rec);
    });

    socket.on('get_online', () => socket.emit('online', { online: io.engine.clientsCount, rooms: rooms.size }));

    socket.on('set_name', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        const n = safety.safeName(cleanName(data && data.name), 'لاعب');
        if (db.players[ctx.token].user) return;      // اسم الحساب المسجل ثابت
        db.players[ctx.token].name = n;
        saveSoon();
    });

    // ───── مباريات الحساب المحفوظة ومزامنة الألغاز ─────
    function acct() {
        const ctx = playerCtx(socket);
        const rec = ctx && db.players[ctx.token];
        return rec && rec.user ? { ctx, rec } : null;
    }
    socket.on('games_get', () => {
        const a = acct();
        if (!a) return socket.emit('games', []);
        socket.emit('games', (a.rec.hist || []).map((g) => ({
            id: g.id, t: g.t, w: g.w, b: g.b, c: g.c, tc: g.tc, rated: g.rated, v: g.v, res: g.res, ai: g.ai, n: g.h.length, an: !!g.an
        })));
    });
    socket.on('game_get', (data) => {
        const a = acct();
        const g = a && (a.rec.hist || []).find((x) => x.id === String((data && data.id) || ''));
        if (!g) return socket.emit('games_error', 'المباراة غير موجودة.');
        let an = null;
        if (g.an && Array.isArray(g.an.p)) {
            const startTurn = g.sf ? g.sf.split(' ')[1] : 'w';
            an = {
                source: g.an.src, accuracy: g.an.acc, counts: g.an.counts,
                plies: g.an.p.map((x, i) => ({ san: g.h[i], color: ((i % 2 === 0) === (startTurn === 'w')) ? 'w' : 'b', cls: x[0], loss: x[1], cp: x[2], best: x[3] }))
            };
        }
        socket.emit('game_data', { id: g.id, t: g.t, w: g.w, b: g.b, c: g.c, tc: g.tc, rated: g.rated, v: g.v, sf: g.sf, h: g.h, res: g.res, ai: g.ai, an });
    });
    socket.on('pz_save', (d) => {
        const a = acct();
        if (!a || !d || typeof d !== 'object') return;
        const ids = (x) => (Array.isArray(x) && x.length <= 2000 && x.every((n) => Number.isInteger(n) && n >= 1 && n <= 99999) ? x : null);
        const solved = ids(d.solved);
        const rated = ids(d.rated);
        const rating = Number(d.rating);
        const streak = Number(d.streak);
        if (!solved || !rated || !Number.isFinite(rating) || rating < 100 || rating > 4000) return;
        a.rec.pz = { r: Math.round(rating), s: solved, d: rated, k: Number.isFinite(streak) && streak >= 0 ? Math.min(9999, Math.floor(streak)) : 0 };
        saveSoon();
    });

    // تحليل مباراة منتهية: يرسل العميل السجل فقط والخادم يعيد تقييم كل حركة
    socket.on('analyze', async (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        if (socket.data.analyzing) return socket.emit('analysis_error', 'التحليل جارٍ بالفعل.');
        if (analysisRunning >= 3) return socket.emit('analysis_error', 'الخادم مشغول بتحليلات أخرى، حاول بعد قليل.');
        const hist = data && data.history;
        const okHist = Array.isArray(hist) && hist.length >= 1 && hist.length <= 400 && hist.every((m) => typeof m === 'string' && /^[A-Za-z0-9+#=\-]{2,10}$/.test(m));
        let startFen = data && typeof data.startFen === 'string' ? data.startFen.slice(0, 100) : null;
        if (!okHist) return socket.emit('analysis_error', 'بيانات المباراة غير صالحة.');
        if (startFen) { try { new Chess(startFen); } catch (e) { startFen = null; } }
        // تقييمات محسوبة في متصفح اللاعب (اختيارية): { cp, best } لكل مركز
        let evals = null;
        if (data && Array.isArray(data.evals) && data.evals.length === hist.length + 1) {
            const good = data.evals.every((e) => e && Number.isFinite(e.cp) && (e.best == null || /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(e.best)) && (e.alt == null || Number.isFinite(e.alt)));
            const clamp = (x) => Math.max(-10000, Math.min(10000, Math.round(x)));
            if (good) evals = data.evals.map((e) => ({ cp: clamp(e.cp), best: e.best || null, alt: e.alt == null ? null : clamp(e.alt) }));
        }
        socket.data.analyzing = true;
        analysisRunning++;
        try {
            const result = await analyzeGame(startFen, hist, (done, total) => socket.emit('analysis_progress', { done, total }), evals);
            socket.emit('analysis_result', result);
            // حفظ التحليل مع المباراة المحفوظة في الحساب
            const rec = db.players[ctx.token];
            const gid = data && typeof data.gameId === 'string' ? data.gameId : null;
            const sg = gid && rec && rec.user && Array.isArray(rec.hist) ? rec.hist.find((g) => g.id === gid) : null;
            if (sg && sg.h.length === hist.length && sg.h.every((m, i) => m === hist[i])) {
                sg.an = { src: result.source, acc: result.accuracy, counts: result.counts, p: result.plies.map((x) => [x.cls, x.loss, x.cp, x.best]) };
                saveSoon();
            }
        } catch (e) {
            console.error('analysis error:', e.message);
            socket.emit('analysis_error', 'تعذّر تحليل هذه المباراة.');
        } finally {
            analysisRunning--;
            socket.data.analyzing = false;
        }
    });

    socket.on('leaderboard', (data) => {
        const cat = data && typeof data.cat === 'string' ? data.cat : 'blitz';
        socket.emit('leaderboard', { cat: CATEGORIES.includes(cat) ? cat : 'blitz', rows: leaderboard(cat) });
    });

    socket.on('create_room', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        const tcId = resolveTc(data);
        if (!tcId) return socket.emit('room_error', 'نظام الوقت غير صالح.');
        removeFromQueues(ctx.token);
        leaveRoom(ctx.token, true);
        const room = newRoom('multi', tcId, resolveVariant(data));
        seat(ctx.token, room, 'w');
        socket.emit('room_created', { roomId: room.id, tc: tcId, variant: room.variant });
    });

    socket.on('join_room', (payload) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        const data = payload && typeof payload === 'object' ? payload : { roomId: payload };
        const roomId = String(data.roomId || '').trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room || room.type !== 'multi') return socket.emit('room_error', 'الغرفة غير موجودة.');
        if (room.players.w === ctx.token || room.players.b === ctx.token) return socket.emit('room_error', 'هذه غرفتك أنت، أرسل الكود لصديقك.');
        if (room.players.b || room.matched || room.over) return socket.emit('room_error', 'الغرفة ممتلئة أو انتهت اللعبة فيها.');
        removeFromQueues(ctx.token);
        leaveRoom(ctx.token, true);
        seat(ctx.token, room, 'b');
        startMatch(room);
    });

    socket.on('find_match', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        const tcId = resolveTc(data);
        if (!tcId) return socket.emit('room_error', 'نظام الوقت غير صالح.');
        removeFromQueues(ctx.token);
        leaveRoom(ctx.token, true);
        const cat = categoryOf(TIME_CONTROLS[tcId]);
        queues[tcId].push({ token: ctx.token, rating: ratingOf(ctx.token, cat), since: Date.now() });
        socket.emit('searching', { tc: tcId });
        runMatchmaking();
    });

    socket.on('cancel_search', () => {
        const ctx = playerCtx(socket);
        if (ctx) removeFromQueues(ctx.token);
        socket.emit('search_cancelled');
    });

    socket.on('create_ai_room', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        data = data || {};
        const tcId = resolveTc(data);
        if (!tcId) return socket.emit('room_error', 'نظام الوقت غير صالح.');
        const color = data.color === 'b' ? 'b' : 'w';
        const level = Math.min(15, Math.max(1, parseInt(data.level, 10) || 8));

        removeFromQueues(ctx.token);
        leaveRoom(ctx.token, true);
        const room = newRoom('ai', tcId, resolveVariant(data));
        room.matched = true;
        room.aiLevel = level;
        room.aiColor = other(color);
        seat(ctx.token, room, color);
        room.names[room.aiColor] = 'الحاسوب';
        room.ratings[color] = ratingOf(ctx.token, room.cat);
        socket.emit('game_start', gameStartPayload(room, color));
        broadcast(room);
        if (room.aiColor === 'w') aiTurn(room);
    });

    socket.on('spectate', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        if (ctx.room && !ctx.room.over) return socket.emit('room_error', 'أنهِ مباراتك أولًا.');
        const room = rooms.get(String((data && data.roomId) || '').trim().toUpperCase());
        if (!room || room.type !== 'multi' || !room.matched) return socket.emit('room_error', 'لا توجد مباراة بهذا الكود.');
        leaveRoom(ctx.token, true);
        ctx.l.specId = room.id;
        room.spectators.add(ctx.token);
        socket.join(room.id);
        socket.emit('spectate_start', { roomId: room.id, tc: room.tcId, rated: room.rated });
        socket.emit('state', publicState(room));
        broadcast(room);
    });

    // ───── المباريات المباشرة: العلنية (المصنَّفة) لكل الناس، والودّية لأصدقاء اللاعبين فقط ─────
    socket.on('live_games', () => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        const me = db.players[ctx.token];
        const friends = new Set((me && me.user && me.friends) || []);
        const list = [];
        for (const room of rooms.values()) {
            if (room.type !== 'multi' || !room.matched || room.over || !room.game || room.plies < 2) continue;
            if (room.players.w === ctx.token || room.players.b === ctx.token) continue;
            const fr = friends.has(room.players.w) || friends.has(room.players.b);
            if (!room.rated && !fr) continue;
            const rw = room.ratings.w || 0;
            const rb = room.ratings.b || 0;
            list.push({
                id: room.id, tc: room.tcId, rated: !!room.rated, v: room.variant, n: room.plies, sp: room.spectators.size, fr,
                w: { name: room.names.w, r: room.ratings.w }, b: { name: room.names.b, r: room.ratings.b }, avg: Math.round((rw + rb) / 2)
            });
        }
        list.sort((a, b) => (b.fr - a.fr) || (b.avg - a.avg) || (b.n - a.n));
        socket.emit('live_list', list.slice(0, 12));
    });

    socket.on('leave_room', () => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        removeFromQueues(ctx.token);
        leaveRoom(ctx.token, true);
        socket.emit('left');
    });

    socket.on('move', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx || !ctx.room || !data || typeof data.from !== 'string' || typeof data.to !== 'string') return;
        const ok = applyMove(ctx.room, ctx.color, {
            from: data.from,
            to: data.to,
            promotion: typeof data.promotion === 'string' ? data.promotion : undefined
        });
        if (!ok && !ctx.room.over) socket.emit('state', publicState(ctx.room));
    });

    // ───── الإبلاغ عن لاعب ─────
    socket.on('report', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx || !ctx.room || ctx.room.type !== 'multi' || !ctx.room.matched || !data || typeof data.reason !== 'string') return;
        const target = ctx.room.players[other(ctx.color)];
        if (!target || !db.players[target]) return socket.emit('toast', 'لا يمكن الإبلاغ الآن.');
        const r = safety.addReport(db, { reporter: ctx.token, target, reason: data.reason, gameId: ctx.room.gameId });
        if (!r.ok) return socket.emit('toast', r.error);
        saveSoon();
        socket.emit('toast', 'تم استلام بلاغك. شكرًا لمساعدتنا في إبقاء المنصة نظيفة.');
    });

    socket.on('chat', (data) => {
        const ctx = playerCtx(socket);
        if (!ctx || !ctx.room || ctx.room.type !== 'multi' || !data || typeof data.message !== 'string') return;
        const now = Date.now();
        socket.data.chatLog = socket.data.chatLog.filter((t) => now - t < 8000);
        if (socket.data.chatLog.length >= 5) return socket.emit('toast', 'تكتب بسرعة كبيرة، تمهّل قليلًا.');
        let message = cleanChat(data.message);
        if (!message) return;
        if (safety.isMuted(db.players[ctx.token], now)) return socket.emit('toast', 'تم تقييد الدردشة لحسابك مؤقتًا بسبب بلاغات من لاعبين.');
        socket.data.spam = socket.data.spam || {};
        if (safety.isSpam(socket.data.spam, message, now)) return socket.emit('toast', 'لا تكرر الرسالة نفسها.');
        message = safety.filterText(message).text;
        socket.data.chatLog.push(now);
        const opp = ctx.room.players[other(ctx.color)];
        if (opp) emitTo(opp, 'chat', { message });
    });

    socket.on('resign', () => {
        const ctx = playerCtx(socket);
        if (!ctx || !ctx.room || ctx.room.over || !ctx.room.matched) return;
        endGame(ctx.room, { winner: other(ctx.color), reason: 'resign' });
    });

    // إلغاء المباراة قبل أن يتحرك الطرفان (دون تأثير على التصنيف)
    socket.on('abort', () => {
        const ctx = playerCtx(socket);
        const room = ctx && ctx.room;
        if (!room || room.over || !room.matched) return;
        if (room.plies >= 2) return socket.emit('toast', 'لا يمكن الإلغاء بعد أول حركتين.');
        endGame(room, { winner: null, reason: 'aborted' });
    });

    // ───── اقتراح التعادل ─────
    socket.on('offer_draw', () => {
        const ctx = playerCtx(socket);
        const room = ctx && ctx.room;
        if (!room || room.type !== 'multi' || room.over || !room.matched) return;
        const color = ctx.color;
        if (room.drawOffer && room.drawOffer !== color) return endGame(room, { winner: null, reason: 'agreement' });
        if (room.drawOffer === color) return;
        if (room.plies < 2) return socket.emit('toast', 'يمكن اقتراح التعادل بعد أول حركتين.');
        if (room.plies - room.lastDrawPly[color] < 2) return socket.emit('toast', 'انتظر حركة قبل اقتراح التعادل مرة أخرى.');
        room.lastDrawPly[color] = room.plies;
        room.drawOffer = color;
        emitTo(room.players[other(color)], 'draw_offered');
        socket.emit('draw_sent');
    });

    socket.on('respond_draw', (data) => {
        const ctx = playerCtx(socket);
        const room = ctx && ctx.room;
        if (!room || room.type !== 'multi' || room.over || !room.drawOffer) return;
        if (room.drawOffer === ctx.color) return;
        const offerer = room.drawOffer;
        room.drawOffer = null;
        if (data && data.accept) endGame(room, { winner: null, reason: 'agreement' });
        else if (room.players[offerer]) emitTo(room.players[offerer], 'draw_declined');
    });

    // ───── إعادة المباراة بتبديل الألوان ─────
    socket.on('rematch', () => {
        const ctx = playerCtx(socket);
        const room = ctx && ctx.room;
        if (!room || room.type !== 'multi' || !room.over) return;
        if (!room.players.w || !room.players.b) return socket.emit('toast', 'غادر الخصم المباراة.');
        room.rematch[ctx.color] = true;
        if (room.rematch.w && room.rematch.b) {
            resetForRematch(room);
            startMatch(room);
        } else {
            emitTo(room.players[other(ctx.color)], 'rematch_offered');
        }
    });

    // ───── تسجيل الحساب والدخول ─────
    socket.on('register', async (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        data = data && typeof data === 'object' ? data : {};
        const token = ctx.token;
        const rec = db.players[token];
        if (rec.user) return socket.emit('auth_error', 'لديك حساب بالفعل.');
        const u = cleanUser(data.username);
        const pw = typeof data.password === 'string' ? data.password : '';
        const err = validateCreds(u, pw);
        if (err) return socket.emit('auth_error', err);
        if (safety.filterText(u).flagged) return socket.emit('auth_error', 'اسم المستخدم غير مناسب، اختر اسمًا آخر.');
        if (db.users[u.toLowerCase()]) return socket.emit('auth_error', 'اسم المستخدم مستخدم، اختر اسمًا آخر.');
        let h;
        try { h = await hashPassword(pw); } catch (e) { return socket.emit('auth_error', 'تعذّر إنشاء الحساب، حاول مرة أخرى.'); }
        if (db.users[u.toLowerCase()]) return socket.emit('auth_error', 'اسم المستخدم مستخدم، اختر اسمًا آخر.');
        if (!playerCtx(socket) || playerCtx(socket).token !== token) return;
        rec.user = u;
        rec.pass = h;
        rec.name = u;
        ensureSocial(rec);
        db.users[u.toLowerCase()] = token;
        saveSoon();
        sendWelcome(socket, token, rec);
        pushFriends(token);
        socket.emit('auth_ok', { user: u });
    });

    socket.on('login', async (data) => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        data = data && typeof data === 'object' ? data : {};
        const u = cleanUser(data.username);
        const pw = typeof data.password === 'string' ? data.password.slice(0, 100) : '';
        const key = u.toLowerCase();
        socket.data.fails = socket.data.fails || 0;
        if (tooManyFails(key) || socket.data.fails >= 8) return socket.emit('auth_error', 'محاولات كثيرة، حاول بعد عشر دقائق.');
        const token = db.users[key];
        const rec = token && db.players[token];
        let ok = false;
        try { ok = !!(rec && rec.pass && await verifyPassword(pw, rec.pass)); } catch (e) { ok = false; }
        if (!ok) {
            addFail(key);
            socket.data.fails++;
            return socket.emit('auth_error', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
        }
        const cur = playerCtx(socket);
        if (!cur) return;
        socket.data.fails = 0;
        loginFails.delete(key);
        const old = cur.token;
        if (old !== token) {
            // نغادر مقعد الضيف الحالي ثم ننتقل إلى الحساب
            removeFromQueues(old);
            leaveRoom(old, true);
            const lo = live.get(old);
            if (lo) clearTimeout(lo.grace);
            live.delete(old);
            socket.data.token = null;
        }
        rec.last = Date.now();
        attach(socket, token, rec);
        socket.emit('auth_ok', { user: rec.user });
    });

    socket.on('logout', () => {
        const ctx = playerCtx(socket);
        if (!ctx) return;
        const old = ctx.token;
        removeFromQueues(old);
        leaveRoom(old, true);
        const lo = live.get(old);
        if (lo) clearTimeout(lo.grace);
        live.delete(old);
        pushToFriends(old);
        const token = crypto.randomBytes(18).toString('base64url');
        const rec = db.players[token] = newPlayer();
        saveSoon();
        socket.data.token = null;
        attach(socket, token, rec);
        socket.emit('logged_out');
    });

    // ───── الأصدقاء ─────
    function accountCtx() {
        const ctx = playerCtx(socket);
        if (!ctx) return null;
        const rec = db.players[ctx.token];
        if (!rec || !rec.user) { socket.emit('friend_error', 'سجّل الدخول أولًا لاستخدام قائمة الأصدقاء.'); return null; }
        ensureSocial(rec);
        return { ...ctx, rec };
    }

    socket.on('friends_get', () => {
        const a = accountCtx();
        if (a) pushFriends(a.token);
    });

    socket.on('friend_add', (data) => {
        const a = accountCtx();
        if (!a) return;
        const target = db.users[cleanUser(data && data.username).toLowerCase()];
        if (!target) return socket.emit('friend_error', 'لا يوجد مستخدم بهذا الاسم.');
        if (target === a.token) return socket.emit('friend_error', 'لا يمكنك إضافة نفسك.');
        const other_ = db.players[target];
        ensureSocial(other_);
        if (a.rec.friends.includes(target)) return socket.emit('friend_error', 'هو صديقك بالفعل.');
        if (a.rec.reqOut.includes(target)) return socket.emit('friend_error', 'أرسلت له طلبًا بالفعل.');
        if (a.rec.reqIn.includes(target)) {
            link(a.token, target);                       // طلب متبادل: صداقة فورية
            emitTo(target, 'notify', { text: a.rec.user + ' قبل طلب صداقتك.' });
        } else {
            if (other_.reqIn.length >= 100) return socket.emit('friend_error', 'لدى هذا المستخدم طلبات كثيرة معلّقة.');
            a.rec.reqOut.push(target);
            other_.reqIn.push(a.token);
            emitTo(target, 'notify', { text: 'طلب صداقة جديد من ' + a.rec.user });
        }
        saveSoon();
        pushFriends(a.token);
        pushFriends(target);
        socket.emit('friend_ok', 'تم إرسال الطلب.');
    });

    socket.on('friend_respond', (data) => {
        const a = accountCtx();
        if (!a) return;
        const target = db.users[cleanUser(data && data.username).toLowerCase()];
        if (!target || !a.rec.reqIn.includes(target)) return;
        if (data.accept) {
            link(a.token, target);
            emitTo(target, 'notify', { text: a.rec.user + ' قبل طلب صداقتك.' });
        } else {
            unlink(a.token, target);
        }
        saveSoon();
        pushFriends(a.token);
        pushFriends(target);
    });

    socket.on('friend_remove', (data) => {
        const a = accountCtx();
        if (!a) return;
        const target = db.users[cleanUser(data && data.username).toLowerCase()];
        if (!target) return;
        unlink(a.token, target);
        saveSoon();
        pushFriends(a.token);
        pushFriends(target);
    });

    // دعوة صديق إلى مباراة ودّية
    socket.on('friend_invite', (data) => {
        const a = accountCtx();
        if (!a) return;
        const target = db.users[cleanUser(data && data.username).toLowerCase()];
        if (!target || !a.rec.friends.includes(target)) return socket.emit('friend_error', 'هذا المستخدم ليس في قائمة أصدقائك.');
        const err = sendInvite(socket, a.token, target, data);
        if (err) socket.emit('friend_error', err);
    });

    socket.on('invite_decline', (data) => {
        const a = accountCtx();
        if (!a) return;
        const target = db.users[cleanUser(data && data.username).toLowerCase()];
        if (target) emitTo(target, 'notify', { text: a.rec.user + ' رفض دعوتك.' });
    });

    clubs.register(socket);
    voice.register(socket);

    socket.on('disconnect', () => onDisconnect(socket));
});

// ───────────────────────── التشغيل والإيقاف ─────────────────────────
async function start(port) {
    await loadDb();
    return new Promise((resolve) => {
        server.listen(port === undefined ? PORT : port, () => {
            console.log(`Server running on port ${server.address().port}`);
            resolve(server);
        });
    });
}

function shutdown() {
    const flushed = flushDb();
    clearInterval(matchTimer);
    clearInterval(sweepTimer);
    io.close();
    server.close(() => Promise.resolve(flushed).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
}

if (require.main === module) {
    start();
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

module.exports = { server, io, app, start, shutdown, rooms, live, db: () => db };
