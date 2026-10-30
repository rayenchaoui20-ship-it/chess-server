'use strict';
// بطولات النوادي: سويسرية (عدد جولات ثابت، النقاط 1/½/0) أو إقصائية (خروج المغلوب).
// يُنشئها مالك النادي ويشارك فيها أعضاؤه. المباريات غير مصنَّفة. البيانات في db.tourneys.
// كل جولة: «جاهز؟» لكل لاعب (3 دقائق) ثم تبدأ المباراة وحدها حين يضغط الطرفان «العب».

const crypto = require('crypto');

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 16;
const READY_MS = 3 * 60 * 1000;
const KEEP_DONE = 3;
const FORMATS = ['swiss', 'ko'];

function store(db) {
    if (!db.tourneys || typeof db.tourneys !== 'object') db.tourneys = {};
    return db.tourneys;
}
const log2c = (n) => Math.ceil(Math.log2(Math.max(1, n)));
const seedIdx = (t, tok) => t.seeds.indexOf(tok);

// ───────────────────────── اقتراع ─────────────────────────
function order(t) {
    return t.players.slice().sort((a, b) => (t.score[b] || 0) - (t.score[a] || 0) || seedIdx(t, a) - seedIdx(t, b));
}
function matchup(L, t, repeat) {
    if (!L.length) return [];
    const p = L[0];
    for (let i = 1; i < L.length; i++) {
        const q = L[i];
        if (!repeat && (t.played[p] || []).includes(q)) continue;
        const r = matchup(L.slice(1, i).concat(L.slice(i + 1)), t, repeat);
        if (r) return [[p, q]].concat(r);
    }
    return null;
}
// من يأخذ الأبيض: الأقل لعبًا بالأبيض، ثم من لعب الأسود آخر مرة، ثم الأعلى تصنيفًا
function colorPair(t, p, q) {
    const c = (x) => t.cols[x] || { w: 0, b: 0, last: null };
    const dp = c(p).w - c(p).b, dq = c(q).w - c(q).b;
    if (dp !== dq) return dp < dq ? [p, q] : [q, p];
    if (c(p).last !== c(q).last) return c(p).last === 'b' ? [p, q] : [q, p];
    return [p, q];
}
function newBoard(w, b) {
    return { w, b, state: 'pending', result: null, bye: false, ready: { w: false, b: false }, deadline: 0, roomId: null, tries: 0, note: '' };
}
const byeBoard = (tok) => ({ w: tok, b: null, state: 'done', result: 'w', bye: true, ready: { w: true, b: true }, deadline: 0, roomId: null, tries: 0, note: 'راحة' });

function pairSwiss(t) {
    let L = order(t);
    const boards = [];
    if (L.length % 2) {
        const pick = L.slice().reverse().find((x) => !t.byes.includes(x)) || L[L.length - 1];
        L = L.filter((x) => x !== pick);
        t.byes.push(pick);
        boards.push(byeBoard(pick));
    }
    const pairs = matchup(L, t, false) || matchup(L, t, true) || [];
    pairs.forEach(([p, q]) => { const [w, b] = colorPair(t, p, q); boards.push(newBoard(w, b)); });
    return boards;
}
function pairKo(t) {
    let L = t.seeds.filter((x) => !t.out.includes(x));
    const boards = [];
    if (t.round === 0 && (L.length & (L.length - 1))) {
        const byes = (1 << log2c(L.length)) - L.length;          // أعلى المصنّفين يستريحون في الجولة الأولى
        L.slice(0, byes).forEach((x) => boards.push(byeBoard(x)));
        L = L.slice(byes);
    }
    for (let i = 0; i < L.length / 2; i++) {
        const hi = L[i], lo = L[L.length - 1 - i];
        boards.push(i % 2 === 0 ? newBoard(hi, lo) : newBoard(lo, hi));
    }
    return boards;
}

