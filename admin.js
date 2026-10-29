'use strict';
// لوحة الإدارة: واجهة ويب + واجهات JSON. المفتاح يُرسل في ترويسة x-admin-key (وليس في الرابط).
const express = require('express');

function attach(app, d) {
    const api = express.Router();
    api.use(express.json({ limit: '4kb' }));
    api.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (!d.adminOk(req)) return res.status(404).end();
        next();
    });
    const find = (u) => {
        const tok = d.db().users[String(u || '').toLowerCase().replace(/^@/, '')];
        return tok && d.db().players[tok] ? { tok, rec: d.db().players[tok] } : null;
    };
    const clubOf = (tok) => { try { return require('./clubs').clubOf(d.db(), tok); } catch (e) { return null; } };
    const row = (tok, rec) => {
        const c = clubOf(tok);
        const best = Math.max(0, ...Object.values(rec.r || {}).map((x) => (x && x.r) || 0));
        return {
            user: rec.user, created: rec.created || 0, last: rec.last || 0, games: rec.games || 0, best,
            club: c ? c.name : null, online: d.isConnected(tok),
            muted: !!(rec.mutedUntil && rec.mutedUntil > Date.now()), mutedUntil: rec.mutedUntil || 0,
            banned: !!rec.banned, flags: rec.flags || 0, ach: Object.keys(rec.ach || {}).length
        };
    };

    api.post('/stats', (req, res) => {
        const db = d.db();
        const accounts = Object.values(db.players).filter((p) => p.user);
        const day = Date.now() - 24 * 3600 * 1000;
        res.json({
            ok: true, storage: d.storage(),
            players: Object.keys(db.players).length, accounts: accounts.length,
            active24h: accounts.filter((p) => (p.last || 0) > day).length,
            new24h: accounts.filter((p) => (p.created || 0) > day).length,
            online: d.io.engine.clientsCount, rooms: d.rooms.size,
            clubs: Object.keys(db.clubs || {}).length, tourneys: Object.keys(db.tourneys || {}).length,
            banned: accounts.filter((p) => p.banned).length,
            uptimeMin: Math.round(process.uptime() / 60),
            signupPerDay: d.signupInfo ? d.signupInfo().perDay : null
        });
    });
    api.post('/reports', (req, res) => {
        const s = d.safety.summary(d.db());
        res.json({ ok: true, reports: (s.reports || []).slice(-60).reverse(), flagged: s.flagged || [] });
    });
    api.post('/users', (req, res) => {
        const q = String((req.body && req.body.q) || '').toLowerCase().replace(/^@/, '').trim().slice(0, 30);
        const db = d.db();
        let rows = Object.entries(db.players).filter(([, p]) => p.user && (!q || p.user.toLowerCase().includes(q)));
        rows.sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
        res.json({ ok: true, total: rows.length, rows: rows.slice(0, 25).map(([t, p]) => row(t, p)) });
    });
    api.post('/mute', (req, res) => {
        const u = find(req.body && req.body.user);
        if (!u) return res.status(404).json({ ok: false, error: 'مستخدم غير موجود' });
        const hours = Math.max(0, Math.min(24 * 365, parseFloat(req.body.hours) || 0));
        u.rec.mutedUntil = hours ? Date.now() + hours * 3600 * 1000 : 0;
        d.saveSoon();
        res.json({ ok: true, row: row(u.tok, u.rec) });
    });
    api.post('/ban', (req, res) => {
        const u = find(req.body && req.body.user);
        if (!u) return res.status(404).json({ ok: false, error: 'مستخدم غير موجود' });
        u.rec.banned = !!req.body.on;
        if (u.rec.banned) d.kick(u.tok);
        d.saveSoon();
        res.json({ ok: true, row: row(u.tok, u.rec) });
    });
    api.post('/resetpw', async (req, res) => {
        const u = find(req.body && req.body.user);
        const pw = req.body && req.body.password;
        if (!u) return res.status(404).json({ ok: false, error: 'مستخدم غير موجود' });
        if (typeof pw !== 'string' || pw.length < 6 || pw.length > 100) return res.status(400).json({ ok: false, error: 'كلمة المرور قصيرة (6 أحرف على الأقل)' });
        u.rec.pass = await d.hashPassword(pw);
        d.saveSoon();
        res.json({ ok: true });
    });
    api.post('/clubs', (req, res) => {
        const db = d.db();
        res.json({ ok: true, rows: Object.values(db.clubs || {}).map((c) => ({ id: c.id, name: c.name, count: c.members.length, owner: d.uname(c.owner) })).sort((a, b) => b.count - a.count).slice(0, 100) });
    });
    api.post('/club-delete', (req, res) => {
        const db = d.db();
        const id = String((req.body && req.body.id) || '');
        const c = db.clubs && db.clubs[id];
        if (!c) return res.status(404).json({ ok: false, error: 'النادي غير موجود' });
        c.members.forEach((t) => { if (db.players[t] && db.players[t].club === id) db.players[t].club = null; });
        Object.keys(db.tourneys || {}).forEach((k) => { if (db.tourneys[k].club === id) delete db.tourneys[k]; });
        delete db.clubs[id];
        d.saveSoon();
        res.json({ ok: true });
    });
    api.post('/backups', async (req, res) => res.json(await d.listBackups()));
    api.post('/restore', async (req, res) => {
        const day = String((req.body && req.body.day) || '');
        if (String(req.body && req.body.confirm) !== day) return res.status(400).json({ ok: false, error: 'التأكيد لا يطابق التاريخ.' });
        res.json(await d.restore(day));
    });
    api.post('/backup-now', async (req, res) => res.json({ ok: await d.backupNow() }));
    api.post('/backup-get', async (req, res) => {
        const json = await d.getBackup(String((req.body && req.body.day) || ''));
        if (!json) return res.status(404).json({ ok: false, error: 'لا توجد نسخة بهذا التاريخ' });
        res.type('application/json').send(json);
    });
    app.use('/admin/api', api);
    app.get('/admin', (req, res) => {
        res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
        res.sendFile(require('path').join(__dirname, 'public', 'admin.html'));
    });
}
module.exports = { attach };
