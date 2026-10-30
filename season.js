'use strict';
// الموسم الشهري: عند بداية شهر جديد (بتوقيت UTC) نمنح شارات لأفضل 3 في كل نظام ثم نقرّب كل التصنيفات من 1500 إلى النصف.
// db.season = { id: 'YYYY-MM' } · db.seasons = [{ id, top: { cat: [{ u, r }] } }] · rec.sg = { s, n } (ألعاب الموسم) · rec.badges = [{ s, c, k }]

const BASE = 1500;
const KEEP_FACTOR = 0.5;               // يبقى نصف الفارق عن 1500
const MIN_GAMES = 5;                   // أقل عدد ألعاب مصنَّفة في الموسم للمنافسة على الشارة
const MIN_CAT_GAMES = 3;
const seasonId = (now) => new Date(now).toISOString().slice(0, 7);
function daysLeft(now) {
    const d = new Date(now);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return Math.max(1, Math.ceil((next - now) / 864e5));
}
function countGame(rec, now) {
    const id = seasonId(now);
    if (!rec.sg || rec.sg.s !== id) rec.sg = { s: id, n: 0 };
    rec.sg.n++;
}

// يُنهي الموسم السابق إن بدأ شهر جديد. يعيد null إن لم يتغيّر شيء، أو { prev, awards, reset }
function rollover(db, now, cats) {
    const cur = seasonId(now);
    if (!db.season || typeof db.season !== 'object') { db.season = { id: cur }; return null; }
    if (db.season.id === cur) return null;
    const prev = db.season.id;
    const awards = [];
    const top = {};
    const accts = Object.entries(db.players).filter(([, p]) => p && p.user);
    for (const cat of cats) {
        const rows = accts
            .filter(([, p]) => p.sg && p.sg.s === prev && p.sg.n >= MIN_GAMES && p.r && p.r[cat] && p.r[cat].n >= MIN_CAT_GAMES)
            .map(([t, p]) => ({ t, u: p.user, r: p.r[cat].r }))
            .sort((a, b) => b.r - a.r)
            .slice(0, 3);
        top[cat] = rows.map((x) => ({ u: x.u, r: x.r }));
        rows.forEach((x, i) => {
            const p = db.players[x.t];
            p.badges = Array.isArray(p.badges) ? p.badges : [];
            if (!p.badges.some((b) => b.s === prev && b.c === cat)) p.badges.push({ s: prev, c: cat, k: i + 1 });
            awards.push({ token: x.t, cat, rank: i + 1, season: prev });
        });
    }
    let reset = 0;
    for (const p of Object.values(db.players)) {
        if (!p || !p.r) continue;
        for (const cat of cats) {
            const x = p.r[cat];
            if (x && typeof x.r === 'number') { x.r = Math.max(100, Math.round(BASE + (x.r - BASE) * KEEP_FACTOR)); reset++; }
        }
    }
    db.seasons = (Array.isArray(db.seasons) ? db.seasons : []).concat([{ id: prev, top }]).slice(-12);
    db.season = { id: cur };
    return { prev, awards, reset };
}

const MEDAL = ['🥇', '🥈', '🥉'];
module.exports = { seasonId, daysLeft, countGame, rollover, MEDAL, MIN_GAMES };
