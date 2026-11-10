'use strict';
// نسخة المدارس: المدرّب (صاحب ترخيص ساري) ينشئ فصلًا بكود، والطلاب المسجّلون ينضمون بالكود،
// ويرى المدرّب لوحة تقدّمهم. الطالب يرى اسم فصله فقط؛ لا يرى أحد بيانات طالب غيره.
// الحالة: db.classes[CODE] = { name, owner: token, students: [token], t } · rec.cls = CODE (للطالب) · rec.sch = { until } (ترخيص المدرّب)
const MAX_CLASSES = 5, MAX_STUDENTS = 60;
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const licensed = (rec, now) => !!(rec && rec.sch && rec.sch.until > now);
const clean = (n) => String(n || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 30);
function newCode(db) {
    for (let k = 0; k < 50; k++) {
        let c = ''; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
        if (!db.classes[c]) return c;
    }
    return null;
}
function mine(db, token) { return Object.entries(db.classes || {}).filter(([, c]) => c.owner === token); }
function create(db, token, name, now) {
    const rec = db.players[token];
    if (!rec || !rec.user) return { err: 'سجّل حسابًا أولًا.' };
    if (!licensed(rec, now)) return { err: 'هذه الميزة لحسابات المدرّبين المرخّصة.' };
    db.classes = db.classes || {};
    const nm = clean(name);
    if (nm.length < 2) return { err: 'اكتب اسمًا للفصل.' };
    if (mine(db, token).length >= MAX_CLASSES) return { err: 'وصلت إلى الحد الأقصى من الفصول.' };
    const code = newCode(db);
    if (!code) return { err: 'تعذّر إنشاء الفصل.' };
    db.classes[code] = { name: nm, owner: token, students: [], t: now };
    return { code };
}
function join(db, token, code) {
    const rec = db.players[token];
    if (!rec || !rec.user) return { err: 'سجّل حسابًا مجانيًا أولًا لتنضم إلى فصل.' };
    const c = db.classes && db.classes[String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)];
    if (!c) return { err: 'لا يوجد فصل بهذا الكود.' };
    if (c.owner === token) return { err: 'أنت مدرّب هذا الفصل.' };
    if (rec.cls && rec.cls !== code && db.classes[rec.cls]) leave(db, token);
    if (c.students.length >= MAX_STUDENTS && !c.students.includes(token)) return { err: 'الفصل ممتلئ.' };
    if (!c.students.includes(token)) c.students.push(token);
    rec.cls = String(code).toUpperCase();
    return { ok: true };
}
function leave(db, token) {
    const rec = db.players[token];
    if (!rec || !rec.cls) return;
    const c = db.classes && db.classes[rec.cls];
    if (c) c.students = c.students.filter((t) => t !== token);
    delete rec.cls;
}
function remove(db, owner, code, user) {
    const c = db.classes && db.classes[code];
    if (!c || c.owner !== owner) return { err: 'لا تملك هذا الفصل.' };
    const t = db.users && db.users[String(user || '').toLowerCase()];
    if (!t || !c.students.includes(t)) return { err: 'الطالب ليس في الفصل.' };
    leave(db, t);
    return { ok: true };
}
function destroy(db, owner, code) {
    const c = db.classes && db.classes[code];
    if (!c || c.owner !== owner) return { err: 'لا تملك هذا الفصل.' };
    c.students.slice().forEach((t) => { const r = db.players[t]; if (r) delete r.cls; });
    delete db.classes[code];
    return { ok: true };
}
// statsOf(rec) → { rating, games, puzzles } من الخادم؛ هنا نضيف نقاط الأسبوع
function state(db, token, now, statsOf) {
    const rec = db.players[token];
    if (!rec || !rec.user) return { guest: true };
    const wid = require('./league').weekId(now);
    const out = { teacher: licensed(rec, now), until: licensed(rec, now) ? rec.sch.until : 0, classes: [], student: null };
    mine(db, token).forEach(([code, c]) => {
        out.classes.push({
            code, name: c.name,
            students: c.students.map((t) => {
                const r = db.players[t]; if (!r || !r.user) return null;
                const st = statsOf ? statsOf(r) : {};
                const wk = r.wk && r.wk.id === wid ? r.wk : null;
                return { user: r.user, rating: st.rating || null, games: st.games || 0, wins: st.wins || 0, puzzles: st.puzzles || 0, wk: wk ? wk.pts : 0 };
            }).filter(Boolean).sort((a, b) => b.wk - a.wk || b.games - a.games)
        });
    });
    const sc = rec.cls && db.classes && db.classes[rec.cls];
    if (sc) { const o = db.players[sc.owner]; out.student = { code: rec.cls, name: sc.name, teacher: o && o.user ? o.user : null }; }
    return out;
}
module.exports = { create, join, leave, remove, destroy, state, licensed, MAX_STUDENTS };
