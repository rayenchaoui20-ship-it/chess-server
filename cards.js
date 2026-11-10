'use strict';
// لعبة الورق (على غرار ألعاب «آخر ورقة»): قواعد عامة + أوراق بتصميم خاص بنا + غرف ولاعبون آليون.
// الخادم هو المرجع الوحيد: لا يرى اللاعب إلا أوراقه، ولا يرى الآخرون إلا عدد الأوراق.
// الورقة: { c: لون 0..3 (أحمر/أزرق/أخضر/ذهبي) أو 4 للبرّية, v: 0..9 رقم, 10 منع, 11 عكس, 12 +2, 13 برّية, 14 برّية +4 }
const SKIP = 10, REV = 11, DRAW2 = 12, WILD = 13, WILD4 = 14;

function makeDeck() {
    const d = [];
    for (let c = 0; c < 4; c++) {
        d.push({ c, v: 0 });
        for (let v = 1; v <= 12; v++) { d.push({ c, v }); d.push({ c, v }); }
    }
    for (let i = 0; i < 4; i++) { d.push({ c: 4, v: WILD }); d.push({ c: 4, v: WILD4 }); }
    return d;
}
function shuffle(a, rnd) {
    const r = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
}
const isWild = (card) => card.c === 4;
const nextSeat = (g, from, steps) => { const n = g.hands.length; return (((from + g.dir * (steps || 1)) % n) + n) % n; };

