(function () {
    'use strict';

    // ───────────────────────── الثوابت ─────────────────────────
    const PIECE_THEME = 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png';
    const TCS = {
        '1+0': { base: 60, inc: 0 }, '2+1': { base: 120, inc: 1 },
        '3+0': { base: 180, inc: 0 }, '3+2': { base: 180, inc: 2 }, '5+0': { base: 300, inc: 0 },
        '10+0': { base: 600, inc: 0 }, '15+10': { base: 900, inc: 10 }
    };
    const CAT_NAMES = { bullet: 'بوليت', blitz: 'بليتز', rapid: 'رابيد' };
    const THEMES = ['classic', 'green', 'brown', 'slate'];
    const SCREENS = ['menu-screen', 'ai-options-screen', 'waiting-screen', 'searching-screen', 'leaderboard-screen', 'game-screen'];
    const REASONS = {
        checkmate: 'كش مات', timeout: 'انتهى الوقت', resign: 'استسلام', abandoned: 'غادر الخصم المباراة',
        stalemate: 'جمود (Stalemate)', insufficient: 'عدم كفاية القطع', repetition: 'تكرار الوضعية',
        fifty: 'قاعدة الخمسين حركة', agreement: 'اتفاق على التعادل', aborted: 'أُلغيت المباراة',
        timevsinsufficient: 'انتهى الوقت، لكن الخصم لا يملك قطعًا كافية للكش مات'
    };
    const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

    // ───────────────────────── الحالة ─────────────────────────
    const socket = io();
    const game = new Chess();          // نسخة محلية للتحقق السريع فقط، السيرفر هو المرجع
    let board = null;
    let myColor = 'w';
    let gameMode = '';
    let spectating = false;
    let flipped = false;
    let selectedTc = '3+0';
    let state = null;
    let positions = [{ fen: '', from: null, to: null, cap: null, color: null }];
    let reviewIndex = null;
    let serverOffset = 0;
    let pendingMove = null;
    let lastSoundCount = 0;
    let lastOver = false;
    let firstState = true;
    let searchInterval = null;
    let resultTimer = null;
    let flashTimer = null;
    let resumeTimer = null;
    let awaitResume = false;
    let rematchSent = false;
    let oppLeft = false;
    let oppName = 'الخصم';
    let lastAI = null;
    let currentScreen = 'menu-screen';
    let ratings = { bullet: 1200, blitz: 1200, rapid: 1200 };
    let lbCat = 'blitz';
    let pendingJoin = null;
    let replaced = false;
    let confirmYes = null;
    let memToken = null;

    // ───────────────────────── تخزين المتصفح (اختياري) ─────────────────────────
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

    function show(id) {
        currentScreen = id;
        SCREENS.forEach((s) => $('#' + s).toggleClass('hidden', s !== id));
        window.scrollTo(0, 0);
    }

    function catOf(id) {
        const t = TCS[id];
        if (!t) return 'blitz';
        const est = t.base + 40 * t.inc;
        return est < 180 ? 'bullet' : est < 480 ? 'blitz' : 'rapid';
    }
    function tcText(id) {
        const t = TCS[id];
        return t ? id + ' (' + CAT_NAMES[catOf(id)] + ')' : '';
    }

    // ───────────────────────── الأصوات ─────────────────────────
    let audioCtx = null;
    let soundOn = lsGet('chess-sound') !== 'off';

    function ensureAudio() {
        try {
            if (!audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (AC) audioCtx = new AC();
            }
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { /* ignore */ }
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, ensureAudio));

    function tone(freq, start, dur, vol, type, endFreq) {
        const t0 = audioCtx.currentTime + start;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    function noise(start, dur, vol, cutoff) {
        const t0 = audioCtx.currentTime + start;
        const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        const g = audioCtx.createGain();
        g.gain.value = vol;
        src.connect(filter);
        filter.connect(g);
        g.connect(audioCtx.destination);
        src.start(t0);
    }
    function playSound(type) {
        if (!soundOn) return;
        try {
            ensureAudio();
            if (!audioCtx) return;
            if (type === 'move') { tone(220, 0, 0.08, 0.5, 'triangle', 120); noise(0, 0.05, 0.6, 1800); }
            else if (type === 'capture') { tone(160, 0, 0.12, 0.7, 'triangle', 80); noise(0, 0.09, 1.0, 2600); noise(0.05, 0.06, 0.5, 1500); }
            else if (type === 'check') { tone(660, 0, 0.12, 0.3, 'sine'); tone(880, 0.1, 0.16, 0.3, 'sine'); }
            else if (type === 'end') { [523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.3, 0.35, 'sine')); }
        } catch (e) { /* ignore */ }
    }
    function updateSoundButton() {
        $('#sound-btn').text(soundOn ? 'الصوت مفعّل' : 'الصوت مكتوم').attr('aria-pressed', String(soundOn));
    }
    updateSoundButton();

    // ───────────────────────── رسائل ونوافذ ─────────────────────────
    function flash(msg) {
        $('#flash-text').text(msg);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => $('#flash-text').text(''), 5000);
    }
    function askConfirm(text, onYes) {
        confirmYes = onYes;
        $('#confirm-text').text(text);
        $('#confirm-dialog').removeClass('hidden');
        $('#confirm-no').trigger('focus');
    }
    function closeConfirm() { confirmYes = null; $('#confirm-dialog').addClass('hidden'); }
    $('#confirm-yes').on('click', () => { const f = confirmYes; closeConfirm(); if (f) f(); });
    $('#confirm-no').on('click', closeConfirm);

    // ───────────────────────── القائمة ─────────────────────────
    function getName() { return ($('#player-name').val() || '').trim().slice(0, 20); }
    function getToken() { return lsGet('chess-token') || memToken; }

    function renderTimeGroups() {
        const box = $('#time-groups').empty();
        ['bullet', 'blitz', 'rapid'].forEach((cat) => {
            const g = $('<div class="time-group">').append($('<div class="gname">').text(CAT_NAMES[cat]));
            const row = $('<div class="time-row">');
            Object.keys(TCS).filter((id) => catOf(id) === cat).forEach((id) => {
                const t = TCS[id];
                const unit = (t.base / 60) + ' د' + (t.inc ? ' + ' + t.inc + ' ث' : '');
                row.append(
                    $('<button class="time-card">').attr({ 'data-action': 'selectTc', 'data-tc': id, 'aria-pressed': String(id === selectedTc) })
                        .append($('<span class="num">').text(id), $('<span class="unit">').text(unit))
                );
            });
            box.append(g.append(row));
        });
    }
    function renderRatings() {
        const box = $('#ratings').empty();
        ['bullet', 'blitz', 'rapid'].forEach((c) => {
            box.append($('<span class="chip">').text(CAT_NAMES[c]).append($('<b>').text(ratings[c])));
        });
    }
    function levelName(v) { return v <= 5 ? 'مبتدئ' : (v <= 10 ? 'متوسط' : 'متقدم'); }
    function updateLevelLabel() {
        const v = Number($('#ai-level').val());
        $('#ai-level-label').text('المستوى ' + v + ' (' + levelName(v) + ')');
    }

    const saved = lsGet('chess-tc');
    if (saved && TCS[saved]) selectedTc = saved;
    const savedName = lsGet('chess-name');
    if (savedName) $('#player-name').val(savedName);
    const savedTheme = lsGet('chess-theme');
    if (savedTheme && THEMES.includes(savedTheme)) document.body.setAttribute('data-theme', savedTheme);
    renderTimeGroups();
    renderRatings();
    updateLevelLabel();
    $('#ai-level').on('input', updateLevelLabel);
    $('#player-name').on('input', () => lsSet('chess-name', getName()));
    $('#player-name').on('change', () => socket.emit('set_name', { name: getName() }));
    $('#join-room-input').on('keydown', (e) => { if (e.key === 'Enter') A.joinRoom(); });
    $('#chat-input').on('keydown', (e) => { if (e.key === 'Enter') A.sendChat(); });

    // رابط دعوة: /?room=ABC123
    (function () {
        try {
            const code = new URLSearchParams(location.search).get('room');
            if (code && /^[A-Za-z0-9]{6}$/.test(code)) {
                pendingJoin = code.toUpperCase();
                $('#join-room-input').val(pendingJoin);
                history.replaceState(null, '', location.pathname);
            }
        } catch (e) { /* ignore */ }
    })();

    function resetToMenu() {
        clearTimeout(resultTimer);
        clearTimeout(resumeTimer);
        awaitResume = false;
        stopSearchTimer();
        state = null;
        spectating = false;
        $('#disc-text').addClass('hidden');
        $('#result-dialog, #promotion-dialog').addClass('hidden');
        closeConfirm();
        if (board) { board.destroy(); board = null; }
        show('menu-screen');
    }

    // ───────────────────────── الإجراءات (أزرار الواجهة) ─────────────────────────
    const A = {
        selectTc(el) {
            selectedTc = el.dataset.tc;
            lsSet('chess-tc', selectedTc);
            $('.time-card').each(function () { $(this).attr('aria-pressed', String($(this).data('tc') === selectedTc)); });
            $('#menu-error').text('');
        },
        findMatch() { $('#menu-error').text(''); socket.emit('find_match', { tc: selectedTc }); },
        createRoom() { socket.emit('create_room', { tc: selectedTc }); },
        joinRoom() {
            const roomId = $('#join-room-input').val().trim();
            if (!roomId) return $('#menu-error').text('أدخل كود الغرفة أولًا.');
            socket.emit('join_room', { roomId });
        },
        spectateRoom() {
            const roomId = $('#join-room-input').val().trim();
            if (!roomId) return $('#menu-error').text('أدخل كود الغرفة التي تريد مشاهدتها.');
            socket.emit('spectate', { roomId });
        },
        showAIOptions() { show('ai-options-screen'); },
        setAiColor(el) {
            const c = el.dataset.color;
            $('#ai-options-screen').data('color', c);
            $('#ai-options-screen .seg button').each(function () { $(this).attr('aria-pressed', String($(this).data('color') === c)); });
        },
        startAIGame() {
            let color = $('#ai-options-screen').data('color') || 'w';
            if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
            lastAI = { level: $('#ai-level').val(), tc: selectedTc };
            socket.emit('create_ai_room', { color, level: lastAI.level, tc: lastAI.tc });
        },
        goMenu() { show('menu-screen'); },
        leaveWaiting() { socket.emit('leave_room'); resetToMenu(); },
        cancelSearch() { socket.emit('cancel_search'); },
        copyRoomCode() { copyText($('#room-code').text(), '#copy-btn', 'انسخ الكود'); },
        copyRoomLink() { copyText(location.origin + '/?room=' + $('#room-code').text(), '#copy-link-btn', 'انسخ الرابط'); },
        showLeaderboard() { show('leaderboard-screen'); requestLeaderboard(); },
        lbTab(el) {
            lbCat = el.dataset.cat;
            $('#lb-tabs button').each(function () { $(this).attr('aria-pressed', String($(this).data('cat') === lbCat)); });
            requestLeaderboard();
        },
        // اللعب
        resign() {
            if (!state || state.over || spectating) return;
            askConfirm('هل تريد الاستسلام؟', () => socket.emit('resign'));
        },
        abort() { socket.emit('abort'); },
        offerDraw() {
            if (!state || state.over || gameMode !== 'multi' || spectating) return;
            if (state.moveCount < 2) return flash('يمكن اقتراح التعادل بعد أول حركتين.');
            socket.emit('offer_draw');
        },
        respondDraw(el) {
            $('#draw-banner').addClass('hidden');
            socket.emit('respond_draw', { accept: el.dataset.accept === '1' });
        },
        requestRematch() {
            if (!state || !state.over || spectating) return;
            if (gameMode === 'ai') {
                if (!lastAI) return;
                socket.emit('create_ai_room', { color: myColor === 'w' ? 'b' : 'w', level: lastAI.level, tc: lastAI.tc });
                return;
            }
            if (rematchSent) return;
            rematchSent = true;
            $('#result-rematch, #rematch-btn').prop('disabled', true).text('بانتظار الخصم...');
            socket.emit('rematch');
        },
        downloadPGN() { downloadPGN(); },
        flipBoard() { flipped = !flipped; if (board) board.flip(); },
        toggleSound() {
            soundOn = !soundOn;
            lsSet('chess-sound', soundOn ? 'on' : 'off');
            updateSoundButton();
            if (soundOn) playSound('move');
        },
        cycleTheme() {
            const cur = document.body.getAttribute('data-theme') || 'classic';
            const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
            document.body.setAttribute('data-theme', next);
            lsSet('chess-theme', next);
        },
        exitGame() {
            const leave = () => { socket.emit('leave_room'); resetToMenu(); };
            if (spectating || !state || state.over) return leave();
            if (state.moveCount < 2 && gameMode === 'multi') return leave();
            askConfirm('مغادرة المباراة الجارية تُحتسب خسارة. هل تريد المغادرة؟', leave);
        },
        reviewGo(el) { reviewGo(el.dataset.where); },
        promotePiece(el) {
            $('#promotion-dialog').addClass('hidden');
            if (pendingMove) {
                submitMove({ from: pendingMove.from, to: pendingMove.to, promotion: el.dataset.p });
                board.position(game.fen());
                pendingMove = null;
            }
        },
        cancelPromotion() { cancelPromotion(); },
        closeResult() { closeResult(); },
        sendChat() {
            if (spectating) return;
            const msg = $('#chat-input').val().trim();
            if (!msg) return;
            appendChat('أنت', msg);
            socket.emit('chat', { message: msg });
            $('#chat-input').val('');
        },
        reload() { location.reload(); }
    };

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const fn = A[el.dataset.action];
        if (fn) fn(el, e);
    });

    function copyText(text, btnSel, original) {
        const done = () => { $(btnSel).text('تم النسخ'); setTimeout(() => $(btnSel).text(original), 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
        else done();
    }

    function requestLeaderboard() {
        $('#lb-list').empty().append($('<li class="lb-empty">').text('جارٍ التحميل...'));
        socket.emit('leaderboard', { cat: lbCat });
    }
    socket.on('leaderboard', (d) => {
        if (d.cat !== lbCat) return;
        const list = $('#lb-list').empty();
        if (!d.rows.length) return list.append($('<li class="lb-empty">').text('لا توجد مباريات مصنَّفة بعد. كن أول المتصدرين!'));
        d.rows.forEach((r, i) => {
            list.append($('<li>').append(
                $('<span class="rk">').text(i + 1),
                $('<span class="nm">').text(r.name),
                $('<span class="rt">').text(r.rating),
                $('<span class="gm">').text(r.games + ' مباراة')
            ));
        });
    });

    // ───────────────────────── الاتصال وإعادة الاتصال ─────────────────────────
    socket.on('connect', () => {
        $('#conn-banner').addClass('hidden');
        socket.emit('hello', { token: getToken(), name: getName() });
    });
    socket.on('disconnect', () => { if (!replaced) $('#conn-banner').removeClass('hidden'); });
    socket.on('replaced', () => { replaced = true; $('#conn-banner').addClass('hidden'); $('#replaced-dialog').removeClass('hidden'); });
    socket.on('error', () => { /* تجاوز حد المعدل: نتجاهل */ });

    socket.on('welcome', (w) => {
        memToken = w.token;
        lsSet('chess-token', w.token);
        ratings = w.ratings || ratings;
        renderRatings();
        setOnline(w.online);
        if (!$('#player-name').val() && w.name) $('#player-name').val(w.name);

        const inLiveGame = currentScreen === 'game-screen' && state && !state.over && !spectating;
        if (currentScreen === 'searching-screen' || currentScreen === 'waiting-screen') {
            stopSearchTimer();
            show('menu-screen');       // إن بقيت الغرفة فسيعيد السيرفر room_created
        }
        if (spectating) resetToMenu();
        if (inLiveGame) {
            // ننتظر أن يستأنف السيرفر المباراة، وإلا فقد انتهت أثناء الانقطاع
            awaitResume = true;
            clearTimeout(resumeTimer);
            resumeTimer = setTimeout(() => {
                if (!awaitResume) return;
                awaitResume = false;
                alert('انتهت المباراة أثناء انقطاع الاتصال.');
                resetToMenu();
            }, 2500);
        }
        if (pendingJoin) {
            socket.emit('join_room', { roomId: pendingJoin });
            pendingJoin = null;
        }
    });

    function setOnline(n) {
        $('#online-count').text(n ? n + ' لاعب متصل الآن' : '');
    }
    socket.on('online', (d) => setOnline(d.online));
    setInterval(() => { if (socket.connected && currentScreen === 'menu-screen') socket.emit('get_online'); }, 20000);

    // ───────────────────────── البحث عن خصم ─────────────────────────
    function stopSearchTimer() {
        if (searchInterval) { clearInterval(searchInterval); searchInterval = null; }
    }
    socket.on('searching', ({ tc }) => {
        $('#search-info').text('النظام: ' + tcText(tc));
        $('#search-timer').text('00:00');
        show('searching-screen');
        stopSearchTimer();
        const startedAt = Date.now();
        searchInterval = setInterval(() => {
            const s = Math.floor((Date.now() - startedAt) / 1000);
            $('#search-timer').text(String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'));
        }, 1000);
    });
    socket.on('search_cancelled', () => { stopSearchTimer(); show('menu-screen'); });
    socket.on('left', () => { if (currentScreen !== 'menu-screen') resetToMenu(); });

    socket.on('room_created', ({ roomId }) => {
        $('#room-code').text(roomId);
        $('#copy-btn').text('انسخ الكود');
        $('#copy-link-btn').text('انسخ الرابط');
        show('waiting-screen');
    });
    socket.on('room_error', (msg) => {
        $('#menu-error').text(msg);
        if (currentScreen !== 'menu-screen' && currentScreen !== 'game-screen') { alert(msg); }
    });
    socket.on('room_closed', () => {
        if (currentScreen === 'game-screen' && !(state && state.over)) {
            alert('أُغلقت الغرفة.');
            resetToMenu();
        } else if (currentScreen === 'waiting-screen') {
            resetToMenu();
        }
    });

    // ───────────────────────── اللوحة ─────────────────────────
    function initBoard() {
        if (board) board.destroy();
        game.reset();
        board = Chessboard('board', {
            draggable: !spectating,
            position: 'start',
            orientation: (myColor === 'b') !== flipped ? 'black' : 'white',
            pieceTheme: PIECE_THEME,
            onDragStart,
            onDrop,
            onSnapEnd: () => { clearLegal(); board.position(game.fen()); }
        });
    }
    $(window).on('resize', () => { if (board) board.resize(); });

    function clearLegal() { $('#board .square-55d63').removeClass('legal-move legal-capture'); }
    function showLegal(source) {
        clearLegal();
        game.moves({ square: source, verbose: true }).forEach((m) => {
            const isCapture = m.captured || m.flags.indexOf('e') !== -1;
            $('#board .square-' + m.to).addClass(isCapture ? 'legal-capture' : 'legal-move');
        });
    }
    function canPlay() { return !!state && !state.over && !spectating && reviewIndex === null && game.turn() === myColor; }

    function onDragStart(source, piece) {
        if (!canPlay()) return false;
        if (piece.charAt(0) !== myColor) return false;
        showLegal(source);
    }
    function onDrop(source, target) {
        clearLegal();
        if (source === target) { handleSquareTap(source); return 'snapback'; }
        clearSelection();
        return attemptMove(source, target) === 'moved' ? undefined : 'snapback';
    }
    function attemptMove(source, target) {
        const legal = game.moves({ square: source, verbose: true }).filter((m) => m.to === target);
        if (!legal.length) return false;
        if (legal[0].flags.indexOf('p') !== -1) {
            pendingMove = { from: source, to: target };
            $('#promotion-dialog img').each(function () {
                $(this).attr('src', PIECE_THEME.replace('{piece}', myColor + $(this).data('piece')));
            });
            $('#promotion-dialog').removeClass('hidden');
            return 'promo';
        }
        return submitMove({ from: source, to: target }) ? 'moved' : false;
    }

    let selectedSquare = null;
    let lastTapSq = null;
    let lastTapAt = 0;

    function clearSelection() {
        selectedSquare = null;
        $('#board .square-55d63').removeClass('selected-sq');
        clearLegal();
    }
    function selectSquare(sq) {
        clearSelection();
        selectedSquare = sq;
        $('#board .square-' + sq).addClass('selected-sq');
        showLegal(sq);
    }
    function handleSquareTap(sq) {
        const now = Date.now();
        if (sq === lastTapSq && now - lastTapAt < 400) return;
        lastTapSq = sq;
        lastTapAt = now;
        if (!canPlay()) { clearSelection(); return; }
        if (selectedSquare && selectedSquare !== sq) {
            if (attemptMove(selectedSquare, sq)) {
                clearSelection();
                if (!pendingMove) board.position(game.fen());
                return;
            }
        }
        const piece = game.get(sq);
        if (piece && piece.color === myColor) {
            if (selectedSquare === sq) clearSelection(); else selectSquare(sq);
        } else {
            clearSelection();
        }
    }
    $('#board').on('click', '.square-55d63', function () { handleSquareTap($(this).attr('data-square')); });

    function submitMove(m) {
        const move = { from: m.from, to: m.to, promotion: m.promotion || 'q' };
        if (game.move(move) === null) return false;
        socket.emit('move', move);
        return true;
    }
    function cancelPromotion() { $('#promotion-dialog').addClass('hidden'); pendingMove = null; }

    function highlightLastMove(lm) {
        $('#board .square-55d63').removeClass('highlight-last');
        if (!lm) return;
        $('#board .square-' + lm.from).addClass('highlight-last');
        $('#board .square-' + lm.to).addClass('highlight-last');
    }

    // ───────────────────────── سجل الحركات والمراجعة ─────────────────────────
    function renderHistory(history, current) {
        if (current === undefined) current = history.length;
        const box = $('#move-list').empty();
        if (!history.length) { box.append($('<p class="empty">').text('ستظهر الحركات هنا')); return; }
        for (let i = 0; i < history.length; i += 2) {
            const row = $('<div class="mrow">');
            row.append($('<span class="num">').text(i / 2 + 1));
            [history[i], history[i + 1]].forEach((san, k) => {
                const ply = i + k + 1;
                const el = $('<span class="mv">').text(san || '');
                if (san) el.attr('data-ply', ply);
                if (san && ply === current) el.addClass('last');
                row.append(el);
            });
            box.append(row);
        }
        const cur = box.find('.mv.last')[0];
        if (cur && current !== history.length) cur.scrollIntoView({ block: 'nearest' });
        else box.scrollTop(box[0].scrollHeight);
    }
    $('#move-list').on('click', '.mv[data-ply]', function () {
        if (state && state.over) reviewTo(Number($(this).attr('data-ply')));
    });

    function buildPositions(history) {
        const g = new Chess();
        const pos = [{ fen: g.fen(), from: null, to: null, cap: null, color: null }];
        history.forEach((san) => {
            const mv = g.move(san);
            if (mv) pos.push({ fen: g.fen(), from: mv.from, to: mv.to, cap: mv.captured || null, color: mv.color });
        });
        return pos;
    }
    function reviewTo(i) {
        if (!state || !state.over || !board) return;
        i = Math.max(0, Math.min(positions.length - 1, i));
        reviewIndex = i === positions.length - 1 ? null : i;
        const p = positions[i];
        board.position(p.fen);
        highlightLastMove(p.from ? { from: p.from, to: p.to } : null);
        renderHistory(state.history || [], i);
        renderCaptured(i);
    }
    function reviewGo(where) {
        if (!state || !state.over) return;
        const last = positions.length - 1;
        const cur = reviewIndex === null ? last : reviewIndex;
        if (where === 'start') reviewTo(0);
        else if (where === 'prev') reviewTo(cur - 1);
        else if (where === 'next') reviewTo(cur + 1);
        else reviewTo(last);
    }

    // ───────────────────────── القطع المأكولة (من سجل الحركات، فتصح مع الترقية) ─────────────────────────
    function renderCaptured(idx) {
        const caps = { w: [], b: [] };           // caps[c] = القطع التي أكلها اللون c
        for (let i = 1; i <= idx && i < positions.length; i++) {
            const p = positions[i];
            if (p.cap) caps[p.color].push(p.cap);
        }
        const fen = (positions[idx] || positions[positions.length - 1]).fen;
        const mat = { w: 0, b: 0 };
        fen.split(' ')[0].split('').forEach((ch) => {
            const t = ch.toLowerCase();
            if (PIECE_VALUE[t]) mat[ch === t ? 'b' : 'w'] += PIECE_VALUE[t];
        });
        const opp = myColor === 'w' ? 'b' : 'w';
        fillCaptured('#my-captured', caps[myColor], opp, mat[myColor] - mat[opp]);
        fillCaptured('#opp-captured', caps[opp], myColor, mat[opp] - mat[myColor]);
    }
    function fillCaptured(sel, list, victimColor, ahead) {
        const box = $(sel).empty();
        list.slice().sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]).forEach((t) => {
            box.append($('<img>').attr({ src: PIECE_THEME.replace('{piece}', victimColor + t.toUpperCase()), alt: '' }));
        });
        if (ahead > 0) box.append($('<span class="adv">').text('+' + ahead));
    }

    // ───────────────────────── الساعات ─────────────────────────
    function remainingMs(color) {
        if (!state) return 0;
        let ms = state.clocks[color];
        if (state.running && !state.over && !state.frozen && state.turn === color) {
            ms -= (Date.now() + serverOffset) - state.tickAt;
        }
        return Math.max(0, ms);
    }
    function fmt(ms) {
        const total = Math.ceil(ms / 1000);
        const m = Math.floor(total / 60), s = total % 60;
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    function renderClocks() {
        if (!state) return;
        const opp = myColor === 'w' ? 'b' : 'w';
        const mine = remainingMs(myColor), theirs = remainingMs(opp);
        const live = state.running && !state.over;
        $('#my-timer').text(fmt(mine)).toggleClass('low', mine < 10000).toggleClass('active', live && state.turn === myColor);
        $('#opponent-timer').text(fmt(theirs)).toggleClass('low', theirs < 10000).toggleClass('active', live && state.turn === opp);

        // مهلة عودة الخصم المنقطع
        const until = !spectating && state.disc ? state.disc[opp] : null;
        if (until && !state.over) {
            const left = Math.max(0, Math.ceil((until - (Date.now() + serverOffset)) / 1000));
            $('#disc-text').text('انقطع اتصال ' + oppName + '. سيخسر إن لم يعد خلال ' + left + ' ثانية.').removeClass('hidden');
        } else {
            $('#disc-text').addClass('hidden');
        }
    }
    setInterval(renderClocks, 200);

    // ───────────────────────── الحالة والنتيجة ─────────────────────────
    function updateStatus() {
        if (!state) return;
        let text, tone = '';
        if (state.over) {
            const r = state.result;
            const reason = REASONS[r.reason] || '';
            if (!r.winner) text = 'تعادل: ' + reason;
            else if (spectating) text = (r.winner === 'w' ? 'فاز الأبيض' : 'فاز الأسود') + ' (' + reason + ')';
            else if (r.winner === myColor) { text = 'فزت بالمباراة (' + reason + ')'; tone = 'win'; }
            else { text = 'خسرت المباراة (' + reason + ')'; tone = 'loss'; }
        } else if (spectating) {
            text = state.check ? 'كش! الدور على ' : 'الدور على ';
            text += state.turn === 'w' ? 'الأبيض' : 'الأسود';
        } else if (state.check) {
            text = state.turn === myColor ? 'كش على ملكك' : 'كش على ملك الخصم';
            tone = 'check';
        } else if (!state.running) {
            text = state.turn === myColor ? 'دورك. تبدأ الساعة بعد أول حركتين.' : 'دور الخصم';
            if (state.turn === myColor) tone = 'mine';
        } else {
            text = state.turn === myColor ? 'دورك' : 'دور الخصم';
            if (state.turn === myColor) tone = 'mine';
        }
        $('#status-text').text(text);
        $('#status-card').attr('data-tone', tone);

        let meta = gameMode === 'ai' ? 'ضد الحاسوب' : (state.rated ? 'مباراة مصنَّفة' : 'مباراة ودّية');
        meta += ' · ' + tcText(state.tc);
        if (state.spectators) meta += ' · ' + state.spectators + ' مشاهد';
        $('#game-meta').text(meta);
    }

    function showResult() {
        if (!state || !state.over || spectating) return;
        const r = state.result;
        let title, tone;
        if (!r.winner) { title = r.reason === 'aborted' ? 'أُلغيت المباراة' : 'انتهت بالتعادل'; tone = 'draw'; }
        else if (r.winner === myColor) { title = 'فزت بالمباراة'; tone = 'win'; }
        else { title = 'خسرت المباراة'; tone = 'loss'; }
        $('#result-title').text(title).attr('data-tone', tone);
        $('#result-reason').text(REASONS[r.reason] || '');
        const dl = $('#result-delta').addClass('hidden').removeClass('pos neg');
        if (r.delta && r.newRatings) {
            const d = r.delta[myColor];
            const cat = catOf(state.tc);
            ratings[cat] = r.newRatings[myColor];
            renderRatings();
            dl.text('التصنيف ' + r.newRatings[myColor] + ' (' + (d >= 0 ? '+' : '') + d + ')').addClass(d >= 0 ? 'pos' : 'neg').removeClass('hidden');
        }
        $('#result-dialog').removeClass('hidden');
        $('#result-rematch:visible').trigger('focus');
    }
    function closeResult() { $('#result-dialog').addClass('hidden'); }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { cancelPromotion(); closeResult(); closeConfirm(); return; }
        if (state && state.over && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
            const map = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'start', End: 'end' };
            if (map[e.key]) { e.preventDefault(); reviewGo(map[e.key]); }
        }
    });

    // ───────────────────────── بدء المباراة ─────────────────────────
    function resetGameUi() {
        clearTimeout(resultTimer);
        state = null;
        positions = [{ fen: '', from: null, to: null, cap: null, color: null }];
        reviewIndex = null;
        lastSoundCount = 0;
        lastOver = false;
        firstState = true;
        $('#notice-text, #flash-text').text('');
        $('#disc-text').addClass('hidden');
        $('#status-text').text('اللعبة جارية...');
        $('#status-card').attr('data-tone', '');
        $('#my-timer, #opponent-timer').removeClass('active low').text('--:--');
        $('#my-dot').attr('class', 'dot ' + myColor);
        $('#opp-dot').attr('class', 'dot ' + (myColor === 'w' ? 'b' : 'w'));
        $('#game-screen').removeClass('reviewable');
        $('#review-bar, #pgn-btn, #rematch-btn, #abort-btn').addClass('hidden');
        $('#result-rematch').removeClass('hidden');
        $('#result-rematch, #rematch-btn').prop('disabled', false).text('العب مجددًا');
        $('#rematch-note').text('');
        $('#draw-banner').addClass('hidden');
        $('#draw-btn').prop('disabled', false).text('اقترح تعادلًا');
        $('#my-captured, #opp-captured').empty();
        $('#my-rating, #opp-rating').text('');
        rematchSent = false;
        oppLeft = false;
        closeResult();
        cancelPromotion();
        renderHistory([]);
    }

    socket.on('game_start', (data) => {
        stopSearchTimer();
        awaitResume = false;
        clearTimeout(resumeTimer);
        spectating = false;
        myColor = data.color;
        gameMode = data.mode;
        if (!data.resumed) { flipped = false; $('#chat-box').empty(); }
        resetGameUi();
        oppName = gameMode === 'ai' ? 'الحاسوب' : 'الخصم';
        $('#opp-name').text(oppName);
        $('#my-name').text('أنت');
        $('#chat-container').toggleClass('hidden', gameMode !== 'multi');
        $('#draw-btn').toggleClass('hidden', gameMode !== 'multi');
        $('#resign-btn, #flip-btn').removeClass('hidden');
        show('game-screen');
        initBoard();
    });

    socket.on('spectate_start', () => {
        spectating = true;
        gameMode = 'multi';
        myColor = 'w';
        flipped = false;
        $('#chat-box').empty();
        resetGameUi();
        oppName = 'الأسود';
        $('#opp-name').text('الأسود');
        $('#my-name').text('الأبيض');
        $('#chat-container').addClass('hidden');
        $('#resign-btn, #draw-btn, #abort-btn, #rematch-btn').addClass('hidden');
        show('game-screen');
        initBoard();
    });

    socket.on('state', (s) => {
        if (!s || !s.fen) return;
        state = s;
        clearSelection();
        serverOffset = s.serverNow - Date.now();
        game.load(s.fen);
        if (board) board.position(s.fen);
        highlightLastMove(s.lastMove);

        const nm = s.names || {};
        const opp = myColor === 'w' ? 'b' : 'w';
        oppName = nm[opp] || (spectating ? (opp === 'b' ? 'الأسود' : 'الأبيض') : (gameMode === 'ai' ? 'الحاسوب' : 'الخصم'));
        $('#opp-name').text(oppName);
        $('#my-name').text(nm[myColor] || (spectating ? 'الأبيض' : 'أنت'));
        if (gameMode === 'multi' && s.ratings) {
            $('#my-rating').text(s.ratings[myColor] ? '(' + s.ratings[myColor] + ')' : '');
            $('#opp-rating').text(s.ratings[opp] ? '(' + s.ratings[opp] + ')' : '');
        }

        positions = buildPositions(s.history || []);
        reviewIndex = null;
        renderHistory(s.history || []);
        renderCaptured(positions.length - 1);
        updateGameButtons(s);

        if (firstState) {
            lastSoundCount = s.moveCount;
            lastOver = s.over;
            firstState = false;
            if (s.over) resultTimer = setTimeout(showResult, 300);
        } else {
            if (s.moveCount > lastSoundCount) {
                if (s.check && !s.over) playSound('check');
                else playSound(s.lastMove && s.lastMove.captured ? 'capture' : 'move');
            }
            lastSoundCount = s.moveCount;
            if (s.over && !lastOver) {
                setTimeout(() => playSound('end'), 350);
                clearTimeout(resultTimer);
                resultTimer = setTimeout(showResult, 900);
            }
            lastOver = s.over;
        }
        updateStatus();
        renderClocks();
    });

    function updateGameButtons(s) {
        $('#game-screen').toggleClass('reviewable', !!s.over);
        $('#review-bar, #pgn-btn').toggleClass('hidden', !s.over);
        if (spectating) {
            $('#resign-btn, #abort-btn, #draw-btn, #rematch-btn').addClass('hidden');
            return;
        }
        const canAbort = gameMode === 'multi' && !s.over && s.moveCount < 2;
        $('#abort-btn').toggleClass('hidden', !canAbort);
        $('#resign-btn').toggleClass('hidden', !!s.over || canAbort);
        $('#draw-btn').toggleClass('hidden', !!s.over || gameMode !== 'multi');

        // اقتراح التعادل (الحالة من السيرفر، فتصح بعد إعادة الاتصال أيضًا)
        const iOffered = s.drawOffer === myColor;
        $('#draw-btn').prop('disabled', iOffered).text(iOffered ? 'تم إرسال الاقتراح' : 'اقترح تعادلًا');
        $('#draw-banner').toggleClass('hidden', !(s.drawOffer && s.drawOffer !== myColor && !s.over));

        const gone = oppLeft || (gameMode === 'multi' && s.result && s.result.reason === 'abandoned');
        $('#rematch-btn, #result-rematch').toggleClass('hidden', !s.over || !!gone);
        if (s.over && gone) $('#rematch-note').text('غادر الخصم المباراة.');
        if (s.over && s.rematch && gameMode === 'multi') {
            const opp = myColor === 'w' ? 'b' : 'w';
            if (s.rematch[myColor]) {
                rematchSent = true;
                $('#result-rematch, #rematch-btn').prop('disabled', true).text('بانتظار الخصم...');
            } else if (s.rematch[opp]) {
                $('#rematch-note').text(oppName + ' يريد إعادة المباراة.');
                $('#result-rematch, #rematch-btn').text('قبول الإعادة');
            }
        }
    }

    // ───────────────────────── أحداث اللعب ─────────────────────────
    socket.on('notice', (msg) => $('#notice-text').text(msg));
    socket.on('toast', (msg) => flash(msg));
    socket.on('draw_offered', () => { $('#draw-banner').removeClass('hidden'); playSound('check'); });
    socket.on('draw_cleared', () => $('#draw-banner').addClass('hidden'));
    socket.on('draw_declined', () => flash('رفض الخصم اقتراح التعادل.'));
    socket.on('draw_sent', () => $('#draw-btn').prop('disabled', true).text('تم إرسال الاقتراح'));
    socket.on('opp_reconnected', () => flash('عاد الخصم إلى المباراة.'));
    socket.on('rematch_offered', () => {
        if (rematchSent) return;
        $('#rematch-note').text(oppName + ' يريد إعادة المباراة.');
        $('#result-rematch, #rematch-btn').text('قبول الإعادة');
        flash(oppName + ' يريد إعادة المباراة.');
    });
    socket.on('opponent_left', () => {
        oppLeft = true;
        if (state && state.over) {
            $('#rematch-btn, #result-rematch').addClass('hidden');
            $('#rematch-note').text('غادر الخصم المباراة.');
        }
    });

    // ───────────────────────── الدردشة (text() لمنع XSS) ─────────────────────────
    function appendChat(who, msg) {
        $('<div>').text(who + ': ' + msg).appendTo('#chat-box');
        const box = document.getElementById('chat-box');
        box.scrollTop = box.scrollHeight;
    }
    socket.on('chat', (d) => appendChat(oppName, d && d.message ? d.message : ''));

    // ───────────────────────── PGN ─────────────────────────
    function downloadPGN() {
        if (!state) return;
        const nm = state.names || {};
        const r = state.result;
        const res = !r ? '*' : (!r.winner ? '1/2-1/2' : (r.winner === 'w' ? '1-0' : '0-1'));
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const t = TCS[state.tc];
        const g = new Chess();
        g.header('Event', 'Online game', 'Site', location.host, 'Date',
            d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()),
            'White', nm.w || 'Player', 'Black', nm.b || 'Player', 'Result', res,
            'TimeControl', t ? (t.base + (t.inc ? '+' + t.inc : '')) : '-');
        (state.history || []).forEach((san) => g.move(san));
        const blob = new Blob([g.pgn() + '\n'], { type: 'application/x-chess-pgn' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chess-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.pgn';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // تحذير قبل إغلاق الصفحة أثناء مباراة جارية
    window.addEventListener('beforeunload', (e) => {
        if (state && !state.over && !spectating && state.moveCount >= 2) { e.preventDefault(); e.returnValue = ''; }
    });
})();
