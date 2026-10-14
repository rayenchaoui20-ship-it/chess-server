const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('لاعب متصل:', socket.id);

  // 1. نظام اللعب الأونلاين بين صديقين
  socket.on('create_room', (roomId) => {
    rooms[roomId] = { playerW: socket.id, playerB: null };
    socket.join(roomId);
    socket.emit('room_created', roomId);
  });

  socket.on('join_room', (roomId) => {
    if (rooms[roomId] && !rooms[roomId].playerB) {
      rooms[roomId].playerB = socket.id;
      socket.join(roomId);
      io.to(roomId).emit('start_game', { white: rooms[roomId].playerW, black: socket.id });
    } else {
      socket.emit('room_full', 'الغرفة ممتلئة أو غير موجودة');
    }
  });

  socket.on('make_move', (data) => {
    socket.to(data.roomId).emit('receive_move', data.move);
  });

  socket.on('send_chat', (data) => {
    socket.to(data.roomId).emit('receive_chat', data.message);
  });

  // 2. نظام اللعب ضد Stockfish الحقيقي القوي عبر السحاب
  socket.on('create_stockfish_room', (data) => {
    const roomId = 'ai_' + Math.random().toString(36).substring(2, 8);
    socket.join(roomId);

    const game = new Chess();
    const playerColor = data.color || 'w';
    const difficulty = data.level || 10; // مستوى الصعوبة

    socket.roomData = { game, playerColor, difficulty };

    socket.emit('stockfish_room_created', { roomId, color: playerColor });

    if (playerColor === 'b') {
      fetchStockfishMove(socket);
    }
  });

  socket.on('player_move_vs_ai', (data) => {
    const room = socket.roomData;
    if (!room || !room.game) return;

    const move = room.game.move(data.move);
    if (!move) return;

    if (room.game.game_over()) {
      socket.emit('game_over', { fen: room.game.fen() });
      return;
    }

    fetchStockfishMove(socket);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].playerW === socket.id || rooms[roomId].playerB === socket.id) {
        io.to(roomId).emit('opponent_disconnected');
        delete rooms[roomId];
      }
    }
    console.log('لاعب مغادر:', socket.id);
  });
});

// دالة لجلب أقوى نقلة من Stockfish عبر الإنترنت
function fetchStockfishMove(socket) {
  const room = socket.roomData;
  if (!room || !room.game) return;

  const fen = room.game.fen();
  // استخدام Stockfish Online API المجانية والقوية
  const encodedFen = encodeURIComponent(fen);
  const depth = Math.min(Math.max(room.difficulty, 1), 15); // تحديد عمق التفكير حسب الصعوبة
  const apiUrl = `https://stockfish.online/api/s/v2.php?fen=${encodedFen}&depth=${depth}`;

  https.get(apiUrl, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        if (response.success && response.bestmove) {
          // الرد يكون بصيغة مثل "bestmove e2e4 ponder e7e5"
          const moveParts = response.bestmove.split(' ');
          const moveStr = moveParts[1]; // نأخذ النقلة الأولى

          if (moveStr && moveStr.length >= 4) {
            const from = moveStr.substring(0, 2);
            const to = moveStr.substring(2, 4);
            const promotion = moveStr.length > 4 ? moveStr[4] : undefined;

            const moveResult = room.game.move({ from, to, promotion });
            if (moveResult) {
              socket.emit('server_ai_move', {
                from,
                to,
                promotion,
                fen: room.game.fen(),
                isGameOver: room.game.game_over()
              });
            }
          }
        } else {
          fallbackRandomMove(socket);
        }
      } catch (e) {
        fallbackRandomMove(socket);
      }
    });
  }).on('error', () => {
    fallbackRandomMove(socket);
  });
}

// خطة بديلة احتياطية في حال انقطاع الإنترنت مؤقتاً
function fallbackRandomMove(socket) {
  const room = socket.roomData;
  if (!room || !room.game) return;
  const possibleMoves = room.game.moves({ verbose: true });
  if (possibleMoves.length === 0) return;
  const selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  room.game.move(selectedMove);
  socket.emit('server_ai_move', {
    from: selectedMove.from,
    to: selectedMove.to,
    promotion: selectedMove.promotion,
    fen: room.game.fen(),
    isGameOver: room.game.game_over()
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