function newGame(players, rnd) {
    const n = players.length;
    const deck = shuffle(makeDeck(), rnd);
    const hands = players.map(() => []);
    for (let k = 0; k < 7; k++) for (let i = 0; i < n; i++) hands[i].push(deck.pop());
    // أول ورقة مكشوفة: رقم عادي دائمًا
    let first = deck.pop();
    while (first.v > 9) { deck.unshift(first); first = deck.pop(); }
    return {
        hands, deck, pile: [first], color: first.c, dir: 1, turn: Math.floor((rnd || Math.random)() * n), phase: 'play', drawn: -1,
        winner: null, last: null, st: players.map(() => ({ played: 0, drawn: 0 }))
    };
}
function refill(g, rnd) {
    if (g.deck.length > 0) return;
    const top = g.pile.pop();
    g.deck = shuffle(g.pile.splice(0), rnd);
    g.pile = [top];
}
function draw(g, seat, k, rnd) {
    const got = [];
    for (let i = 0; i < k; i++) {
        refill(g, rnd);
        if (!g.deck.length) break;              // لا ورق كافٍ (نادر جدًا)
        const c = g.deck.pop(); g.hands[seat].push(c); got.push(c);
    }
    g.st[seat].drawn += got.length;
    return got;
}
function canPlay(g, card) {
    const top = g.pile[g.pile.length - 1];
    return isWild(card) || card.c === g.color || card.v === top.v;
}
// الأوراق المسموح بلعبها الآن للاعب صاحب الدور
function playable(g, seat) {
    if (g.winner !== null || g.turn !== seat) return [];
    if (g.phase === 'drawn') return g.drawn >= 0 && g.hands[seat][g.drawn] && canPlay(g, g.hands[seat][g.drawn]) ? [g.drawn] : [];
    const out = [];
    g.hands[seat].forEach((c, i) => { if (canPlay(g, c)) out.push(i); });
    return out;
}
// يلعب ورقة. color مطلوب للبرّية. يعيد null إن كانت الحركة غير صالحة
function play(g, seat, idx, color, rnd) {
    if (!playable(g, seat).includes(idx)) return null;
    const card = g.hands[seat][idx];
    if (isWild(card) && !(color >= 0 && color <= 3)) return null;
    g.hands[seat].splice(idx, 1);
    g.pile.push(card);
    g.color = isWild(card) ? color : card.c;
    g.st[seat].played++;
    g.drawn = -1; g.phase = 'play';
    const ev = { by: seat, type: 'play', card, color: g.color, skipped: -1, drew: 0 };
    if (g.hands[seat].length === 0) { g.winner = seat; g.last = ev; return ev; }
    let nxt = nextSeat(g, seat, 1);
    if (card.v === REV) {
        g.dir = -g.dir;
        nxt = g.hands.length === 2 ? seat : nextSeat(g, seat, 1);          // لاعبان: العكس يعطيك دورًا آخر
        if (g.hands.length === 2) ev.skipped = nextSeat(g, seat, 1);
    } else if (card.v === SKIP) { ev.skipped = nxt; nxt = nextSeat(g, seat, 2); }
    else if (card.v === DRAW2) { ev.skipped = nxt; ev.drew = draw(g, nxt, 2, rnd).length; nxt = nextSeat(g, seat, 2); }
    else if (card.v === WILD4) { ev.skipped = nxt; ev.drew = draw(g, nxt, 4, rnd).length; nxt = nextSeat(g, seat, 2); }
    g.turn = nxt;
    g.last = ev;
    return ev;
}
// سحب ورقة: إن صلحت للعب يُسمح بلعبها أو التمرير، وإلا ينتقل الدور
function drawCard(g, seat, rnd) {
    if (g.winner !== null || g.turn !== seat || g.phase !== 'play') return null;
    const got = draw(g, seat, 1, rnd);
    const ev = { by: seat, type: 'draw', n: got.length, canPlay: false };
    if (got.length && canPlay(g, got[0])) { g.phase = 'drawn'; g.drawn = g.hands[seat].length - 1; ev.canPlay = true; }
    else { g.turn = nextSeat(g, seat, 1); g.phase = 'play'; g.drawn = -1; }
    g.last = ev;
    return ev;
}
function pass(g, seat) {
    if (g.winner !== null || g.turn !== seat || g.phase !== 'drawn') return null;
    g.turn = nextSeat(g, seat, 1); g.phase = 'play'; g.drawn = -1;
    g.last = { by: seat, type: 'pass' };
    return g.last;
}
// أفضل لون للبرّية: اللون الأكثر في اليد
function bestColor(hand) {
    const n = [0, 0, 0, 0];
    hand.forEach((c) => { if (c.c < 4) n[c.c]++; });
    let b = 0; for (let i = 1; i < 4; i++) if (n[i] > n[b]) b = i;
    return b;
}
// قرار الحاسوب: { idx, color } أو { draw: true } أو { pass: true }
function aiPick(g, seat) {
    const ok = playable(g, seat);
    if (g.phase === 'drawn') return ok.length ? { idx: ok[0], color: bestColor(g.hands[seat]) } : { pass: true };
    if (!ok.length) return { draw: true };
    const hand = g.hands[seat];
    const nxt = nextSeat(g, seat, 1), threat = g.hands[nxt].length <= 2;
    let best = ok[0], bs = -1e9;
    ok.forEach((i) => {
        const c = hand[i];
        let s = 0;
        if (isWild(c)) s -= hand.length > 2 ? 40 : -5;                      // نحتفظ بالبرّيات ما أمكن
        else if (c.v >= SKIP) s += threat ? 60 : 15;
        else s += c.v + (c.c === g.color ? 3 : 0);
        const same = hand.filter((h) => h.c === c.c).length;                // نتخلص من لون كثير
        s += same;
        if (c.v === WILD4 && !threat && hand.length > 3) s -= 30;
        if (s > bs) { bs = s; best = i; }
    });
    const rest = hand.filter((_, i) => i !== best);
    return { idx: best, color: bestColor(rest.length ? rest : hand) };
}

const REACTIONS = ['👍', '😂', '😮', '😡', '🎉', '😭', '🤝', '🃏'];
const AWAY_WAIT = 45000, IDLE_WAIT = 30000, MAX_MISS = 3, MAX_PLAYERS = 4;

