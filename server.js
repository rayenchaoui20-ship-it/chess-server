const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios'); // للاتصال بمحرك Stockfish عبر الإنترنت

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// هذا السطر هو المسؤول عن قراءة ملف index.html والواجهة تلقائياً
app.use(express.static(__dirname));

// تخزين الغرف وحالتها
const rooms = {};

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // إنشاء غرفة لعب جماعي مع صديق
    socket.on('create_room', (data) => {
        const { roomId, timeLimit } = data;
        rooms[roomId] = {
            players: { white: socket.id, black: null },
            fen: 'start',
            timeW: timeLimit || 300,
            timeB: timeLimit || 300,
            mode: 'multi'
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
    });

    // الانضمام لغرفة صديق
    socket.on('join_room', (roomId) => {
        const room = rooms[roomId];
        if (room && !room.players.black) {
            room.players.black = socket.id;
            socket.join(roomId);
            io.to(roomId).emit('start_game', {
                fen: room.fen,
                white: room.players.white,
                black: room.players.black
            });
        } else {
            socket.emit('error_message', 'الغرفة ممتلئة أو غير موجودة');
        }
    });

    // إنشاء غرفة للعب ضد الذكاء الاصطناعي (Stockfish)
    socket.on('create_stockfish_room', (data) => {
        const { color, level } = data;
        const roomId = 'ai_room_' + socket.id;
        rooms[roomId] = {
            playerColor: color,
            aiLevel: level || 10,
            fen: 'start',
            mode: 'ai'
        };
        socket.join(roomId);
        
        socket.emit('stockfish_room_created', {
            roomId: roomId,
            fen: 'start',
            color: color
        });

        // إذا اخترت أن تلعب بالأسود، يبدأ الذكاء الاصطناعي بنقلة أولى
        if (color === 'b') {
            makeStockfishMove(roomId, 'start');
        }
    });

    // استقبال الحركات في وضع اللعب ضد AI
    socket.on('player_move_vs_ai', async (data) => {
        const roomId = 'ai_room_' + socket.id;
        const room = rooms[roomId];
        if (!room) return;

        // هنا نفترض أن الحركات صحيحة ويتم جلب رد Stockfish
        await makeStockfishMove(roomId, data.move);
    });

    // دالة الاتصال بمحرك Stockfish عبر الإنترنت
    async function makeStockfishMove(roomId, currentFen) {
        const room = rooms[roomId];
        if (!room) return;

        try {
            // استخدام API جاهز وموثوق لمحرك Stockfish
            const response = await axios.get(`https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(currentFen)}&depth=${room.aiLevel}`);
            if (response.data && response.data.success) {
                // استخراج النقلة القادمة من المحرك (مثلا: bestmove e2e4)
                const bestMoveStr = response.data.bestmove;
                // إرسال النقلة للواجهة
                io.to(roomId).emit('server_ai_move', {
                    fen: response.data.fen || currentFen,
                    bestMove: bestMoveStr
                });
            }
        } catch (error) {
            console.error('خطأ في الاتصال بمحرك Stockfish:', error);
        }
    }

    // استقبال الحركات في وضع اللعب الجماعي
    socket.on('make_move', (data) => {
        const { roomId, move } = data;
        const room = rooms[roomId];
        if (room) {
            socket.to(roomId).emit('receive_move', move);
        }
    });

    // نظام الدردشة الفورية
    socket.on('send_chat', (data) => {
        const { roomId, message } = data;
        socket.to(roomId).emit('receive_chat', message);
    });

    socket.on('disconnect', () => {
        console.log('مستخدم انقطع اتصاله:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل بكفاءة على البورت: ${PORT}`);
});
