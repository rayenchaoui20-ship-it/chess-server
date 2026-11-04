'use strict';
// ليدو: 2–4 لاعبين (بشر أو الحاسوب). الخادم هو المرجع الوحيد للنرد والحركة.
// القطعة p: -1 في القاعدة · 0..50 على المسار (نسبةً إلى نقطة بدء لونها) · 51..55 ممر الفوز · 56 وصلت.
// 6 تُخرج قطعة وتعطي رمية إضافية · الأكل والوصول يعطيان رمية إضافية · ثلاث ستات متتالية تُلغي الدور.
// خانات الأمان: نقاط البدء (مضاعفات 13) والنجوم (مضاعفات 13 + 8).
const START = [0, 13, 26, 39];
const FIN = 56;
const COLORS = ['#e5484d', '#3fae7a', '#f5b83d', '#3e8ef7'];
const seatColors = (n) => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);
const isSafe = (abs) => abs % 13 === 0 || abs % 13 === 8;
const absOf = (color, p) => (p >= 0 && p <= 50 ? (START[color] + p) % 52 : null);

function newGame(players) {
    const n = players.length, cols = seatColors(n);
    return {
        n, cols, pieces: players.map(() => [-1, -1, -1, -1]), turn: 0, dice: 0, phase: 'roll', sixes: 0, winner: null,
        rolls: 0, last: null
    };
}
function legal(g, seat, d) {
    const out = [];
    g.pieces[seat].forEach((p, i) => {
        if (p === -1) { if (d === 6) out.push(i); }
        else if (p < FIN && p + d <= FIN) out.push(i);
    });
    return out;
}
function nextSeat(g) {
    g.turn = (g.turn + 1) % g.n;
    g.phase = 'roll'; g.dice = 0; g.sixes = 0;
}
// يرمي النرد؛ يعيد { dice, movable, passed }
function roll(g, rnd) {
    if (g.winner !== null || g.phase !== 'roll') return null;
    const d = 1 + Math.floor((rnd || Math.random)() * 6);
    g.dice = d; g.rolls++;
    g.last = null;
    if (d === 6) g.sixes++;
    if (d === 6 && g.sixes >= 3) { const r = { dice: d, movable: [], passed: true, triple: true }; nextSeat(g); g.dice = d; return r; }
    const movable = legal(g, g.turn, d);
    if (!movable.length) { const r = { dice: d, movable, passed: true }; const keep = d; nextSeat(g); g.dice = keep; return r; }
    g.phase = 'move';
    return { dice: d, movable, passed: false };
}
function move(g, piece) {
    if (g.winner !== null || g.phase !== 'move') return null;
    const seat = g.turn, d = g.dice;
    if (!legal(g, seat, d).includes(piece)) return null;
    const from = g.pieces[seat][piece];
    const to = from === -1 ? 0 : from + d;
    g.pieces[seat][piece] = to;
    const cap = [];
    const abs = absOf(g.cols[seat], to);
    if (abs !== null && !isSafe(abs)) {
        g.pieces.forEach((arr, s) => {
            if (s === seat) return;
            arr.forEach((p, i) => { if (absOf(g.cols[s], p) === abs) { arr[i] = -1; cap.push({ seat: s, piece: i }); } });
        });
    }
    g.last = { seat, piece, from, to, cap, dice: d };
    const done = g.pieces[seat].every((p) => p === FIN);
    if (done) { g.winner = seat; g.phase = 'over'; return { cap, done: true }; }
    const extra = d === 6 || cap.length > 0 || to === FIN;
    if (extra) { g.phase = 'roll'; g.dice = 0; }
    else nextSeat(g);
    return { cap, extra, done: false };
}
// اختيار الحاسوب: يفضّل الأكل ثم الوصول ثم الإخراج ثم الأبعد تقدّمًا مع تجنّب الخطر
function aiPick(g, movable) {
    const seat = g.turn, d = g.dice, col = g.cols[seat];
    let best = movable[0], bs = -1e9;
    movable.forEach((i) => {
        const from = g.pieces[seat][i], to = from === -1 ? 0 : from + d;
        let s = to * 0.5;
        const abs = absOf(col, to);
        if (to === FIN) s += 60;
        else if (to > 50) s += 25;
        if (from === -1) s += 35;
        if (abs !== null) {
            let hit = false, danger = false;
            g.pieces.forEach((arr, o) => {
                if (o === seat) return;
                arr.forEach((p) => {
                    const oa = absOf(g.cols[o], p);
                    if (oa === null) return;
                    if (oa === abs && !isSafe(abs)) hit = true;
                    const dist = (abs - oa + 52) % 52;
                    if (!isSafe(abs) && dist >= 1 && dist <= 6) danger = true;
                });
            });
            if (hit) s += 80;
            if (danger) s -= 30;
            if (isSafe(abs)) s += 12;
        }
        const fa = absOf(col, from);
        if (fa !== null && !isSafe(fa)) {            // الهرب من الخطر الحالي
            g.pieces.forEach((arr, o) => { if (o !== seat) arr.forEach((p) => { const oa = absOf(g.cols[o], p); if (oa !== null) { const dist = (fa - oa + 52) % 52; if (dist >= 1 && dist <= 6) s += 20; } }); });
        }
        if (s > bs) { bs = s; best = i; }
    });
    return best;
}

