'use strict';
// لغز اليوم: ترتيب الحلّ الأسرع وسلسلة الأيام المتتالية. الخادم يقيس الزمن بنفسه.
// الحالة: db.daily = { day, rows: [{ u, ms, m, s }] } لليوم الحالي فقط، و rec.dc = { last, streak, best, n } لكل حساب.

const MIN_MS = 1500;                    // أسرع من هذا لا يُقبل
const MAX_MS = 6 * 3600 * 1000;
const MISTAKE_MS = 15000;               // كل خطأ يضيف 15 ثانية إلى النتيجة
const KEEP = 500;
const dayStr = (now) => new Date(now).toISOString().slice(0, 10);
const prevDay = (now) => dayStr(now - 864e5);

function ensure(db, now) {
    const d = dayStr(now);
    if (!db.daily || db.daily.day !== d || !Array.isArray(db.daily.rows)) db.daily = { day: d, rows: [] };
    return db.daily;
}

// يسجّل حلًّا ناجحًا (أول حلّ في اليوم فقط). يعيد { ok, already, streak, best, rank, ms }
function record(db, rec, ms, mistakes, now) {
    if (!rec || !rec.user) return { ok: false };
    const today = dayStr(now);
    const d = ensure(db, now);
    const dc = rec.dc && typeof rec.dc === 'object' ? rec.dc : (rec.dc = { last: '', streak: 0, best: 0, n: 0 });
    if (dc.last === today) return { ok: true, already: true, streak: dc.streak, best: dc.best, rank: rankOf(d, rec.user), ms: null };
    ms = Math.min(MAX_MS, Math.max(0, Math.round(Number(ms) || 0)));
    if (ms < MIN_MS) return { ok: false, tooFast: true };
    const m = Math.min(20, Math.max(0, Math.floor(Number(mistakes) || 0)));
    dc.streak = dc.last === prevDay(now) ? dc.streak + 1 : 1;
    dc.best = Math.max(dc.best || 0, dc.streak);
    dc.n = (dc.n || 0) + 1;
    dc.last = today;
    d.rows.push({ u: rec.user, ms, m, s: ms + m * MISTAKE_MS });
    d.rows.sort((a, b) => a.s - b.s);
    if (d.rows.length > KEEP) d.rows.length = KEEP;
    return { ok: true, already: false, streak: dc.streak, best: dc.best, rank: rankOf(d, rec.user), ms };
}
function rankOf(d, user) {
    const i = d.rows.findIndex((r) => r.u === user);
    return i >= 0 ? i + 1 : null;
}
function top(db, now, user) {
    const d = ensure(db, now);
    return { day: d.day, rows: d.rows.slice(0, 20).map((r) => ({ u: r.u, ms: r.ms, m: r.m })), total: d.rows.length, me: user ? rankOf(d, user) : null };
}
// سلسلة صالحة للعرض: تنقطع إن مرّ يوم كامل بلا حل
function liveStreak(rec, now) {
    const dc = rec && rec.dc;
    if (!dc) return 0;
    return dc.last === dayStr(now) || dc.last === prevDay(now) ? dc.streak || 0 : 0;
}
function solvedToday(rec, now) { return !!(rec && rec.dc && rec.dc.last === dayStr(now)); }

module.exports = { record, top, ensure, liveStreak, solvedToday, dayStr, MIN_MS, MISTAKE_MS };
