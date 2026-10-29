'use strict';
// سلم وثعبان: لوحة 10×10 كلاسيكية، 2–4 لاعبين (بشر أو الحاسوب). الخادم هو المرجع الوحيد للنرد والحركة.
// القواعد: الوصول إلى 100 يحتاج رقمًا مطابقًا تمامًا. الرقم 6 يمنح رمية إضافية.

const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
const SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
const COLORS = ['#e2b14b', '#46c08f', '#ef6b72', '#5879ae'];
const MAX_PLAYERS = 4;
const TURN_MS = 60000;          // مهلة اللاعب قبل أن يُرمى النرد عنه
const BOT_MS = 1100;

function createGame(n) {
    return { pos: new Array(n).fill(0), turn: 0, winner: null, last: null, log: [], rolls: 0, sixes: 0 };
}

// رمية واحدة للاعب صاحب الدور. rnd: دالة تعيد 1..6 (للاختبار)
function roll(g, i, rnd) {
    if (g.winner !== null) return 'انتهت اللعبة.';
    if (g.turn !== i) return 'ليس دورك.';
    const d = rnd ? rnd() : 1 + Math.floor(Math.random() * 6);
    const from = g.pos[i];
    let to = from + d;
    let via = null;
    if (to > 100) to = from;                          // رقم أكبر من اللازم: تبقى مكانك
    else if (LADDERS[to]) { via = 'ladder'; g.last = { p: i, d, from, step: to, to: LADDERS[to], via }; to = LADDERS[to]; }
    else if (SNAKES[to]) { via = 'snake'; g.last = { p: i, d, from, step: to, to: SNAKES[to], via }; to = SNAKES[to]; }
    if (!via) g.last = { p: i, d, from, step: to, to, via: null };
    g.pos[i] = to;
    (g.log || (g.log = [])).push([i, d, from, to]);   // لإعادة المشاهدة بعد النهاية
    g.rolls++;
    g.last.extra = false;
    if (to === 100) { g.winner = i; return null; }
    if (d === 6 && g.pos[i] !== 100) { g.last.extra = true; g.sixes++; }   // رمية إضافية
    else g.turn = (g.turn + 1) % g.pos.length;
    return null;
}

function publicState(g) {
    const st = { pos: g.pos.slice(), turn: g.turn, winner: g.winner, last: g.last, rolls: g.rolls };
    if (g.winner !== null && g.log) st.log = g.log.slice(0, 600);
    return st;
}

