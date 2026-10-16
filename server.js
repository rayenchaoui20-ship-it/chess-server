const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const axios = require('axios');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ───────────────────────── الإعدادات ─────────────────────────
const ALLOWED_TIMES = [60, 180, 600];       // ثوانٍ: بوليت / بليتز / رابيد
const MAX_CHAT_LENGTH = 200;
const STOCKFISH_URL = 'https://stockfish.online/api/s/v2.php';

const rooms = new Map();

// طابور البحث عن خصم عشوائي: طابور لكل نظام وقت (قيم هي socket.id)
const queues = {};
ALLOWED_TIMES.forEach((t) => { queues[t] = []; });

function removeFromQueues(socketId) {
    for (const t of ALLOWED_TIMES) {
        const i = queues[t].indexOf(socketId);
        if (i !== -1) queues[t].splice(i, 1);
    }
}

// ───────────────────────── أدوات مساعدة ─────────────────────────
const other = (c) => (c === 'w' ? 'b' : 'w');

// تنظيف اسم اللاعب: حذف المحارف الخفية والأقواس، وقص الطول
function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
}

function makeRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id;
    do {
        id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (rooms.has(id));
    return id;
}

function newRoom(type, timeSec) {
    const room = {
        id: makeRoomId(),
        type,                       // 'multi' | 'ai'
        timeSec,
        game: new Chess(),
        players: { w: null, b: null },
        names: { w: '', b: '' },
        matched: false,             // انضم الطرفان
        aiColor: null,
        aiLevel: 10,
        aiBusy: false,
        aiFallbackNotified: false,
        clocks: { w: timeSec * 1000, b: timeSec * 1000 },
        running: false,             // الساعة تبدأ بعد أول نصف حركتين
        plies: 0,
        lastTick: Date.now(),
        timer: null,
        lastMove: null,
        over: false,
        result: null,               // { winner: 'w' | 'b' | null, reason }
        closed: false,
        rematch: { w: false, b: false },
        drawOffer: null,            // لون من اقترح التعادل حاليًا
        lastDrawPly: { w: -9, b: -9 }
    };
    rooms.set(room.id, room);
    return room;
}

// يجلس اللاعب على لون في الغرفة
function seat(socket, room, color) {
    room.players[color] = socket.id;
    room.names[color] = socket.data.name || '';
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.color = color;
}

// يبدأ المباراة بعد اكتمال اللاعبين (غرفة صديق أو بحث عشوائي أو إعادة)
function startMatch(room) {
    room.matched = true;
    for (const color of ['w', 'b']) {
        io.to(room.players[color]).emit('game_start', {
            color,
            mode: 'multi',
            roomId: room.id
        });
    }
    broadcast(room);
}

// إعادة المباراة في نفس الغرفة مع تبديل الألوان
function resetForRematch(room) {
    clearTimeout(room.timer);
    const wId = room.players.w, bId = room.players.b;
    room.players.w = bId;
    room.players.b = wId;
    const wName = room.names.w;
    room.names.w = room.names.b;
    room.names.b = wName;
    for (const c of ['w', 'b']) {
        const s = io.sockets.sockets.get(room.players[c]);
        if (s) s.data.color = c;
    }
    room.game = new Chess();
    room.clocks = { w: room.timeSec * 1000, b: room.timeSec * 1000 };
    room.running = false;
    room.plies = 0;
    room.lastTick = Date.now();
    room.lastMove = null;
    room.over = false;
    room.result = null;
    room.rematch = { w: false, b: false };
    room.drawOffer = null;
    room.lastDrawPly = { w: -9, b: -9 };
}

function publicState(room) {
    return {
        fen: room.game.fen(),
        turn: room.game.turn(),
        check: room.game.inCheck(),
        lastMove: room.lastMove,
        history: room.game.history(),
        names: room.names,
        moveCount: room.plies,
        clocks: room.clocks,
        tickAt: room.lastTick,
        serverNow: Date.now(),
        running: room.running,
        over: room.over,
        result: room.result
    };
}

