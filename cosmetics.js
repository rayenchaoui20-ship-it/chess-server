'use strict';
// التجميلات: صورة رمزية + لقب + إطار + لون اسم. تُفتح بالإنجازات أو بمكافآت الموسم أو بالعضوية الداعمة (VIP).
// الحالة: rec.cos = { av, ti, fr, nc } · rec.rw = ['fr:2026-11', ...] (مكافآت المواسم الدائمة) · rec.ss = { id, w, g } (تقدّم الموسم) · rec.vip = { until }
// لا فائدة لعبية من أيٍّ منها: مظهر فقط.
const seasonId = (now) => new Date(now).toISOString().slice(0, 7);
const SEASONS = [
    { n: 'موسم الصحراء', icon: '🏜', c: '#E2A84B', c2: '#F2C879' },
    { n: 'موسم البحر', icon: '🌊', c: '#2F8FB5', c2: '#7CC7E4' },
    { n: 'موسم الربيع', icon: '🌸', c: '#D56B93', c2: '#F0A6C0' },
    { n: 'موسم الفرسان', icon: '🛡', c: '#8B5CF6', c2: '#B9A0FA' },
    { n: 'موسم الواحة', icon: '🌴', c: '#3FAE7A', c2: '#86D9AF' },
    { n: 'موسم الشمس', icon: '☀', c: '#F08A24', c2: '#F8BB78' },
    { n: 'موسم القمر', icon: '🌙', c: '#6E7FD6', c2: '#A5B1F0' },
    { n: 'موسم الجبال', icon: '⛰', c: '#7A8A99', c2: '#B3C0CC' },
    { n: 'موسم الخريف', icon: '🍂', c: '#C0642B', c2: '#E39A68' },
    { n: 'موسم الزليج', icon: '🧿', c: '#1F8A8A', c2: '#68C7C7' },
    { n: 'موسم النجوم', icon: '⭐', c: '#D9A400', c2: '#F2D05E' },
    { n: 'موسم الشتاء', icon: '❄', c: '#5B9BD5', c2: '#A9CFF0' }
];
const seasonOf = (id) => SEASONS[(parseInt(String(id).slice(5, 7), 10) - 1 + 12) % 12] || SEASONS[0];
// مراحل مكافآت الموسم (انتصارات في الشهر)
const TIERS = [{ w: 5, kind: 'fr' }, { w: 15, kind: 'nc' }, { w: 30, kind: 'ti' }];

// مناسبات عالمية قصيرة (بالتاريخ UTC). رمضان والعيد من التقويم الهجري عبر Intl. لكل مناسبة إطار بعد 3 انتصارات ولقب بعد 8.
const EV_TIERS = [{ w: 3, kind: 'fr' }, { w: 8, kind: 'ti' }];
const EVENTS = [
    { id: 'newyear', n: 'رأس السنة', icon: '🎆', c: '#E8B923', c2: '#F6DC7A' },
    { id: 'winter', n: 'أضواء الشتاء', icon: '🎄', c: '#2E9E6B', c2: '#8BD9B3' },
    { id: 'halloween', n: 'الهالوين', icon: '🎃', c: '#E8731A', c2: '#F6B173' },
    { id: 'ramadan', n: 'رمضان', icon: '🌙', c: '#6E7FD6', c2: '#A5B1F0' },
    { id: 'eid', n: 'العيد', icon: '🎉', c: '#D56B93', c2: '#F0A6C0' },
    { id: 'spring', n: 'عيد الربيع', icon: '🌷', c: '#E06C9F', c2: '#F4A9C9' }
];
function hijri(now) {
    try {
        const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(now));
        const g = (t) => parseInt((p.find((x) => x.type === t) || {}).value, 10);
        return { m: g('month'), d: g('day') };
    } catch (e) { return null; }
}
// المناسبة الجارية أو null. المفتاح يتضمن السنة الميلادية (أو الهجرية لرمضان والعيد) كي لا يتكرر منح العنصر.
function eventOf(now) {
    const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const left = (endUTC) => Math.max(1, Math.ceil((endUTC - now) / 864e5));
    const ev = (id, key, endUTC) => Object.assign({}, EVENTS.find((e) => e.id === id), { key: id + '-' + key, left: left(endUTC) });
    const h = hijri(now);
    if (h && h.m === 9) return ev('ramadan', y, now + (30 - h.d + 1) * 864e5);
    if (h && ((h.m === 10 && h.d <= 3) || (h.m === 12 && h.d >= 10 && h.d <= 13))) return ev('eid', y + '-' + h.m, now + 3 * 864e5);
    if ((m === 12 && day >= 26) || (m === 1 && day <= 6)) return ev('newyear', m === 1 ? y - 1 : y, Date.UTC(m === 1 ? y : y + 1, 0, 7));
    if (m === 12 && day >= 15) return ev('winter', y, Date.UTC(y, 11, 26));
    if ((m === 10 && day >= 24) || (m === 11 && day <= 2)) return ev('halloween', m === 11 ? y : y, Date.UTC(m === 11 ? y : y, 10, 3));
    if ((m === 3 && day >= 20) || (m === 4 && day <= 3)) return ev('spring', y, Date.UTC(y, 3, 4));
    return null;
}