// ───────────────────────── الترتيب ─────────────────────────
function standings(t) {
    if (t.format === 'swiss') {
        const buch = (x) => (t.played[x] || []).reduce((s, o) => s + (t.score[o] || 0), 0);
        return t.players.slice().sort((a, b) => (t.score[b] || 0) - (t.score[a] || 0) || buch(b) - buch(a) || seedIdx(t, a) - seedIdx(t, b))
            .map((tok) => ({ token: tok, pts: t.score[tok] || 0 }));
    }
    const alive = t.seeds.filter((x) => !t.out.includes(x)).map((tok) => ({ token: tok, alive: true }));
    const gone = t.out.slice().sort((a, b) => (t.outRound[b] || 0) - (t.outRound[a] || 0) || seedIdx(t, a) - seedIdx(t, b)).map((tok) => ({ token: tok, alive: false, round: (t.outRound[tok] || 0) + 1 }));
    return alive.concat(gone);
}

// ───────────────────────── الوحدة ─────────────────────────
// deps: getDb, saveSoon, emitTo, uname, ratingOf(token), statusOf(token), safety, clubOf(token),
//       tcIds, launchGame({tid, round, bi, w, b, tc, variant}) -> {roomId}|{error, who}, timers? {set, clear}, now?
function init(deps) {
    const db = () => deps.getDb();
    const timers = deps.timers || { set: setTimeout, clear: clearTimeout };
    const now = deps.now || Date.now;
    const pending = new Map();                       // مفتاح اللوحة -> مؤقّت الغياب
    const key = (t, bi) => t.id + ':' + t.round + ':' + bi;

    function clubOfTourney(t) { return db().clubs && db().clubs[t.club]; }
    function audience(t) {
        const c = clubOfTourney(t);
        const set = new Set(c ? c.members : []);
        t.players.forEach((x) => set.add(x));
        return [...set];
    }
    function visibleTo(token) {
        const c = deps.clubOf(token);
        const all = Object.values(store(db()));
        const mine = all.filter((t) => (c && t.club === c.id) || t.players.includes(token));
        const active = mine.filter((t) => t.status === 'open' || t.status === 'running');
        const done = mine.filter((t) => t.status === 'done' || t.status === 'cancelled').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, KEEP_DONE);
        return active.concat(done);
    }

    function myBoard(t, token) {
        if (t.status !== 'running' || t.round < 0) return -1;
        return t.rounds[t.round].findIndex((b) => !b.bye && b.state === 'pending' && (b.w === token || b.b === token));
    }
    function summary(t, token) {
        const u = (x) => deps.uname(x) || '؟';
        const st = standings(t).map((r) => Object.assign({ u: u(r.token), rating: t.seedRating[r.token] || deps.ratingOf(r.token) }, r.pts !== undefined ? { pts: r.pts } : { alive: r.alive, round: r.round }));
        const boards = t.round >= 0 ? t.rounds[t.round].map((b) => ({ w: u(b.w), b: b.b ? u(b.b) : null, state: b.state, res: b.result, bye: b.bye, note: b.note })) : [];
        let play = null;
        const bi = myBoard(t, token);
        if (bi >= 0) {
            const b = t.rounds[t.round][bi];
            const color = b.w === token ? 'w' : 'b';
            play = { opp: u(color === 'w' ? b.b : b.w), color, ready: b.ready[color], oppReady: b.ready[color === 'w' ? 'b' : 'w'], deadline: b.deadline };
        }
        const c = clubOfTourney(t);
        return {
            id: t.id, name: t.name, format: t.format, tc: t.tc, variant: t.variant, status: t.status,
            round: t.round + 1, totalRounds: t.totalRounds, count: t.players.length, min: MIN_PLAYERS, max: MAX_PLAYERS,
            joined: t.players.includes(token), isOwner: t.owner === token, canStart: t.status === 'open' && t.players.length >= MIN_PLAYERS,
            club: c ? c.name : '', standings: st, boards, winner: t.winner ? u(t.winner) : null, play, note: t.note || ''
        };
    }
    function pushTo(token) {
        deps.emitTo(token, 'tourneys', { now: now(), list: visibleTo(token).map((t) => summary(t, token)) });
    }
    function push(t) { audience(t).forEach(pushTo); }
    function notify(tokens, text) {
        tokens.forEach((x) => {
            deps.emitTo(x, 'notify', { text });
            if (deps.pushOffline) { try { deps.pushOffline(x, { title: '🏆 بطولة النادي', body: text, url: '/' }); } catch (e) { /* اختياري */ } }
        });
    }

    // ───── دورة الحياة ─────
    function schedule(t, bi) {
        const k = key(t, bi);
        if (pending.has(k)) timers.clear(pending.get(k));
        const round = t.round;
        pending.set(k, timers.set(() => noShow(t.id, round, bi), Math.max(1000, t.rounds[t.round][bi].deadline - now())));
    }
    function clearBoardTimer(t, bi) {
        const k = key(t, bi);
        if (pending.has(k)) { timers.clear(pending.get(k)); pending.delete(k); }
    }

    function startRound(t) {
        t.round++;
        t.rounds[t.round] = t.format === 'swiss' ? pairSwiss(t) : pairKo(t);
        t.rounds[t.round].forEach((b, bi) => {
            if (b.bye) {
                if (t.format === 'swiss') t.score[b.w] = (t.score[b.w] || 0) + 1;
                return;
            }
            b.deadline = now() + READY_MS;
            [b.w, b.b].forEach((x) => { t.cols[x] = t.cols[x] || { w: 0, b: 0, last: null }; });
            t.cols[b.w].w++; t.cols[b.w].last = 'w';
            t.cols[b.b].b++; t.cols[b.b].last = 'b';
            schedule(t, bi);
        });
        const live = t.rounds[t.round].filter((b) => !b.bye);
        const text = '🏆 «' + t.name + '» الجولة ' + (t.round + 1) + ': اضغط «العب» في الشريط العلوي خلال 3 دقائق.';
        notify([].concat(...live.map((b) => [b.w, b.b])), text);
        const resting = t.rounds[t.round].filter((b) => b.bye).map((b) => b.w);
        notify(resting, '🏆 «' + t.name + '» الجولة ' + (t.round + 1) + ': لديك راحة هذه الجولة.');
        if (!live.length) endRoundIfDone(t);
    }

    function finish(t, winner) {
        t.status = 'done';
        t.winner = winner || null;
        t.finishedAt = now();
        const done = Object.values(store(db())).filter((x) => x.club === t.club && (x.status === 'done' || x.status === 'cancelled')).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
        done.slice(KEEP_DONE + 2).forEach((x) => { delete store(db())[x.id]; });   // لا نكدّس سجلات قديمة
        if (winner && deps.onChampion) { try { deps.onChampion(winner); } catch (e) { /* اختياري */ } }
        notify(audience(t), '🏆 انتهت بطولة «' + t.name + '»' + (winner ? '. البطل: ' + (deps.uname(winner) || '؟') : '.'));
    }

    function endRoundIfDone(t) {
        const boards = t.rounds[t.round];
        if (!boards.every((b) => b.state === 'done')) return;
        if (t.format === 'swiss') {
            if (t.round + 1 >= t.totalRounds) return finish(t, standings(t)[0].token);
            return startRound(t);
        }
        const alive = t.seeds.filter((x) => !t.out.includes(x));
        if (alive.length <= 1) return finish(t, alive[0]);
        return startRound(t);
    }

    // res: 'w' | 'b' | 'd' | 'x' (غاب الطرفان)
    function record(t, bi, res, note) {
        const b = t.rounds[t.round][bi];
        if (!b || b.state === 'done') return;
        clearBoardTimer(t, bi);
        if (t.format === 'ko') {
            if (res === 'd' && b.tries < 1) {              // تعادل: تُعاد بتبديل الألوان مرة واحدة
                b.tries++;
                const w = b.w; b.w = b.b; b.b = w;
                b.state = 'pending'; b.ready = { w: false, b: false }; b.roomId = null; b.deadline = now() + READY_MS;
                b.note = 'تعادل: أُعيدت المباراة بتبديل الألوان';
                schedule(t, bi);
                notify([b.w, b.b], '🏆 تعادل في «' + t.name + '»: تُعاد المباراة بتبديل الألوان.');
                return push(t);
            }
            if (res === 'd' || res === 'x') {
                res = seedIdx(t, b.w) < seedIdx(t, b.b) ? 'w' : 'b';
                note = (note ? note + '. ' : '') + 'يتأهل الأعلى تصنيفًا';
            }
            const loser = res === 'w' ? b.b : b.w;
            t.out.push(loser);
            t.outRound[loser] = t.round;
        } else {
            const add = { w: [1, 0], b: [0, 1], d: [0.5, 0.5], x: [0, 0] }[res];
            t.score[b.w] = (t.score[b.w] || 0) + add[0];
            t.score[b.b] = (t.score[b.b] || 0) + add[1];
            t.played[b.w] = (t.played[b.w] || []).concat(b.b);
            t.played[b.b] = (t.played[b.b] || []).concat(b.w);
        }
        b.state = 'done'; b.result = res; b.note = note || b.note || '';
        deps.saveSoon();
        endRoundIfDone(t);
        push(t);
    }

    function noShow(tid, round, bi) {
        const t = store(db())[tid];
        if (!t || t.status !== 'running' || t.round !== round) return;
        const b = t.rounds[round][bi];
        if (!b || b.state !== 'pending') return;
        pending.delete(key(t, bi));
        if (b.ready.w && !b.ready.b) record(t, bi, 'w', 'غاب ' + (deps.uname(b.b) || 'الخصم'));
        else if (b.ready.b && !b.ready.w) record(t, bi, 'b', 'غاب ' + (deps.uname(b.w) || 'الخصم'));
        else record(t, bi, 'x', 'غاب الطرفان');
    }

    function ready(t, token) {
        const bi = myBoard(t, token);
        if (bi < 0) return 'لا توجد مباراة تنتظرك الآن.';
        const b = t.rounds[t.round][bi];
        const color = b.w === token ? 'w' : 'b';
        if (deps.statusOf(token) === 'playing') return 'أنهِ مباراتك الحالية أولًا.';
        b.ready[color] = true;
        if (b.ready.w && b.ready.b) {
            const r = deps.launchGame({ tid: t.id, round: t.round, bi, w: b.w, b: b.b, tc: t.tc, variant: t.variant });
            if (r && r.error) {
                if (r.who) { const c = b.w === r.who ? 'w' : 'b'; b.ready[c] = false; deps.emitTo(r.who, 'notify', { text: r.error }); }
                else b.ready = { w: false, b: false };
            } else {
                b.state = 'playing'; b.roomId = r.roomId;
                clearBoardTimer(t, bi);
            }
        }
        deps.saveSoon();
        push(t);
        return null;
    }

    // نهاية مباراة بطولة (يستدعيها الخادم من endGame)
    function gameEnded(meta, result) {
        const t = store(db())[meta.id];
        if (!t || t.status !== 'running' || t.round !== meta.round) return;
        const b = t.rounds[t.round][meta.bi];
        if (!b || b.state !== 'playing') return;
        const res = result && result.winner && result.reason !== 'aborted' ? result.winner : 'd';
        record(t, meta.bi, res, '');
    }

    // بعد إعادة تشغيل الخادم: المباريات الجارية تُعاد، والمؤقّتات تُستعاد
    function resume() {
        Object.values(store(db())).forEach((t) => {
            if (t.status !== 'running') return;
            t.rounds[t.round].forEach((b, bi) => {
                if (b.bye || b.state === 'done') return;
                b.state = 'pending'; b.ready = { w: false, b: false }; b.roomId = null; b.deadline = now() + READY_MS;
                b.note = 'أُعيدت بعد إعادة تشغيل الخادم';
                schedule(t, bi);
            });
        });
    }

    // ───── Socket.IO ─────
    function register(socket) {
        function me() {
            const ctx = deps.playerCtx(socket);
            const rec = ctx && db().players[ctx.token];
            if (!rec || !rec.user) { socket.emit('t_error', 'سجّل الدخول أولًا.'); return null; }
            return { token: ctx.token, rec };
        }
        const fail = (e) => socket.emit('t_error', e);
        const find = (id) => store(db())[String(id)];

        socket.on('t_get', () => { const a = me(); if (a) pushTo(a.token); });

        socket.on('t_create', (d) => {
            const a = me(); if (!a) return;
            const c = deps.clubOf(a.token);
            if (!c || c.owner !== a.token) return fail('إنشاء البطولات لمالك النادي فقط.');
            if (Object.values(store(db())).some((t) => t.club === c.id && (t.status === 'open' || t.status === 'running'))) return fail('لدى ناديك بطولة جارية بالفعل.');
            const format = d && d.format;
            if (!FORMATS.includes(format)) return fail('اختر نوع البطولة.');
            if (!deps.tcIds.includes(d.tc)) return fail('اختر وقت المباراة.');
            let name = String((d && d.name) || '').replace(/[\u0000-\u001f\u007f‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
            name = name ? deps.safety.filterText(name).text : 'بطولة ' + c.name;
            let id;
            do { id = crypto.randomBytes(4).toString('hex'); } while (store(db())[id]);
            store(db())[id] = {
                id, club: c.id, name, format, tc: d.tc, variant: d.variant === '960' ? '960' : 'std', owner: a.token,
                status: 'open', players: [a.token], created: now(), round: -1, rounds: [], totalRounds: 0, winner: null,
                seeds: [], seedRating: {}, score: {}, played: {}, cols: {}, byes: [], out: [], outRound: {}, note: ''
            };
            deps.saveSoon();
            notify(c.members.filter((x) => x !== a.token), '🏆 فتح ' + a.rec.user + ' التسجيل في بطولة «' + name + '». ادخل صفحة النادي للمشاركة.');
            push(store(db())[id]);
        });

        socket.on('t_join', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.status !== 'open') return fail('التسجيل في هذه البطولة مغلق.');
            const c = deps.clubOf(a.token);
            if (!c || c.id !== t.club) return fail('البطولة لأعضاء النادي فقط.');
            if (t.players.includes(a.token)) return;
            if (t.players.length >= MAX_PLAYERS) return fail('البطولة ممتلئة.');
            t.players.push(a.token);
            deps.saveSoon(); push(t);
        });

        socket.on('t_leave', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.status !== 'open' || !t.players.includes(a.token)) return;
            if (t.owner === a.token) return fail('أنت منظّم البطولة. استعمل «إلغاء البطولة».');
            t.players = t.players.filter((x) => x !== a.token);
            deps.saveSoon(); push(t); pushTo(a.token);
        });

        socket.on('t_start', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.owner !== a.token || t.status !== 'open') return fail('لا يمكن بدء هذه البطولة.');
            if (t.players.length < MIN_PLAYERS) return fail('يلزم ' + MIN_PLAYERS + ' لاعبين على الأقل.');
            t.seeds = t.players.slice().sort((x, y) => deps.ratingOf(y) - deps.ratingOf(x));
            t.seeds.forEach((x) => { t.seedRating[x] = deps.ratingOf(x); });
            t.totalRounds = t.format === 'swiss' ? Math.min(5, Math.max(2, log2c(t.players.length))) : log2c(t.players.length);
            t.status = 'running'; t.startedAt = now();
            t.players.forEach((x) => { t.score[x] = 0; t.played[x] = []; });
            startRound(t);
            deps.saveSoon(); push(t);
        });

        socket.on('t_cancel', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.owner !== a.token || (t.status !== 'open' && t.status !== 'running')) return;
            if (t.status === 'running') t.rounds[t.round].forEach((b, bi) => clearBoardTimer(t, bi));
            t.status = 'cancelled'; t.finishedAt = now();
            notify(audience(t), '🏆 أُلغيت بطولة «' + t.name + '».');
            deps.saveSoon(); push(t);
        });

        socket.on('t_ready', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t) return;
            const e = ready(t, a.token);
            if (e) fail(e);
        });
    }

    return { register, gameEnded, resume, push, _t: { store, record, noShow, startRound, ready, summary } };
}

module.exports = { init, pairSwiss, pairKo, standings, MIN_PLAYERS, MAX_PLAYERS, READY_MS };
