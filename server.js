const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('لاعب متصل:', socket.id);

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

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].playerW === socket.id || rooms[roomId].playerB === socket.id) {
        io.to(roomId).emit('opponent_disconnected');
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});