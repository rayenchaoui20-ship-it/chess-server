'use strict';
// بطولة الأسبوع: ترتيب عام لكل اللاعبين المسجّلين بنقاط الأسبوع (ألعاب ضد بشر في كل الألعاب: فوز 3 · تعادل 2 · مشاركة 1).
// جوائزها شرفية فقط: لا مال ولا رسوم دخول. في نهاية الأسبوع ينال أول ثلاثة إطارًا حصريًا، وينال الأول لقبًا.
// الحالة: db.tn = { done: 'YYYY-Www' } (آخر أسبوع جرت تسويته)
const league = require('./league');
const TOP = 10;
const PRIZES = ['fr', 'ti'];

function standings(db, id) {
    const rows = [];
    for (const [token, rec] of Object.entries(db.players || {})) {
        if (!rec || !rec.user) continue;
        const wk = rec.wk && rec.wk.id === id ? rec.wk : rec.wkPrev && rec.wkPrev.id === id ? rec.wkPrev : null;
        if (!wk || !wk.pts) continue;
        rows.push({ token, user: rec.user, pts: wk.pts, w: wk.w || 0, g: wk.g || 0 });
    }
    rows.sort((a, b) => b.pts - a.pts || b.w - a.w || a.g - b.g || (a.user < b.user ? -1 : 1));
    return rows;
}
// يُسوّي الأسبوع المنتهي مرة واحدة. يعيد قائمة الفائزين [{token, rank, items:[key]}]
function settle(db, now) {
    const id = league.weekId(now), prev = league.weekId(now - 7 * 864e5);
    db.tn = db.tn || {};
    if (db.tn.done === prev || db.tn.done === id) return [];
    db.tn.done = prev;
    const out = [];
    standings(db, prev).slice(0, 3).forEach((r, i) => {
        const rec = db.players[r.token];
        if (!rec || r.pts < 3) return;                         // لا جائزة بلا مشاركة حقيقية
        rec.rw = Array.isArray(rec.rw) ? rec.rw : [];
        const items = [];
        PRIZES.forEach((kind) => {
            if (kind === 'ti' && i > 0) return;
            const key = kind + ':tn-' + prev + '-' + (i + 1);
            if (!rec.rw.includes(key)) { rec.rw.push(key); items.push(key); }
        });
        out.push({ token: r.token, rank: i + 1, items });
    });
    return out;
}
function state(db, token, now) {
    const id = league.weekId(now);
    const all = standings(db, id);
    const rows = all.slice(0, TOP).map((r) => ({ user: r.user, pts: r.pts, w: r.w }));
    const mine = all.findIndex((r) => r.token === token);
    return { week: id, left: league.daysLeft(now), rows, me: mine >= 0 ? { rank: mine + 1, pts: all[mine].pts } : null, total: all.length };
}
module.exports = { standings, settle, state };
