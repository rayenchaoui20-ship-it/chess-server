'use strict';
// بطولات «ملك المدينة» للنوادي: إقصاء بطاولات من 2 إلى 4 لاعبين، يتأهل فائز كل طاولة حتى النهائي.
// الغرف تُنشأ تلقائيًا (deps.makeRoom)، ونهاية اللعبة تصلنا عبر callback.
const crypto = require('crypto');

const MIN_PLAYERS = 3, MAX_PLAYERS = 16, TABLE = 4, KEEP_DONE = 3;

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// توزيع متوازن: 5 لاعبين -> 3 + 2، و9 -> 3 + 3 + 3، وحتى 4 -> طاولة واحدة (النهائي)
function split(players) {
    const k = Math.ceil(players.length / TABLE);
    const tables = Array.from({ length: k }, () => []);
    shuffle(players.slice()).forEach((p, i) => tables[i % k].push(p));
    return tables;
}

function init(deps) {
    const cfg = Object.assign({ prefix: 'mt', key: 'mtourneys', emoji: '🎲', game: 'ملك المدينة' }, deps.cfg || {});
    const P = cfg.prefix;
    const store = (d) => { if (!d[cfg.key] || typeof d[cfg.key] !== 'object') d[cfg.key] = {}; return d[cfg.key]; };
    const db = () => deps.getDb();

    const audience = (t) => {
        const c = db().clubs && db().clubs[t.club];
        return [...new Set((c ? c.members : []).concat(t.players))];
    };
    function visibleTo(token) {
        const c = deps.clubOf(token);
        const mine = Object.values(store(db())).filter((t) => (c && t.club === c.id) || t.players.includes(token));
        const active = mine.filter((t) => t.status === 'open' || t.status === 'running');
        const done = mine.filter((t) => t.status === 'done' || t.status === 'cancelled').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, KEEP_DONE);
        return active.concat(done);
    }
    function summary(t, token) {
        const u = (x) => deps.uname(x) || '؟';
        const alive = t.players.filter((x) => !t.out.includes(x));
        const tables = t.round >= 0 ? t.tables.map((tb) => ({ names: tb.players.map(u), state: tb.state, winner: tb.winner ? u(tb.winner) : null, mine: tb.players.includes(token) })) : [];
        const mineTb = t.status === 'running' ? t.tables.find((tb) => tb.state === 'playing' && tb.players.includes(token)) : null;
        const c = db().clubs && db().clubs[t.club];
        return {
            id: t.id, name: t.name, status: t.status, round: t.round + 1, count: t.players.length, min: MIN_PLAYERS, max: MAX_PLAYERS,
            joined: t.players.includes(token), isOwner: t.owner === token, canStart: t.status === 'open' && t.players.length >= MIN_PLAYERS,
            club: c ? c.name : '', players: t.players.map((x) => ({ u: u(x), alive: t.status === 'open' || alive.includes(x) })),
            tables, final: t.status === 'running' && t.tables.length === 1, winner: t.winner ? u(t.winner) : null, play: !!mineTb
        };
    }
    function pushTo(token) {
        const c = deps.clubOf(token);
        deps.emitTo(token, P + '_list', { canCreate: !!(c && c.owner === token), list: visibleTo(token).map((t) => summary(t, token)) });
    }
    const push = (t) => audience(t).forEach(pushTo);
    function notify(tokens, text) {
        tokens.forEach((x) => {
            deps.emitTo(x, 'notify', { text });
            if (deps.pushOffline) { try { deps.pushOffline(x, { title: cfg.emoji + ' بطولة ' + cfg.game, body: text, url: '/' }); } catch (e) { /* اختياري */ } }
        });
    }

    // ───── دورة الحياة ─────
    function openTable(t, ti) {
        const tb = t.tables[ti];
        const round = t.round;
        const code = deps.makeRoom(tb.players, t.map, (winnerToken) => tableEnded(t.id, round, ti, winnerToken));
        if (!code) { tb.state = 'pending'; return false; }
        tb.state = 'playing'; tb.code = code;
        return true;
    }

    function startRound(t) {
        const alive = t.players.filter((x) => !t.out.includes(x));
        t.round++;
        t.tables = split(alive).map((players) => ({ players, state: 'pending', winner: null, code: null }));
        t.tables.forEach((_, ti) => openTable(t, ti));
        const final = t.tables.length === 1;
        const text = cfg.emoji + ' «' + t.name + '» ' + (final ? 'النهائي' : 'الجولة ' + (t.round + 1)) + ': ادخل «' + cfg.game + '» واضغط «العب» خلال 3 دقائق وإلا تُحسب مفلسًا.';
        notify(alive, text);
    }

    function finish(t, winner) {
        t.status = 'done'; t.winner = winner || null; t.finishedAt = Date.now();
        const done = Object.values(store(db())).filter((x) => x.club === t.club && (x.status === 'done' || x.status === 'cancelled')).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
        done.slice(KEEP_DONE + 2).forEach((x) => { delete store(db())[x.id]; });
        if (winner && deps.onChampion) { try { deps.onChampion(winner); } catch (e) { /* اختياري */ } }
        notify(audience(t), cfg.emoji + ' انتهت بطولة «' + t.name + '»' + (winner ? '. البطل: ' + (deps.uname(winner) || '؟') : '.'));
    }

    function tableEnded(tid, round, ti, winnerToken) {
        const t = store(db())[tid];
        if (!t || t.status !== 'running' || t.round !== round) return;
        const tb = t.tables[ti];
        if (!tb || tb.state === 'done') return;
        // احتياط: إن لم يُعرف فائز نأخذ أول لاعب في الطاولة
        const w = tb.players.includes(winnerToken) ? winnerToken : tb.players[0];
        tb.state = 'done'; tb.winner = w;
        tb.players.forEach((x) => { if (x !== w) t.out.push(x); });
        if (t.tables.every((x) => x.state === 'done')) {
            if (t.tables.length === 1) finish(t, w);
            else startRound(t);
        }
        deps.saveSoon();
        push(t);
    }

    // بعد إعادة تشغيل الخادم الغرف الحية تضيع: نعيد فتح الطاولات غير المنتهية
    function resume() {
        Object.values(store(db())).forEach((t) => {
            if (t.status !== 'running' || !t.tables) return;
            t.tables.forEach((tb, ti) => { if (tb.state !== 'done') openTable(t, ti); });
        });
    }

    // ───── Socket.IO ─────
    function register(socket) {
        function me() {
            const ctx = deps.playerCtx(socket);
            const rec = ctx && db().players[ctx.token];
            if (!rec || !rec.user) { socket.emit(P + '_error', 'سجّل الدخول أولًا.'); return null; }
            return { token: ctx.token, rec };
        }
        const fail = (e) => socket.emit(P + '_error', e);
        const find = (id) => store(db())[String(id)];

        socket.on(P + '_get', () => { const a = me(); if (a) pushTo(a.token); });

        socket.on(P + '_create', (d) => {
            const a = me(); if (!a) return;
            const c = deps.clubOf(a.token);
            if (!c || c.owner !== a.token) return fail('إنشاء البطولات لمالك النادي فقط.');
            if (Object.values(store(db())).some((t) => t.club === c.id && (t.status === 'open' || t.status === 'running'))) return fail('لدى ناديك بطولة «' + cfg.game + '» جارية بالفعل.');
            let name = String((d && d.name) || '').replace(/[\u0000-\u001f\u007f‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
            name = name ? deps.safety.filterText(name).text : 'بطولة ' + c.name;
            let id;
            do { id = crypto.randomBytes(4).toString('hex'); } while (store(db())[id]);
            const maps = deps.settings();
            store(db())[id] = {
                id, club: c.id, name, owner: a.token, status: 'open', players: [a.token], created: Date.now(), round: -1,
                tables: [], out: [], winner: null, map: maps[crypto.randomInt(maps.length)]
            };
            deps.saveSoon();
            notify(c.members.filter((x) => x !== a.token), cfg.emoji + ' فتح ' + a.rec.user + ' التسجيل في بطولة «' + cfg.game + '»: «' + name + '». ادخل «' + cfg.game + '» للمشاركة.');
            push(store(db())[id]);
        });

        socket.on(P + '_join', (d) => {
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

        socket.on(P + '_leave', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.status !== 'open' || !t.players.includes(a.token)) return;
            if (t.owner === a.token) return fail('أنت منظّم البطولة. استعمل «إلغاء».');
            t.players = t.players.filter((x) => x !== a.token);
            deps.saveSoon(); push(t); pushTo(a.token);
        });

        socket.on(P + '_start', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.owner !== a.token || t.status !== 'open') return fail('لا يمكن بدء هذه البطولة.');
            if (t.players.length < MIN_PLAYERS) return fail('يلزم ' + MIN_PLAYERS + ' لاعبين على الأقل.');
            t.status = 'running'; t.startedAt = Date.now();
            startRound(t);
            deps.saveSoon(); push(t);
        });

        socket.on(P + '_cancel', (d) => {
            const a = me(); if (!a) return;
            const t = find(d && d.id);
            if (!t || t.owner !== a.token || (t.status !== 'open' && t.status !== 'running')) return;
            t.status = 'cancelled'; t.finishedAt = Date.now();
            notify(audience(t), cfg.emoji + ' أُلغيت بطولة «' + t.name + '».');
            deps.saveSoon(); push(t);
        });
    }

    return { register, resume, _t: { store, tableEnded, startRound, summary } };
}

module.exports = { init, split, MIN_PLAYERS, MAX_PLAYERS };
