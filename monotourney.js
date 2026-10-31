'use strict';
// سلم وثعبان: 2–4 لاعبين (بشر أو الحاسوب). الخادم هو المرجع الوحيد للنرد والحركة.
// الأنماط: classic (100 خانة) · quick (50 خانة) · chaos (ثعابين كثيرة) · surprise (خانات خاصة).
// القواعد: الوصول إلى آخر خانة يحتاج رقمًا مطابقًا تمامًا. الرقم 6 رمية إضافية.
// الخانات الخاصة: again = رمية إضافية · back = تراجع 3 خانات · shield = درع يمتص لدغة ثعبان واحدة.

const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
const SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
const spec = (again, back, shield) => {
    const o = {};
    again.forEach((c) => { o[c] = 'again'; });
    back.forEach((c) => { o[c] = 'back'; });
    shield.forEach((c) => { o[c] = 'shield'; });
    return o;
};
const BOARDS = {
    classic: { cells: 100, ladders: LADDERS, snakes: SNAKES, specials: {} },
    quick: {
        cells: 50,
        ladders: { 2: 17, 7: 21, 13: 32, 24: 41, 35: 48 },
        snakes: { 19: 4, 30: 9, 38: 20, 44: 27, 47: 12, 49: 33 },
        specials: {}
    },
    chaos: {
        cells: 100,
        ladders: { 3: 24, 12: 33, 27: 58, 41: 62, 56: 77, 71: 92 },
        snakes: { 98: 40, 95: 58, 93: 64, 89: 51, 84: 46, 79: 43, 74: 35, 68: 29, 63: 18, 59: 22, 53: 14, 47: 8, 44: 6, 38: 15, 31: 10, 26: 5 },
        specials: {}
    },
    surprise: {
        cells: 100,
        ladders: LADDERS,
        snakes: SNAKES,
        specials: spec([13, 33, 58, 76, 90], [25, 45, 68, 86, 97], [10, 40, 66, 85])
    }
};
const MODE_IDS = Object.keys(BOARDS);
const validMode = (m) => (MODE_IDS.includes(m) ? m : 'classic');
const COLORS = ['#e2b14b', '#46c08f', '#ef6b72', '#5879ae'];
const MAX_PLAYERS = 4;
const TURN_MS = 60000;          // مهلة اللاعب قبل أن يُرمى النرد عنه
const BOT_MS = 1100;
const REACTIONS = ['👍', '😂', '😮', '😡', '🎉', '😭', '🤝', '🐍'];
const INVITE_GAP = 10000;
const SHARE_TTL = 30 * 60 * 1000;
const QUEUE_TTL = 120000;

function createGame(n, mode) {
    const m = validMode(mode);
    return {
        mode: m, board: BOARDS[m], pos: new Array(n).fill(0), turn: 0, winner: null, last: null, log: [], rolls: 0, sixes: 0,
        shield: new Array(n).fill(false), st: Array.from({ length: n }, () => ({ lad: 0, snk: 0, big: false }))
    };
}

// رمية واحدة للاعب صاحب الدور. rnd: دالة تعيد 1..6 (للاختبار)
function roll(g, i, rnd) {
    if (g.winner !== null) return 'انتهت اللعبة.';
    if (g.turn !== i) return 'ليس دورك.';
    const B = g.board;
    const d = rnd ? rnd() : 1 + Math.floor(Math.random() * 6);
    const from = g.pos[i];
    const st = g.st[i];
    let step = from + d, to = step, via = null, special = null;
    if (step > B.cells) { step = from; to = from; }                         // رقم أكبر من اللازم: تبقى مكانك
    else if (B.ladders[step]) { via = 'ladder'; to = B.ladders[step]; st.lad++; }
    else if (B.snakes[step]) {
        if (g.shield[i]) { g.shield[i] = false; via = 'shield'; to = step; }   // الدرع يمتص اللدغة
        else { via = 'snake'; to = B.snakes[step]; st.snk++; if (step - to >= 50) st.big = true; }
    } else if (B.specials[step]) {
        const k = B.specials[step];
        if (k === 'again') special = 'again';
        else if (k === 'back') { special = 'back'; via = 'back'; to = step - 3; }
        else if (k === 'shield') { special = g.shield[i] ? 'shield_have' : 'shield'; g.shield[i] = true; }
    }
    g.last = { p: i, d, from, step, to, via, special, extra: false };
    g.pos[i] = to;
    g.log.push([i, d, from, to, special || (via === 'shield' ? 'blocked' : '')]);   // لإعادة المشاهدة بعد النهاية
    g.rolls++;
    if (to === B.cells) { g.winner = i; return null; }
    if (d === 6 || special === 'again') { g.last.extra = true; if (d === 6) g.sixes++; }   // رمية إضافية
    else g.turn = (g.turn + 1) % g.pos.length;
    return null;
}

