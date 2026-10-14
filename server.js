const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
            body { font-family: Tahoma, sans-serif; background: #121212; color: #e0e0e0; text-align: center; margin: 0; padding: 10px; }
            .container { max-width: 600px; margin: auto; background: #1e1e1e; padding: 15px; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.7); }
            button, select, input { padding: 10px; margin: 6px; font-size: 15px; border-radius: 6px; border: none; outline: none; }
            button { background: #4CAF50; color: white; cursor: pointer; font-weight: bold; transition: 0.2s; }
            button:hover { background: #43a047; }
            #board { width: 400px; margin: 15px auto; }
            .hidden { display: none !important; }
            .timer-box { font-size: 18px; font-weight: bold; background: #2a2a2a; padding: 6px 12px; border-radius: 6px; display: inline-block; margin: 4px; border: 1px solid #444; }
            #chat-box { height: 80px; background: #121212; border: 1px solid #333; overflow-y: scroll; text-align: right; padding: 6px; margin-bottom: 6px; border-radius: 6px; font-size: 14px; }
            .highlight-white { background-color: rgba(255, 255, 0, 0.4) !important; }
        </style>
    </head>
    <body>
    <div class="container">
        <h2>منصة الشطرنج الاحترافية 🏆</h2>
        
        <div id="menu-screen">
            <h3>اختر نظام الوقت واللعب:</h3>
            <button onclick="selectMode('bullet', 60)">⚡ بوليت (دقيقة واحدة)</button>
            <button onclick="selectMode('blitz', 180)">🔥 بليتز (3 دقائق)</button>
            <button onclick="selectMode('rapid', 600)">⏱️ رابيد (10 دقائق)</button>
            
            <div id="action-buttons" class="hidden" style="margin-top: 12px; border-top: 1px solid #333; padding-top: 12px;">
                <p id="selected-mode-text" style="color: #4CAF50; font-weight: bold;"></p>
                <button onclick="showAIOptions()">اللعب ضد الذكاء الاصطناعي</button>
                <br>
                <button onclick="createRoom()">إنشاء غرفة لصديق</button>
                <br>
                <input type="text" id="join-room-input" placeholder="أدخل كود الغرفة">
                <button onclick="joinRoom()">انضمام</button>
            </div>
        </div>

        <div id="ai-options-screen" class="hidden">
            <h3>إعدادات محرك Stockfish الذكي</h3>
            <label>اختر لونك:</label>
            <select id="ai-color">
                <option value="w">الأبيض (أنت تبدأ)</option>
                <option value="b">الأسود</option>
            </select>
            <br>
            <label>المستوى (1 إلى 15):</label>
            <input type="number" id="ai-level" min="1" max="15" value="10">
            <br><br>
            <button onclick="startAIGame()">ابدأ المعركة</button>
            <button onclick="location.reload()">رجوع</button>
        </div>

        <div id="game-screen" class="hidden">
            <div>
                <div class="timer-box" id="opponent-timer">الخصم: --:--</div>
                <div class="timer-box" id="my-timer">أنت: --:--</div>
            </div>
            
            <div id="board"></div>

            <p id="status-text" style="font-weight: bold; margin: 8px 0; color: #ffb74d;">اللعبة جارية...</p>
            
            <div id="chat-container">
                <div id="chat-box"></div>
                <input type="text" id="chat-input" placeholder="اكتب رسالة...">
                <button onclick="sendChatMessage()">إرسال</button>
            </div>
            <button onclick="location.reload()" style="background: #d32f2f; margin-top: 5px;">إنهاء / خروج</button>
        </div>
    </div>

    <!-- نافذة منبثقة لاختيار الترقية عند وصول العسكري للنهاية -->
    <div id="promotion-dialog" class="hidden" style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#2d2d2d; padding:20px; border-radius:10px; border:2px solid #4CAF50; z-index:1000;">
        <h3>اختر قطعة الترقية:</h3>
        <button onclick="promotePiece('q')">وزير (Q)</button>
        <button onclick="promotePiece('r')">قلعة (R)</button>
        <button onclick="promotePiece('b')">فيل (B)</button>
        <button onclick="promotePiece('n')">حصان (N)</button>
    </div>

    <!-- أصوات اللعبة -->
    <audio id="move-sound" src="https://images.chesscomfiles.com/chess-themes/sounds/standard/1000/Move.mp3"></audio>
    <audio id="capture-sound" src="https://images.chesscomfiles.com/chess-themes/sounds/standard/1000/Capture.mp3"></audio>
    <audio id="game-end-sound" src="https://images.chesscomfiles.com/chess-themes/sounds/standard/1000/GameOver.mp3"></audio>

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
        let selectedTimeSec = 180;
        let myTime = 180;
        let opponentTime = 180;
        let timerInterval = null;
        let pendingMove = null;

        function playSound(type) {
            try {
                if (type === 'move') document.getElementById('move-sound').play();
                if (type === 'capture') document.getElementById('capture-sound').play();
                if (type === 'end') document.getElementById('game-end-sound').play();
            } catch(e) {}
        }

        function selectMode(mode, seconds) {
            selectedTimeSec = seconds;
            myTime = seconds;
            opponentTime = seconds;
            let names = { 'bullet': 'بوليت (دقيقة واحدة)', 'blitz': 'بليتز (3 دقائق)', 'rapid': 'رابيد (10 دقائق)' };
            $('#selected-mode-text').text('النظام: ' + names[mode]);
            $('#action-buttons').removeClass('hidden');
        }

        function showAIOptions() {
            $('#menu-screen').addClass('hidden');
            $('#ai-options-screen').removeClass('hidden');
        }

        function createRoom() {
            currentRoomId = 'room_' + Math.random().toString(36).substring(2, 8);
            gameMode = 'multi';
            socket.emit('create_room', { roomId: currentRoomId, timeSec: selectedTimeSec });
            alert('كود الغرفة الخاص بك: ' + currentRoomId + '\nقم بإرساله لصديقك لينضم إليك.');
            $('#menu-screen').addClass('hidden');
            $('#game-screen').removeClass('hidden');
            initBoard('w');
            startClock();
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
            socket.emit('create_stockfish_room', { color, level, timeSec: selectedTimeSec });
            initBoard(color);
            startClock();
        }

        function initBoard(orientation) {
            const config = {
                draggable: true,
                position: 'start',
                orientation: orientation === 'b' ? 'black' : 'white',
                pieceTheme: 'https://cdnjs.cloudflare.com/ajax/libs/chessboard-js/1.0.0/img/chesspieces/wikipedia/{piece}.png',
                onDrop: handleMove,
                onSnapEnd: () => board.position(chess.fen())
            };
            board = Chessboard('board', config);
        }

        function handleMove(source, target) {
            const piece = chess.get(source);
            if (piece && piece.type === 'p' && ((piece.color === 'w' && target[1] === '8') || (piece.color === 'b' && target[1] === '1'))) {
                pendingMove = { source, target };
                $('#promotion-dialog').removeClass('hidden');
                return 'snapback';
            }
            return executeMove({ source, target, promotion: 'q' });
        }

        function promotePiece(promo) {
            $('#promotion-dialog').addClass('hidden');
            if (pendingMove) {
                executeMove({ source: pendingMove.source, target: pendingMove.target, promotion: promo });
                pendingMove = null;
            }
        }

        function executeMove(moveObj) {
            const move = chess.move(moveObj);
            if (move === null) return 'snapback';

            if (move.captured) playSound('capture');
            else playSound('move');

            highlightLastMove(move.from, move.to);

            if (gameMode === 'multi') {
                socket.emit('make_move', { roomId: currentRoomId, fen: chess.fen(), history: chess.history() });
            } else if (gameMode === 'ai') {
                socket.emit('player_move_vs_ai', { fen: chess.fen() });
            }
            board.position(chess.fen());
            checkGameStatus();
        }

        function highlightLastMove(from, to) {
            $('#board .square-55d63').removeClass('highlight-white');
            $('#board .square-' + from).addClass('highlight-white');
            $('#board .square-' + to).addClass('highlight-white');
        }

        function startClock() {
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                if (chess.game_over()) return;
                if ((chess.turn() === 'w' && $('#ai-color').val() === 'w') || (chess.turn() === 'b' && $('#ai-color').val() === 'b')) {
                    myTime--;
                    if (myTime <= 0) {
                        clearInterval(timerInterval);
                        alert('انتهى وقتك! لقد خسرت المباراة.');
                        playSound('end');
                    }
                } else {
                    opponentTime--;
                    if (opponentTime <= 0) {
                        clearInterval(timerInterval);
                        alert('انتهى وقت الخصم! لقد فزت.');
                        playSound('end');
                    }
                }
                formatTimeDisplays();
            }, 1000);
        }

        function formatTimeDisplays() {
            let m1 = Math.floor(myTime / 60), s1 = myTime % 60;
            let m2 = Math.floor(opponentTime / 60), s2 = opponentTime % 60;
            $('#my-timer').text('أنت: ' + String(m1).padStart(2,'0') + ':' + String(s1).padStart(2,'0'));
            $('#opponent-timer').text('الخصم: ' + String(m2).padStart(2,'0') + ':' + String(s2).padStart(2,'0'));
        }

        function checkGameStatus() {
            if (chess.in_checkmate()) {
                $('#status-text').text('كش مات! انتهت اللعبة.');
                playSound('end');
            } else if (chess.in_draw()) {
                $('#status-text').text('تعادل!');
                playSound('end');
            } else if (chess.in_check()) {
                $('#status-text').text('تحذير: كش للملك! ⚠️');
            } else {
                $('#status-text').text('اللعبة جارية...');
            }
        }

        socket.on('start_game', (data) => {
            $('#menu-screen').addClass('hidden');
            $('#game-screen').removeClass('hidden');
            chess.load(data.fen);
            myTime = data.timeSec || 180;
            opponentTime = data.timeSec || 180;
            let orientation = (socket.id === data.white) ? 'w' : 'b';
            initBoard(orientation);
            startClock();
        });

        socket.on('stockfish_room_created', (data) => {
            currentRoomId = data.roomId;
            chess.load(data.fen);
        });

        socket.on('receive_move', (data) => {
            chess.load(data.fen);
            board.position(data.fen);
            playSound('move');
            checkGameStatus();
        });

        socket.on('server_ai_move', (data) => {
            chess.load(data.fen);
            board.position(data.fen);
            playSound('move');
            checkGameStatus();
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
        rooms[data.roomId] = { white: socket.id, black: null, fen: 'start', timeSec: data.timeSec };
        socket.join(data.roomId);
    });

    socket.on('join_room', (roomId) => {
        const room = rooms[roomId];
        if (room && !room.black) {
            room.black = socket.id;
            socket.join(roomId);
            io.to(roomId).emit('start_game', { fen: room.fen, white: room.white, black: room.black, timeSec: room.timeSec });
        }
    });

    socket.on('create_stockfish_room', (data) => {
        const roomId = 'ai_room_' + socket.id;
        rooms[roomId] = { aiLevel: data.level || 10, fen: 'start', timeSec: data.timeSec };
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
        socket.to(data.roomId).emit('send_chat', data.message);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