const AVATARS = [
    { id: 'pawn', e: '♟', n: 'البيدق' }, { id: 'dice', e: '🎲', n: 'النرد' }, { id: 'crown', e: '👑', n: 'التاج' },
    { id: 'fox', e: '🦊', n: 'الثعلب', ach: 'wins_10' }, { id: 'falcon', e: '🦅', n: 'الصقر', ach: 'rating_1600' },
    { id: 'lion', e: '🦁', n: 'الأسد', ach: 'wins_50' }, { id: 'snake', e: '🐍', n: 'الثعبان', ach: 'sl_first' },
    { id: 'clover', e: '🍀', n: 'البرسيم', ach: 'lu_wins_10' }, { id: 'castle', e: '🏰', n: 'القلعة', ach: 'mp_wins_10' },
    { id: 'owl', e: '🦉', n: 'البومة', ach: 'puzzles_50' }, { id: 'fire', e: '🔥', n: 'النار', ach: 'daily_7' },
    { id: 'mosque', e: '🕌', n: 'المسجد', pk: 'arab' }, { id: 'moon', e: '🌙', n: 'الهلال', pk: 'arab' }, { id: 'trophy', e: '🏆', n: 'الكأس', pk: 'royal' }, { id: 'joker', e: '🃏', n: 'الجوكر', pk: 'royal' },
    { id: 'wolf', e: '🐺', n: 'الذئب', vip: true }, { id: 'dragon', e: '🐉', n: 'التنين', vip: true }, { id: 'gem', e: '💎', n: 'الماسة', vip: true }
];
const TITLES = [
    { id: 'newbie', n: 'لاعب جديد' }, { id: 'regular', n: 'اللاعب المنتظم', ach: 'games_25' },
    { id: 'fox', n: 'الثعلب', ach: 'wins_10' }, { id: 'luck', n: 'ملك الحظ', ach: 'lu_wins_10' },
    { id: 'master', n: 'سيّد الشطرنج', ach: 'rating_1800' }, { id: 'climber', n: 'المتسلّق', ach: 'sl_ladders3' },
    { id: 'king', n: 'ملك المدينة', ach: 'mp_wins_10' }, { id: 'star', n: 'نجم الموسم', ach: 'season_badge' },
    { id: 'champ', n: 'بطل البطولات', ach: 'champion' }, { id: 'patient', n: 'محترف الصبر', ach: 'games_100' },
    { id: 'vip', n: 'داعم الموقع 💎', vip: true }, { id: 'sage', n: 'الحكيم', pk: 'arab' }, { id: 'emperor', n: 'الإمبراطور', pk: 'royal' }
];
const FRAMES = [
    { id: 'none', n: 'بلا إطار', c: 'transparent' }, { id: 'bronze', n: 'برونزي', c: '#CD7F32', ach: 'first_win' },
    { id: 'silver', n: 'فضي', c: '#C0C8D2', ach: 'wins_10' }, { id: 'gold', n: 'ذهبي', c: '#E2B14B', ach: 'wins_50' },
    { id: 'royal', n: 'ملكي متوهّج', c: '#B070FF', vip: true }, { id: 'zellij', n: 'زليج', c: '#1BA6A0', pk: 'arab' }, { id: 'rainbow', n: 'قوس قزح', c: '#FF6FB5', pk: 'royal' }
];
const NAMECOLORS = [
    { id: 'default', n: 'الافتراضي', c: '' }, { id: 'sky', n: 'سماوي', c: '#4DB3E6', ach: 'games_25' },
    { id: 'lime', n: 'ليموني', c: '#8FD14F', ach: 'puzzles_10' }, { id: 'rose', n: 'وردي', c: '#F27AA5', ach: 'friend_first' },
    { id: 'gold', n: 'ذهبي', c: '#F2C14B', vip: true }, { id: 'emerald', n: 'زمردي', c: '#34D399', pk: 'arab' }, { id: 'crimson', n: 'قرمزي', c: '#FF5A6E', pk: 'royal' }
];
const KINDS = { av: AVATARS, ti: TITLES, fr: FRAMES, nc: NAMECOLORS };