function broadcast(room) {
    io.to(room.id).emit('state', publicState(room));
}

function closeRoom(room) {
    clearTimeout(room.timer);
    room.closed = true;
    rooms.delete(room.id);
}

// ───────────────────────── الساعة ─────────────────────────
function scheduleFlag(room) {
    clearTimeout(room.timer);
    if (room.over || !room.running) return;
    const side = room.game.turn();
    room.timer = setTimeout(() => onFlag(room, side), Math.max(0, room.clocks[side]));
}

function onFlag(room, side) {
    if (room.over || room.closed || room.game.turn() !== side) return;
    room.clocks[side] = 0;
    endGame(room, { winner: other(side), reason: 'timeout' });
}

function endGame(room, result) {
    if (room.over) return;
    room.over = true;
    room.result = result;
    room.drawOffer = null;
    clearTimeout(room.timer);
    room.lastTick = Date.now();
    broadcast(room);
}

// ───────────────────────── تطبيق الحركة ─────────────────────────
function applyMove(room, color, { from, to, promotion }) {
    if (room.over || room.closed || room.game.turn() !== color) return false;

    const now = Date.now();
    if (room.running) {
        room.clocks[color] -= now - room.lastTick;
        if (room.clocks[color] <= 0) {
            room.clocks[color] = 0;
            endGame(room, { winner: other(color), reason: 'timeout' });
            return false;
        }
    }

    let mv;
    try {
        const promo = ['q', 'r', 'b', 'n'].includes(promotion) ? promotion : 'q';
        mv = room.game.move({ from, to, promotion: promo });
    } catch (e) {
        // حركة غير قانونية: نعيد الوقت المخصوم
        if (room.running) room.clocks[color] += now - room.lastTick;
        return false;
    }

    room.plies++;
    room.lastMove = { from: mv.from, to: mv.to, san: mv.san, captured: !!mv.captured };
    if (!room.running && room.plies >= 2) room.running = true;
    room.lastTick = now;

    // تحرّك الطرف الآخر دون الرد على اقتراح التعادل: يُعتبر رفضًا
    if (room.drawOffer && room.drawOffer !== color) {
        room.drawOffer = null;
        io.to(room.id).emit('draw_cleared');
    }

    const g = room.game;
    if (g.isCheckmate()) {
        endGame(room, { winner: color, reason: 'checkmate' });
    } else if (g.isStalemate()) {
        endGame(room, { winner: null, reason: 'stalemate' });
    } else if (g.isInsufficientMaterial()) {
        endGame(room, { winner: null, reason: 'insufficient' });
    } else if (g.isThreefoldRepetition()) {
        endGame(room, { winner: null, reason: 'repetition' });
    } else if (g.isDraw()) {
        endGame(room, { winner: null, reason: 'fifty' });
    } else {
        scheduleFlag(room);
        broadcast(room);
        if (room.type === 'ai' && g.turn() === room.aiColor) aiTurn(room);
    }
    return true;
}

// ───────────────────────── الذكاء الاصطناعي ─────────────────────────
async function fetchEngineMove(room) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await axios.get(STOCKFISH_URL, {
                params: { fen: room.game.fen(), depth: room.aiLevel },
                timeout: 8000
            });
            const text = res.data && res.data.success ? String(res.data.bestmove || '') : '';
            const m = /bestmove\s+([a-h][1-8])([a-h][1-8])([qrbn])?/.exec(text);
            if (m) return { from: m[1], to: m[2], promotion: m[3] };
        } catch (e) {
            console.error('Stockfish API error:', e.message);
        }
    }
    return null;
}

