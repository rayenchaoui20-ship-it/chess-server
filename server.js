const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const Stockfish = require('stockfish');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('لاعب متصل:', socket.id);

  // 1. نظام اللعب الأونلاين بين صديقين (الغرف العادية)
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

  // 2. نظام اللعب ضد Stockfish الحقيقي على السيرفر (AI Server)
  socket.on('create_stockfish_room', (data) => {
    const roomId = 'ai_' + Math.random().toString(36).substring(2, 8);
    socket.join(roomId);

    const game = new Chess();
    const playerColor = data.color || 'w';
    const difficulty = data.level || 10; // مستوى الصعوبة من 0 إلى 20
    const engine = Stockfish();

    socket.roomData = { game, engine, playerColor, difficulty };

    // استقبال ردود ومتحركات Stockfish
    engine.onmessage = (message) => {
      let line = message;
      if (typeof message === 'object' && message !== null) {
        line = message.data || '';
      }

      if (typeof line === 'string' && line.startsWith('bestmove')) {
        const bestMoveStr = line.split(' ')[1];
        if (bestMoveStr && bestMoveStr !== '(none)') {
          const from = bestMoveStr.substring(0, 2);
          const to = bestMoveStr.substring(2, 4);
          const promotion = bestMoveStr.length > 4 ? bestMoveStr[4] : undefined;

          const moveResult = socket.roomData.game.move({ from, to, promotion });
          if (moveResult) {
            socket.emit('server_ai_move', {
              from,
              to,
              promotion,
              fen: socket.roomData.game.fen(),
              isGameOver: socket.roomData.game.game_over()
            });
          }
        }
      }
    };

    engine.postMessage('uci');
    engine.postMessage('isready');

    socket.emit('stockfish_room_created', { roomId, color: playerColor });

    // إذا اختار اللاعب الأسود، يبدأ Stockfish بالحركة الأولى
    if (playerColor === 'b') {
      triggerStockfishMove(socket);
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

    triggerStockfishMove(socket);
  });

  // إدارة الانقطاع والخروج
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

function triggerStockfishMove(socket) {
  const room = socket.roomData;
  if (!room || !room.engine) return;

  const fen = room.game.fen();
  room.engine.postMessage(`setoption name Skill Level value ${room.difficulty}`);
  room.engine.postMessage(`position fen ${fen}`);
  room.engine.postMessage('go movetime 500'); // زمن تفكير المحرك نصف ثانية
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
