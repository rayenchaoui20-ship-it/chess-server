(function () {
    'use strict';

    // بديل بسيط للترجمة (النص عربي فقط حاليًا)
    const tr = (s, p) => (typeof s === 'string' && p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] == null ? m : p[k])) : s);
    const I18N = { tag: 'ar', lang: 'ar' };

    // ───────────────────────── الثوابت ─────────────────────────
    const PIECE_THEME = 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png';
    const TCS = {
        '1+0': { base: 60, inc: 0 }, '2+1': { base: 120, inc: 1 },
        '3+0': { base: 180, inc: 0 }, '3+2': { base: 180, inc: 2 }, '5+0': { base: 300, inc: 0 },
        '10+0': { base: 600, inc: 0 }, '15+10': { base: 900, inc: 10 }
    };
    const CAT_NAMES = { bullet: tr('بوليت'), blitz: tr('بليتز'), rapid: tr('رابيد') };
    const THEMES = ['classic', 'green', 'brown', 'slate'];
    const SCREENS = ['world-screen', 'menu-screen', 'live-screen', 'ai-options-screen', 'waiting-screen', 'searching-screen', 'leaderboard-screen', 'auth-screen', 'friends-screen', 'club-screen', 'games-screen', 'puzzle-screen', 'mono-screen', 'game-screen'];
    const REASONS = {
        checkmate: tr('كش مات'), timeout: tr('انتهى الوقت'), resign: tr('استسلام اللاعب'), abandoned: tr('غادر الخصم المباراة'),
        stalemate: tr('جمود (Stalemate)'), insufficient: tr('عدم كفاية القطع'), repetition: tr('تكرار الوضعية'),
        fifty: tr('قاعدة الخمسين حركة'), agreement: tr('اتفاق على التعادل'), aborted: tr('أُلغيت المباراة'),
        timevsinsufficient: tr('انتهى الوقت، لكن الخصم لا يملك قطعًا كافية للكش مات')
    };
    const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

    // ───────────────────────── الحالة ─────────────────────────
    const socket = io();
    window.APP = { socket, show: (id) => show(id), toMenu: () => show('menu-screen') };
    // رسائل الخادم النصية تُترجم عند الاستقبال (الخادم يرسل بالعربية دائمًا)
    const MSG_EVENTS = new Set(['room_error', 'toast', 'notice', 'auth_error', 'friend_error', 'friend_ok', 'analysis_error', 'games_error']);
    const rawOn = socket.on.bind(socket);
    socket.on = (ev, fn) => rawOn(ev, MSG_EVENTS.has(ev)
        ? (m) => fn(typeof m === 'string' ? tr(m) : m)
        : ev === 'notify' ? (d) => fn(d && typeof d.text === 'string' ? Object.assign({}, d, { text: tr(d.text) }) : d) : fn);
    let game = new Chess();            // نسخة محلية للتحقق السريع فقط، السيرفر هو المرجع
    const plainGame = game;
    let wrapGame = null;
    // شطرنج فيشر (له startFen) يمر عبر Castle960 لدعم التبييت؛ الشطرنج العادي لا يتغيّر إطلاقًا
    function pickGame(startFen) {
        if (startFen && window.Castle960) {
            if (!wrapGame || wrapGame.startFen !== startFen) wrapGame = window.Castle960.createGame(Chess, startFen);
            game = wrapGame;
        } else game = plainGame;
    }
    function makeGame(startFen) {
        return startFen && window.Castle960 ? window.Castle960.createGame(Chess, startFen) : (startFen ? new Chess(startFen) : new Chess());
    }
    let board = null;
    let myColor = 'w';
    let gameMode = '';
    let spectating = false;
    let flipped = false;
    let selectedTc = '3+0';
    let variant = lsGet('chess-variant') === '960' ? '960' : 'std';
    let state = null;
    let positions = [{ fen: '', from: null, to: null, cap: null, color: null }];
    let reviewIndex = null;
    let analysis = null;
    let analyzing = false;
    const CLS = {
        brilliant: { sym: '!!', name: tr('رائعة (بريليانت)') },
        great: { sym: '!', name: tr('رائعة جدًا') },
        best: { sym: '★', name: tr('الأفضل') },
        excellent: { sym: '✓', name: tr('ممتازة') },
        good: { sym: '•', name: tr('جيدة') },
        book: { sym: '📖', name: tr('نظرية') },
        inaccuracy: { sym: '?!', name: tr('دقة ضعيفة') },
        mistake: { sym: '?', name: tr('خطأ') },
        blunder: { sym: '??', name: tr('خطأ فادح (بلندر)') }
    };
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
    let oppName = tr('الخصم');
    let lastAI = null;
    let currentScreen = 'menu-screen';
    let ratings = { bullet: 1200, blitz: 1200, rapid: 1200 };
    let lbCat = 'blitz';
    let pendingJoin = null;
    let replaced = false;
    let confirmYes = null;
    let memToken = null;
    let account = null;
    let authMode = 'login';
    let friendsTimer = null;
    let clubTimer = null;
    let clubData = null;
    let clubSearchTimer = null;
    let liveTimer = null;
    let friendsData = { friends: [], incoming: [], outgoing: [] };
    let pendingInvite = null;
    let gtoastTimer = null;

    // ───────────────────────── تخزين المتصفح (اختياري) ─────────────────────────
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

    function show(id) {
        currentScreen = id;
        if (id !== 'friends-screen' && friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
        if (id !== 'club-screen' && clubTimer) { clearInterval(clubTimer); clubTimer = null; }
        if (id !== 'live-screen' && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
        SCREENS.forEach((s) => $('#' + s).toggleClass('hidden', s !== id));
        $('#world-switch').toggleClass('hidden', id !== 'menu-screen' && id !== 'mono-screen');
        $('#wordmark').text(id === 'world-screen' ? 'الألعاب' : id === 'mono-screen' ? 'ملك المدينة' : 'شطرنج');
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
        if (window.SFX) { window.SFX.play(type); return; }
        try {
            ensureAudio();
            if (!audioCtx) return;
            if (type === 'move') { tone(220, 0, 0.08, 0.5, 'triangle', 120); noise(0, 0.05, 0.6, 1800); }
            else if (type === 'capture') { tone(160, 0, 0.12, 0.7, 'triangle', 80); noise(0, 0.09, 1.0, 2600); noise(0.05, 0.06, 0.5, 1500); }
            else if (type === 'check') { tone(660, 0, 0.12, 0.3, 'sine'); tone(880, 0.1, 0.16, 0.3, 'sine'); }
            else if (type === 'end') { [523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.3, 0.35, 'sine')); }
        } catch (e) { /* ignore */ }
    }
    // نوع صوت النقلة من رمزها (SAN): تبييت، ترقية، أخذ، كش
    function moveSound(san, captured) {
        san = san || '';
        if (san.indexOf('#') !== -1 || san.indexOf('+') !== -1) return 'check';
        if (san.indexOf('O-O') === 0) return 'castle';
        if (san.indexOf('=') !== -1) return 'promote';
        return captured || san.indexOf('x') !== -1 ? 'capture' : 'move';
    }
    function updateSoundButton() {
        $('#sound-btn').text(soundOn ? tr('الصوت مفعّل') : tr('الصوت مكتوم')).attr('aria-pressed', String(soundOn));
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
    function getName() { return account || ($('#player-name').val() || '').trim().slice(0, 20); }
    function getToken() { return lsGet('chess-token') || memToken; }

    function renderTimeGroups() {
        const box = $('#time-groups').empty();
        ['bullet', 'blitz', 'rapid'].forEach((cat) => {
            const g = $('<div class="time-group">').append($('<div class="gname">').text(CAT_NAMES[cat]));
            const row = $('<div class="time-row">');
            Object.keys(TCS).filter((id) => catOf(id) === cat).forEach((id) => {
                const t = TCS[id];
                const unit = tr('{m} د', { m: t.base / 60 }) + (t.inc ? ' + ' + tr('{s} ث', { s: t.inc }) : '');
                row.append(
                    $('<button class="time-card">').attr({ 'data-action': 'selectTc', 'data-tc': id, 'aria-pressed': String(id === selectedTc) })
                        .append($('<span class="num">').text(id), $('<span class="unit">').text(unit))
                );
            });
            box.append(g.append(row));
        });
    }
    function renderVariant() {
        $('#variant-toggle').attr('aria-pressed', String(variant === '960'));
        $('#variant-state').text(variant === '960' ? tr('مفعّل') : tr('متوقف'));
    }
    function renderRatings() {
        const box = $('#ratings').empty();
        ['bullet', 'blitz', 'rapid'].forEach((c) => {
            box.append($('<span class="chip">').text(CAT_NAMES[c]).append($('<b>').text(ratings[c])));
        });
    }
    function levelName(v) { return v <= 5 ? tr('مبتدئ') : (v <= 10 ? tr('متوسط') : tr('متقدم')); }
    function updateLevelLabel() {
        const v = Number($('#ai-level').val());
        $('#ai-level-label').text(tr('المستوى {v} ({name})', { v, name: levelName(v) }));
    }

    const saved = lsGet('chess-tc');
    if (saved && TCS[saved]) selectedTc = saved;
    renderVariant();
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
        toggleVariant() {
            variant = variant === '960' ? 'std' : '960';
            lsSet('chess-variant', variant);
            renderVariant();
        },
        findMatch() { $('#menu-error').text(''); socket.emit('find_match', { tc: selectedTc }); },
        createRoom() { socket.emit('create_room', { tc: selectedTc, variant }); },
        joinRoom() {
            const roomId = $('#join-room-input').val().trim();
            if (!roomId) return $('#menu-error').text(tr('أدخل كود الغرفة أولًا.'));
            socket.emit('join_room', { roomId });
        },
        spectateRoom() {
            const roomId = $('#join-room-input').val().trim();
            if (!roomId) return $('#menu-error').text(tr('أدخل كود الغرفة التي تريد مشاهدتها.'));
            socket.emit('spectate', { roomId });
        },
        showAIOptions() { show('ai-options-screen'); },
        showMono() { show('mono-screen'); if (window.Mono) window.Mono.open(); },
        openReport() { $('#report-dialog').removeClass('hidden'); },
        closeReport() { $('#report-dialog').addClass('hidden'); },
        sendReport(el) { socket.emit('report', { reason: el.dataset.reason }); $('#report-dialog').addClass('hidden'); },
        toggleChatMute() {
            chatMuted = !chatMuted;
            $('#chat-mute-btn').attr('aria-pressed', String(chatMuted)).text(chatMuted ? '🔊 أظهر رسائل الخصم' : '🔇 اكتم رسائل الخصم');
        },
        reviewPly(el) { reviewTo(parseInt(el.dataset.ply, 10) || 0); },
        pickChess() { lsSet('chess-world', 'chess'); show('menu-screen'); },
        pickMono() { lsSet('chess-world', 'mono'); A.showMono(); },
        changeWorld() {
            if (window.Mono && window.Mono.busy && window.Mono.busy() && !window.confirm('مغادرة ملك المدينة الآن تعني الإفلاس. هل تريد تغيير اللعبة؟')) return;
            if (window.Mono && window.Mono.leave) window.Mono.leave();
            show('world-screen');
        },
        setAiColor(el) {
            const c = el.dataset.color;
            $('#ai-options-screen').data('color', c);
            $('#ai-options-screen .seg button').each(function () { $(this).attr('aria-pressed', String($(this).data('color') === c)); });
        },
        startAIGame() {
            let color = $('#ai-options-screen').data('color') || 'w';
            if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
            lastAI = { level: $('#ai-level').val(), tc: selectedTc, variant };
            socket.emit('create_ai_room', { color, level: lastAI.level, tc: lastAI.tc, variant: lastAI.variant });
        },
        goMenu() { show('menu-screen'); },
        showGames() {
            $('#games-list').empty();
            $('#games-empty').text(tr('جارٍ التحميل...')).removeClass('hidden');
            show('games-screen');
            socket.emit('games_get');
        },
        openGame(el) { socket.emit('game_get', { id: el.dataset.id }); },
        leaveWaiting() { socket.emit('leave_room'); resetToMenu(); },
        cancelSearch() { socket.emit('cancel_search'); },
        copyRoomCode() { copyText($('#room-code').text(), '#copy-btn', tr('انسخ الكود')); },
        copyRoomLink() { copyText(location.origin + '/?room=' + $('#room-code').text(), '#copy-link-btn', tr('انسخ الرابط')); },
        showLive() {
            $('#live-list').empty();
            $('#live-empty').text(tr('جارٍ التحميل...')).removeClass('hidden');
            show('live-screen');
            socket.emit('live_games');
            if (liveTimer) clearInterval(liveTimer);
            liveTimer = setInterval(() => { if (socket.connected) socket.emit('live_games'); }, 5000);
        },
        watchGame(el) { socket.emit('spectate', { roomId: el.dataset.id }); },
        showLeaderboard() { show('leaderboard-screen'); requestLeaderboard(); },
        lbTab(el) {
            lbCat = el.dataset.cat;
            $('#lb-tabs button').each(function () { $(this).attr('aria-pressed', String($(this).data('cat') === lbCat)); });
            requestLeaderboard();
        },
        // اللعب
        resign() {
            if (!state || state.over || spectating) return;
            askConfirm(tr('هل تريد الاستسلام؟'), () => socket.emit('resign'));
        },
        abort() { socket.emit('abort'); },
        offerDraw() {
            if (!state || state.over || gameMode !== 'multi' || spectating) return;
            if (state.moveCount < 2) return flash(tr('يمكن اقتراح التعادل بعد أول حركتين.'));
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
                socket.emit('create_ai_room', { color: myColor === 'w' ? 'b' : 'w', level: lastAI.level, tc: lastAI.tc, variant: lastAI.variant });
                return;
            }
            if (rematchSent) return;
            rematchSent = true;
            $('#result-rematch, #rematch-btn').prop('disabled', true).text(tr('بانتظار الخصم...'));
            socket.emit('rematch');
        },
        downloadPGN() { downloadPGN(); },
        flipBoard() { flipped = !flipped; if (board) board.flip(); markAnalysis(reviewIndex === null ? positions.length - 1 : reviewIndex); },
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
            askConfirm(tr('مغادرة المباراة الجارية تُحتسب خسارة. هل تريد المغادرة؟'), leave);
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
            appendChat(tr('أنت'), msg);
            socket.emit('chat', { message: msg });
            $('#chat-input').val('');
        },
        showPuzzles() { show('puzzle-screen'); pzNext(false); },
        pzLevel(el) {
            pzLevelN = Number(el.dataset.n);
            $('#pz-levels button').each(function () { $(this).attr('aria-pressed', String(Number($(this).data('n')) === pzLevelN)); });
            pzNext(false);
        },
        pzNext() { pzNext(true); },
        pzRetry() { if (pzCur) pzStart(pzCur); },
        pzHint() { pzHint(); },
        pzSolution() { pzSolution(); },
        showAuth() { $('#auth-error').text(''); show('auth-screen'); $('#auth-user').trigger('focus'); },
        authTab(el) { setAuthMode(el.dataset.mode); },
        authSubmit() { authSubmit(); },
        logout() {
            askConfirm(tr('هل تريد تسجيل الخروج من حسابك؟'), () => { resetToMenu(); socket.emit('logout'); });
        },
        showClubs() {
            if (!account) { gtoast(tr('سجّل الدخول أولًا لاستخدام الأندية.')); A.showAuth(); return; }
            $('#club-msg').text('').removeClass('err good');
            $('#club-none, #club-mine').addClass('hidden');
            show('club-screen');
            socket.emit('club_get');
            if (clubTimer) clearInterval(clubTimer);
            clubTimer = setInterval(() => { if (socket.connected) socket.emit('club_get'); }, 10000);
        },
        clubCreate() {
            const name = $('#club-name').val().trim();
            if (!name) return;
            socket.emit('club_create', { name, desc: $('#club-desc-in').val().trim() });
        },
        clubJoin(el) { socket.emit('club_join', { id: el.dataset.id }); },
        clubLeave() {
            askConfirm(tr('هل تريد مغادرة النادي؟'), () => socket.emit('club_leave'));
        },
        clubKick(el) {
            const u = el.dataset.user;
            askConfirm(tr('إخراج {u} من النادي؟', { u }), () => socket.emit('club_kick', { username: u }));
        },
        clubChallenge(el) { socket.emit('club_challenge', { username: el.dataset.user }); },
        clubSend() {
            const t = $('#club-input').val().trim();
            if (!t) return;
            socket.emit('club_chat', { message: t });
            $('#club-input').val('');
        },
        showFriends() {
            $('#fr-msg').text('').removeClass('err good');
            show('friends-screen');
            socket.emit('friends_get');
            if (friendsTimer) clearInterval(friendsTimer);
            friendsTimer = setInterval(() => { if (socket.connected) socket.emit('friends_get'); }, 10000);
        },
        friendAdd() {
            const u = $('#friend-input').val().trim();
            if (!u) return;
            socket.emit('friend_add', { username: u });
            $('#friend-input').val('');
        },
        friendRespond(el) { socket.emit('friend_respond', { username: el.dataset.user, accept: el.dataset.accept === '1' }); },
        friendRemove(el) {
            const u = el.dataset.user;
            askConfirm(tr('إزالة {u} من قائمة أصدقائك؟', { u }), () => socket.emit('friend_remove', { username: u }));
        },
        friendInvite(el) { socket.emit('friend_invite', { username: el.dataset.user, tc: selectedTc, variant }); },
        inviteAccept() {
            $('#invite-dialog').addClass('hidden');
            if (pendingInvite) socket.emit('join_room', { roomId: pendingInvite.roomId });
            pendingInvite = null;
        },
        inviteDecline() {
            $('#invite-dialog').addClass('hidden');
            if (pendingInvite) socket.emit('invite_decline', { username: pendingInvite.from });
            pendingInvite = null;
        },
        analyzeGame() {
            if (!state || !state.over || analyzing) return;
            if (!(state.history || []).length) return gtoast(tr('لا توجد حركات لتحليلها.'));
            analyzing = true;
            analysis = null;
            $('#analysis-box').removeClass('hidden');
            $('#analysis-summary, #analysis-note').empty();
            $('#analysis-bar').removeClass('hidden');
            $('#analysis-fill').css('width', '3%');
            $('#analysis-status').text(tr('جارٍ التحليل... قد يستغرق دقيقة')).removeClass('err');
            $('#analyze-btn').prop('disabled', true);
            const history = state.history.slice();
            const gameId = state.gameId || null;
            const startFen = state.startFen || null;
            $('#analysis-status').text(tr('جارٍ تحميل محرك Stockfish...'));
            browserEvals(positions.map((p) => p.fen), (done, total) => setAnalysisProgress(done, total, tr('جارٍ التحليل على جهازك...'))).then((evals) => {
                if (!analyzing) return;
                if (!evals) $('#analysis-status').text(tr('جارٍ التحليل على الخادم... قد يستغرق دقيقة'));
                socket.emit('analyze', { history, startFen, evals: evals || undefined, gameId: gameId || undefined });
            });
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
        const done = () => { $(btnSel).text(tr('تم النسخ')); setTimeout(() => $(btnSel).text(original), 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
        else done();
    }

    function requestLeaderboard() {
        $('#lb-list').empty().append($('<li class="lb-empty">').text(tr('جارٍ التحميل...')));
        socket.emit('leaderboard', { cat: lbCat });
    }
    socket.on('leaderboard', (d) => {
        if (d.cat !== lbCat) return;
        const list = $('#lb-list').empty();
        if (!d.rows.length) return list.append($('<li class="lb-empty">').text(tr('لا توجد مباريات مصنَّفة بعد. كن أول المتصدرين!')));
        d.rows.forEach((r, i) => {
            list.append($('<li>').append(
                $('<span class="rk">').text(i + 1),
                $('<span class="nm">').text(tr(r.name)),
                $('<span class="rt">').text(r.rating),
                $('<span class="gm">').text(tr('{n} مباراة', { n: r.games }))
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
        account = w.user || null;
        renderAccount();
        if (account) { if (w.pz) pzMerge(w.pz); else pzSync(); }
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
                alert(tr('انتهت المباراة أثناء انقطاع الاتصال.'));
                resetToMenu();
            }, 2500);
        }
        if (pendingJoin) {
            socket.emit('join_room', { roomId: pendingJoin });
            pendingJoin = null;
        }
    });

    function setOnline(n) {
        $('#online-count').text(n ? tr('{n} لاعب متصل الآن', { n }) : '');
    }
    socket.on('online', (d) => setOnline(d.online));
    setInterval(() => { if (socket.connected && currentScreen === 'menu-screen') socket.emit('get_online'); }, 20000);

    // ───────────────────────── البحث عن خصم ─────────────────────────
    function stopSearchTimer() {
        if (searchInterval) { clearInterval(searchInterval); searchInterval = null; }
    }
    socket.on('searching', ({ tc }) => {
        $('#search-info').text(tr('النظام: {tc}', { tc: tcText(tc) }));
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
        $('#copy-btn').text(tr('انسخ الكود'));
        $('#copy-link-btn').text(tr('انسخ الرابط'));
        show('waiting-screen');
    });
    socket.on('room_error', (msg) => {
        $('#menu-error').text(msg);
        if (currentScreen !== 'menu-screen' && currentScreen !== 'game-screen') { alert(msg); }
    });
    socket.on('room_closed', () => {
        if (currentScreen === 'game-screen' && !(state && state.over)) {
            alert(tr('أُغلقت الغرفة.'));
            resetToMenu();
        } else if (currentScreen === 'waiting-screen') {
            resetToMenu();
        }
    });

    // ───────────────────────── اللوحة ─────────────────────────
    function initBoard() {
        analysis = null;
        analyzing = false;
        $('#eval-bar').addClass('hidden');
        $('#analysis-box').addClass('hidden');
        $('#analysis-summary, #analysis-note').empty();
        if (board) board.destroy();
        game.reset();
        board = Chessboard('board', {
            draggable: !spectating,
            position: 'start',
            orientation: (myColor === 'b') !== flipped ? 'black' : 'white',
            pieceTheme: PIECE_THEME,
            moveSpeed: 130, snapSpeed: 40, snapbackSpeed: 130, appearSpeed: 120, trashSpeed: 90,
            onDragStart,
            onDrop,
            onSnapEnd: () => { clearLegal(); board.position(game.fen()); }
        });
    }
    $(window).on('resize', () => { if (board) board.resize(); if (pzBoard) pzBoard.resize(); });

    function clearLegal() { $('#board .square-55d63').removeClass('legal-move legal-capture'); }
    function showLegal(source) {
        clearLegal();
        game.moves({ square: source, verbose: true }).forEach((m) => {
            const isCapture = m.captured || m.flags.indexOf('e') !== -1;
            if (m.castle) {                                   // تبييت 960: نضيء قلعة الملك ووجهته (إن تحرّك الملك فعلًا)
                $('#board .square-' + m.rook).addClass('legal-move');
                if (m.to !== source) $('#board .square-' + m.to).addClass('legal-move');
                return;
            }
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
        const legal = game.moves({ square: source, verbose: true }).filter((m) => m.to === target || (m.castle && m.rook === target));
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

    // يضيء مربع الملك الواقع في كش (fen = المركز المعروض)
    function markCheck(fen) {
        $('#board .square-55d63').removeClass('in-check');
        if (!fen) return;
        try {
            const g = new Chess(fen);
            if (!g.in_check()) return;
            const files = 'abcdefgh';
            g.board().forEach((row, r) => row.forEach((p, f) => {
                if (p && p.type === 'k' && p.color === g.turn()) $('#board .square-' + files[f] + (8 - r)).addClass('in-check');
            }));
        } catch (e) { /* ignore */ }
    }
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
        if (!history.length) { box.append($('<p class="empty">').text(tr('ستظهر الحركات هنا'))); return; }
        for (let i = 0; i < history.length; i += 2) {
            const row = $('<div class="mrow">');
            row.append($('<span class="num">').text(i / 2 + 1));
            [history[i], history[i + 1]].forEach((san, k) => {
                const ply = i + k + 1;
                const el = $('<span class="mv">').text(san || '');
                const an = analysis && analysis.plies[ply - 1];
                if (san && an && CLS[an.cls] && an.cls !== 'good') el.append($('<b class="bd">').addClass('c-' + an.cls).text(CLS[an.cls].sym));
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

    function buildPositions(history, startFen) {
        const g = makeGame(startFen);
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
        markCheck(p.fen);
        markAnalysis(i);
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

    // ───────────────────────── مبارياتي (المحفوظة في الحساب) ─────────────────────────
    socket.on('games', (list) => {
        const ul = $('#games-list').empty();
        $('#games-empty').text(tr('لا توجد مباريات محفوظة بعد. تُحفظ آخر 20 مباراة تلعبها وأنت مسجّل الدخول.')).toggleClass('hidden', !!list.length);
        list.forEach((g) => {
            const mine = g.c || 'w';
            const opp = tr(g.ai ? tr('الحاسوب') : (mine === 'w' ? g.b : g.w));
            const outcome = !g.res || !g.res.winner ? 'draw' : (g.res.winner === mine ? 'win' : 'loss');
            const res = tr(outcome === 'win' ? tr('فوز') : outcome === 'loss' ? tr('خسارة') : tr('تعادل'));
            const tone = outcome === 'draw' ? '' : outcome;
            const d = new Date(g.t);
            const info = [tcText(g.tc), tr('{n} حركة', { n: g.n }), d.toLocaleDateString(I18N.tag) + ' ' + d.toLocaleTimeString(I18N.tag, { hour: '2-digit', minute: '2-digit' })];
            if (g.v === '960') info.push(tr('فيشر 960'));
            if (g.an) info.push(tr('محلّلة'));
            ul.append($('<li>').append(
                $('<button type="button" class="game-row">').attr({ 'data-action': 'openGame', 'data-id': g.id }).append(
                    $('<span class="gr-res">').addClass(tone).text(res),
                    $('<span class="gr-main">').append($('<b>').text(tr('ضد {opp}', { opp })), $('<small class="muted">').text(info.join(' · ')))
                )
            ));
        });
    });
    socket.on('games_error', (m) => gtoast(m));
    socket.on('game_data', (g) => openArchive(g));

    // فتح مباراة محفوظة في شاشة اللعب بوضع المراجعة (للقراءة فقط)
    function openArchive(g) {
        spectating = true;
        gameMode = g.ai ? 'ai' : 'multi';
        myColor = g.c || 'w';
        flipped = false;
        $('#chat-box').empty();
        resetGameUi();
        const opp = myColor === 'w' ? 'b' : 'w';
        const nm = { w: g.w, b: g.b };
        oppName = tr(nm[opp] || tr('الخصم'));
        $('#opp-name').text(oppName);
        $('#my-name').text(tr(nm[myColor] || tr('أنت')));
        $('#chat-container').addClass('hidden');
        $('#resign-btn, #draw-btn, #abort-btn, #rematch-btn, #report-btn').addClass('hidden');
        show('game-screen');
        initBoard();
        positions = buildPositions(g.h || [], g.sf || null);
        const fen = positions[positions.length - 1].fen;
        state = {
            fen, startFen: g.sf || null, variant: g.v, gameId: g.id, turn: fen.split(' ')[1], check: false, lastMove: null,
            history: g.h || [], names: nm, ratings: {}, rated: !!g.rated, tc: g.tc, moveCount: (g.h || []).length,
            clocks: { w: 0, b: 0 }, running: false, over: true, result: g.res || { winner: null, reason: 'draw' },
            drawOffer: null, disc: {}, spectators: 0, rematch: {}, serverNow: Date.now()
        };
        serverOffset = 0;
        lastOver = true;
        firstState = false;
        pickGame(state.startFen);
        game.load(fen, state.cr);
        if (board) board.position(fen);
        reviewIndex = null;
        renderHistory(state.history);
        renderCaptured(positions.length - 1);
        updateGameButtons(state);
        updateStatus();
        renderClocks();
        $('#my-timer, #opponent-timer').text('--:--');
        if (g.an && Array.isArray(g.an.plies) && g.an.plies.length === state.history.length) {
            analysis = g.an;
            $('#analysis-box').removeClass('hidden');
            $('#analysis-bar').addClass('hidden');
            $('#analysis-status').text(tr('تحليل محفوظ لهذه المباراة. استعمل الأسهم أو اضغط على أي حركة.')).removeClass('err');
            renderAnalysisSummary(analysis);
            renderHistory(state.history, state.history.length);
            reviewTo(positions.length - 1);
        }
    }

    // ───────────────────────── تحليل المباراة ─────────────────────────
    function fmtEval(cp) {
        if (Math.abs(cp) >= 9000) return cp > 0 ? tr('كش مات للأبيض') : tr('كش مات للأسود');
        return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
    }
    function winPctJs(cp) {
        const c = Math.max(-1500, Math.min(1500, cp));
        return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
    }
    function evalAt(i) {
        if (!analysis) return null;
        if (i <= 0) return analysis.startCp == null ? 20 : analysis.startCp;
        const p = analysis.plies[i - 1];
        return p ? p.cp : null;
    }
    // شريط التقييم بجانب اللوحة (الأبيض فاتح، الأسود داكن)
    function setEvalBar(i) {
        const cp = evalAt(i);
        const bar = $('#eval-bar');
        const show = cp != null;
        const was = !bar.hasClass('hidden');
        bar.toggleClass('hidden', !show);
        if (show !== was && board) setTimeout(() => { if (board) board.resize(); }, 0);
        if (!show) return;
        bar.toggleClass('flip', (myColor === 'b') !== flipped);
        $('#eval-fill').css('height', winPctJs(cp).toFixed(1) + '%');
        $('#eval-text').text(Math.abs(cp) >= 9000 ? 'M' : (Math.abs(cp) / 100).toFixed(1)).attr('data-lead', cp >= 0 ? 'w' : 'b');
        bar.attr('title', tr('التقييم: {v}', { v: fmtEval(cp) }));
    }
    function markAnalysis(i) {
        $('#board .square-55d63').removeAttr('data-sym').removeAttr('data-cls');
        const note = $('#analysis-note').empty();
        $('#best-arrow').remove();
        setEvalBar(i);
        updateGraphMarker(i);
        if (!analysis || i < 1 || !positions[i]) return;
        const an = analysis.plies[i - 1];
        const c = an && CLS[an.cls];
        if (!c) return;
        $('#board .square-' + positions[i].to).attr({ 'data-sym': c.sym, 'data-cls': an.cls });
        const num = Math.ceil(i / 2) + (i % 2 ? '.' : '...');
        const line = $('<div>').append($('<b>').addClass('c-' + an.cls).text(num + ' ' + an.san + ' ' + c.sym), document.createTextNode(' ' + c.name));
        const extra = [tr('التقييم: {v}', { v: fmtEval(an.cp) })];
        if (an.best && (an.cls === 'inaccuracy' || an.cls === 'mistake' || an.cls === 'blunder')) extra.push(tr('الأفضل كان: {m}', { m: an.best }));
        note.append(line, $('<div class="muted small">').text(extra.join(' · ')));
        if (an.best && (an.cls === 'inaccuracy' || an.cls === 'mistake' || an.cls === 'blunder')) drawBestArrow(i, an.best);
    }
    function renderAnalysisSummary(res) {
        const nm = (state && state.names) || {};
        const rows = [['accuracy', tr('الدقة')]].concat(Object.keys(CLS).map((k) => [k, CLS[k].sym + ' ' + CLS[k].name]));
        const tbl = $('<table class="an-table">');
        tbl.append($('<tr>').append($('<th>'), $('<th>').text(tr(nm.w || tr('الأبيض'))), $('<th>').text(tr(nm.b || tr('الأسود')))));
        rows.forEach(([k, label]) => {
            let w;
            let b;
            if (k === 'accuracy') { w = res.accuracy.w == null ? '-' : res.accuracy.w + '%'; b = res.accuracy.b == null ? '-' : res.accuracy.b + '%'; }
            else { w = res.counts.w[k] || 0; b = res.counts.b[k] || 0; if (!w && !b) return; }
            tbl.append($('<tr>').append($('<td>').text(label).addClass(k === 'accuracy' ? '' : 'c-' + k), $('<td>').text(w), $('<td>').text(b)));
        });
        const box = $('#analysis-summary').empty().append(tbl);
        try { renderDeep(res, box); } catch (e) { /* التحليل الأعمق اختياري */ }
    }

    // ───────────────────────── تحليل أعمق: الرسم والحركات الحاسمة والمراحل والسهم ─────────────────────────
    const plyNum = (i) => Math.ceil(i / 2) + (i % 2 ? '.' : '...');
    const accFromLoss = (l) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, l)) - 3.1669));
    function phaseOf(i) {
        if (i <= 20) return 0;
        const bd = ((positions[i - 1] || {}).fen || '').split(' ')[0] || '';
        let minor = 0;
        let queen = 0;
        for (const ch of bd) { const c = ch.toLowerCase(); if (c === 'q') queen++; else if (c === 'r' || c === 'n' || c === 'b') minor++; }
        return (queen === 0 && minor <= 6) || queen + minor <= 4 ? 2 : 1;
    }
    function renderDeep(res, box) {
        const n = res.plies.length;
        if (!n) return;
        // رسم التقييم
        const pts = [];
        let prev = res.startCp == null ? 20 : res.startCp;
        for (let i = 0; i <= n; i++) {
            const cp = i === 0 ? prev : (res.plies[i - 1].cp == null ? prev : res.plies[i - 1].cp);
            prev = cp;
            pts.push([n ? (i / n) * 300 : 0, 80 * (1 - winPctJs(cp) / 100)]);
        }
        const line = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        const g = $('<div class="an-graph" role="img">').attr({ 'aria-label': tr('رسم التقييم'), title: tr('اضغط على الرسم للانتقال إلى الحركة') });
        g.html('<svg viewBox="0 0 300 80" preserveAspectRatio="none"><rect width="300" height="80" fill="#1b2438"/>'
            + '<polygon points="0,80 ' + line + ' 300,80" fill="#e9edf5"/>'
            + '<line x1="0" y1="40" x2="300" y2="40" stroke="#7a88a8" stroke-width=".6" stroke-dasharray="3 3"/>'
            + '<polyline points="' + line + '" fill="none" stroke="#7d93c4" stroke-width="1"/></svg>');
        const DOT = { blunder: '#ef4444', mistake: '#f97316', brilliant: '#22d3ee' };
        res.plies.forEach((p, k) => {
            if (!DOT[p.cls]) return;
            g.append($('<i class="an-dot">').css({ left: (pts[k + 1][0] / 3).toFixed(2) + '%', top: (pts[k + 1][1] / 0.8).toFixed(1) + '%', background: DOT[p.cls] }));
        });
        g.append($('<b id="an-mark">').css('left', '100%'));
        g.data('n', n);
        box.append($('<h4 class="an-h">').text(tr('رسم التقييم')), g,
            $('<div class="an-legend muted small">').append($('<span class="lg-b">').text(tr('خطأ فادح')), ' ', $('<span class="lg-m">').text(tr('خطأ')), ' ', $('<span class="lg-r">').text(tr('رائعة'))));

        // اللحظات الحاسمة
        const bad = [];
        const gems = [];
        res.plies.forEach((p, k) => {
            if (p.cls === 'blunder' || p.cls === 'mistake') bad.push([p, k + 1]);
            else if (p.cls === 'brilliant') gems.push([p, k + 1]);
        });
        bad.sort((x, y) => y[0].loss - x[0].loss);
        const mom = $('<div class="an-moments">');
        const addMoment = (pair, icon) => {
            const [p, i] = pair;
            const c = CLS[p.cls];
            const txt = icon + ' ' + plyNum(i) + ' ' + p.san + ' ' + c.sym + (p.best && icon !== '✨' ? ' · ' + tr('الأفضل كان: {m}', { m: p.best }) : '') + (icon !== '✨' ? ' (−' + Math.round(p.loss) + '%)' : '');
            mom.append($('<button type="button" class="an-moment">').addClass('c-' + p.cls).attr({ 'data-action': 'reviewPly', 'data-ply': i }).text(txt));
        };
        box.append($('<h4 class="an-h">').text(tr('اللحظات الحاسمة')));
        if (!bad.length && !gems.length) mom.append($('<p class="muted small">').text(tr('لا أخطاء كبيرة في هذه المباراة.')));
        bad.slice(0, 4).forEach((x) => addMoment(x, '⚠'));
        gems.slice(0, 2).forEach((x) => addMoment(x, '✨'));
        box.append(mom);

        // مراحل المباراة ومتوسط الخسارة
        const ph = [[[], []], [[], []], [[], []]];
        const all = [[], []];
        res.plies.forEach((p, k) => { const ci = p.color === 'w' ? 0 : 1; ph[phaseOf(k + 1)][ci].push(p.loss || 0); all[ci].push(p.loss || 0); });
        const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
        const accTxt = (arr) => (arr.length ? Math.round(mean(arr.map(accFromLoss))) + '%' : '-');
        const t2 = $('<table class="an-table">');
        const nm = (state && state.names) || {};
        t2.append($('<tr>').append($('<th>').text(tr('المرحلة')), $('<th>').text(tr(nm.w || tr('الأبيض'))), $('<th>').text(tr(nm.b || tr('الأسود')))));
        [tr('الافتتاح'), tr('الوسط'), tr('النهاية')].forEach((label, k) => {
            if (!ph[k][0].length && !ph[k][1].length) return;
            t2.append($('<tr>').append($('<td>').text(label), $('<td>').text(accTxt(ph[k][0])), $('<td>').text(accTxt(ph[k][1]))));
        });
        t2.append($('<tr>').append($('<td>').text(tr('متوسط الخسارة لكل حركة')), $('<td>').text(all[0].length ? mean(all[0]).toFixed(1) + '%' : '-'), $('<td>').text(all[1].length ? mean(all[1]).toFixed(1) + '%' : '-')));
        box.append($('<h4 class="an-h">').text(tr('الدقة حسب المرحلة')), t2);
    }
    function updateGraphMarker(i) {
        const g = $('.an-graph');
        const n = g.data('n');
        if (!g.length || !n) return;
        $('#an-mark').css('left', ((Math.max(0, Math.min(n, i)) / n) * 100).toFixed(2) + '%');
    }
    $(document).on('click', '.an-graph', function (e) {
        const n = $(this).data('n');
        if (!n || !state || !state.over) return;
        const r = this.getBoundingClientRect();
        const x = (e.clientX - r.left) / Math.max(1, r.width);
        reviewTo(Math.round(Math.max(0, Math.min(1, x)) * n));
    });
    // سهم أفضل حركة فوق اللوحة
    function drawBestArrow(i, bestSan) {
        try {
            const g = new Chess(positions[i - 1].fen);
            const mv = g.move(bestSan);
            const bEl = document.getElementById('board');
            if (!mv || !bEl) return;
            const sa = bEl.querySelector('.square-' + mv.from);
            const sb = bEl.querySelector('.square-' + mv.to);
            if (!sa || !sb) return;
            const r = bEl.getBoundingClientRect();
            const c = (el) => { const q = el.getBoundingClientRect(); return [q.left - r.left + q.width / 2, q.top - r.top + q.height / 2, q.width]; };
            const [x1, y1, sz] = c(sa);
            const [x2, y2] = c(sb);
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const head = sz * 0.42;
            const w = sz * 0.13;
            const ex = x2 - ux * head * 0.6;
            const ey = y2 - uy * head * 0.6;
            const sx = x1 + ux * sz * 0.25;
            const sy = y1 + uy * sz * 0.25;
            const px = -uy;
            const py = ux;
            const poly = [[sx + px * w, sy + py * w], [ex + px * w, ey + py * w], [ex + px * head * 0.55, ey + py * head * 0.55], [x2, y2], [ex - px * head * 0.55, ey - py * head * 0.55], [ex - px * w, ey - py * w], [sx - px * w, sy - py * w]]
                .map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
            const svg = '<svg id="best-arrow" xmlns="http://www.w3.org/2000/svg" width="' + r.width + '" height="' + r.height + '" viewBox="0 0 ' + r.width + ' ' + r.height + '"><polygon points="' + poly + '" fill="#22c55e" fill-opacity=".82" stroke="#0b3d1c" stroke-width="1"/></svg>';
            $(bEl).append(svg);
        } catch (e) { /* ignore */ }
    }
    function setAnalysisProgress(done, total, label) {
        if (!analyzing) return;
        $('#analysis-fill').css('width', Math.max(3, Math.round((done / total) * 100)) + '%');
        $('#analysis-status').text(tr(label) + ' ' + done + ' / ' + total);
    }
    socket.on('analysis_progress', (d) => setAnalysisProgress(d.done, d.total, tr('جارٍ التحليل على الخادم...')));

    // تقييم المراكز بمحرك Stockfish يعمل داخل المتصفح (Web Worker). يعيد null إن لم يتوفر فنرجع للخادم.
    function browserEvals(fens, onProgress) {
        return new Promise((resolve) => {
            let finished = false;
            const workers = [];
            let guard = null;
            const finish = (v) => {
                if (finished) return;
                finished = true;
                clearTimeout(guard);
                workers.forEach((w) => { try { w.terminate(); } catch (e) { /* ignore */ } });
                resolve(v);
            };
            if (typeof Worker === 'undefined') return finish(null);
            guard = setTimeout(() => finish(null), 150000);
            $.getJSON('/vendor/stockfish/manifest.json').done((m) => {
                if (!m || !m.file) return finish(null);
                const url = '/vendor/stockfish/' + m.file.split('/').map(encodeURIComponent).join('/');
                const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
                const results = new Array(fens.length).fill(null);
                let next = 0;
                let done = 0;
                const start = () => {
                    let w;
                    try { w = new Worker(url); } catch (e) { return finish(null); }
                    workers.push(w);
                    let phase = 'init';
                    let job = -1;
                    let score = null;
                    let score2 = null;
                    let best = null;
                    const send = (s) => w.postMessage(s);
                    const initTimer = setTimeout(() => { if (phase === 'init') finish(null); }, 25000);
                    const nextJob = () => {
                        if (next >= fens.length) return;
                        job = next++;
                        score = null;
                        score2 = null;
                        best = null;
                        send('position fen ' + fens[job]);
                        send('go depth 14 movetime 1500');
                    };
                    w.onerror = () => finish(null);
                    w.onmessage = (ev) => {
                        const line = typeof ev.data === 'string' ? ev.data : '';
                        if (phase === 'init') {
                            if (line.indexOf('uciok') === 0) { send('setoption name Hash value 16'); send('setoption name MultiPV value 2'); send('isready'); }
                            else if (line.indexOf('readyok') === 0) { phase = 'run'; clearTimeout(initTimer); nextJob(); }
                            return;
                        }
                        if (line.indexOf('info') === 0 && line.indexOf(' score ') > 0 && line.indexOf('bound') < 0) {
                            const s = /score (cp|mate) (-?\d+)/.exec(line);
                            const mp = /multipv (\d+)/.exec(line);
                            const sc = s ? (s[1] === 'cp' ? Number(s[2]) : (Number(s[2]) > 0 ? 10000 : -10000)) : null;
                            if (sc !== null) { if (mp && mp[1] === '2') score2 = sc; else score = sc; }
                            const pv = / pv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
                            if (pv && !(mp && mp[1] === '2')) best = pv[1];
                        } else if (line.indexOf('bestmove') === 0) {
                            const bm = /^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
                            const mv = bm ? bm[1] : best;
                            const white = fens[job].split(' ')[1] === 'w';
                            const cp = score == null ? 0 : (white ? score : -score);
                            const alt = score2 == null ? null : Math.max(-10000, Math.min(10000, white ? score2 : -score2));
                            results[job] = { cp: Math.max(-10000, Math.min(10000, cp)), best: mv || null, alt };
                            done++;
                            onProgress(done, fens.length);
                            if (done >= fens.length) finish(results); else nextJob();
                        }
                    };
                    send('uci');
                };
                for (let k = 0; k < n; k++) start();
            }).fail(() => finish(null));
        });
    }
    socket.on('analysis_result', (res) => {
        analyzing = false;
        analysis = res;
        $('#analyze-btn').prop('disabled', false);
        $('#analysis-bar').addClass('hidden');
        $('#analysis-status').text(res.source === 'local'
            ? tr('تحليل مبسّط: محرك Stockfish غير متاح الآن، لذا النتائج أقل دقة.')
            : tr('انتهى التحليل. اضغط على أي حركة أو استعمل الأسهم لرؤية تقييمها.')).removeClass('err');
        renderAnalysisSummary(res);
        if (state) renderHistory(state.history || [], state.history ? state.history.length : 0);
        reviewTo(positions.length - 1);
    });
    socket.on('analysis_error', (msg) => {
        analyzing = false;
        $('#analyze-btn').prop('disabled', false);
        $('#analysis-bar').addClass('hidden');
        $('#analysis-status').text(msg).addClass('err');
    });

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
            $('#disc-text').text(tr('انقطع اتصال {name}. سيخسر إن لم يعد خلال {n} ثانية.', { name: oppName, n: left })).removeClass('hidden');
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
            if (!r.winner) text = tr('تعادل: {reason}', { reason });
            else if (spectating) text = tr(r.winner === 'w' ? tr('فاز الأبيض ({reason})') : tr('فاز الأسود ({reason})'), { reason });
            else if (r.winner === myColor) { text = tr('فزت بالمباراة ({reason})', { reason }); tone = 'win'; }
            else { text = tr('خسرت المباراة ({reason})', { reason }); tone = 'loss'; }
        } else if (spectating) {
            text = tr(state.check
                ? (state.turn === 'w' ? tr('كش! الدور على الأبيض') : tr('كش! الدور على الأسود'))
                : (state.turn === 'w' ? tr('الدور على الأبيض') : tr('الدور على الأسود')));
        } else if (state.check) {
            text = state.turn === myColor ? tr('كش على ملكك') : tr('كش على ملك الخصم');
            tone = 'check';
        } else if (!state.running) {
            text = state.turn === myColor ? tr('دورك. تبدأ الساعة بعد أول حركتين.') : tr('دور الخصم');
            if (state.turn === myColor) tone = 'mine';
        } else {
            text = state.turn === myColor ? tr('دورك') : tr('دور الخصم');
            if (state.turn === myColor) tone = 'mine';
        }
        $('#status-text').text(text);
        $('#status-card').attr('data-tone', tone);

        let meta = gameMode === 'ai' ? tr('ضد الحاسوب') : (state.rated ? tr('مباراة مصنَّفة') : tr('مباراة ودّية'));
        if (state.variant === '960') meta += tr(' · شطرنج فيشر 960');
        meta += ' · ' + tcText(state.tc);
        if (state.spectators) meta += ' · ' + tr('{n} مشاهد', { n: state.spectators });
        $('#game-meta').text(meta);
    }

    function showResult() {
        if (!state || !state.over || spectating) return;
        const r = state.result;
        let title, tone;
        if (!r.winner) { title = r.reason === 'aborted' ? tr('أُلغيت المباراة') : tr('انتهت بالتعادل'); tone = 'draw'; }
        else if (r.winner === myColor) { title = tr('فزت بالمباراة'); tone = 'win'; }
        else { title = tr('خسرت المباراة'); tone = 'loss'; }
        $('#result-title').text(title).attr('data-tone', tone);
        $('#result-reason').text(REASONS[r.reason] || '');
        const dl = $('#result-delta').addClass('hidden').removeClass('pos neg');
        if (r.delta && r.newRatings) {
            const d = r.delta[myColor];
            const cat = catOf(state.tc);
            ratings[cat] = r.newRatings[myColor];
            renderRatings();
            dl.text(tr('التصنيف {r} ({d})', { r: r.newRatings[myColor], d: (d >= 0 ? '+' : '') + d })).addClass(d >= 0 ? 'pos' : 'neg').removeClass('hidden');
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
        $('#status-text').text(tr('اللعبة جارية...'));
        $('#status-card').attr('data-tone', '');
        $('#my-timer, #opponent-timer').removeClass('active low').text('--:--');
        $('#my-dot').attr('class', 'dot ' + myColor);
        $('#opp-dot').attr('class', 'dot ' + (myColor === 'w' ? 'b' : 'w'));
        $('#game-screen').removeClass('reviewable');
        $('#review-bar, #pgn-btn, #rematch-btn, #abort-btn').addClass('hidden');
        $('#result-rematch').removeClass('hidden');
        $('#result-rematch, #rematch-btn').prop('disabled', false).text(tr('العب مجددًا'));
        $('#rematch-note').text('');
        $('#draw-banner').addClass('hidden');
        $('#draw-btn').prop('disabled', false).text(tr('اقترح تعادلًا'));
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
        oppName = gameMode === 'ai' ? tr('الحاسوب') : tr('الخصم');
        $('#opp-name').text(oppName);
        $('#my-name').text(tr('أنت'));
        $('#chat-container').toggleClass('hidden', gameMode !== 'multi');
        $('#draw-btn').toggleClass('hidden', gameMode !== 'multi');
        $('#report-btn').toggleClass('hidden', gameMode !== 'multi');
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
        oppName = tr('الأسود');
        $('#opp-name').text(tr('الأسود'));
        $('#my-name').text(tr('الأبيض'));
        $('#chat-container').addClass('hidden');
        $('#resign-btn, #draw-btn, #abort-btn, #rematch-btn, #report-btn').addClass('hidden');
        show('game-screen');
        initBoard();
    });

    socket.on('state', (s) => {
        if (!s || !s.fen) return;
        state = s;
        clearSelection();
        serverOffset = s.serverNow - Date.now();
        pickGame(s.startFen);
        game.load(s.fen, s.cr);
        if (board) board.position(s.fen);
        highlightLastMove(s.lastMove);
        markCheck(s.fen);

        const nm = s.names || {};
        const opp = myColor === 'w' ? 'b' : 'w';
        oppName = tr(nm[opp] || (spectating ? (opp === 'b' ? tr('الأسود') : tr('الأبيض')) : (gameMode === 'ai' ? tr('الحاسوب') : tr('الخصم'))));
        $('#opp-name').text(oppName);
        $('#my-name').text(tr(nm[myColor] || (spectating ? tr('الأبيض') : tr('أنت'))));
        if (gameMode === 'multi' && s.ratings) {
            $('#my-rating').text(s.ratings[myColor] ? '(' + s.ratings[myColor] + ')' : '');
            $('#opp-rating').text(s.ratings[opp] ? '(' + s.ratings[opp] + ')' : '');
        }

        positions = buildPositions(s.history || [], s.startFen);
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
                else playSound(s.lastMove ? moveSound(s.lastMove.san, s.lastMove.captured) : 'move');
            }
            lastSoundCount = s.moveCount;
            if (s.over && !lastOver) {
                setTimeout(() => {
                    const w = s.result && s.result.winner;
                    playSound(!w ? 'draw' : spectating || w === myColor ? 'win' : 'lose');
                }, 350);
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
        $('#review-bar, #pgn-btn, #analyze-btn').toggleClass('hidden', !s.over);
        if (spectating) {
            $('#resign-btn, #abort-btn, #draw-btn, #rematch-btn').addClass('hidden');
            $('#report-btn').toggleClass('hidden', gameMode !== 'multi');
            return;
        }
        const canAbort = gameMode === 'multi' && !s.over && s.moveCount < 2;
        $('#abort-btn').toggleClass('hidden', !canAbort);
        $('#resign-btn').toggleClass('hidden', !!s.over || canAbort);
        $('#draw-btn').toggleClass('hidden', !!s.over || gameMode !== 'multi');

        // اقتراح التعادل (الحالة من السيرفر، فتصح بعد إعادة الاتصال أيضًا)
        const iOffered = s.drawOffer === myColor;
        $('#draw-btn').prop('disabled', iOffered).text(iOffered ? tr('تم إرسال الاقتراح') : tr('اقترح تعادلًا'));
        $('#draw-banner').toggleClass('hidden', !(s.drawOffer && s.drawOffer !== myColor && !s.over));

        const gone = oppLeft || (gameMode === 'multi' && s.result && s.result.reason === 'abandoned');
        $('#rematch-btn, #result-rematch').toggleClass('hidden', !s.over || !!gone);
        if (s.over && gone) $('#rematch-note').text(tr('غادر الخصم المباراة.'));
        if (s.over && s.rematch && gameMode === 'multi') {
            const opp = myColor === 'w' ? 'b' : 'w';
            if (s.rematch[myColor]) {
                rematchSent = true;
                $('#result-rematch, #rematch-btn').prop('disabled', true).text(tr('بانتظار الخصم...'));
            } else if (s.rematch[opp]) {
                $('#rematch-note').text(tr('{name} يريد إعادة المباراة.', { name: oppName }));
                $('#result-rematch, #rematch-btn').text(tr('قبول الإعادة'));
            }
        }
    }

    // ───────────────────────── أحداث اللعب ─────────────────────────
    socket.on('notice', (msg) => $('#notice-text').text(msg));
    socket.on('toast', (msg) => flash(msg));
    socket.on('draw_offered', () => { $('#draw-banner').removeClass('hidden'); playSound('notify'); });
    socket.on('draw_cleared', () => $('#draw-banner').addClass('hidden'));
    socket.on('draw_declined', () => flash(tr('رفض الخصم اقتراح التعادل.')));
    socket.on('draw_sent', () => $('#draw-btn').prop('disabled', true).text(tr('تم إرسال الاقتراح')));
    socket.on('opp_reconnected', () => flash(tr('عاد الخصم إلى المباراة.')));
    socket.on('rematch_offered', () => {
        if (rematchSent) return;
        $('#rematch-note').text(tr('{name} يريد إعادة المباراة.', { name: oppName }));
        $('#result-rematch, #rematch-btn').text(tr('قبول الإعادة'));
        flash(tr('{name} يريد إعادة المباراة.', { name: oppName }));
    });
    socket.on('opponent_left', () => {
        oppLeft = true;
        if (state && state.over) {
            $('#rematch-btn, #result-rematch').addClass('hidden');
            $('#rematch-note').text(tr('غادر الخصم المباراة.'));
        }
    });

    // ───────────────────────── الدردشة (text() لمنع XSS) ─────────────────────────
    function appendChat(who, msg) {
        $('<div>').text(who + ': ' + msg).appendTo('#chat-box');
        const box = document.getElementById('chat-box');
        box.scrollTop = box.scrollHeight;
    }
    let chatMuted = false;
    socket.on('chat', (d) => chatMuted || appendChat(oppName, d && d.message ? d.message : ''));

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
        if (state.startFen) g.header('Variant', 'Chess960', 'SetUp', '1', 'FEN', state.startFen);
        g.header('Event', 'Online game', 'Site', location.host, 'Date',
            d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()),
            'White', nm.w || 'Player', 'Black', nm.b || 'Player', 'Result', res,
            'TimeControl', t ? (t.base + (t.inc ? '+' + t.inc : '')) : '-');
        let pgnText;
        if (state.startFen) {
            const tags = [['Event', 'Online game'], ['Site', location.host], ['Date', d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate())],
                ['White', nm.w || 'Player'], ['Black', nm.b || 'Player'], ['Result', res], ['Variant', 'Chess960'], ['SetUp', '1'], ['FEN', state.startFen]];
            const moves = (state.history || []).map((san, i) => (i % 2 === 0 ? (i / 2 + 1) + '. ' : '') + san).join(' ');
            pgnText = tags.map((t) => '[' + t[0] + ' "' + String(t[1]).replace(/"/g, "'") + '"]').join('\n') + '\n\n' + moves + ' ' + res;
        } else {
            (state.history || []).forEach((san) => g.move(san));
            pgnText = g.pgn();
        }
        const blob = new Blob([pgnText + '\n'], { type: 'application/x-chess-pgn' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chess-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.pgn';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }



    // ───────────────────────── دعم المطوّر (يُضبط من الملف support.json) ─────────────────────────
    function loadSupport() {
        $.getJSON('/support.json').done((d) => {
            const links = (d && Array.isArray(d.links) ? d.links : [])
                .filter((l) => l && l.label && typeof l.url === 'string' && /^https:\/\//i.test(l.url)).slice(0, 4);
            if (!links.length) return;
            $('#support-msg').text(String((d && d.message) || '').slice(0, 300));
            const box = $('#support-links').empty();
            links.forEach((l) => box.append(
                $('<a class="btn secondary" target="_blank" rel="noopener noreferrer">').attr('href', l.url).text(String(l.label).slice(0, 40))
            ));
            $('#support-card').removeClass('hidden');
        });
    }
    loadSupport();

    // ───────────────────────── الحساب والأصدقاء ─────────────────────────
    function gtoast(text) {
        $('#global-toast').text(text).removeClass('hidden');
        clearTimeout(gtoastTimer);
        gtoastTimer = setTimeout(() => $('#global-toast').addClass('hidden'), 4500);
    }

    function renderAccount() {
        const logged = !!account;
        $('#acc-info').text(logged ? tr('مرحبًا، {name}', { name: account }) : tr('أنت تلعب كضيف'));
        $('#acc-login').toggleClass('hidden', logged);
        $('#acc-friends, #acc-games, #acc-logout').toggleClass('hidden', !logged);
        const nameInput = $('#player-name');
        if (logged) nameInput.val(account).prop('disabled', true);
        else {
            nameInput.prop('disabled', false);
            if (nameInput.val() === '' || nameInput.data('wasAccount')) nameInput.val(lsGet('chess-name') || '');
        }
        nameInput.data('wasAccount', logged);
        if (!logged) { friendsData = { friends: [], incoming: [], outgoing: [] }; renderFriends(); }
    }

    function setAuthMode(mode) {
        authMode = mode;
        $('#auth-tabs button').each(function () { $(this).attr('aria-pressed', String($(this).data('mode') === mode)); });
        $('#auth-submit').text(mode === 'login' ? tr('دخول') : tr('إنشاء الحساب'));
        $('#auth-pass').attr('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
        $('#auth-hint').toggleClass('hidden', mode === 'login');
        $('#auth-note').toggleClass('hidden', mode === 'login');
        $('#auth-error').text('');
    }
    function authSubmit() {
        const username = $('#auth-user').val().trim();
        const password = $('#auth-pass').val();
        if (!username || !password) return $('#auth-error').text(tr('أدخل اسم المستخدم وكلمة المرور.'));
        $('#auth-error').text('');
        socket.emit(authMode, { username, password });
    }
    $('#auth-pass, #auth-user').on('keydown', (e) => { if (e.key === 'Enter') authSubmit(); });
    $('#friend-input').on('keydown', (e) => { if (e.key === 'Enter') A.friendAdd(); });
    setAuthMode('login');

    socket.on('auth_error', (msg) => $('#auth-error').text(msg));
    socket.on('auth_ok', () => {
        $('#auth-pass').val('');
        $('#auth-error').text('');
        show('menu-screen');
        gtoast(authMode === 'register' ? tr('تم إنشاء حسابك. أهلًا بك!') : tr('تم تسجيل الدخول.'));
    });
    socket.on('logged_out', () => { show('menu-screen'); gtoast(tr('تم تسجيل الخروج.')); });

    const STATUS_TEXT = { online: tr('متصل'), playing: tr('يلعب الآن'), searching: tr('يبحث عن خصم'), offline: tr('غير متصل') };

    function renderFriends() {
        const d = friendsData;
        const inc = $('#fr-in').empty();
        $('#fr-in-box').toggleClass('hidden', !d.incoming.length);
        d.incoming.forEach((u) => {
            inc.append($('<li>').append(
                $('<span class="nm">').text(u),
                $('<button class="btn primary">').text(tr('قبول')).attr({ 'data-action': 'friendRespond', 'data-user': u, 'data-accept': '1' }),
                $('<button class="btn ghost">').text(tr('رفض')).attr({ 'data-action': 'friendRespond', 'data-user': u, 'data-accept': '0' })
            ));
        });
        const list = $('#fr-list').empty();
        if (!d.friends.length) list.append($('<li class="empty">').text(tr('لا يوجد أصدقاء بعد. أضف صديقًا باسم المستخدم.')));
        const order = { online: 0, searching: 1, playing: 2, offline: 3 };
        d.friends.slice().sort((a, b) => order[a.status] - order[b.status] || a.username.localeCompare(b.username)).forEach((f) => {
            const li = $('<li>').append(
                $('<span class="sdot">').addClass(f.status),
                $('<span class="nm">').text(f.username),
                $('<span class="st">').text(STATUS_TEXT[f.status] || ''),
                $('<span class="rt">').text(f.rating)
            );
            if (f.watch) li.append($('<button class="btn secondary">').text(tr('شاهد')).attr({ 'data-action': 'watchGame', 'data-id': f.watch }));
            if (f.status === 'online' || f.status === 'searching') {
                li.append($('<button class="btn secondary">').text(tr('دعوة')).attr({ 'data-action': 'friendInvite', 'data-user': f.username }));
            }
            li.append($('<button class="btn ghost">').text(tr('إزالة')).attr({ 'data-action': 'friendRemove', 'data-user': f.username }));
            list.append(li);
        });
        const out = $('#fr-out').empty();
        $('#fr-out-box').toggleClass('hidden', !d.outgoing.length);
        d.outgoing.forEach((u) => out.append($('<li>').append($('<span class="nm">').text(u), $('<span class="st">').text(tr('بانتظار الرد')))));
        const n = d.incoming.length;
        $('#friends-badge').text(n).toggleClass('hidden', !n);
    }
    socket.on('friends', (d) => { friendsData = d; renderFriends(); });
    // ───────────────────────── الأندية ─────────────────────────
    function clubChatLine(m) {
        return $('<div>').append($('<b>').text(m.u), document.createTextNode(': ' + m.t));
    }
    function renderClubList(list) {
        const ul = $('#club-list').empty();
        if (!list.length) ul.append($('<li class="empty">').text(tr('لا توجد أندية مطابقة. كن أول من ينشئ نادٍ!')));
        list.forEach((c) => {
            ul.append($('<li>').append(
                $('<span class="nm">').text(c.name),
                $('<span class="st">').text(tr('{n} عضو', { n: c.count })),
                $('<span class="rt">').text(c.score),
                $('<button class="btn secondary">').text(tr('انضم')).attr({ 'data-action': 'clubJoin', 'data-id': c.id })
            ));
        });
    }
    function renderClub(d) {
        clubData = d.club;
        $('#club-msg').text('');
        if (!d.club) {
            $('#club-mine').addClass('hidden');
            $('#club-none').removeClass('hidden');
            $('#club-title').text(tr('الأندية'));
            renderClubList(d.list || []);
            return;
        }
        const c = d.club;
        $('#club-none').addClass('hidden');
        $('#club-mine').removeClass('hidden');
        $('#club-title').text('🛡 ' + c.name);
        $('#club-desc').text(c.desc || '').toggleClass('hidden', !c.desc);
        $('#club-meta').text(tr('{n} من {m} عضو · تصنيف النادي {s}', { n: c.count, m: c.max, s: c.score }));
        const ul = $('#club-members').empty();
        c.members.forEach((m) => {
            const li = $('<li>').append(
                $('<span class="sdot">').addClass(m.status),
                $('<span class="nm">').text((m.owner ? '👑 ' : '') + m.username + (m.username === account ? ' (' + tr('أنت') + ')' : '')),
                $('<span class="st">').text(STATUS_TEXT[m.status] || ''),
                $('<span class="rt">').text(m.rating)
            );
            if (m.username !== account && (m.status === 'online' || m.status === 'searching')) {
                li.append($('<button class="btn secondary">').text(tr('تحدَّ')).attr({ 'data-action': 'clubChallenge', 'data-user': m.username }));
            }
            if (c.isOwner && m.username !== account) {
                li.append($('<button class="btn ghost">').text(tr('إخراج')).attr({ 'data-action': 'clubKick', 'data-user': m.username }));
            }
            ul.append(li);
        });
        const box = $('#club-chat');
        const atEnd = box[0].scrollHeight - box.scrollTop() - box.innerHeight() < 40;
        box.empty();
        if (!c.chat.length) box.append($('<div class="muted">').text(tr('لا رسائل بعد. ابدأ المحادثة!')));
        c.chat.forEach((m) => box.append(clubChatLine(m)));
        if (atEnd || !box.data('seen')) box.scrollTop(box[0].scrollHeight);
        box.data('seen', true);
    }
    socket.on('club', renderClub);
    socket.on('club_list', renderClubList);
    socket.on('club_error', (m) => $('#club-msg').text(m).removeClass('good').addClass('err'));
    socket.on('club_chat', (m) => {
        if (!clubData) return;
        clubData.chat.push(m);
        const box = $('#club-chat');
        if (box.find('.muted').length) box.empty();
        box.append(clubChatLine(m));
        box.scrollTop(box[0].scrollHeight);
    });
    $('#club-search').on('input', function () {
        const q = $(this).val().trim();
        clearTimeout(clubSearchTimer);
        clubSearchTimer = setTimeout(() => socket.emit('club_list', { q }), 250);
    });
    $('#club-input').on('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); A.clubSend(); } });

    socket.on('live_list', (list) => {
        const ul = $('#live-list').empty();
        $('#live-empty').text(tr('لا توجد مباريات مباشرة الآن. جرّب بعد قليل.')).toggleClass('hidden', !!list.length);
        list.forEach((g) => {
            const side = (p, c) => $('<span class="lv-p">').append($('<i class="dot ' + c + '">'), document.createTextNode(' ' + p.name + (p.r ? ' (' + p.r + ')' : '')));
            const meta = [tcText(g.tc), tr('{n} حركة', { n: g.n }), '👁 ' + g.sp];
            if (g.v === '960') meta.push(tr('فيشر 960'));
            ul.append($('<li>').append(
                $('<button type="button" class="game-row">').attr({ 'data-action': 'watchGame', 'data-id': g.id }).append(
                    $('<span class="gr-res">').addClass(g.fr ? 'win' : '').text(g.fr ? tr('صديق') : (g.rated ? tr('مصنَّفة') : tr('ودّية'))),
                    $('<span class="gr-main">').append($('<b>').append(side(g.w, 'w'), document.createTextNode(' ⚔ '), side(g.b, 'b')), $('<small class="muted">').text(meta.join(' · ')))
                )
            ));
        });
    });
    socket.on('friend_error', (m) => $('#fr-msg').text(m).removeClass('good').addClass('err'));
    socket.on('friend_ok', (m) => $('#fr-msg').text(m).removeClass('err').addClass('good'));
    socket.on('notify', (d) => gtoast(d.text));
    socket.on('invite', (d) => {
        if (currentScreen === 'game-screen' && state && !state.over) {
            gtoast(tr('دعوة من {name} (أنت في مباراة الآن)', { name: d.from }));
            socket.emit('invite_decline', { username: d.from });
            return;
        }
        pendingInvite = d;
        $('#invite-text').text(tr(d.variant === '960' ? tr('{name} يدعوك إلى مباراة ودّية ({tc}) بشطرنج فيشر 960') : tr('{name} يدعوك إلى مباراة ودّية ({tc})'), { name: d.from, tc: tcText(d.tc) }));
        $('#invite-dialog').removeClass('hidden');
        playSound('notify');
    });

    // ───────────────────────── الألغاز (تعمل في المتصفح بلا سيرفر) ─────────────────────────
    // f = وضعية البداية، n = كش مات في n حركات، s = الحركة الأولى الصحيحة، r = ردّ الخصم (للغز الحركتين)
    const PUZZLES = [
        {id:1,n:1,d:800,f:"1r2kbnr/p3pp1p/8/1ppBN3/6QN/2PP4/PP3P2/R1B1K2R w - - 0 1",s:"g4d7",r:""},
        {id:2,n:1,d:812,f:"r3kbnr/pp1n1p1p/8/1Bp3p1/4P1Q1/1q5P/P2P1P1P/RN2K1NR w - - 0 1",s:"g4d7",r:""},
        {id:3,n:1,d:824,f:"rnb2qn1/1p1p4/p1k1p3/2pN1p2/P1P2Q1p/R2P1K1P/1P2P1P1/5BNR w - - 0 1",s:"f4c7",r:""},
        {id:4,n:1,d:836,f:"r1b1kb1r/1p4p1/4p3/p2pK2p/P1p2N1q/5PP1/RPPB3P/1N1Q1B1R b - - 0 1",s:"h4f6",r:""},
        {id:5,n:1,d:848,f:"5NQ1/4p3/1P1k4/3pb3/3P4/8/2P2P1R/1N2K1N1 w - - 0 1",s:"g8e6",r:""},
        {id:6,n:1,d:860,f:"1n3bnr/1p2Qpkp/r1p4p/8/1p1p4/3P3P/P1P2K1P/RN3B1R w - - 0 1",s:"h1g1",r:""},
        {id:7,n:1,d:872,f:"r3kb1Q/3p3p/bppp2p1/8/8/3Pq3/P1P5/3K3n b - - 0 1",s:"h1f2",r:""},
        {id:8,n:1,d:884,f:"1nb1k3/1ppp4/4p1p1/5p1r/5N2/2PP2q1/RP2P1P1/1N1Q1BK1 b - - 0 1",s:"g3e3",r:""},
        {id:9,n:1,d:896,f:"r1bq1bnr/ppp1p2p/2B3Q1/3p2p1/6k1/2N4N/PPPP1PPP/R1B1K2R w - - 0 1",s:"g6g5",r:""},
        {id:10,n:1,d:908,f:"6n1/5p2/1p1b3p/2p2p2/2P1pk1P/2Q5/P2P1K2/5R2 w - - 0 1",s:"c3g3",r:""},
        {id:11,n:1,d:920,f:"1n2kbn1/p3ppp1/p7/8/1P6/5q2/P1P5/R5Kb b - - 0 1",s:"f3g2",r:""},
        {id:12,n:1,d:932,f:"6k1/3ppr1p/2p3p1/P1P2P2/5P2/P2P4/4P2P/1qB1KBb1 b - - 0 1",s:"b1c1",r:""},
        {id:13,n:1,d:944,f:"6k1/3ppr1p/2p5/P1P2p2/P4P2/3P4/4P2P/1qB1KBb1 b - - 0 1",s:"b1c1",r:""},
        {id:14,n:1,d:956,f:"2r5/1Bpk1p2/5Bp1/4p2p/1p6/3P3b/P2K1PPP/R1QR4 w - - 0 1",s:"c1c6",r:""},
        {id:15,n:1,d:968,f:"rnb1kbnr/p3pppp/3p4/8/1PQ5/P3P3/3P1PPP/RNB1K1NR w - - 0 1",s:"c4c8",r:""},
        {id:16,n:1,d:980,f:"rnb1kb1r/3p1ppp/p1p5/4p3/P3Pq2/8/RPPP2Pn/1NBQK1NR b - - 0 1",s:"f4f1",r:""},
        {id:17,n:1,d:992,f:"r5r1/p3p1bp/1pp4k/1R6/5N2/2PK4/PP6/R1B5 w - - 0 1",s:"b5h5",r:""},
        {id:18,n:1,d:1004,f:"5kn1/5p2/p5r1/2p4K/3r4/P6P/2P1P3/6Nb b - - 0 1",s:"g8f6",r:""},
        {id:19,n:1,d:1016,f:"6r1/p3n3/7p/3pk3/7P/5r2/P1PP4/7K b - - 0 1",s:"f3h3",r:""},
        {id:20,n:1,d:1028,f:"3k2nr/1K5p/5np1/5Q2/5p1P/BPP2N2/3P2PR/8 w - - 0 1",s:"f5c8",r:""},
        {id:21,n:1,d:1040,f:"4k1r1/R3p2p/2p2p2/6p1/1QP3b1/4PP2/1PP5/2B1KBN1 w - - 0 1",s:"b4e7",r:""},
        {id:22,n:1,d:1052,f:"4k1r1/2R4p/2p2p2/6p1/1QP3b1/4PP2/1PP5/2B1KBN1 w - - 0 1",s:"b4e7",r:""},
        {id:23,n:1,d:1064,f:"r2q1bnr/p3p3/np4p1/3p1P1k/3pP3/5K2/PPP4P/1RBQ1BNR w - - 0 1",s:"f3g3",r:""},
        {id:24,n:1,d:1076,f:"4k1r1/2pb3p/p3B2n/2P5/P1P1pP1P/2N5/1r5R/3K4 b - - 0 1",s:"g8g1",r:""},
        {id:25,n:1,d:1088,f:"N1b1kbr1/p3pppp/p7/7n/1P6/4K2P/P1P2PP1/1RBQ2NR w - - 0 1",s:"a8c7",r:""},
        {id:26,n:2,d:1250,f:"rn4nr/7p/6p1/p3p3/P2kP3/1P3P1P/5K1P/2R5 w - - 0 1",s:"f2e2",r:"g6g5"},
        {id:27,n:2,d:1265,f:"1r6/ppp1pp2/P7/5b2/7b/1P1k4/7P/5K2 b - - 0 1",s:"b8g8",r:"h2h3"},
        {id:28,n:2,d:1280,f:"1r6/pp2pp2/P1p5/5b2/7b/1P1k3P/8/5K2 b - - 0 1",s:"b8g8",r:"b3b4"},
        {id:29,n:2,d:1295,f:"1r1qkb1r/pppb3p/4pn1p/8/2P5/7P/PP2PPP1/RN1K1B1R b - - 0 1",s:"d7a4",r:"d1e1"},
        {id:30,n:2,d:1310,f:"1n6/rp5p/p5k1/2p2bqp/2P1n3/P4K1p/3P3P/8 b - - 0 1",s:"g5d2",r:"a3a4"},
        {id:31,n:2,d:1325,f:"1n6/rp5p/p5k1/2p2b1p/2P1nK2/P6p/3P2qP/8 b - - 0 1",s:"g2d2",r:"f4f3"},
        {id:32,n:2,d:1340,f:"1nbqkb2/2pp4/4p3/1P3p2/5Pn1/3P1B2/3BP2P/rN1QK2R b - - 0 1",s:"d8h4",r:"e1f1"},
        {id:33,n:2,d:1355,f:"r7/2p1k3/pp1p4/4p3/3P4/P1P1P3/r7/4K3 b - - 0 1",s:"a8h8",r:"e1f1"},
        {id:34,n:2,d:1370,f:"r7/2p1k3/pp1p4/8/3P4/P3P3/r7/4K3 b - - 0 1",s:"a8h8",r:"e1f1"},
        {id:35,n:2,d:1385,f:"1nbqkbnr/2ppp1p1/1p5p/pN6/5P2/8/PPPP3P/R1BQK2R w - - 0 1",s:"d1h5",r:"g7g6"},
        {id:36,n:2,d:1400,f:"rn5r/p1k4N/4ppp1/2p5/1P2P1P1/8/4PP1P/1qBK1BR1 b - - 0 1",s:"h8d8",r:"d1e1"},
        {id:37,n:2,d:1415,f:"1Q6/3p4/2p1p3/1p6/1P2k2p/2P3PN/5P2/3K1B2 w - - 0 1",s:"b8f4",r:"e4d5"},
        {id:38,n:2,d:1430,f:"r2q1b1r/4Rp1p/b2k4/p2p2p1/P5n1/8/1PPP1PPP/2B1K1NR b - - 0 1",s:"d8e7",r:"e1d1"},
        {id:39,n:2,d:1445,f:"r6B/1p5p/4k3/pqp5/2P2p2/5P1b/P2P1K2/1N6 b - - 0 1",s:"b5b1",r:"a2a3"},
        {id:40,n:2,d:1460,f:"1nbqk1r1/3p1pp1/1p6/2b1p2p/N5P1/5P2/P2BK2P/R2Q1BNR b - - 0 1",s:"c8a6",r:"e2e1"},
        {id:41,n:2,d:1475,f:"1n2k2r/3ppp1p/7b/1p6/r5P1/3P3N/2PBP1RP/3K4 b - - 0 1",s:"a4a1",r:"d2c1"},
        {id:42,n:2,d:1490,f:"rn1r4/ppk2p1p/4P3/P1p3p1/5b2/5P2/RPP1P1B1/4K3 b - - 0 1",s:"f4g3",r:"e1f1"},
        {id:43,n:2,d:1505,f:"1n1bk1n1/rp3N1R/p7/2pPpb2/1P6/8/P2PPPP1/RNB1KB2 w - - 0 1",s:"f7d6",r:"e8f8"},
        {id:44,n:2,d:1520,f:"1rbqk1nr/p1p1p3/2np4/1p4K1/P6p/5P2/1PPPP1PP/RNBQ1B1R b - - 0 1",s:"e7e5",r:"g5g6"},
        {id:45,n:2,d:1535,f:"1rbqk1nr/p1p1p3/2np4/6K1/R6p/5P2/1PPPP1PP/1NBQ1B1R b - - 0 1",s:"e7e5",r:"g5g6"},
        {id:46,n:2,d:1550,f:"7Q/p1p3pR/5k2/3p4/4Pp2/P1P2K2/P3P1P1/2B2BN1 w - - 0 1",s:"h8g7",r:"f6e6"},
        {id:47,n:3,d:1000,f:"r1b1kbnr/p3pppp/1ppp1n2/1Q6/2P4P/P4P1R/1P1PPKP1/RNB2BN1 b - - 0 1",s:"c6b5",r:"c4b5",l:"c8h3",o:"c6b5"},
        {id:48,n:3,d:1022,f:"rn2kbn1/ppp2ppr/8/4p3/P3P1b1/R1N3P1/1PPPQ3/2B1KBN1 b - - 0 1",s:"g4e2",r:"e1e2",l:"f8a3",o:"g4e2"},
        {id:49,n:3,d:1044,f:"r2q1bn1/ppk1pppr/7p/1B1p4/1P1p1P2/4P2P/P3K2P/RNBQ3R w - - 0 1",s:"d1c2",r:"c7b8",l:"c2h7",o:"d1c2"},
        {id:50,n:3,d:1066,f:"r2qkb1r/1p2p3/p1p2p2/3p4/1P4n1/3KP3/P1PP3P/RNB1N2R b - - 0 1",s:"g4f2",r:"d3d4",l:"f2h1",o:"g4f2"},
        {id:51,n:3,d:1088,f:"rn3b2/ppN1nkpr/8/4pP2/P5b1/R5P1/1PPPQ3/2B1KBN1 b - - 0 1",s:"g4e2",r:"f1e2",l:"e7f5",o:"g4e2"},
        {id:52,n:3,d:1110,f:"2rq1R2/3k4/4p3/pppp2p1/8/2P1K2B/P7/RN4N1 w - - 0 1",s:"f8d8",r:"c8d8",l:"b1d2",o:"f8d8"},
        {id:53,n:3,d:1132,f:"1n1k2nr/1b1p2b1/6pp/4p3/1p2r3/3P1K2/5PPP/8 w - - 0 1",s:"d3e4",r:"g8f6",l:"g2g3",o:"d3e4"},
        {id:54,n:3,d:1154,f:"1r1qkbnr/ppp1p3/6p1/3p4/1n3P2/2PPB2P/P6P/RN2KBNR b - - 0 1",s:"b4c2",r:"e1e2",l:"c2a1",o:"b4c2"},
        {id:55,n:3,d:1176,f:"rnb1k2r/1p1pb3/p3pn1p/2p2Rp1/P1P1P3/6PP/1P1B4/RN1NKB2 b - - 0 1",s:"e6f5",r:"e4f5",l:"g5g4",o:"e6f5"},
        {id:56,n:3,d:1198,f:"5k2/1p4pR/2ppp2p/5p2/QP3P2/1P1PK3/4PNPP/1NB2BR1 b - - 0 1",s:"f8g8",r:"f2e4",l:"g8h7",o:"f8g8"},
        {id:57,n:3,d:1220,f:"r2q1bnr/Rpp1p1p1/3k3p/5p2/7P/1b1BP3/1PPPKPP1/1NB3NR w - - 0 1",s:"a7a8",r:"d8a8",l:"c2b3",o:"a7a8"},
        {id:58,n:3,d:1242,f:"1nbq1b1B/7p/1p2p3/p1pB4/P1P2k1n/1P5P/3PPP2/RN1QK1NR b - - 0 1",s:"e6d5",r:"a1a2",l:"f4f5",o:"e6d5"},
        {id:59,n:3,d:1264,f:"1nk2bnr/2p1pp1p/r2p4/p5p1/8/P1P2PqP/1P1PP3/RNBK1BNR b - - 0 1",s:"g3f2",r:"a1a2",l:"f2f1",o:"g3f2"},
        {id:60,n:3,d:1286,f:"1nb1nb1r/4p2p/3pk3/1p4p1/5Q2/B1PP1P1P/2P1P1P1/4KBNR w - - 0 1",s:"f4g4",r:"e6e5",l:"g4c8",o:"f4g4"},
        {id:61,n:3,d:1308,f:"1nk2bnr/2p1pp1p/r2p4/p5p1/q7/P1P2P1P/1P1PP1P1/RNB1KBNR b - - 0 1",s:"a4c2",r:"a1a2",l:"c2c1",o:"a4c2"},
        {id:62,n:3,d:1330,f:"r4b1r/1p1kp3/p1p2p2/8/3KPN2/8/P6P/RN6 b - - 0 1",s:"e7e5",r:"d4d3",l:"e5f4",o:"e7e5"},
        {id:63,n:3,d:1352,f:"rn2k2r/2p2ppp/p7/3P4/6n1/N3PN1b/PPPK1P1P/R3B2R b - - 0 1",s:"h3g2",r:"h1g1",l:"g2f3",o:"h3g2"},
        {id:64,n:3,d:1374,f:"r2qkbnr/pp2pp1p/3pb2p/2pn4/2P5/PP3P2/4P1PP/RN1QKBNR w - - 0 1",s:"c4d5",r:"e6d7",l:"a1a2",o:"c4d5"},
        {id:65,n:3,d:1396,f:"rn3k2/3p4/b1p3p1/pP2Pp2/4p3/PP2P1P1/4BKR1/4R1N1 w - - 0 1",s:"b5a6",r:"b8a6",l:"e1f1",o:"b5a6"},
        {id:66,n:3,d:1418,f:"rnb1k1nr/pp1pbp2/7p/2p1P3/6QP/1P1PP3/2PK2B1/4R3 w - - 0 1",s:"g4g7",r:"e7h4",l:"g7h8",o:"g4g7"},
        {id:67,n:3,d:1440,f:"r3kbr1/p1p1p1p1/n7/5p1p/4P1bP/PPP3P1/3N1P2/R1B1K1NR w - - 0 1",s:"f2f3",r:"g4f3",l:"g1f3",o:"f2f3"},
        {id:68,n:3,d:1462,f:"rnbqk3/pppp1p2/6p1/3n3r/2P1pP2/BP2P3/P2P2PP/R3KBNR w - - 0 1",s:"c4d5",r:"h5d5",l:"a1b1",o:"c4d5"}
    ];

    let pzBoard = null;
    let pzGame = null;
    let pzCur = null;
    let pzSide = 'w';
    let pzStep = 0;
    let pzBusy = false;
    let pzDone = false;
    let pzHelped = false;
    let pzMistakes = 0;
    let pzLevelN = 0;
    let pzSel = null;
    let pzTapSq = null;
    let pzTapAt = 0;
    let pzMsgTimer = null;
    let pzSolved = new Set();
    let pzStreak = Number(lsGet('chess-pz-streak')) || 0;
    let pzRating = Number(lsGet('chess-pz-rating')) || 1000;
    let pzRated = new Set();
    let pzRun = 0;
    try { pzRated = new Set(JSON.parse(lsGet('chess-pz-rated') || '[]')); } catch (e) { pzRated = new Set(); }
    try { pzSolved = new Set(JSON.parse(lsGet('chess-pz-solved') || '[]')); } catch (e) { pzSolved = new Set(); }

    function pzSave() {
        lsSet('chess-pz-solved', JSON.stringify([...pzSolved]));
        lsSet('chess-pz-streak', String(pzStreak));
        pzSync();
    }
    // حفظ تقدّم الألغاز في الحساب (للمسجّلين فقط)
    function pzSync() {
        if (!account || !socket.connected) return;
        socket.emit('pz_save', { solved: [...pzSolved], rated: [...pzRated], rating: pzRating, streak: pzStreak });
    }
    // دمج ما في الحساب مع ما في هذا المتصفح: اتحاد الألغاز، والتصنيف من الجهة التي لعبت أكثر
    function pzMerge(s) {
        const sSolved = Array.isArray(s.s) ? s.s : [];
        const sRated = Array.isArray(s.d) ? s.d : [];
        const serverWins = sRated.length >= pzRated.size;
        sSolved.forEach((id) => pzSolved.add(id));
        sRated.forEach((id) => pzRated.add(id));
        if (serverWins && Number.isFinite(s.r)) { pzRating = s.r; pzStreak = Number(s.k) || 0; }
        lsSet('chess-pz-rating', String(pzRating));
        lsSet('chess-pz-rated', JSON.stringify([...pzRated]));
        lsSet('chess-pz-solved', JSON.stringify([...pzSolved]));
        lsSet('chess-pz-streak', String(pzStreak));
        pzSync();
        if (currentScreen === 'puzzle-screen') pzStats();
    }
    // تصنيف الألغاز (محلي في متصفحك): يتغير مرة واحدة عند أول إنهاء لكل لغز
    function pzApplyRating(score) {
        if (!pzCur || pzRated.has(pzCur.id)) return '';
        pzRated.add(pzCur.id);
        const e = 1 / (1 + Math.pow(10, ((pzCur.d || 1000) - pzRating) / 400));
        const delta = Math.round(24 * (score - e));
        pzRating = Math.max(100, pzRating + delta);
        lsSet('chess-pz-rating', String(pzRating));
        lsSet('chess-pz-rated', JSON.stringify([...pzRated]));
        return ' ' + tr('({d} تصنيف)', { d: (delta >= 0 ? '+' : '') + delta });
    }
    function pzPool() { return PUZZLES.filter((p) => !pzLevelN || p.n === pzLevelN); }
    function pzStats() {
        const pool = pzPool();
        const done = pool.filter((p) => pzSolved.has(p.id)).length;
        $('#pz-stats').text(tr('تصنيف الألغاز: {r} · حللت {d} من {n} · سلسلة متتالية: {s}', { r: pzRating, d: done, n: pool.length, s: pzStreak }));
    }
    function pzSetText(text, tone, temp) {
        clearTimeout(pzMsgTimer);
        $('#pz-text').text(text);
        $('#pz-card').attr('data-tone', tone || '');
        if (temp) pzMsgTimer = setTimeout(pzPrompt, 2200);
    }
    function pzPrompt() {
        if (!pzCur || pzDone) return;
        const who = tr(pzSide === 'w' ? tr('الأبيض') : tr('الأسود'));
        pzSetText(pzCur.n === 3 ? tr('{who} يلعب ويكسب مادة (ابحث عن أقوى حركة)', { who })
            : pzStep === 0
            ? tr(pzCur.n === 1 ? tr('{who} يلعب ويُكش مات في حركة واحدة') : tr('{who} يلعب ويُكش مات في حركتين'), { who })
            : tr('أحسنت! والآن أنهِ المباراة بكش مات.'), 'mine');
    }

    // اللغز التالي: أول لغز لم يُحل بعد (من الأسهل إلى الأصعب)
    function pzNext(advance) {
        const pool = pzPool();
        if (!pool.length) return;
        let list = pool.filter((p) => !pzSolved.has(p.id));
        if (!list.length) {
            list = pool;
            pzSetText(tr('أنهيت كل ألغاز هذا النوع! سنعيدها من البداية.'), 'draw');
        }
        // عند الضغط على «التالي» نتخطى اللغز الحالي إن لم يُحل
        let next = list[0];
        if (advance && pzCur && list.length > 1 && list[0].id === pzCur.id) next = list[1];
        pzStart(next);
    }

    function pzStart(p) {
        pzCur = p;
        pzRun++;
        pzGame = new Chess(p.f);
        pzSide = pzGame.turn();
        pzStep = 0;
        pzBusy = false;
        pzDone = false;
        pzHelped = false;
        pzMistakes = 0;
        pzClear();
        // تحقق احتياطي: إن لم تكن الحركة الأولى قانونية نتخطى اللغز
        const legal = pzGame.moves({ verbose: true }).some((m) => m.from + m.to === p.s.slice(0, 4));
        if (!legal) { pzSolved.add(p.id); return pzNext(true); }
        if (pzBoard) pzBoard.destroy();
        pzBoard = Chessboard('pboard', {
            draggable: true,
            position: p.f,
            orientation: pzSide === 'b' ? 'black' : 'white',
            pieceTheme: PIECE_THEME,
            moveSpeed: 130, snapSpeed: 40, snapbackSpeed: 130, appearSpeed: 120, trashSpeed: 90,
            onDragStart: (source, piece) => {
                if (!pzCanMove() || piece.charAt(0) !== pzSide) return false;
                pzShowLegal(source, true);
            },
            onDrop: (source, target) => {
                pzClearMarks();
                if (source === target) { pzTap(source); return 'snapback'; }
                pzSel = null;
                return pzTryMove(source, target) ? undefined : 'snapback';
            },
            onSnapEnd: () => { pzClearMarks(); pzBoard.position(pzGame.fen()); }
        });
        $('#pz-meta').text(tr('اللغز {id} من {n} · {kind} · صعوبة {d}', { id: p.id, n: PUZZLES.length, kind: tr(p.n === 1 ? tr('كش مات في حركة') : p.n === 2 ? tr('كش مات في حركتين') : tr('تكتيك: اكسب مادة')), d: p.d || '' }));
        $('#pz-hint').prop('disabled', false);
        pzPrompt();
        pzStats();
    }

    function pzCanMove() { return !!pzCur && !pzDone && !pzBusy && pzGame.turn() === pzSide; }
    function pzClearMarks() { $('#pboard .square-55d63').removeClass('legal-move legal-capture selected-sq hint-sq'); }
    function pzClear() { pzSel = null; if ($('#pboard').length) pzClearMarks(); }
    // drag = true: مجرد إظهار الحركات أثناء السحب دون تثبيت التحديد (وإلا يُلغى عند الإفلات على نفس المربع)
    function pzShowLegal(sq, drag) {
        pzClearMarks();
        if (!drag) {
            pzSel = sq;
            $('#pboard .square-' + sq).addClass('selected-sq');
        }
        pzGame.moves({ square: sq, verbose: true }).forEach((m) => {
            $('#pboard .square-' + m.to).addClass(m.captured ? 'legal-capture' : 'legal-move');
        });
    }
    function pzTap(sq) {
        const now = Date.now();
        if (sq === pzTapSq && now - pzTapAt < 400) return;
        pzTapSq = sq;
        pzTapAt = now;
        if (!pzCanMove()) { pzClear(); return; }
        if (pzSel && pzSel !== sq) {
            const from = pzSel;
            pzClear();
            if (pzTryMove(from, sq)) { pzBoard.position(pzGame.fen()); return; }
        }
        const piece = pzGame.get(sq);
        if (piece && piece.color === pzSide) { if (pzSel === sq) pzClear(); else pzShowLegal(sq); }
        else pzClear();
    }
    $('#pboard').on('click', '.square-55d63', function () { pzTap($(this).attr('data-square')); });

    // يجرّب حركة اللاعب. true = حركة صحيحة (طُبّقت)، false = خاطئة أو غير قانونية (أُلغيت)
    function pzTryMove(from, to) {
        if (!pzCanMove()) return false;
        const mv = pzGame.move({ from, to, promotion: 'q' });
        if (!mv) return false;
        const tactic = pzCur.n === 3;
        const finalMove = !tactic && (pzCur.n === 1 || pzStep === 1);
        const correct = tactic ? (pzCur.o || pzCur.s.slice(0, 4)).split(' ').indexOf(from + to) !== -1
            : (finalMove ? pzGame.in_checkmate() : (from + to === pzCur.s.slice(0, 4)));
        if (!correct) {
            pzGame.undo();
            pzMistakes++;
            playSound('wrong');
            pzSetText(tactic ? tr('ليست أقوى حركة، ابحث عن طريقة لكسب مادة.') : finalMove ? tr('ليست كش مات، حاول مرة أخرى.') : tr('ليست الحركة الصحيحة، حاول مرة أخرى.'), 'check', true);
            return false;
        }
        playSound(moveSound(mv.san, mv.captured));
        if (tactic) { pzTactic(from + to); return true; }
        if (finalMove) { pzFinish(); return true; }
        // حركة أولى صحيحة: يردّ الخصم ثم يكمل اللاعب
        pzStep = 1;
        pzBusy = true;
        const run = pzRun;
        pzSetText(tr('حركة صحيحة! الخصم يرد...'), 'mine');
        setTimeout(() => {
            if (run !== pzRun) return;
            const replies = pzGame.moves({ verbose: true });
            const rep = replies.find((m) => m.from + m.to === (pzCur.r || '').slice(0, 4)) || replies[0];
            if (rep) {
                const rm = pzGame.move({ from: rep.from, to: rep.to, promotion: 'q' });
                playSound(rm ? moveSound(rm.san, rm.captured) : 'move');
                pzBoard.position(pzGame.fen());
            }
            pzBusy = false;
            pzPrompt();
        }, 600);
        return true;
    }

    // لغز تكتيكي: بعد الحركة الصحيحة نعرض بقية الخط المتوقع
    function pzTactic(played) {
        if (played !== pzCur.s.slice(0, 4) || !pzCur.r) { pzFinish(); return; }
        const run = pzRun;
        pzBusy = true;
        pzSetText(tr('حركة قوية! لنرَ كيف تستمر الخطة...'), 'mine');
        const step = (uci, next) => setTimeout(() => {
            if (run !== pzRun) return;
            const m = pzGame.moves({ verbose: true }).find((x) => x.from + x.to === uci.slice(0, 4));
            if (m) {
                const r = pzGame.move({ from: m.from, to: m.to, promotion: 'q' });
                playSound(r ? moveSound(r.san, r.captured) : 'move');
                pzBoard.position(pzGame.fen());
            }
            next();
        }, 650);
        step(pzCur.r, () => step(pzCur.l || '', () => { pzBusy = false; pzFinish(); }));
    }

    function pzFinish() {
        pzDone = true;
        pzClear();
        playSound('good');
        let delta = '';
        if (!pzHelped) {
            pzSolved.add(pzCur.id);
            pzStreak = pzMistakes === 0 ? pzStreak + 1 : 0;
            delta = pzApplyRating(pzMistakes === 0 ? 1 : 0.4);
        } else {
            pzStreak = 0;
            delta = pzApplyRating(0.2);
        }
        pzSave();
        pzStats();
        const what = tr(pzCur.n === 3 ? tr('كسبت مادة!') : tr('كش مات!'));
        const msg = pzHelped ? tr('{what} (بمساعدة التلميح، لن يُحتسب لغزًا محلولًا)', { what }) + delta
            : pzMistakes === 0 ? tr('ممتاز! {what} من أول محاولة.', { what }) + delta : tr('{what} أحسنت.', { what }) + delta;
        pzSetText(msg, 'win');
    }

    // أول حركة تعطي كش مات من الوضعية الحالية
    function pzFindMate() {
        const g = new Chess(pzGame.fen());
        const ms = g.moves({ verbose: true });
        for (const m of ms) {
            g.move({ from: m.from, to: m.to, promotion: m.promotion });
            const mate = g.in_checkmate();
            g.undo();
            if (mate) return m;
        }
        return null;
    }

    function pzHint() {
        if (!pzCanMove()) return;
        pzHelped = true;
        pzClear();
        let from = null;
        if (pzCur.n === 3) from = pzCur.s.slice(0, 2);
        else if (pzCur.n === 1 || pzStep === 1) { const m = pzFindMate(); from = m && m.from; }
        else from = pzCur.s.slice(0, 2);
        if (from) $('#pboard .square-' + from).addClass('hint-sq');
        pzSetText(tr('القطعة المضيئة بالأخضر هي التي يجب تحريكها.'), 'mine');
    }

    function pzSolution() {
        if (!pzCur || pzDone || pzBusy) return;
        pzHelped = true;
        const g = new Chess(pzGame.fen());
        const san = [];
        const play = (m) => { const r = g.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' }); if (r) san.push(r.san); return r; };
        const pick = (uci) => g.moves({ verbose: true }).find((m) => m.from + m.to === uci.slice(0, 4));
        if (pzCur.n === 3) {
            [pzCur.s, pzCur.r, pzCur.l].forEach((u) => { const m = u && pick(u); if (m) play(m); });
        } else if (pzCur.n === 1 || pzStep === 1) {
            const m = (function () { for (const x of g.moves({ verbose: true })) { g.move({ from: x.from, to: x.to, promotion: x.promotion }); const ok = g.in_checkmate(); g.undo(); if (ok) return x; } return null; })();
            if (m) play(m);
        } else {
            const m1 = pick(pzCur.s);
            if (m1) play(m1);
            const rep = pick(pzCur.r) || g.moves({ verbose: true })[0];
            if (rep) play(rep);
            const m2 = (function () { for (const x of g.moves({ verbose: true })) { g.move({ from: x.from, to: x.to, promotion: x.promotion }); const ok = g.in_checkmate(); g.undo(); if (ok) return x; } return null; })();
            if (m2) play(m2);
        }
        pzDone = true;
        pzStreak = 0;
        const delta = pzApplyRating(0);
        pzSave();
        pzStats();
        pzClear();
        pzSetText(tr('الحل: {moves}', { moves: san.join('  ') }) + delta, 'draw');
    }

    // اللعبة المختارة: أول زيارة تعرض شاشة الاختيار
    (function () {
        const w = lsGet('chess-world');
        if (w !== 'chess' && w !== 'mono') show('world-screen');
        else if (w === 'mono') setTimeout(() => { if (currentScreen === 'menu-screen') A.showMono(); }, 0);
        else show('menu-screen');
    })();

    // تحذير قبل إغلاق الصفحة أثناء مباراة جارية
    window.addEventListener('beforeunload', (e) => {
        if (state && !state.over && !spectating && state.moveCount >= 2) { e.preventDefault(); e.returnValue = ''; }
    });
})();