function attach(io, deps) {
    const nameOf = deps.nameOf;
    const rooms = new Map();
    const queue = new Map();
    const BOT_NAMES = ['ياسمين', 'سلطان', 'نور'];
    const newCode = () => {
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        for (let k = 0; k < 40; k++) { let c = ''; for (let j = 0; j < 4; j++) c += A[Math.floor(Math.random() * A.length)]; if (!rooms.has(c)) return c; }
        return null;
    };
    const findByToken = (t) => { for (const room of rooms.values()) { const i = room.players.findIndex((p) => p.token === t); if (i >= 0) return { room, i }; } return null; };
    const dropRoom = (room) => { clearTimeout(room.timer); rooms.delete(room.code); };
    function pub(room, forSeat) {
        const g = room.game;
        const base = {
            code: room.code, started: !!g, host: 0, me: forSeat,
            players: room.players.map((p, i) => ({ name: p.name, bot: !!p.bot, gone: !p.bot && !p.sid, color: g ? g.cols[i] : i }))
        };
        if (!g) return base;
        return Object.assign(base, {
            pieces: g.pieces, turn: g.turn, dice: g.dice, phase: g.phase, winner: g.winner, last: g.last,
            movable: g.phase === 'move' ? legal(g, g.turn, g.dice) : [], deadline: room.deadline || 0
        });
    }
    function emitRoom(room, extra) {
        room.players.forEach((p, i) => { if (p.sid) io.to(p.sid).emit('lu_state', Object.assign(pub(room, i), extra || {})); });
    }
    function isAuto(room, seat) { const p = room.players[seat]; return p.bot || !p.sid; }
    function schedule(room) {
        clearTimeout(room.timer);
        const g = room.game;
        if (!g || g.winner !== null) { room.deadline = 0; return; }
        const auto = isAuto(room, g.turn);
        const wait = auto ? 900 : 30000;
        room.deadline = auto ? 0 : Date.now() + wait;
        room.timer = setTimeout(() => act(room, auto ? 'bot' : 'timeout'), wait);
    }
    function act(room, why) {
        const g = room.game;
        if (!g || g.winner !== null) return;
        if (g.phase === 'roll') doRoll(room);
        else { const mv = legal(g, g.turn, g.dice); doMove(room, aiPick(g, mv)); }
    }
    function doRoll(room) {
        const g = room.game;
        const r = roll(g);
        if (!r) return;
        if (r.passed) { emitRoom(room, { rolled: r.dice, passed: true, triple: !!r.triple, by: g.turn }); }
        else emitRoom(room, { rolled: r.dice });
        if (!r.passed && r.movable.length === 1) {              // حركة وحيدة: تُنفَّذ تلقائيًا
            clearTimeout(room.timer);
            room.timer = setTimeout(() => doMove(room, r.movable[0]), 650);
            return;
        }
        schedule(room);
    }
    function doMove(room, piece) {
        const g = room.game;
        const seat = g.turn;
        const r = move(g, piece);
        if (!r) return;
        emitRoom(room);
        if (g.winner !== null) return finish(room);
        schedule(room);
    }
    function finish(room) {
        clearTimeout(room.timer);
        room.over = true;
        room.timer = setTimeout(() => dropRoom(room), 5 * 60 * 1000);
    }
    function startGame(room) {
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
        const err = (m) => socket.emit('lu_error', m);
        const mine = () => (tok() ? findByToken(tok()) : null);
        const leaveQueue = () => { if (tok() && queue.delete(tok())) socket.emit('lu_searching', { on: false }); };
        const human = () => ({ token: tok(), name: nameOf(tok()), sid: socket.id });
        function leave() {
            leaveQueue();
            const f = mine();
            if (!f) return;
            const { room, i } = f;
            if (room.game && room.game.winner !== null) { room.players[i].sid = null; room.players[i].token = null; if (!room.players.some((p) => p.sid)) dropRoom(room); return; }
            if (!room.game) room.players.splice(i, 1);
            else { room.players[i].sid = null; room.players[i].token = null; room.players[i].bot = true; room.players[i].name += ' 🤖'; }
            if (!room.players.some((p) => p.sid)) return dropRoom(room);
            emitRoom(room);
            if (room.game && room.game.turn === i) schedule(room);
        }
        socket.on('lu_create', () => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            leaveQueue();
            const room = mkRoom();
            if (!room) return err('تعذّر إنشاء الغرفة.');
            room.players.push(human());
            emitRoom(room);
        });
        socket.on('lu_create_ai', (d) => {
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
        socket.on('lu_join', (d) => {
            if (!tok()) return;
            const code = String((d && d.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
            const ex = mine();
            if (ex) { if (ex.room.code === code) { ex.room.players[ex.i].sid = socket.id; emitRoom(ex.room); if (ex.room.game) schedule(ex.room); return; } return err('أنت في غرفة بالفعل.'); }
            const room = rooms.get(code);
            if (!room) return err('لا توجد غرفة بهذا الكود.');
            if (room.game) return err('بدأت اللعبة في هذه الغرفة.');
            if (room.players.length >= 4) return err('الغرفة ممتلئة.');
            leaveQueue();
            room.players.push(human());
            emitRoom(room);
        });
        socket.on('lu_start', () => {
            const f = mine();
            if (!f || f.i !== 0 || f.room.game) return;
            if (f.room.players.length < 2) return err('تحتاج لاعبًا واحدًا على الأقل معك.');
            startGame(f.room);
        });
        socket.on('lu_roll', () => {
            const f = mine();
            if (!f || !f.room.game || f.room.game.turn !== f.i || f.room.game.phase !== 'roll') return;
            doRoll(f.room);
        });
        socket.on('lu_move', (d) => {
            const f = mine();
            if (!f || !f.room.game || f.room.game.turn !== f.i || f.room.game.phase !== 'move') return;
            doMove(f.room, parseInt(d && d.piece, 10));
        });
        socket.on('lu_quick', () => {
            if (!tok() || mine()) return;
            queue.set(tok(), socket.id);
            socket.emit('lu_searching', { on: true });
            const waiting = [...queue.entries()].filter(([t, sid]) => io.sockets.sockets.get(sid));
            if (waiting.length < 2) return;
            const room = mkRoom();
            if (!room) return;
            waiting.slice(0, 4).forEach(([t, sid]) => {
                queue.delete(t);
                const s = io.sockets.sockets.get(sid);
                if (s) { room.players.push({ token: s.data.token, name: nameOf(s.data.token), sid }); s.emit('lu_searching', { on: false }); }
            });
            startGame(room);
        });
        socket.on('lu_quick_cancel', leaveQueue);
        socket.on('lu_leave', leave);
        socket.on('disconnect', leave);
    });
    return { rooms };
}

module.exports = { attach, newGame, legal, roll, move, aiPick, START, FIN, COLORS, isSafe, absOf };