async function aiTurn(room) {
    if (room.over || room.closed || room.aiBusy || room.game.turn() !== room.aiColor) return;
    room.aiBusy = true;
    try {
        let move = await fetchEngineMove(room);

        // الغرفة قد تُغلق أو تنتهي أثناء الانتظار
        if (room.over || room.closed || room.game.turn() !== room.aiColor) return;

        if (!move) {
            // بديل: حركة عشوائية قانونية حتى لا تتجمد اللعبة
            const legal = room.game.moves({ verbose: true });
            if (!legal.length) return;
            const pick = legal[Math.floor(Math.random() * legal.length)];
            move = { from: pick.from, to: pick.to, promotion: pick.promotion };
            if (!room.aiFallbackNotified) {
                room.aiFallbackNotified = true;
                io.to(room.id).emit('notice', 'تعذّر الاتصال بمحرك Stockfish، سيلعب الحاسوب حركات عشوائية مؤقتًا.');
            }
        }
        applyMove(room, room.aiColor, move);
    } finally {
        room.aiBusy = false;
    }
}

// ───────────────────────── المغادرة ─────────────────────────
function handleLeave(socket) {
    removeFromQueues(socket.id);
    const room = rooms.get(socket.data.roomId);
    socket.data.roomId = null;
    if (!room) return;
    socket.leave(room.id);

    if (room.type === 'ai') {
        closeRoom(room);
        return;
    }

    const color = socket.data.color;
    if (room.players[color] === socket.id) room.players[color] = null;

    if (room.matched && !room.over && room.players[other(color)]) {
        endGame(room, { winner: other(color), reason: 'abandoned' });
    }
    // أبلغ من بقي في الغرفة (لإخفاء زر إعادة المباراة مثلًا)
    io.to(room.id).emit('opponent_left');

    if (!room.players.w && !room.players.b) closeRoom(room);
}

