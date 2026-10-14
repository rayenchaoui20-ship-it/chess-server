const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// عرض الواجهة مباشرة بدون أخطاء
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>منصة الشطرنج الاحترافية</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/chessboard-js/1.0.0/chessboard-1.0.0.min.css" />
        <style>
            body { font-family: Tahoma, sans-serif; background: #1e1e1e; color: #fff; text-align: center; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: auto; background: #2d2d2d; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            button, select, input { padding: 10px; margin: 8px; font-size: 16px; border-radius: 5px; border: none; outline: none; }
            button { background: #4CAF50; color: white; cursor: pointer; font-weight: bold; }
            button:hover { background: #45a049; }
            #board { width: 400px; margin: 20px auto; }
            .hidden { display: none !important; }
            #chat-box { height: 100px; background: #1a1a1a; border: 1px solid #444; overflow-y: scroll; text-align: right; padding: 8px; margin-bottom: 10px; border-radius: 5px; }
        </style>
    </head>
    <body>
    <div class="container">
        <h2>منصة الشطرنج الذكية</h2>
        
        <div id="menu-screen">
            <h3>اختر طريقة اللعب:</h3>
            <button onclick="showAIOptions()">اللعب ضد الذكاء الاصطناعي (Stockfish)</button>
            <br><br>
            <button onclick="createRoom()">إنشاء غرفة جديدة للعب مع صديق</button>
            <br>
            <input type="text" id="join-room-input" placeholder="أدخل كود الغرفة">
            <button onclick="joinRoom()">انضمام للغرفة</button>
        </div>

        <div id="ai-options-screen" class="hidden">
            <h3>إعدادات محرك Stockfish</h3>
            <label>اختر اللون:</label>
            <select id="ai-color">
                <option value="w">الأبيض (أنت تبدأ)</option>
                <option value="b">الأسود</option>
            </select>
            <br>
            <label>مستوى الصعوبة (1 إلى 15):</label>
            <input type="number" id="ai-level" min="1" max="15" value="10">
            <br><br>
            <button onclick="startAIGame()">ابدأ اللعبة</button>
            <button onclick="location.reload()">رجوع</button>
        </div>

        <div id="game-screen" class="hidden">
            <div id="board"></div>
            <p id="status-text">جاري اللعب...</p>
            <div id="chat-container">
                <div id="chat-box"></div>
                <input type="text" id="chat-input" placeholder="اكتب رسالة للخصم...">
                <button onclick="sendChatMessage()">إرسال</button>
            </div>
            <br>
            <button onclick="location.reload()">خروج للرئيسية</button>
        </div>
    </div>

    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/chessboard-js/1.0.0/chessboard-1.0.0.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let chess = new Chess();
        let board = null;
        let gameMode = '';
        let currentRoomId = '';

        function showAIOptions() {
            $('#menu-screen').addClass('hidden');
            $('#ai-options-screen').removeClass('hidden');
        }

        function createRoom() {
            currentRoomId = 'room_' + Math.random().toString(36).substring(2, 8);
            gameMode = 'multi';
            socket.emit('create_room', { roomId: currentRoomId });
            alert('تم إنشاء الغرفة بنجاح! كود الغرفة هو: ' + currentRoomId);
            $('#menu-screen').addClass('hidden');
            $('#game-screen').removeClass('hidden');
            initBoard('w');
        }

        function joinRoom() {
            const roomId = $('#join-room-input').val().trim();
            if (!roomId) return alert('الرجاء إدخال كود الغرفة');
            currentRoomId = roomId;
            gameMode = 'multi';
            socket.emit('join_room', roomId);
        }

        function startAIGame() {
            const color = $('#ai-color').val();
            const level = $('#ai-level').val();
            gameMode = 'ai';
            $('#ai-options-screen').addClass('hidden');
            $('#game-screen').removeClass('hidden');
            socket.emit('create_stockfish_room', { color, level });
            initBoard(color);
        }

        function initBoard(orientation) {
            const config = {
                draggable: true,
                position: 'start',
                orientation: orientation === 'b' ? 'black' : 'white',
                onDrop: handleMove
            };
            board = Chessboard('board', config);
        }

        function handleMove(source, target) {
            const move = chess.move({ from: source, to: target, promotion: 'q' });
            if (move === null) return 'snapback';

            if (gameMode === 'multi') {
                socket.emit('make_move', { roomId: currentRoomId, fen: chess.fen() });
            } else if (gameMode === 'ai') {
                socket.emit('player_move_vs_ai', { fen: chess.fen() });
            }
            board.position(chess.fen());
        }

        socket.on('start_game', (data) => {
            $('#menu-screen').addClass('hidden');
            $('#game-screen').removeClass('hidden');
            chess.load(data.fen);
            let orientation = (socket.id === data.white) ? 'w' : 'b';
            initBoard(orientation);
        });

        socket.on('stockfish_room_created', (data) => {
            currentRoomId = data.roomId;
            chess.load(data.fen);
        });

        socket.on('receive_move', (data) => {
            chess.load(data.fen);
            board.position(data.fen);
        });

        socket.on('server_ai_move', (data) => {
            chess.load(data.fen);
            board.position(data.fen);
        });

        socket.on('receive_chat', (msg) => {
            $('#chat-box').append('<div>الخصم: ' + msg + '</div>');
        });

        function sendChatMessage() {
            const msg = $('#chat-input').val();
            if (!msg) return;
            $('#chat-box').append('<div>أنت: ' + msg + '</div>');
            socket.emit('send_chat', { roomId: currentRoomId, message: msg });
            $('#chat-input').val('');
        }
    </script>
    </body>
    </html>
    `);
});

const rooms = {};

io.on('connection', (socket) => {
    socket.on('create_room', (data) => {
        rooms[data.roomId] = { white: socket.id, black: null, fen: 'start' };
        socket.join(data.roomId);
    });

    socket.on('join_room', (roomId) => {
        const room = rooms[roomId];
        if (room && !room.black) {
            room.black = socket.id;
            socket.join(roomId);
            io.to(roomId).emit('start_game', { fen: room.fen, white: room.white, black: room.black });
        }
    });

    socket.on('create_stockfish_room', (data) => {
        const roomId = 'ai_room_' + socket.id;
        rooms[roomId] = { aiLevel: data.level || 10, fen: 'start' };
        socket.join(roomId);
        socket.emit('stockfish_room_created', { roomId, fen: 'start' });
        if (data.color === 'b') {
            makeStockfishMove(roomId, 'start');
        }
    });

    socket.on('player_move_vs_ai', async (data) => {
        const roomId = 'ai_room_' + socket.id;
        await makeStockfishMove(roomId, data.fen);
    });

    async function makeStockfishMove(roomId, currentFen) {
        const room = rooms[roomId];
        if (!room) return;
        try {
            const response = await axios.get(`https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(currentFen)}&depth=${room.aiLevel}`);
            if (response.data && response.data.success) {
                io.to(roomId).emit('server_ai_move', { fen: response.data.fen });
            }
        } catch (e) { console.error(e); }
    }

    socket.on('make_move', (data) => {
        socket.to(data.roomId).emit('receive_move', { fen: data.fen });
    });

    socket.on('send_chat', (data) => {
        socket.to(data.roomId).emit('receive_chat', data.message);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