function attach(io, deps) {
    const nameOf = deps.nameOf;
    const rooms = new Map();
    const queue = new Map();
    const now = deps.now || Date.now;
    const BOT_NAMES = ['ياسمين', 'سلطان', 'نور'];
    const newCode = () => {
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        for (let k = 0; k < 40; k++) { let c = ''; for (let j = 0; j < 4; j++) c += A[Math.floor(Math.random() * A.length)]; if (!rooms.has(c)) return c; }
        return null;
    };
    const findByToken = (t) => { for (const room of rooms.values()) { const i = room.players.findIndex((p) => p.token === t); if (i >= 0) return { room, i }; } return null; };
    const dropRoom = (room) => {
        clearTimeout(room.timer); clearTimeout(room.dropT);
        (room.specs || new Set()).forEach((sid) => io.to(sid).emit('cd_closed'));
        rooms.delete(room.code);
    };
    function pub(room, forSeat) {
        const g = room.game;
        const base = {
            code: room.code, started: !!g, me: forSeat, watching: forSeat < 0, specs: room.specs ? room.specs.size : 0, tally: room.tally || [],
            rm: room.players.map((p) => !!p.rm || !!p.bot),
            players: room.players.map((p, i) => ({ name: p.name, bot: !!p.bot, gone: !p.bot && !p.sid, n: g ? g.hands[i].length : 0, d: deps.deco && (p.stat || p.token) ? deps.deco(p.stat || p.token) : null }))
        };
        if (!g) return base;
        const top = g.pile[g.pile.length - 1];
        return Object.assign(base, {
            top, color: g.color, dir: g.dir, turn: g.turn, phase: g.phase, winner: g.winner, last: g.last, deckN: g.deck.length,
            hand: forSeat >= 0 ? g.hands[forSeat] : [], ok: forSeat >= 0 ? playable(g, forSeat) : [],
            // عند الفوز تُكشف أوراق الخاسرين
            reveal: g.winner !== null ? g.hands : null, deadline: room.deadline || 0
        });
    }
    function emitRoom(room, extra) {
        room.players.forEach((p, i) => { if (p.sid) io.to(p.sid).emit('cd_state', Object.assign(pub(room, i), extra || {})); });
        (room.specs || new Set()).forEach((sid) => io.to(sid).emit('cd_state', Object.assign(pub(room, -1), extra || {})));
    }
    function schedule(room) {
        clearTimeout(room.timer);
        const g = room.game;
        if (!g || g.winner !== null) { room.deadline = 0; return; }
        const p = room.players[g.turn];
        const away = !p.bot && !p.sid;
        if (away && g.phase === 'play' && deps.pushOffline && p.token) {
            const key = g.turn + ':' + g.st[g.turn].played + ':' + g.st[g.turn].drawn;
            if (room.pk !== key) { room.pk = key; try { deps.pushOffline(p.token, { title: '🃏 جاء دورك في لعبة الورق', body: 'ارجع إلى اللعبة قبل أن يلعب الحاسوب عنك.', url: '/cards', tag: 'cards-' + room.code }); } catch (e) { /* */ } }
        }
        const wait = p.bot ? 1100 : away ? AWAY_WAIT : IDLE_WAIT;
        room.deadline = p.bot ? 0 : now() + wait;
        room.timer = setTimeout(() => act(room, p.bot ? 'bot' : 'timeout'), wait);
    }
    function act(room, why) {
        const g = room.game;
        if (!g || g.winner !== null) return;
        const p = room.players[g.turn];
        if (why === 'timeout' && !p.bot) {
            p.miss = (p.miss || 0) + 1;
            if (p.miss >= MAX_MISS) { p.bot = true; p.name = String(p.name).slice(0, 18) + ' 🤖'; p.token = null; p.sid = null; }
        }
        const d = aiPick(g, g.turn);
        apply(room, g.turn, d);
    }
    function apply(room, seat, d) {
        const g = room.game;
        let ev = null;
        if (d.draw) ev = drawCard(g, seat);
        else if (d.pass) ev = pass(g, seat);
        else if (typeof d.idx === 'number') ev = play(g, seat, d.idx, d.color);
        if (!ev) return false;
        emitRoom(room);
        if (g.winner !== null) { finish(room); return true; }
        schedule(room);
        return true;
    }
    function finish(room) {
        clearTimeout(room.timer);
        room.over = true; room.deadline = 0;
        room.tally = room.tally || room.players.map(() => 0);
        if (room.game.winner !== null) room.tally[room.game.winner] = (room.tally[room.game.winner] || 0) + 1;
        if (deps.onEnd) {
            try {
                const g = room.game;
                deps.onEnd(room.players.map((p, i) => ({ token: p.stat || null, win: i === g.winner, humans: room.humans || 0, played: g.st[i].played, drawn: g.st[i].drawn })).filter((r) => r.token));
            } catch (e) { /* لا يعطّل اللعب */ }
        }
        room.timer = setTimeout(() => dropRoom(room), 5 * 60 * 1000);
    }
    function startGame(room) {
        room.humans = room.players.filter((p) => !p.bot).length;
        room.players.forEach((p) => { p.stat = !p.bot && p.token ? p.token : null; p.rm = false; });
        room.over = false;
        if (!room.tally) room.tally = room.players.map(() => 0);
        room.game = newGame(room.players);
        emitRoom(room);
        schedule(room);
    }
    function mkRoom() {
        const code = newCode();
        if (!code) return null;
        const room = { code, players: [], game: null, t: Date.now() };
        rooms.set(code, room);
        return room;
    }

    io.on('connection', (socket) => {
        const tok = () => socket.data.token;
        const err = (m) => socket.emit('cd_error', m);
        const mine = () => (tok() ? findByToken(tok()) : null);
        const leaveQueue = () => { if (tok() && queue.delete(tok())) socket.emit('cd_searching', { on: false }); };
        const human = () => ({ token: tok(), name: nameOf(tok()), sid: socket.id });
        function leave(soft) {
            leaveQueue();
            const f = mine();
            if (!f) return;
            const { room, i } = f;
            if (room.game && room.game.winner !== null) { room.players[i].sid = null; room.players[i].token = null; if (!room.players.some((p) => p.sid)) dropRoom(room); return; }
            if (!room.game) room.players.splice(i, 1);
            else if (soft === true) {
                room.players[i].sid = null;
                if (!room.players.some((p) => p.sid)) { clearTimeout(room.timer); room.timer = setTimeout(() => dropRoom(room), 10 * 60 * 1000); return; }
                emitRoom(room);
                if (room.game.turn === i) schedule(room);
                return;
            } else { room.players[i].sid = null; room.players[i].token = null; room.players[i].bot = true; room.players[i].name += ' 🤖'; }
            if (!room.players.some((p) => p.sid)) return dropRoom(room);
            emitRoom(room);
            if (room.game && room.game.turn === i) schedule(room);
        }
        socket.on('cd_create', () => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            leaveQueue();
            const room = mkRoom();
            if (!room) return err('تعذّر إنشاء الغرفة.');
            room.players.push(human());
            emitRoom(room);
        });
        socket.on('cd_create_ai', (d) => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            leaveQueue();
            const n = Math.min(3, Math.max(1, parseInt(d && d.bots, 10) || 1));
            const room = mkRoom();
            if (!room) return err('تعذّر إنشاء الغرفة.');
            room.players.push(human());
            for (let i = 0; i < n; i++) room.players.push({ token: null, name: BOT_NAMES[i], sid: null, bot: true });
            startGame(room);
        });
        socket.on('cd_join', (d) => {
            if (!tok()) return;
            const code = String((d && d.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
            const ex = mine();
            if (ex) { if (ex.room.code === code) { ex.room.players[ex.i].sid = socket.id; emitRoom(ex.room); if (ex.room.game) schedule(ex.room); return; } return err('أنت في غرفة بالفعل.'); }
            const room = rooms.get(code);
            if (!room) return err('لا توجد غرفة بهذا الكود.');
            if (room.game) return err('بدأت اللعبة في هذه الغرفة.');
            if (room.players.length >= MAX_PLAYERS) return err('الغرفة ممتلئة.');
            leaveQueue();
            room.players.push(human());
            emitRoom(room);
        });
        socket.on('cd_start', () => {
            const f = mine();
            if (!f || f.i !== 0 || f.room.game) return;
            if (f.room.players.length < 2) return err('تحتاج لاعبًا واحدًا على الأقل معك.');
            startGame(f.room);
        });
        socket.on('cd_play', (d) => {
            const f = mine();
            if (!f || !f.room.game) return;
            const idx = parseInt(d && d.idx, 10), color = parseInt(d && d.color, 10);
            if (f.room.game.turn !== f.i) return;
            f.room.players[f.i].miss = 0;
            if (!apply(f.room, f.i, { idx, color: Number.isInteger(color) ? color : -1 })) socket.emit('cd_state', pub(f.room, f.i));
        });
        socket.on('cd_draw', () => {
            const f = mine();
            if (!f || !f.room.game || f.room.game.turn !== f.i) return;
            f.room.players[f.i].miss = 0;
            apply(f.room, f.i, { draw: true });
        });
        socket.on('cd_pass', () => {
            const f = mine();
            if (!f || !f.room.game || f.room.game.turn !== f.i) return;
            f.room.players[f.i].miss = 0;
            apply(f.room, f.i, { pass: true });
        });
        socket.on('cd_quick', () => {
            if (!tok() || mine()) return;
            queue.set(tok(), socket.id);
            socket.emit('cd_searching', { on: true });
            const waiting = [...queue.entries()].filter(([t, sid]) => io.sockets.sockets.get(sid));
            if (waiting.length < 2) return;
            const room = mkRoom();
            if (!room) return;
            waiting.slice(0, MAX_PLAYERS).forEach(([t, sid]) => {
                queue.delete(t);
                const s = io.sockets.sockets.get(sid);
                if (s) { room.players.push({ token: s.data.token, name: nameOf(s.data.token), sid }); s.emit('cd_searching', { on: false }); }
            });
            startGame(room);
        });
        socket.on('cd_quick_cancel', leaveQueue);
        function unwatch() {
            const code = socket.data.cdWatch;
            if (!code) return;
            socket.data.cdWatch = null;
            const room = rooms.get(code);
            if (room && room.specs) { room.specs.delete(socket.id); emitRoom(room); }
        }
        socket.on('cd_watch', (d) => {
            if (!tok()) return;
            const code = String((d && d.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
            const room = rooms.get(code);
            if (!room) return err('لا توجد غرفة بهذا الكود.');
            if (mine()) return err('أنت في غرفة بالفعل.');
            room.specs = room.specs || new Set();
            if (room.specs.size >= 20 && !room.specs.has(socket.id)) return err('عدد المشاهدين ممتلئ.');
            unwatch(); leaveQueue();
            socket.data.cdWatch = code;
            room.specs.add(socket.id);
            emitRoom(room);
        });
        socket.on('cd_rematch', () => {
            const f = mine();
            if (!f || !f.room.game || f.room.game.winner === null) return;
            const room = f.room;
            room.players[f.i].rm = true;
            if (room.players.every((p) => p.bot || !p.sid || p.rm)) {
                clearTimeout(room.timer);
                room.players.forEach((p) => { if (!p.bot && !p.sid) { p.bot = true; p.token = null; p.name = String(p.name).slice(0, 18) + ' 🤖'; } });
                if (!room.players.some((p) => p.sid)) return dropRoom(room);
                startGame(room);
            } else emitRoom(room);
        });
        socket.on('cd_rejoin', () => {
            const f = mine();
            if (!f) return;
            f.room.players[f.i].sid = socket.id;
            f.room.players[f.i].miss = 0;
            clearTimeout(f.room.dropT);
            emitRoom(f.room);
            if (f.room.game && f.room.game.winner === null) schedule(f.room);
        });
        socket.on('cd_react', (d) => {
            const f = mine();
            const e = d && d.e;
            const wroom = !f && socket.data.cdWatch ? rooms.get(socket.data.cdWatch) : null;
            if ((!f && !wroom) || typeof e !== 'string' || !REACTIONS.includes(e)) return;
            const t = now();
            if (t - (socket.data.cdReact || 0) < 600) return;
            socket.data.cdReact = t;
            const room = f ? f.room : wroom;
            const from = f ? String(room.players[f.i].name || 'لاعب').slice(0, 24) : '👁 ' + String(nameOf(tok()) || 'مشاهد').slice(0, 20);
            room.players.forEach((p) => { if (p.sid) io.to(p.sid).emit('cd_react', { from, e }); });
            (room.specs || new Set()).forEach((sid) => io.to(sid).emit('cd_react', { from, e }));
        });
        socket.on('cd_top', () => {
            if (!tok()) return;
            const rows = deps.top ? deps.top() : { month: [], all: [] };
            socket.emit('cd_top', Object.assign({}, rows, { mine: deps.stats ? deps.stats(tok()) : null }));
        });
        socket.on('cd_leave', () => { unwatch(); leave(false); });
        socket.on('disconnect', () => { unwatch(); leave(true); });
    });
    return { rooms };
}

module.exports = { REACTIONS, attach, newGame, playable, play, drawCard, pass, aiPick, makeDeck, canPlay, SKIP, REV, DRAW2, WILD, WILD4 };