function publicState(g) {
    const st = { mode: g.mode, board: g.board, pos: g.pos.slice(), turn: g.turn, winner: g.winner, last: g.last, rolls: g.rolls, shield: g.shield.slice() };
    if (g.winner !== null) { st.log = g.log.slice(0, 800); st.st = g.st; }
    return st;
}

function attach(io, deps) {
    // deps: nameOf(token) · onEnd(results) · top() · uname(token) · userToken(name) · statusOf(token)
    //       emitTo(token, ev, payload) · clubOf(token) · canInvite(aToken, bToken) -> bool
    const nameOf = deps.nameOf;
    const rooms = new Map();
    const queue = new Map();            // token -> { sid, mode, t }
    const shared = new Map();           // clubId -> { code, by, token, at }
    const now = deps.now || Date.now;
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

    // عند نهاية اللعبة نسجّل الإحصاءات مرة واحدة
    function finishOnce(room) {
        const g = room.game;
        if (!g || g.winner === null || room.ended) return;
        room.ended = true;
        if (room.onOver) {
            let w = room.tokens[g.winner];
            if (!w || room.left.has(w)) {                       // الفائز غادر: الأقرب إلى النهاية من الباقين
                const rest = room.tokens.map((t, i) => ({ t, p: g.pos[i] })).filter((x) => !room.left.has(x.t)).sort((a, b) => b.p - a.p);
                w = rest.length ? rest[0].t : null;
            }
            try { room.onOver(w); } catch (e) { /* لا يعطّل اللعب */ }
        }
        if (!deps.onEnd) return;
        try {
            const results = [];
            room.players.forEach((p, i) => {
                if (!p.token) return;
                const s = g.st[i] || {};
                results.push({
                    token: p.token, win: i === g.winner, lad: s.lad || 0, snk: s.snk || 0, big: !!s.big, humans: room.humans || 1,
                    rec: g.log.length <= 600 ? { t: now(), mode: g.mode, names: room.players.map((q) => q.name), me: i, winner: g.winner, log: g.log } : null
                });
            });
            deps.onEnd(results);
        } catch (e) { /* الإحصاءات لا تعطّل اللعبة */ }
    }

    function emitRoom(room) {
        finishOnce(room);
        room.players.forEach((pl, i) => {
            if (!pl.sid) return;
            io.to(pl.sid).emit('sl_update', {
                code: room.code, me: i, host: 0, ai: !!room.ai, mode: room.mode || 'classic',
                players: room.players.map((q, j) => ({ name: q.name, color: COLORS[j % COLORS.length], on: !!q.sid || !!q.bot, bot: !!q.bot })),
                started: !!room.game, game: room.game ? publicState(room.game) : null
            });
        });
        schedule(room);
    }
    function startGame(room) {
        room.game = createGame(room.players.length, room.mode);
        room.humans = room.players.filter((p) => !p.bot).length;
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
        const grace = room.tourney && !p.bot && !p.sid ? Math.max(0, room.t + 90000 - now()) : 0;   // مهلة حضور لأول 90 ثانية
        room.timer = setTimeout(() => {
            if (!rooms.has(room.code) || room.game !== g || g.rolls !== turnAt || g.winner !== null) return;
            roll(g, g.turn);
            emitRoom(room);
        }, Math.max(delay, grace));
        room.timer.unref && room.timer.unref();
    }

    function liveShare(clubId) {
        const s = shared.get(clubId);
        if (!s) return null;
        const f = findByToken(s.token);
        if (now() - s.at > SHARE_TTL || !f || f.room.code !== s.code || f.room.game) { shared.delete(clubId); return null; }
        return s;
    }
    const pubShare = (s) => (s ? { code: s.code, by: s.by } : null);

    const sweep = setInterval(() => {
        const t = now();
        for (const room of [...rooms.values()]) {
            if (room.tourney && room.game && room.game.winner === null && t - room.t > 4 * 60 * 1000 && room.players.every((p) => !p.sid)) {
                // لم يحضر أحد: نُكمل اللعبة آليًا ليُحسم التأهل
                for (let k = 0; k < 3000 && room.game.winner === null; k++) roll(room.game, room.game.turn);
                emitRoom(room);
            }
            if (room.players.every((p) => !p.sid) && t - room.t > 10 * 60 * 1000) dropRoom(room);
        }
        for (const [tok, q] of [...queue]) {
            if (t - q.t > QUEUE_TTL) {
                queue.delete(tok);
                io.to(q.sid).emit('sl_searching', { on: false });
                io.to(q.sid).emit('sl_error', 'لم نجد خصمًا الآن. جرّب اللعب ضد الحاسوب أو ادعُ صديقًا.');
            }
        }
    }, 30000);
    sweep.unref();

    io.on('connection', (socket) => {
        const tok = () => socket.data.token;
        const err = (m) => socket.emit('sl_error', m);
        const mine = () => (tok() ? findByToken(tok()) : null);
        const leaveQueue = () => { if (tok() && queue.delete(tok())) socket.emit('sl_searching', { on: false }); };

        socket.on('sl_create', (d) => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            leaveQueue();
            const code = newCode();
            if (!code) return err('تعذّر إنشاء الغرفة.');
            const room = { code, mode: validMode(d && d.mode), players: [{ token: tok(), name: nameOf(tok()), sid: socket.id }], game: null, t: now() };
            rooms.set(code, room);
            emitRoom(room);
        });

        socket.on('sl_create_ai', (d) => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            leaveQueue();
            const n = Math.min(3, Math.max(1, parseInt(d && d.bots, 10) || 1));
            const code = newCode();
            if (!code) return err('تعذّر إنشاء الغرفة.');
            const players = [{ token: tok(), name: nameOf(tok()), sid: socket.id }];
            for (let k = 1; k <= n; k++) players.push({ token: null, name: 'الحاسوب ' + k, sid: null, bot: true });
            const room = { code, mode: validMode(d && d.mode), players, game: null, t: now(), ai: true };
            startGame(room);
            rooms.set(code, room);
            emitRoom(room);
        });

        // المضيف يغيّر نمط اللوحة قبل البدء
        socket.on('sl_mode', (d) => {
            const f = mine();
            if (!f || f.i !== 0 || f.room.game || f.room.ai) return;
            f.room.mode = validMode(d && d.mode);
            emitRoom(f.room);
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
            leaveQueue();
            let nm = nameOf(tok());
            if (room.players.some((p) => p.name === nm)) nm = nm + ' ' + (room.players.length + 1);
            room.players.push({ token: tok(), name: nm, sid: socket.id });
            emitRoom(room);
        });

        socket.on('sl_rejoin', () => {
            const f = mine();
            if (!f) return socket.emit('sl_none');
            f.room.players[f.i].sid = socket.id; f.room.t = now();
            emitRoom(f.room);
        });

        socket.on('sl_leave', () => {
            leaveQueue();
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
            if (room.left) room.left.add(pl.token);
            pl.bot = true; pl.token = null; pl.sid = null; pl.name = pl.name + ' (غادر)';
            if (room.players.every((p) => !p.sid)) return dropRoom(room);
            emitRoom(room);
        });

        socket.on('sl_start', () => {
            const f = mine();
            if (!f || f.i !== 0) return err('المضيف فقط يبدأ اللعبة.');
            if (f.room.game) return;
            if (f.room.players.length < 2) return err('تحتاج إلى لاعبين اثنين على الأقل.');
            startGame(f.room);
            emitRoom(f.room);
        });

        socket.on('sl_roll', () => {
            const f = mine();
            if (!f || !f.room.game) return;
            const e = roll(f.room.game, f.i);
            if (e) return err(e);
            emitRoom(f.room);
        });

        // ───── مقابلة لاعب عشوائي ─────
        socket.on('sl_quick', (d) => {
            if (!tok()) return;
            if (mine()) return err('أنت في غرفة بالفعل.');
            const mode = validMode(d && d.mode);
            for (const [other, q] of [...queue]) {
                if (other === tok() || q.mode !== mode) continue;
                const code = newCode();
                if (!code) return err('تعذّر إنشاء الغرفة.');
                queue.delete(other);
                const a = { token: other, name: nameOf(other), sid: q.sid };
                let nb = nameOf(tok());
                if (nb === a.name) nb += ' 2';
                const room = { code, mode, players: [a, { token: tok(), name: nb, sid: socket.id }], game: null, t: now() };
                startGame(room);
                rooms.set(code, room);
                io.to(q.sid).emit('sl_searching', { on: false });
                return emitRoom(room);
            }
            queue.set(tok(), { sid: socket.id, mode, t: now() });
            socket.emit('sl_searching', { on: true });
        });
        socket.on('sl_quick_cancel', () => leaveQueue());

        // ───── دعوات الأصدقاء ومشاركة الغرفة مع النادي ─────
        socket.on('sl_invite', (d) => {
            const f = mine();
            if (!f) return err('أنشئ غرفة أولًا.');
            if (f.room.game || f.room.ai) return err('لا يمكن الدعوة بعد بدء اللعبة.');
            const target = deps.userToken(String((d && d.username) || ''));
            if (!target || target === tok()) return err('لا يوجد لاعب بهذا الاسم.');
            if (!deps.canInvite(tok(), target)) return err('يمكنك دعوة أصدقائك وأعضاء ناديك فقط.');
            if (deps.statusOf(target) === 'offline') return err('اللاعب غير متصل الآن.');
            const t = now();
            socket.data.slInv = socket.data.slInv || {};
            if (t - (socket.data.slInv[target] || 0) < INVITE_GAP) return err('انتظر قليلًا قبل دعوته مرة أخرى.');
            socket.data.slInv[target] = t;
            deps.emitTo(target, 'sl_invite', { from: nameOf(tok()), code: f.room.code });
            socket.emit('sl_ok', 'أُرسلت الدعوة إلى ' + deps.uname(target) + '.');
        });
        socket.on('sl_share_club', () => {
            const f = mine();
            if (!f || f.room.game || f.room.ai) return err('أنشئ غرفة لم تبدأ بعد.');
            const c = deps.clubOf(tok());
            if (!c) return err('أنت لست عضوًا في نادٍ.');
            shared.set(c.id, { code: f.room.code, by: nameOf(tok()), token: tok(), at: now() });
            c.members.forEach((t) => deps.emitTo(t, 'sl_club_room', pubShare(liveShare(c.id))));
            socket.emit('sl_ok', 'شاركت غرفتك مع ناديك.');
        });
        socket.on('sl_club_room_get', () => {
            const c = tok() && deps.clubOf(tok());
            socket.emit('sl_club_room', c ? pubShare(liveShare(c.id)) : null);
        });

        // ───── ردود فعل سريعة ─────
        socket.on('sl_react', (d) => {
            const f = mine();
            const e = d && d.e;
            if (!f || typeof e !== 'string' || !REACTIONS.includes(e)) return;
            const t = now();
            if (t - (socket.data.slReact || 0) < 600) return;
            socket.data.slReact = t;
            const from = String(f.room.players[f.i].name || 'لاعب').slice(0, 24);
            f.room.players.forEach((p) => { if (p.sid) io.to(p.sid).emit('sl_react', { from, e }); });
        });

        // ───── آخر ألعابي: إعادة مشاهدة محفوظة في الحساب ─────
        socket.on('sl_hist', () => {
            if (!tok() || !deps.hist) return;
            socket.emit('sl_hist', deps.hist(tok()).map((h, i) => ({ i, t: h.t, mode: h.mode, names: h.names, me: h.me, winner: h.winner, n: h.log.length })));
        });
        socket.on('sl_hist_game', (d) => {
            if (!tok() || !deps.hist) return;
            const h = deps.hist(tok())[parseInt(d && d.i, 10)];
            if (!h) return err('اللعبة غير موجودة.');
            const board = BOARDS[validMode(h.mode)];
            const pos = h.names.map(() => 0);
            h.log.forEach((e) => { pos[e[0]] = e[3]; });
            socket.emit('sl_hist_game', {
                mode: validMode(h.mode), me: h.me, names: h.names,
                game: { mode: validMode(h.mode), board, pos, turn: 0, winner: h.winner, last: null, rolls: h.log.length, shield: h.names.map(() => false), log: h.log }
            });
        });

        // ───── قائمة أفضل اللاعبين ─────
        socket.on('sl_top', () => { if (tok() && deps.top) socket.emit('sl_top', deps.top()); });

        socket.on('disconnect', () => {
            if (tok()) queue.delete(tok());
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

    // غرفة بطولة: تبدأ اللعبة فورًا بمقاعد محجوزة بالتوكن (الغائب يُرمى عنه تلقائيًا)
    function createTourneyRoom(tokens, mode, onOver) {
        const code = newCode();
        if (!code) return null;
        const order = tokens.slice().sort(() => Math.random() - 0.5);
        const room = {
            code, players: order.map((tk) => ({ token: tk, name: nameOf(tk), sid: null })), game: null, t: now(), mode: validMode(mode),
            tourney: true, tokens: order, left: new Set(), onOver
        };
        const seen = new Set();
        room.players.forEach((q) => { if (seen.has(q.name)) q.name += ' ' + (seen.size + 1); seen.add(q.name); });
        startGame(room);
        rooms.set(code, room);
        return code;
    }
    return { createTourneyRoom, rooms };
}

module.exports = { attach, createGame, roll, publicState, LADDERS, SNAKES, BOARDS, MODE_IDS, REACTIONS, rooms: null };