// ───────────────────────── Socket.IO ─────────────────────────
io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.color = null;
    socket.data.name = '';

    socket.on('create_room', (data) => {
        const timeSec = Number(data && data.timeSec);
        if (!ALLOWED_TIMES.includes(timeSec)) return socket.emit('room_error', 'نظام الوقت غير صالح.');

        handleLeave(socket);
        socket.data.name = cleanName(data && data.name);
        const room = newRoom('multi', timeSec);
        seat(socket, room, 'w');
        socket.emit('room_created', { roomId: room.id });
    });

    socket.on('join_room', (payload) => {
        // يقبل نصًا (الكود فقط) أو كائنًا { roomId, name }
        const data = payload && typeof payload === 'object' ? payload : { roomId: payload };
        const roomId = String(data.roomId || '').trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room || room.type !== 'multi') return socket.emit('room_error', 'الغرفة غير موجودة.');
        if (room.players.w === socket.id) return socket.emit('room_error', 'هذه غرفتك أنت، أرسل الكود لصديقك.');
        if (room.players.b || room.over) return socket.emit('room_error', 'الغرفة ممتلئة أو انتهت اللعبة فيها.');

        handleLeave(socket);
        socket.data.name = cleanName(data.name);
        seat(socket, room, 'b');
        startMatch(room);
    });

    socket.on('find_match', (data) => {
        const timeSec = Number(data && data.timeSec);
        if (!ALLOWED_TIMES.includes(timeSec)) return socket.emit('room_error', 'نظام الوقت غير صالح.');

        handleLeave(socket);                       // يخرج من أي غرفة أو طابور سابق
        socket.data.name = cleanName(data && data.name);

        // ابحث عن خصم ما زال متصلًا في طابور نفس نظام الوقت
        const queue = queues[timeSec];
        let opponent = null;
        while (queue.length) {
            const candidate = io.sockets.sockets.get(queue.shift());
            if (candidate && candidate.connected) { opponent = candidate; break; }
        }

        if (!opponent) {
            queue.push(socket.id);
            return socket.emit('searching', { timeSec });
        }

        const room = newRoom('multi', timeSec);
        const opponentIsWhite = Math.random() < 0.5;   // توزيع الألوان عشوائيًا
        seat(opponentIsWhite ? opponent : socket, room, 'w');
        seat(opponentIsWhite ? socket : opponent, room, 'b');
        startMatch(room);
    });

    socket.on('cancel_search', () => {
        removeFromQueues(socket.id);
        socket.emit('search_cancelled');
    });

    socket.on('create_ai_room', (data) => {
        data = data || {};
        const timeSec = Number(data.timeSec);
        if (!ALLOWED_TIMES.includes(timeSec)) return socket.emit('room_error', 'نظام الوقت غير صالح.');
        const color = data.color === 'b' ? 'b' : 'w';
        const level = Math.min(15, Math.max(1, parseInt(data.level, 10) || 10));

        handleLeave(socket);
        socket.data.name = cleanName(data.name);
        const room = newRoom('ai', timeSec);
        room.matched = true;
        room.aiLevel = level;
        room.aiColor = other(color);
        seat(socket, room, color);
        room.names[room.aiColor] = 'الحاسوب';

        socket.emit('game_start', { color, mode: 'ai', roomId: room.id });
        broadcast(room);
        if (room.aiColor === 'w') aiTurn(room);
    });

    socket.on('move', (data) => {
        const room = rooms.get(socket.data.roomId);
        if (!room || !data || typeof data.from !== 'string' || typeof data.to !== 'string') return;
        const ok = applyMove(room, socket.data.color, {
            from: data.from,
            to: data.to,
            promotion: typeof data.promotion === 'string' ? data.promotion : undefined
        });
        if (!ok && !room.over) {
            // إعادة مزامنة اللاعب الذي أرسل حركة مرفوضة
            socket.emit('state', publicState(room));
        }
    });

    socket.on('chat', (data) => {
        const room = rooms.get(socket.data.roomId);
        if (!room || room.type !== 'multi' || !data || typeof data.message !== 'string') return;
        const message = data.message.trim().slice(0, MAX_CHAT_LENGTH);
        if (message) socket.to(room.id).emit('chat', message);
    });

    socket.on('resign', () => {
        const room = rooms.get(socket.data.roomId);
        if (!room || room.over) return;
        endGame(room, { winner: other(socket.data.color), reason: 'resign' });
    });

    // ───── اقتراح التعادل ─────
    socket.on('offer_draw', () => {
        const room = rooms.get(socket.data.roomId);
        if (!room || room.type !== 'multi' || room.over || !room.matched) return;
        const color = socket.data.color;

        // الخصم اقترح قبلي وأنا أقترح الآن: اتفاق متبادل
        if (room.drawOffer && room.drawOffer !== color) {
            return endGame(room, { winner: null, reason: 'agreement' });
        }
        if (room.drawOffer === color) return;
        if (room.plies < 2) return socket.emit('toast', 'يمكن اقتراح التعادل بعد أول حركتين.');
        if (room.plies - room.lastDrawPly[color] < 2) {
            return socket.emit('toast', 'انتظر حركة قبل اقتراح التعادل مرة أخرى.');
        }

        room.lastDrawPly[color] = room.plies;
        room.drawOffer = color;
        socket.to(room.id).emit('draw_offered');
    });

    socket.on('respond_draw', (data) => {
        const room = rooms.get(socket.data.roomId);
        if (!room || room.type !== 'multi' || room.over || !room.drawOffer) return;
        if (room.drawOffer === socket.data.color) return;   // لا يرد على اقتراحه هو

        const offerer = room.drawOffer;
        room.drawOffer = null;
        if (data && data.accept) {
            endGame(room, { winner: null, reason: 'agreement' });
        } else if (room.players[offerer]) {
            io.to(room.players[offerer]).emit('draw_declined');
        }
    });

    // ───── إعادة المباراة بتبديل الألوان ─────
    socket.on('rematch', () => {
        const room = rooms.get(socket.data.roomId);
        if (!room || room.type !== 'multi' || !room.over) return;
        if (!room.players.w || !room.players.b) {
            return socket.emit('toast', 'غادر الخصم المباراة.');
        }
        room.rematch[socket.data.color] = true;
        if (room.rematch.w && room.rematch.b) {
            resetForRematch(room);
            startMatch(room);
        } else {
            socket.to(room.id).emit('rematch_offered');
        }
    });

    socket.on('disconnect', () => handleLeave(socket));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = { server };