function attach(io, { nameOf }) {
    const rooms = new Map();
    const newCode = () => {
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        for (let k = 0; k < 40; k++) {
            let c = '';
            for (let j = 0; j < 4; j++) c += A[Math.floor(Math.random() * A.length)];
            if (!rooms.has(c)) return c;
        }
        return null;
    };
    const findByToken = (token) => {
        for (const room of rooms.values()) {
            const i = room.players.findIndex((p) => p.token === token);
            if (i >= 0) return { room, i };
        }
        return null;
    };
    const dropRoom = (room) => { clearTimeout(room.timer); rooms.delete(room.code); };

    function emitRoom(room) {
        room.players.forEach((pl, i) => {
            if (!pl.sid) return;
            io.to(pl.sid).emit('sl_update', {
                code: room.code, me: i, host: 0, ai: !!room.ai,
                players: room.players.map((q, j) => ({ name: q.name, color: COLORS[j % COLORS.length], on: !!q.sid || !!q.bot, bot: !!q.bot })),
                started: !!room.game, game: room.game ? publicState(room.game) : null
            });
        });
        schedule(room);
    }

    // الحاسوب يرمي بعد لحظة، واللاعب الغائب أو الخامل يُرمى عنه بعد مهلة
    function schedule(room) {
        clearTimeout(room.timer);
        const g = room.game;
        if (!g || g.winner !== null) return;
        if (!room.players.some((p) => !p.bot && p.sid)) return;          // لا بشر متصلون: نتوقف
        const p = room.players[g.turn];
        if (!p) return;
        const delay = p.bot ? BOT_MS + (g.last && g.last.p !== g.turn ? 600 : 0) : (p.sid ? TURN_MS : 8000);
        const turnAt = g.rolls;
        room.timer = setTimeout(() => {
            if (!rooms.has(room.code) || room.game !== g || g.rolls !== turnAt || g.winner !== null) return;
            roll(g, g.turn);
            emitRoom(room);
        }, delay);
        room.timer.unref && room.timer.unref();
    }

    const sweep = setInterval(() => {
        const now = Date.now();
        for (const room of [...rooms.values()]) {
            if (room.players.every((p) => !p.sid) && now - room.t > 10 * 60 * 1000) dropRoom(room);
        }
    }, 30000);
    sweep.unref();

    io.on('connection', (socket) => {
        const tok = () => socket.data.token;
        const err = (m) => socket.emit('sl_error', m);
        const mine = () => (tok() ? findByToken(tok()) : null);

        socket.on('sl_create', () => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            const code = newCode();
            if (!code) return err('تعذّر إنشاء الغرفة.');
            const room = { code, players: [{ token: tok(), name: nameOf(tok()), sid: socket.id }], game: null, t: Date.now() };
            rooms.set(code, room);
            emitRoom(room);
        });

        socket.on('sl_create_ai', (d) => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            const n = Math.min(3, Math.max(1, parseInt(d && d.bots, 10) || 1));
            const code = newCode();
            if (!code) return err('تعذّر إنشاء الغرفة.');
            const players = [{ token: tok(), name: nameOf(tok()), sid: socket.id }];
            for (let k = 1; k <= n; k++) players.push({ token: null, name: 'الحاسوب ' + k, sid: null, bot: true });
            const room = { code, players, game: null, t: Date.now(), ai: true };
            room.game = createGame(players.length);
            rooms.set(code, room);
            emitRoom(room);
        });

        socket.on('sl_join', (d) => {
            if (!tok()) return;
            const code = String((d && d.code) || '').toUpperCase().trim().slice(0, 8);
            const room = rooms.get(code);
            if (!room) return err('الغرفة غير موجودة.');
            const ex = room.players.findIndex((p) => p.token === tok());
            if (ex >= 0) { room.players[ex].sid = socket.id; return emitRoom(room); }
            if (mine()) return err('أنت في غرفة بالفعل.');
            if (room.ai) return err('هذه غرفة ضد الحاسوب.');
            if (room.game) return err('بدأت اللعبة في هذه الغرفة.');
            if (room.players.length >= MAX_PLAYERS) return err('الغرفة ممتلئة.');
            let nm = nameOf(tok());
            if (room.players.some((p) => p.name === nm)) nm = nm + ' ' + (room.players.length + 1);
            room.players.push({ token: tok(), name: nm, sid: socket.id });
            emitRoom(room);
        });

        socket.on('sl_rejoin', () => {
            const f = mine();
            if (!f) return socket.emit('sl_none');
            f.room.players[f.i].sid = socket.id; f.room.t = Date.now();
            emitRoom(f.room);
        });

        socket.on('sl_leave', () => {
            const f = mine();
            if (!f) return;
            const { room, i } = f;
            socket.emit('sl_none');
            if (room.ai) return dropRoom(room);
            if (!room.game) {
                room.players.splice(i, 1);
                if (!room.players.length) return dropRoom(room);
                return emitRoom(room);
            }
            // أثناء اللعبة: يصير اللاعب «حاسوبًا» ليكمل اللاعبون
            const pl = room.players[i];
            pl.bot = true; pl.token = null; pl.sid = null; pl.name = pl.name + ' (غادر)';
            if (room.players.every((p) => !p.sid)) return dropRoom(room);
            emitRoom(room);
        });

        socket.on('sl_start', () => {
            const f = mine();
            if (!f || f.i !== 0) return err('المضيف فقط يبدأ اللعبة.');
            if (f.room.game) return;
            if (f.room.players.length < 2) return err('تحتاج إلى لاعبين اثنين على الأقل.');
            f.room.game = createGame(f.room.players.length);
            emitRoom(f.room);
        });

        socket.on('sl_roll', () => {
            const f = mine();
            if (!f || !f.room.game) return;
            const e = roll(f.room.game, f.i);
            if (e) return err(e);
            emitRoom(f.room);
        });

        socket.on('disconnect', () => {
            const f = tok() ? findByToken(tok()) : null;
            if (!f || f.room.players[f.i].sid !== socket.id) return;
            const { room, i } = f;
            room.players[i].sid = null;
            if (!room.game) {
                room.players.splice(i, 1);
                if (!room.players.length) return dropRoom(room);
            }
            emitRoom(room);
        });
    });
}

module.exports = { attach, createGame, roll, publicState, LADDERS, SNAKES, rooms: null };
