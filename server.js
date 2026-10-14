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

  // 1. نظام اللعب الأونلاين بين صديقين مع المؤقتات وإعادة اللعب
  socket.on('create_room', (data) => {
    const roomId = data.roomId;
    const timeLimit = data.timeLimit || 300; // الافتراضي 5 دقائق لكل لاعب (بالثواني)

    rooms[roomId] = {
      playerW: socket.id,
      playerB: null,
      game: new Chess(),
      timeW: timeLimit,
      timeB: timeLimit,
      timer: null,
      turn: 'w'
    };

    socket.join(roomId);
    socket.emit('room_created', roomId);
  });

  socket.on('join_room', (roomId) => {
    const room = rooms[roomId];
    if (room && !room.playerB) {
      room.playerB = socket.id;
      socket.join(roomId);
      
      io.to(roomId).emit('start_game', { 
        white: room.playerW, 
        black: socket.id,
        fen: room.game.fen()
      });

      startRoomTimer(roomId);
    } else {
      socket.emit('room_full', 'الغرفة ممتلئة أو غير موجودة');
    }
  });

  socket.on('make_move', (data) => {
    const room = rooms[roomIdOf(socket.id)];
    if (!room) return;

    const moveResult = room.game.move(data.move);
    if (moveResult) {
      room.turn = room.game.turn();
      io.to(data.roomId).emit('receive_move', {
        move: data.move,
        fen: room.game.fen(),
        pgn: room.game.pgn(),
        isGameOver: room.game.game_over()
      });

      if (room.game.game_over()) {
        clearInterval(room.timer);
        io.to(data.roomId).emit('game_over', { reason: 'انتهاء اللعبة', fen: room.game.fen() });
      }
    }
  });

  // طلب إعادة مباراة (Rematch)
  socket.on('request_rematch', (roomId) => {
    io.to(roomId).emit('rematch_offered', socket.id);
  });

  socket.on('accept_rematch', (roomId) => {
    const room = rooms[roomId];
    if (room) {
      room.game.reset();
      room.turn = 'w';
      io.to(roomId).emit('start_game', { 
        white: room.playerW, 
        black: room.playerB,
        fen: room.game.fen()
      });
    }
  });

  // الدردشة بين اللاعبين
  socket.on('send_chat', (data) => {
    socket.to(data.roomId).emit('receive_chat', data.message);
  });

  // 2. نظام اللعب ضد Stockfish المتقدم (مع اختيار الصعوبة واللون)
  socket.on('create_stockfish_room', (data) => {
    const roomId = 'ai_' + Math.random().toString(36).substring(2, 8);
    socket.join(roomId);

    const game = new Chess();
    const playerColor = data.color || 'w';
    const difficulty = parseInt(data.level) || 10; // مستوى الصعوبة من 1 إلى 15

    socket.roomData = { game, playerColor, difficulty };

    socket.emit('stockfish_room_created', { roomId, color: playerColor, fen: game.fen() });

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
      socket.emit('game_over', { fen: room.game.fen(), pgn: room.game.pgn() });
      return;
    }

    fetchStockfishMove(socket);
  });

  socket.on('disconnect', () => {
    const roomId = roomIdOf(socket.id);
    if (roomId && rooms[roomId]) {
      clearInterval(rooms[roomId].timer);
      io.to(roomId).emit('opponent_disconnected');
      delete rooms[roomId];
    }
    console.log('لاعب مغادر:', socket.id);
  });
});

// دوال مساعدة للمؤقتات
function roomIdOf(socketId) {
  for (const id in rooms) {
    if (rooms[id].playerW === socketId || rooms[id].playerB === socketId) return id;
  }
  return null;
}

function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.timer = setInterval(() => {
    if (room.game.game_over()) {
      clearInterval(room.timer);
      return;
    }

    if (room.turn === 'w') {
      room.timeW--;
      if (room.timeW <= 0) {
        clearInterval(room.timer);
        io.to(roomId).emit('game_over', { reason: 'فاز الأسود بسبب انقضاء وقت الأبيض!', fen: room.game.fen() });
      }
    } else {
      room.timeB--;
      if (room.timeB <= 0) {
        clearInterval(room.timer);
        io.to(roomId).emit('game_over', { reason: 'فاز الأبيض بسبب انقضاء وقت الأسود!', fen: room.game.fen() });
      }
    }

    io.to(roomId).emit('update_timer', { timeW: room.timeW, timeB: room.timeB });
  }, 1000);
}

// دالة جلب النقلة من Stockfish عبر السحاب بدقة وعمق حسب الصعوبة
function fetchStockfishMove(socket) {
  const room = socket.roomData;
  if (!room || !room.game) return;

  const fen = room.game.fen();
  const encodedFen = encodeURIComponent(fen);
  const depth = Math.min(Math.max(room.difficulty, 1), 15);
  const apiUrl = `https://stockfish.online/api/s/v2.php?fen=${encodedFen}&depth=${depth}`;

  https.get(apiUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        if (response.success && response.bestmove) {
          const moveParts = response.bestmove.split(' ');
          const moveStr = moveParts[1];

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
                pgn: room.game.pgn(),
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
    pgn: room.game.pgn(),
    isGameOver: room.game.game_over()
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
