'use strict';
// تحدّي اليوم لكل الألعاب: 3 تحدّيات يوميًا (من 3 ألعاب مختلفة)، وسلسلة أيام، وترتيب يومي.
// الحالة: rec.gc = { day, p: { key: { g, w } }, done: [ids], streak, last, best } · db.gcday = { day, rows: { user: { n, t } } }
const POOL = [
    { id: 'ch_win', k: 'ch', t: 'w', n: 1, text: 'اربح مباراة شطرنج واحدة' },
    { id: 'ch_play', k: 'ch', t: 'g', n: 2, text: 'العب مباراتين في الشطرنج' },
    { id: 'lu_win', k: 'lu', t: 'w', n: 1, text: 'اربح لعبة ليدو واحدة' },
    { id: 'lu_play', k: 'lu', t: 'g', n: 2, text: 'العب لعبتين في ليدو' },
    { id: 'sl_win', k: 'sl', t: 'w', n: 1, text: 'اربح لعبة سلم وثعبان واحدة' },
    { id: 'sl_play', k: 'sl', t: 'g', n: 2, text: 'العب لعبتين في سلم وثعبان' },
    { id: 'ch_fast', k: 'ch', t: 'f', n: 1, text: 'اربح مباراة شطرنج في 30 نقلة أو أقل', f: (w, i) => w && i.moves > 0 && i.moves <= 30 },
    { id: 'lu_clean', k: 'lu', t: 'f', n: 1, text: 'اربح في ليدو دون أن تُؤكل لك أي قطعة', f: (w, i) => w && i.capd === 0 },
    { id: 'lu_fast', k: 'lu', t: 'f', n: 1, text: 'اربح في ليدو بـ 85 رمية أو أقل', f: (w, i) => w && i.rolls > 0 && i.rolls <= 85 },
    { id: 'lu_eat', k: 'lu', t: 'f', n: 1, text: 'كُل 3 قطع للخصوم في لعبة ليدو واحدة', f: (w, i) => i.caps >= 3 },
    { id: 'sl_clean', k: 'sl', t: 'f', n: 1, text: 'اربح في سلم وثعبان دون أن تلدغك أي ثعبان', f: (w, i) => w && i.snk === 0 },
    { id: 'sl_climb', k: 'sl', t: 'f', n: 1, text: 'اصعد 3 سلالم في لعبة سلم وثعبان واحدة', f: (w, i) => i.lad >= 3 },
    { id: 'ml_win', k: 'ml', t: 'w', n: 1, text: 'اربح لعبة ملك المدينة واحدة' },
    { id: 'ml_play', k: 'ml', t: 'g', n: 1, text: 'العب لعبة ملك المدينة واحدة' }
];
const KEYS = ['ch', 'lu', 'sl', 'ml'];
const dayStr = (now) => new Date(now).toISOString().slice(0, 10);
const prevDay = (now) => dayStr(now - 864e5);
function seed(day) { let h = 7; for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
// اختيار ثابت لكل يوم: نستبعد لعبة واحدة ونأخذ تحدّيًا من كل لعبة من الباقي
function today(now) {
    const day = dayStr(now), h = seed(day);
    const skip = h % KEYS.length;
    return KEYS.filter((_, i) => i !== skip).map((k, i) => {
        const opts = POOL.filter((p) => p.k === k);
        return opts[((h >> (i + 2)) + i) % opts.length];
    });
}
function ensure(rec, now) {
    const d = dayStr(now);
    if (!rec.gc || typeof rec.gc !== 'object') rec.gc = { streak: 0, best: 0, last: '' };
    if (rec.gc.day !== d) { rec.gc.day = d; rec.gc.p = {}; rec.gc.done = []; }
    return rec.gc;
}
function ensureDay(db, now) {
    const d = dayStr(now);
    if (!db.gcday || db.gcday.day !== d || typeof db.gcday.rows !== 'object') db.gcday = { day: d, rows: {} };
    return db.gcday;
}
// يسجّل لعبة منتهية. يعيد قائمة التحدّيات التي أُنجزت الآن
function count(db, rec, key, win, now, info) {
    if (!rec || !rec.user || !KEYS.includes(key)) return [];
    const gc = ensure(rec, now);
    const p = gc.p[key] = gc.p[key] || { g: 0, w: 0 };
    p.g++; if (win) p.w++;
    const fresh = [];
    today(now).forEach((c) => {
        if (c.k !== key || gc.done.includes(c.id)) return;
        const ok = c.t === 'f' ? !!c.f(!!win, info || {}) : (c.t === 'w' ? p.w : p.g) >= c.n;
        if (ok) { gc.done.push(c.id); fresh.push(c); }
    });
    if (fresh.length) {
        const d = dayStr(now);
        if (gc.last !== d) { gc.streak = gc.last === prevDay(now) ? (gc.streak || 0) + 1 : 1; gc.last = d; gc.best = Math.max(gc.best || 0, gc.streak); }
        ensureDay(db, now).rows[rec.user] = { n: gc.done.length, t: now };
    }
    return fresh;
}
function state(db, rec, now) {
    const gc = rec && rec.user ? ensure(rec, now) : null;
    const list = today(now).map((c) => {
        const p = gc && gc.p[c.k];
        const done = !!(gc && gc.done.includes(c.id));
        const prog = c.t === 'f' ? (done ? 1 : 0) : p ? Math.min(c.n, c.t === 'w' ? p.w : p.g) : 0;
        return { id: c.id, text: c.text, n: c.n, prog, done };
    });
    const rows = Object.entries(ensureDay(db, now).rows).map(([user, r]) => ({ user, n: r.n, t: r.t }))
        .sort((a, b) => b.n - a.n || a.t - b.t).slice(0, 10).map((r) => ({ user: r.user, n: r.n }));
    const alive = gc && (gc.last === dayStr(now) || gc.last === prevDay(now));
    return { guest: !gc, list, streak: alive ? gc.streak || 0 : 0, best: gc ? gc.best || 0 : 0, top: rows, total: list.length };
}
module.exports = { count, state, today, POOL, dayStr };
