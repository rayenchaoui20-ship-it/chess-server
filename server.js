const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// هذا السطر يخبر السيرفر ماذا يعرض عندما يفتح أي شخص رابط موقعك
app.get('/', (req, res) => {
    res.send('<h1>مرحباً بك! منصة الشطرنج تعمل بنجاح تام</h1>');
});

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);
    socket.on('disconnect', () => {
        console.log('مستخدم انقطع اتصاله:', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
