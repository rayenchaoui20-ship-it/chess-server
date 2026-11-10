'use strict';
// دوري الأصدقاء الأسبوعي: مجموعة صغيرة (حتى 12 لاعبًا مسجّلًا). كل لعبة ضد بشر تعطي نقاطًا في الأسبوع:
// فوز = 3 · تعادل = 2 · مشاركة = 1 (والجمعة تُضاعَف النقاط). الأسبوع ISO من الاثنين (UTC).
// الحالة: db.leagues[CODE] = { name, owner, members: [token], week, hist: [{ week, user, pts }] } · rec.lg = CODE · rec.wk = { id, pts, w, g } · rec.wkPrev
const MAX = 12;
const PTS = { win: 3, draw: 2, play: 1 };
function weekId(now) {
    const d = new Date(now);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return y + '-W' + String(w).padStart(2, '0');
}
const isFriday = (now) => new Date(now).getUTCDay() === 5;
function daysLeft(now) {
    const d = new Date(now), day = d.getUTCDay() || 7;
    return 8 - day;                                   // يشمل اليوم الحالي
}
function ensureWk(rec, now) {
    const id = weekId(now);
    if (!rec.wk || rec.wk.id !== id) { if (rec.wk && rec.wk.pts) rec.wkPrev = rec.wk; rec.wk = { id, pts: 0, w: 0, g: 0 }; }
    return rec.wk;
}
// يسجّل نتيجة لعبة ضد بشر. outcome: 'win' | 'draw' | 'loss'
function count(rec, outcome, now) {
    if (!rec || !rec.user) return 0;
    const wk = ensureWk(rec, now);
    const base = outcome === 'win' ? PTS.win : outcome === 'draw' ? PTS.draw : PTS.play;
    const add = base * (isFriday(now) ? 2 : 1);          // ليلة الجمعة: نقاط مضاعفة
    wk.pts += add; wk.g++; if (outcome === 'win') wk.w++;
    return add;
}
const newCode = (db) => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let k = 0; k < 50; k++) { let c = ''; for (let j = 0; j < 5; j++) c += A[Math.floor(Math.random() * A.length)]; if (!db.leagues[c]) return c; }
    return null;
};
function ensure(db) { if (!db.leagues || typeof db.leagues !== 'object') db.leagues = {}; return db.leagues; }
function create(db, token, name, now) {
    ensure(db);
    const rec = db.players[token];
    if (!rec || !rec.user) return { error: 'سجّل حسابًا أولًا.' };
    if (rec.lg && db.leagues[rec.lg]) return { error: 'أنت في دوري بالفعل.' };
    const nm = String(name || '').replace(/[<>]/g, '').trim().slice(0, 24);
    if (nm.length < 2) return { error: 'اكتب اسمًا للدوري (حرفان على الأقل).' };
    const code = newCode(db);
    if (!code) return { error: 'تعذّر إنشاء الدوري.' };
    db.leagues[code] = { name: nm, owner: token, members: [token], week: weekId(now), hist: [] };
    rec.lg = code;
    return { code };
}
function join(db, token, code) {
    ensure(db);
    const rec = db.players[token];
    if (!rec || !rec.user) return { error: 'سجّل حسابًا أولًا.' };
    if (rec.lg && db.leagues[rec.lg]) return { error: 'أنت في دوري بالفعل.' };
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const lg = db.leagues[c];
    if (!lg) return { error: 'لا يوجد دوري بهذا الكود.' };
    if (lg.members.length >= MAX) return { error: 'الدوري ممتلئ.' };
    lg.members.push(token); rec.lg = c;
    return { code: c };
}
function leave(db, token) {
    const rec = db.players[token];
    if (!rec || !rec.lg) return false;
    const lg = ensure(db)[rec.lg];
    rec.lg = null;
    if (!lg) return true;
    lg.members = lg.members.filter((t) => t !== token);
    if (!lg.members.length) { const k = Object.keys(db.leagues).find((x) => db.leagues[x] === lg); if (k) delete db.leagues[k]; }
    else if (lg.owner === token) lg.owner = lg.members[0];
    return true;
}
function pointsOf(rec, id) {
    if (!rec) return null;
    if (rec.wk && rec.wk.id === id) return rec.wk;
    if (rec.wkPrev && rec.wkPrev.id === id) return rec.wkPrev;
    return null;
}
// إنهاء الأسابيع المنتهية وتسجيل الفائز في السجل
function rollover(db, lg, now) {
    const cur = weekId(now);
    if (lg.week === cur) return;
    const rows = lg.members.map((t) => ({ rec: db.players[t], p: pointsOf(db.players[t], lg.week) })).filter((x) => x.rec && x.p && x.p.pts > 0)
        .sort((a, b) => b.p.pts - a.p.pts || b.p.w - a.p.w);
    if (rows.length) { lg.hist = [{ week: lg.week, user: rows[0].rec.user, pts: rows[0].p.pts }].concat(lg.hist || []).slice(0, 8); }
    lg.week = cur;
}
function state(db, token, now) {
    const rec = db.players[token];
    if (!rec || !rec.user) return { guest: true };
    const lg = rec.lg && ensure(db)[rec.lg];
    if (!lg) { rec.lg = null; return { none: true }; }
    rollover(db, lg, now);
    const id = weekId(now);
    const rows = lg.members.map((t) => ({ t, rec: db.players[t] })).filter((x) => x.rec && x.rec.user).map((x) => {
        const p = pointsOf(x.rec, id) || { pts: 0, w: 0, g: 0 };
        return { user: x.rec.user, pts: p.pts, w: p.w, g: p.g, me: x.t === token };
    }).sort((a, b) => b.pts - a.pts || b.w - a.w || a.user.localeCompare(b.user));
    const code = rec.lg;
    return { code, name: lg.name, week: id, left: daysLeft(now), fri: isFriday(now), rows, hist: lg.hist || [], owner: lg.owner === token, max: MAX };
}
module.exports = { isFriday, weekId, daysLeft, count, create, join, leave, state, rollover, PTS, MAX };
