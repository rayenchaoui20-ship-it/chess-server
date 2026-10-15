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

// ───────────────────────── أدوات مساعدة ─────────────────────────
const other = (c) => (c === 'w' ? 'b' : 'w');

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
        game: new Chess(),
        players: { w: null, b: null },
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
        closed: false
    };
    rooms.set(room.id, room);
    return room;
}

function publicState(room) {
    return {
        fen: room.game.fen(),
        turn: room.game.turn(),
        check: room.game.inCheck(),
        lastMove: room.lastMove,
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
    if (!room.players.w && !room.players.b) closeRoom(room);
}

// ───────────────────────── Socket.IO ─────────────────────────
io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.color = null;

    socket.on('create_room', (data) => {
        const timeSec = Number(data && data.timeSec);
        if (!ALLOWED_TIMES.includes(timeSec)) return socket.emit('room_error', 'نظام الوقت غير صالح.');

        handleLeave(socket);
        const room = newRoom('multi', timeSec);
        room.players.w = socket.id;
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.color = 'w';
        socket.emit('room_created', { roomId: room.id });
    });

    socket.on('join_room', (roomIdRaw) => {
        const roomId = String(roomIdRaw || '').trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room || room.type !== 'multi') return socket.emit('room_error', 'الغرفة غير موجودة.');
        if (room.players.w === socket.id) return socket.emit('room_error', 'هذه غرفتك أنت، أرسل الكود لصديقك.');
        if (room.players.b || room.over) return socket.emit('room_error', 'الغرفة ممتلئة أو انتهت اللعبة فيها.');

        handleLeave(socket);
        room.players.b = socket.id;
        room.matched = true;
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.color = 'b';

        for (const color of ['w', 'b']) {
            io.to(room.players[color]).emit('game_start', {
                color,
                mode: 'multi',
                roomId: room.id
            });
        }
        broadcast(room);
    });

    socket.on('create_ai_room', (data) => {
        data = data || {};
        const timeSec = Number(data.timeSec);
        if (!ALLOWED_TIMES.includes(timeSec)) return socket.emit('room_error', 'نظام الوقت غير صالح.');
        const color = data.color === 'b' ? 'b' : 'w';
        const level = Math.min(15, Math.max(1, parseInt(data.level, 10) || 10));

        handleLeave(socket);
        const room = newRoom('ai', timeSec);
        room.matched = true;
        room.aiLevel = level;
        room.aiColor = other(color);
        room.players[color] = socket.id;
        socket.join(room.id);
        socket.data.roomId = room.id;
        socket.data.color = color;

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

    socket.on('disconnect', () => handleLeave(socket));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = { server };
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