const isVip = (rec, now) => !!(rec && rec.vip && rec.vip.until > now);
// عناصر مكافآت الموسم التي كسبها اللاعب (دائمة)
function seasonItems(rec) {
    return (Array.isArray(rec.rw) ? rec.rw : []).map((k) => {
        const [kind, sid] = k.split(':');
        if (sid && sid.startsWith('ev-')) {
            const e = EVENTS.find((x) => x.id === sid.slice(3).split('-')[0]);
            if (!e) return null;
            if (kind === 'fr') return { kind, id: k, n: 'إطار ' + e.n, c: e.c };
            if (kind === 'ti') return { kind, id: k, n: 'بطل ' + e.n };
            return null;
        }
        if (sid && sid.startsWith('tn-')) {
            const rank = parseInt(sid.split('-').pop(), 10) || 3;
            if (kind === 'fr') return { kind, id: k, n: 'إطار بطولة الأسبوع', c: ['#F2C14B', '#C0C8D2', '#CD7F32'][rank - 1] || '#CD7F32' };
            if (kind === 'ti') return { kind, id: k, n: 'بطل بطولة الأسبوع' };
            return null;
        }
        const se = seasonOf(sid);
        if (kind === 'fr') return { kind, id: k, n: 'إطار ' + se.n, c: se.c };
        if (kind === 'nc') return { kind, id: k, n: 'لون ' + se.n, c: se.c2 };
        if (kind === 'ti') return { kind, id: k, n: 'بطل ' + se.n };
        return null;
    }).filter(Boolean);
}
function unlocked(rec, kind, item, now) {
    if (!item) return false;
    if (item.pk) return Array.isArray(rec.pk) && rec.pk.includes(item.pk);
    if (item.vip) return isVip(rec, now);
    if (item.ach) return !!(rec.ach && rec.ach[item.ach]);
    return true;
}
function catalog(rec, now) {
    const extra = seasonItems(rec);
    const out = {};
    Object.keys(KINDS).forEach((kind) => {
        const base = KINDS[kind].map((it) => Object.assign({}, it, { open: unlocked(rec, kind, it, now) }));
        const add = extra.filter((x) => x.kind === kind).map((x) => ({ id: x.id, n: x.n, c: x.c, open: true, season: true }));
        out[kind] = base.concat(add);
    });
    return out;
}
function findItem(rec, kind, id) {
    const hit = KINDS[kind] && KINDS[kind].find((x) => x.id === id);
    if (hit) return hit;
    return seasonItems(rec).find((x) => x.kind === kind && x.id === id) || null;
}
// يضبط اختيارات اللاعب بعد التحقق من أنها مفتوحة له
function select(rec, sel, now) {
    rec.cos = rec.cos && typeof rec.cos === 'object' ? rec.cos : {};
    let changed = 0;
    Object.keys(KINDS).forEach((kind) => {
        if (!sel || typeof sel[kind] !== 'string') return;
        const it = findItem(rec, kind, sel[kind]);
        if (it && (it.season || unlocked(rec, kind, it, now))) { rec.cos[kind] = it.id; changed++; }
    });
    return changed;
}
// العرض العام (ما يراه الآخرون). يعيد null إن لم يختر شيئًا
function display(rec, now) {
    const c = rec.cos || {};
    const pick = (kind) => { const it = c[kind] && findItem(rec, kind, c[kind]); return it && (it.season || unlocked(rec, kind, it, now)) ? it : null; };
    const av = pick('av'), ti = pick('ti'), fr = pick('fr'), nc = pick('nc');
    return { av: av ? av.e : null, ti: ti ? ti.n : null, fr: fr && fr.c !== 'transparent' ? fr.c : null, nc: nc && nc.c ? nc.c : null, vip: isVip(rec, now) };
}
// تقدّم الموسم: يزيد العدّاد ويمنح المراحل الجديدة. يعيد قائمة العناصر الجديدة
function seasonCount(rec, win, now) {
    if (!rec || !rec.user) return [];
    const id = seasonId(now);
    if (!rec.ss || rec.ss.id !== id) rec.ss = { id, w: 0, g: 0 };
    rec.ss.g++; if (win) rec.ss.w++;
    rec.rw = Array.isArray(rec.rw) ? rec.rw : [];
    const fresh = [];
    TIERS.forEach((t) => {
        const key = t.kind + ':' + id;
        if (rec.ss.w >= t.w && !rec.rw.includes(key)) { rec.rw.push(key); fresh.push(seasonItems({ rw: [key] })[0]); }
    });
    const ev = eventOf(now);
    if (ev) {
        if (!rec.ev || rec.ev.k !== ev.key) rec.ev = { k: ev.key, w: 0 };
        if (win) rec.ev.w++;
        EV_TIERS.forEach((t) => {
            const key = t.kind + ':ev-' + ev.key;
            if (rec.ev.w >= t.w && !rec.rw.includes(key)) { rec.rw.push(key); fresh.push(seasonItems({ rw: [key] })[0]); }
        });
    }
    return fresh;
}
function seasonState(rec, now) {
    const id = seasonId(now), se = seasonOf(id);
    const ss = rec && rec.ss && rec.ss.id === id ? rec.ss : { w: 0, g: 0 };
    const d = new Date(now), left = Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - now) / 864e5));
    const ev = eventOf(now);
    const evs = ev ? { id: ev.id, name: ev.n, icon: ev.icon, c: ev.c, left: ev.left, w: rec && rec.ev && rec.ev.k === ev.key ? rec.ev.w : 0 } : null;
    if (evs) evs.tiers = EV_TIERS.map((t) => ({ w: t.w, kind: t.kind, done: evs.w >= t.w }));
    return { event: evs, id, name: se.n, icon: se.icon, c: se.c, w: ss.w, g: ss.g, left, tiers: TIERS.map((t) => ({ w: t.w, kind: t.kind, done: ss.w >= t.w })) };
}
module.exports = { catalog, select, display, seasonCount, seasonState, seasonOf, eventOf, EVENTS, isVip, SEASONS, TIERS, AVATARS, TITLES, FRAMES, NAMECOLORS };
