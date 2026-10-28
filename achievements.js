'use strict';
// الإنجازات وملف اللاعب. الإنجاز يُمنح مرة واحدة ويُحفظ في rec.ach = { id: وقت_المنح }.

const bestRating = (rec) => Math.max(0, ...Object.values(rec.r || {}).map((x) => (x && x.r) || 0));
const solved = (rec) => (rec.pz && Array.isArray(rec.pz.s) ? rec.pz.s.length : 0);

const DEFS = [
    { id: 'first_win', icon: '♟', title: 'أول فوز', desc: 'اربح أول مباراة مصنَّفة.', test: (r) => (r.w || 0) >= 1 },
    { id: 'wins_10', icon: '🥉', title: 'عشرة انتصارات', desc: 'اربح 10 مباريات مصنَّفة.', test: (r) => (r.w || 0) >= 10 },
    { id: 'wins_50', icon: '🥈', title: 'خمسون انتصارًا', desc: 'اربح 50 مباراة مصنَّفة.', test: (r) => (r.w || 0) >= 50 },
    { id: 'games_25', icon: '🎯', title: 'لاعب منتظم', desc: 'العب 25 مباراة مصنَّفة.', test: (r) => (r.games || 0) >= 25 },
    { id: 'games_100', icon: '🏅', title: 'محترف الصبر', desc: 'العب 100 مباراة مصنَّفة.', test: (r) => (r.games || 0) >= 100 },
    { id: 'rating_1600', icon: '📈', title: 'تصنيف 1600', desc: 'بلغ تصنيفك 1600 في أي نظام وقت.', test: (r) => bestRating(r) >= 1600 },
    { id: 'rating_1800', icon: '🚀', title: 'تصنيف 1800', desc: 'بلغ تصنيفك 1800 في أي نظام وقت.', test: (r) => bestRating(r) >= 1800 },
    { id: 'puzzles_10', icon: '🧩', title: 'مبتدئ الألغاز', desc: 'احلل 10 ألغاز.', test: (r) => solved(r) >= 10 },
    { id: 'puzzles_50', icon: '🧠', title: 'صيّاد الألغاز', desc: 'احلل 50 لغزًا.', test: (r) => solved(r) >= 50 },
    { id: 'puzzle_streak_10', icon: '🔥', title: 'عشرة بلا خطأ', desc: 'احلل 10 ألغاز متتالية من أول محاولة.', test: (r) => !!(r.pz && r.pz.k >= 10) },
    { id: 'friend_first', icon: '🤝', title: 'أول صديق', desc: 'أضف صديقًا إلى قائمتك.', test: (r) => (r.friends || []).length >= 1 },
    { id: 'club_member', icon: '🛡', title: 'ابن النادي', desc: 'انضم إلى نادٍ.', test: (r, c) => !!(c && c.club) },
    { id: 'champion', icon: '🏆', title: 'بطل بطولة', desc: 'افز ببطولة في ناديك.', test: (r) => (r.champ || 0) >= 1 }
];
const BY_ID = Object.fromEntries(DEFS.map((d) => [d.id, d]));
const info = (id) => (BY_ID[id] ? { id, icon: BY_ID[id].icon, title: BY_ID[id].title, desc: BY_ID[id].desc } : null);

// يمنح الإنجازات المستحقة الجديدة ويعيد قائمتها (للإشعار)
function evaluate(rec, ctx, now) {
    if (!rec) return [];
    if (!rec.ach || typeof rec.ach !== 'object') rec.ach = {};
    const got = [];
    for (const d of DEFS) {
        if (rec.ach[d.id]) continue;
        let ok = false;
        try { ok = !!d.test(rec, ctx || {}); } catch (e) { ok = false; }
        if (ok) { rec.ach[d.id] = now || Date.now(); got.push(d.id); }
    }
    return got;
}

// سجل التصنيف (آخر 40 نقطة لكل نظام) لرسم المنحنى
function pushRating(rec, cat) {
    if (!rec || !rec.r || !rec.r[cat]) return;
    if (!rec.rh || typeof rec.rh !== 'object') rec.rh = {};
    const a = rec.rh[cat] = rec.rh[cat] || [];
    a.push(rec.r[cat].r);
    if (a.length > 40) a.splice(0, a.length - 40);
}

// الملف العام للاعب. ctx: { clubName }
function profile(rec, ctx) {
    const hist = Array.isArray(rec.hist) ? rec.hist : [];
    const recent = hist.slice(0, 8).map((g) => {
        const mine = g.c;
        const res = !g.res || !g.res.winner ? 'd' : g.res.winner === mine ? 'w' : 'l';
        return { res, opp: mine === 'w' ? g.b : g.w, tc: g.tc, t: g.t, ai: !!g.ai, rated: !!g.rated };
    });
    const w = rec.w || 0, l = rec.l || 0, d = rec.d || 0;
    return {
        user: rec.user, since: rec.created || 0,
        ratings: Object.fromEntries(Object.entries(rec.r || {}).map(([k, v]) => [k, { r: v.r, n: v.n }])),
        history: rec.rh || {},
        w, l, d, games: rec.games || 0, rate: w + l + d ? Math.round((w / (w + l + d)) * 100) : null,
        club: (ctx && ctx.clubName) || null,
        pz: { rating: rec.pz ? rec.pz.r : null, solved: solved(rec), streak: rec.pz ? rec.pz.k || 0 : 0 },
        champ: rec.champ || 0,
        ach: Object.entries(rec.ach || {}).filter(([id]) => BY_ID[id]).map(([id, at]) => Object.assign(info(id), { at })),
        all: DEFS.map((x) => info(x.id)),
        recent
    };
}

module.exports = { DEFS, evaluate, pushRating, profile, info };
