/* سلم وثعبان: واجهة العميل. الخادم هو المرجع الوحيد للنرد والمواقع. */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;

    var CLASSIC = {
        cells: 100,
        ladders: { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 },
        snakes: { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 },
        specials: {}
    };
    var B = CLASSIC;                 // لوحة اللعبة الحالية (يرسلها الخادم)
    var SP_ICON = { again: '🎲', back: '↩', shield: '🛡' };
    var MODE_NOTE = {
        classic: 'اللوحة الأصلية: 100 خانة، 9 سلالم و10 ثعابين.',
        quick: 'لعبة قصيرة: 50 خانة فقط.',
        chaos: 'ثعابين كثيرة وسلالم قليلة: الحظ يلعب ضدك!',
        surprise: 'خانات خاصة: 🎲 رمية إضافية · ↩ تراجع 3 خطوات · 🛡 درع يصدّ ثعبانًا.'
    };
    var SNAKE_COLORS = ['#3fae7a', '#d9534f', '#8e6bd0', '#e08a2e', '#2f9fbf'];
    var STEP_MS = 120, JUMP_MS = 650, DIE_MS = 520;
    var FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

    var last = null;               // آخر حالة من الخادم
    var shown = null;              // المواقع المعروضة حاليًا (للحركة التدريجية)
    var seenRolls = -1;
    var busy = false;              // رسوم الحركة جارية
    var queue = [];
    var muted = false;
    try { muted = localStorage.getItem('snk-mute') === '1'; } catch (e) { /* */ }

    function sfx(n, a) { try { if (!muted && window.SFX) window.SFX.play(n, a); } catch (e) { /* */ } }
    function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function err(m) { $('#snk-error').text(m || ''); }
    function view(v) {
        ['home', 'lobby', 'game'].forEach(function (x) { $('#snk-' + x).toggleClass('hidden', x !== v); });
        $('#snk-leave').text(v === 'home' ? 'رجوع' : 'غادر');
    }

    // ───────── هندسة اللوحة ─────────
    function rowsN() { return B.cells / 10; }
    function cell(n) {                    // مركز المربع n (الوحدة: عرض المربع = 10، العرض الكلي 100)
        var r = Math.floor((n - 1) / 10), i = (n - 1) % 10;
        var c = r % 2 === 0 ? i : 9 - i;
        return { x: c * 10 + 5, y: (rowsN() - 1 - r) * 10 + 5 };
    }
    function pt(n) { return n <= 0 ? { x: 5, y: rowsN() * 10 + 12 } : cell(n); }

    function ladderSvg(a, b) {
        var p = cell(a), q = cell(b);
        var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy);
        var nx = -dy / len * 1.5, ny = dx / len * 1.5;
        var s = '<line x1="' + (p.x + nx) + '" y1="' + (p.y + ny) + '" x2="' + (q.x + nx) + '" y2="' + (q.y + ny) + '" class="snk-rail"/>' +
            '<line x1="' + (p.x - nx) + '" y1="' + (p.y - ny) + '" x2="' + (q.x - nx) + '" y2="' + (q.y - ny) + '" class="snk-rail"/>';
        var rungs = Math.max(2, Math.floor(len / 4.5));
        for (var k = 1; k <= rungs; k++) {
            var t = k / (rungs + 1), cx = p.x + dx * t, cy = p.y + dy * t;
            s += '<line x1="' + (cx + nx) + '" y1="' + (cy + ny) + '" x2="' + (cx - nx) + '" y2="' + (cy - ny) + '" class="snk-rung"/>';
        }
        return s;
    }
    function snakeSvg(head, tail, color) {
        var p = cell(head), q = cell(tail);
        var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy);
        var nx = -dy / len, ny = dx / len, w = Math.min(7, 2.5 + len / 14);
        var c1 = { x: p.x + dx * 0.25 + nx * w, y: p.y + dy * 0.25 + ny * w };
        var c2 = { x: p.x + dx * 0.75 - nx * w, y: p.y + dy * 0.75 - ny * w };
        var d = 'M' + p.x + ' ' + p.y + ' C' + c1.x + ' ' + c1.y + ',' + c2.x + ' ' + c2.y + ',' + q.x + ' ' + q.y;
        return '<path d="' + d + '" class="snk-body" stroke="' + color + '"/>' +
            '<path d="' + d + '" class="snk-scales"/>' +
            '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.6" fill="' + color + '" class="snk-head"/>' +
            '<circle cx="' + (p.x - 0.9) + '" cy="' + (p.y - 0.7) + '" r="0.55" fill="#fff"/><circle cx="' + (p.x + 0.9) + '" cy="' + (p.y - 0.7) + '" r="0.55" fill="#fff"/>' +
            '<circle cx="' + (p.x - 0.9) + '" cy="' + (p.y - 0.7) + '" r="0.25" fill="#111"/><circle cx="' + (p.x + 0.9) + '" cy="' + (p.y - 0.7) + '" r="0.25" fill="#111"/>';
    }
    var builtMode = null;
    function buildBoard() {
        var key = last && last.game ? last.game.mode : 'classic';
        if (builtMode === key) return;
        builtMode = key;
        var R = rowsN(), H = R * 10, cells = '';
        for (var n = B.cells; n >= 1; n--) {
            var c = cell(n), r = Math.floor((n - 1) / 10), i = (n - 1) % 10, col = r % 2 === 0 ? i : 9 - i;
            var sp = B.specials[n];
            var cls = 'snk-c' + ((r + col) % 2 ? ' alt' : '') + (B.ladders[n] ? ' lad' : '') + (B.snakes[n] ? ' snk' : '') + (sp ? ' sp sp-' + sp : '') + (n === B.cells ? ' goal' : '');
            cells += '<div class="' + cls + '" style="left:' + (c.x - 5) + '%;top:' + ((c.y - 5) * 100 / H) + '%;height:' + (100 / R) + '%"><span>' + n + '</span>' + (sp ? '<b class="spi">' + SP_ICON[sp] + '</b>' : '') + '</div>';
        }
        var svg = '<svg class="snk-svg" viewBox="0 0 100 ' + H + '" aria-hidden="true">';
        Object.keys(B.ladders).forEach(function (a) { svg += ladderSvg(+a, B.ladders[a]); });
        var k = 0;
        Object.keys(B.snakes).forEach(function (a) { svg += snakeSvg(+a, B.snakes[a], SNAKE_COLORS[k++ % SNAKE_COLORS.length]); });
        svg += '</svg>';
        $('#snk-board').css('aspect-ratio', '10 / ' + R).html(cells + svg + '<div id="snk-tokens" class="snk-tokens"></div>');
    }

    // ───────── الرموز ─────────
    function paintTokens() {
        if (!last || !shown) return;
        var box = $('#snk-tokens');
        last.players.forEach(function (p, i) {
            var el = box.children('[data-i=' + i + ']');
            if (!el.length) el = $('<i class="snk-tk">').attr('data-i', i).css('background', p.color).appendTo(box);
            el[0].style.setProperty('--tkc', p.color);
            var n = shown[i], c = pt(n);
            var same = shown.filter(function (v, j) { return j < i && v === n; }).length;
            var ox = (i % 2 ? 1.2 : -1.2) + same * 0.0, oy = (i < 2 ? -1.2 : 1.2);
            el.css({ left: (c.x + ox) + '%', top: ((c.y + oy) * 100 / (rowsN() * 10)) + '%' }).toggleClass('me', i === last.me);
            if (i === last.me) applySkinTo(el);
            el.attr('title', p.name);
        });
    }

    // ───────── عرض الحالة ─────────
    function render() {
        if (!last) return view('home');
        if (!last.started) { renderLobby(); return view('lobby'); }
        view('game');
        var g = last.game;
        B = g.board || CLASSIC;
        buildBoard();
        if (!shown) { shown = g.pos.slice(); seenRolls = g.rolls; }
        renderPlayers();
        paintTokens();
        status();
        processUpdate();
    }
    function renderLobby() {
        $('#snk-code').text(last.code);
        var ul = $('#snk-lplayers').empty();
        last.players.forEach(function (p, i) {
            ul.append($('<li>').append($('<i class="snk-dot">').css('background', p.color), $('<span class="nm">').text(p.name + (i === last.me ? ' (أنت)' : '') + (i === 0 ? ' 👑' : ''))));
        });
        var host = last.me === 0;
        $('#snk-lmode').toggleClass('hidden', !host).val(last.mode || 'classic');
        $('#snk-lmode-note').text((host ? '' : 'النمط: ') + (MODE_NOTE[last.mode] || ''));
        $('#snk-start').toggleClass('hidden', !host).prop('disabled', last.players.length < 2);
        $('#snk-wait').text(host ? (last.players.length < 2 ? 'بانتظار لاعب آخر. أرسل الكود لصديقك.' : 'يمكنك بدء اللعبة الآن.') : 'بانتظار المضيف ليبدأ اللعبة...');
    }
    function renderPlayers() {
        var ul = $('#snk-plist').empty(), g = last.game;
        last.players.forEach(function (p, i) {
            ul.append($('<li>').toggleClass('cur', g.winner === null && i === g.turn).toggleClass('off', !p.on)
                .append($('<i class="snk-dot">').css('background', p.color), $('<span class="nm">').text(p.name + (i === last.me ? ' (أنت)' : '') + (p.bot ? ' 🤖' : '') + (g.shield && g.shield[i] ? ' 🛡' : '')),
                    $('<span class="rt">').text((shown ? shown[i] : g.pos[i]) || 'البداية')));
        });
    }
    function status() {
        var g = last.game, txt;
        if (g.winner !== null) txt = '🏆 فاز ' + last.players[g.winner].name + '!';
        else if (busy) txt = '';
        else if (g.turn === last.me) txt = '🎲 دورك: ارمِ النرد';
        else txt = 'دور ' + last.players[g.turn].name + '...';
        if (txt || !busy) $('#snk-status').text(txt);
        var can = g.winner === null && g.turn === last.me && !busy;
        $('#snk-roll').prop('disabled', !can).toggleClass('primary', can);
        $('#snk-over').toggleClass('hidden', g.winner === null);
        $('#snk-reactbar').toggleClass('hidden', !!last.ai);   // ضد الحاسوب: لا حاجة للتفاعلات
        $('#snk-replay').toggleClass('hidden', !(g.winner !== null && g.log && g.log.length));
    }

    // ───────── الحركة: نرد ثم خطوات ثم سلم أو ثعبان ─────────
    function processUpdate() {
        var g = last.game;
        if (g.rolls === seenRolls) return;
        if (g.rolls < seenRolls) { shown = g.pos.slice(); seenRolls = g.rolls; renderPlayers(); paintTokens(); return; }   // لعبة جديدة
        if (busy) return;
        var l = g.last;
        if (!l || g.rolls > seenRolls + 1) { shown = g.pos.slice(); seenRolls = g.rolls; renderPlayers(); paintTokens(); status(); return; }
        animate(l, g);
    }
    function animate(l, g) {
        busy = true;
        seenRolls = g.rolls;
        var who = last.players[l.p].name;
        $('#snk-status').text(who + ' يرمي...');
        $('#snk-roll').prop('disabled', true);
        sfx('dice');
        var die = $('#snk-die').addClass('rolling'), t0 = 0;
        var iv = setInterval(function () { die.text(FACES[Math.floor(Math.random() * 6)]); }, 70);
        setTimeout(function () {
            clearInterval(iv);
            die.removeClass('rolling').text(FACES[l.d - 1]);
            $('#snk-msg').text(who + ': ' + l.d);
            walk(l, function () {
                var done = function () {
                    shown = g.pos.slice();
                    busy = false;
                    renderPlayers(); paintTokens();
                    if (g.winner !== null) {
                        sfx(g.winner === last.me ? 'win' : 'lose');
                        $('#snk-msg').text('🏆 ' + last.players[g.winner].name);
                    } else if (g.turn === last.me) sfx('turn');
                    status();
                    processUpdate();                  // تحديثات تراكمت أثناء الرسوم
                };
                if (!l.via) {
                    if (l.special === 'again') { sfx('jump'); $('#snk-msg').text('🎲 ' + who + ': رمية إضافية!'); }
                    else if (l.special === 'shield') { sfx('jump'); $('#snk-msg').text('🛡 ' + who + ' حصل على درع'); }
                    return done();
                }
                if (l.via === 'shield') { sfx('jump'); $('#snk-msg').text('🛡 ' + who + ': الدرع صدّ الثعبان!'); return setTimeout(done, 600); }
                var tk = $('#snk-tokens > [data-i=' + l.p + ']');
                tk.addClass(l.via === 'ladder' ? 'climb' : 'slide');
                shown[l.p] = l.to; paintTokens();
                sfx(l.via === 'ladder' ? 'jump' : 'wrong');
                $('#snk-msg').text(l.via === 'ladder' ? '🪜 ' + who + ' صعد السلم إلى ' + l.to : l.via === 'back' ? '↩ ' + who + ' تراجع 3 خطوات إلى ' + l.to : '🐍 ' + who + ' لدغه ثعبان إلى ' + l.to);
                setTimeout(function () { tk.removeClass('climb slide'); done(); }, JUMP_MS);
            });
        }, DIE_MS);
    }
    function walk(l, cb) {
        var from = l.from, to = l.step;
        if (to === from) { $('#snk-msg').text('تحتاج رقمًا مطابقًا تمامًا للوصول إلى ' + B.cells); return cb(); }
        var n = from;
        (function step() {
            n++;
            shown[l.p] = n; paintTokens(); sfx('step');
            if (n >= to) return setTimeout(cb, 150);
            setTimeout(step, STEP_MS);
        })();
    }

    // ───────── إعادة المشاهدة بعد نهاية اللعبة ─────────
    var rpId = 0;
    function replayStop(msg) {
        rpId++;
        if (!last || !last.game) return;
        shown = last.game.pos.slice(); busy = false;
        $('#snk-replay').text('🎬 إعادة المشاهدة');
        paintTokens(); status();
        if (msg) $('#snk-msg').text(msg);
    }
    function replay() {
        if (!last || !last.game || last.game.winner === null || !last.game.log || !last.game.log.length) return;
        if (busy) return replayStop('');            // الضغط أثناء الإعادة = إيقاف
        var log = last.game.log, id = ++rpId, i = 0;
        busy = true;
        shown = last.players.map(function () { return 0; });
        paintTokens();
        $('#snk-replay').text('⏹ إيقاف');
        $('#snk-roll').prop('disabled', true);
        (function next() {
            if (id !== rpId) return;
            if (i >= log.length) return replayStop('🏆 ' + last.players[last.game.winner].name);
            var e = log[i++], p = e[0], d = e[1], from = e[2], to = e[3];
            var step = from + d > B.cells ? from : from + d;
            var l = { p: p, d: d, from: from, step: step, to: to, via: to === step ? (e[4] === 'blocked' ? 'shield' : null) : (e[4] === 'back' ? 'back' : (to > step ? 'ladder' : 'snake')), special: e[4] === 'back' ? null : (e[4] || null) };
            var who = last.players[p].name;
            $('#snk-die').text(FACES[d - 1]);
            $('#snk-status').text('↻ ' + i + ' / ' + log.length);
            $('#snk-msg').text(who + ': ' + d);
            sfx('dice');
            shown[p] = from;
            walk(l, function () {
                if (id !== rpId) return;
                if (!l.via) return setTimeout(next, 350);
                if (l.via === 'shield') return setTimeout(next, 500);
                var tk = $('#snk-tokens > [data-i=' + p + ']');
                tk.addClass(l.via === 'ladder' ? 'climb' : 'slide');
                shown[p] = to; paintTokens();
                sfx(l.via === 'ladder' ? 'jump' : 'wrong');
                $('#snk-msg').text(l.via === 'ladder' ? '🪜 ' + who + ' → ' + to : '🐍 ' + who + ' → ' + to);
                setTimeout(function () { tk.removeClass('climb slide'); setTimeout(next, 250); }, JUMP_MS);
            });
        })();
    }

    // ───────── المظهر: أشكال الأحجار والنرد تُفتح بالإنجازات ─────────
    var SKIN_TK = [['dot', 'دائرة', null], ['hex', 'سداسي', 'sl_first'], ['diamond', 'معيّن', 'sl_games_25'], ['star', 'نجمة', 'sl_wins_10'], ['shield', 'درع', 'sl_big_snake']];
    var SKIN_RING = [['#fff', 'أبيض', null], ['#e2b14b', 'ذهبي', 'sl_first'], ['#4fd1e8', 'سماوي', 'sl_ladders3'], ['#ff7ab6', 'وردي', 'sl_wins_10']];
    var SKIN_DIE = [['plain', 'عادي', null], ['gold', 'ذهبي', 'sl_ladders3'], ['neon', 'نيون', 'sl_wins_10']];
    var unlocked = {}, achTitle = {}, skin = { tk: 'dot', ring: '#fff', die: 'plain' };
    try { var sv = JSON.parse(localStorage.getItem('snk-skin') || '{}'); if (sv && typeof sv === 'object') { skin.tk = String(sv.tk || 'dot'); skin.ring = String(sv.ring || '#fff'); skin.die = String(sv.die || 'plain'); } } catch (e) { /* */ }
    function okSkin(list, v) { var it = list.filter(function (x) { return x[0] === v; })[0]; return !!it && (!it[2] || !!unlocked[it[2]]); }
    function applySkinTo(el) {
        var tk = okSkin(SKIN_TK, skin.tk) ? skin.tk : 'dot';
        el.attr('class', el.attr('class').replace(/\btk-\w+/g, '') + ' tk-' + tk);
        var ring = okSkin(SKIN_RING, skin.ring) ? skin.ring : '#fff';
        el.css('border-color', ring); el[0].style.setProperty('--ring', ring);
    }
    function applyDieSkin() {
        var d = okSkin(SKIN_DIE, skin.die) ? skin.die : 'plain';
        $('#snk-die').attr('class', ($('#snk-die').attr('class') || 'snk-die').replace(/\bdie-\w+/g, '') + ' die-' + d);
    }
    function fillSkin(sel, list, cur) {
        var s = $(sel).empty();
        list.forEach(function (x) {
            var open = !x[2] || unlocked[x[2]];
            s.append($('<option>').val(x[0]).prop('disabled', !open).text(x[1] + (open ? '' : ' 🔒 ' + (achTitle[x[2]] || 'إنجاز'))));
        });
        s.val(okSkin(list, cur) ? cur : list[0][0]);
    }
    function refreshSkinUi() {
        fillSkin('#snk-sk-tk', SKIN_TK, skin.tk); fillSkin('#snk-sk-ring', SKIN_RING, skin.ring); fillSkin('#snk-sk-die', SKIN_DIE, skin.die);
        applyDieSkin(); if (last && shown) paintTokens();
    }
    function saveSkin() { try { localStorage.setItem('snk-skin', JSON.stringify(skin)); } catch (e) { /* */ } }
    $(document).on('change', '#snk-sk-tk', function () { skin.tk = this.value; saveSkin(); refreshSkinUi(); });
    $(document).on('change', '#snk-sk-ring', function () { skin.ring = this.value; saveSkin(); refreshSkinUi(); });
    $(document).on('change', '#snk-sk-die', function () { skin.die = this.value; saveSkin(); refreshSkinUi(); });
    socket.on('profile', function (p) {
        if (!p || !p.me) return;
        unlocked = {}; (p.ach || []).forEach(function (a) { unlocked[a.id] = 1; });
        (p.all || []).forEach(function (a) { achTitle[a.id] = a.title; });
        refreshSkinUi();
    });
    socket.on('ach_new', function (d) { (d.list || []).forEach(function (a) { unlocked[a.id] = 1; achTitle[a.id] = a.title; }); refreshSkinUi(); });

    // ───────── الأنماط، المقابلة العشوائية، الدعوات، الردود، الترتيب ─────────
    function modeNote() { $('#snk-mode-note').text(MODE_NOTE[$('#snk-mode').val()] || ''); }
    $(document).on('change', '#snk-mode', modeNote);
    $(document).on('change', '#snk-lmode', function () { socket.emit('sl_mode', { mode: this.value }); });
    socket.on('sl_searching', function (d) { $('#snk-searching').toggleClass('hidden', !(d && d.on)); });
    socket.on('sl_ok', function (m) { $('#snk-inv-msg').text(m).css('color', 'var(--win)'); });
    socket.on('sl_error', function (m) { $('#snk-inv-msg').text(m).css('color', 'var(--loss)'); });
    $(document).on('keydown', '#snk-inv-user', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('[data-snk=invite]').trigger('click'); } });
    function joinCode(code) {
        function go() { APP.show('snk-screen'); socket.emit('sl_join', { code: code }); }
        if (last && last.game && last.game.winner === null) return;          // لا نقطع لعبة جارية
        if (last) { socket.emit('sl_leave'); setTimeout(go, 250); } else go();
    }
    socket.on('sl_invite', function (d) {
        if (!d || typeof d.code !== 'string' || !/^[A-Z]{3,8}$/i.test(d.code)) return;
        if (last && last.game && last.game.winner === null) return;
        var el = $('#mp-invite-toast').removeClass('hidden').empty().append(
            $('<span>').text('🐍 ' + String(d.from || '') + ' يدعوك إلى سلم وثعبان'),
            $('<button class="btn primary" type="button">').text('انضم').on('click', function () { el.addClass('hidden'); joinCode(d.code); }),
            $('<button class="btn ghost" type="button">').text('✕').on('click', function () { el.addClass('hidden'); })
        );
        try { if (window.SFX && !muted) window.SFX.play('notify'); } catch (e) { /* */ }
        setTimeout(function () { el.addClass('hidden'); }, 45000);
    });
    var clubRoom = null;
    function renderClubRoom() {
        var box = $('#snk-clubroom');
        if (!clubRoom || last) return box.addClass('hidden').empty();
        box.removeClass('hidden').empty().append(
            $('<span>').text('🛡 ' + clubRoom.by + ' فتح غرفة سلم وثعبان لناديك'),
            $('<button class="btn primary" type="button">').text('انضم').on('click', function () { joinCode(clubRoom.code); })
        );
    }
    socket.on('sl_club_room', function (d) { clubRoom = d && d.code ? d : null; renderClubRoom(); });
    setInterval(function () { if (socket.connected && $('#snk-screen').is(':visible') && !last) socket.emit('sl_club_room_get'); }, 8000);
    $(document).on('click', '#snk-reactbar [data-sreact]', function () { socket.emit('sl_react', { e: $(this).attr('data-sreact') }); });
    socket.on('sl_react', function (d) {
        if (!d || typeof d.e !== 'string') return;
        var el = $('<div class="mp-react">').append($('<span class="re">').text(d.e), $('<span class="rn">').text(String(d.from || '')));
        var box = $('#snk-reacts').append(el);
        while (box.children().length > 6) box.children().first().remove();
        sfx('step');
        setTimeout(function () { el.remove(); }, 2800);
    });
    socket.on('sl_top', function (rows) {
        var ul = $('#snk-top').empty().removeClass('hidden');
        if (!rows || !rows.length) return ul.append($('<li class="empty">').text('لا يوجد ترتيب بعد. اربح ضد لاعبين حقيقيين لتظهر هنا.'));
        rows.forEach(function (r, i) {
            ul.append($('<li>').append($('<span class="nm">').text((['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' ' + r.user), $('<span class="rt">').text(r.w + ' فوز')));
        });
    });

    // ───────── أحداث الخادم ─────────
    socket.on('sl_update', function (d) {
        var first = !last;
        if (!last || last.code !== d.code) { shown = null; seenRolls = -1; busy = false; rpId++; }
        last = d;
        err('');
        if (lget('chess-world') === 'snake' && !$('#snk-screen').is(':visible')) APP.show('snk-screen');
        if (first && d.started) { $('#snk-die').text('⚄'); $('#snk-msg').text(''); }
        render();
    });
    socket.on('sl_none', function () { rpId++; last = null; shown = null; busy = false; seenRolls = -1; view('home'); });
    socket.on('sl_error', function (m) { err(m); });
    socket.on('welcome', function () { socket.emit('sl_rejoin'); });

    // ───────── الأزرار ─────────
    $(document).on('click', '#snk-screen [data-snk]', function () {
        var a = $(this).attr('data-snk');
        err('');
        if (a === 'ai') socket.emit('sl_create_ai', { bots: +$('#snk-bots').val() || 1, mode: $('#snk-mode').val() });
        else if (a === 'create') socket.emit('sl_create', { mode: $('#snk-mode').val() });
        else if (a === 'quick') socket.emit('sl_quick', { mode: $('#snk-mode').val() });
        else if (a === 'quickcancel') socket.emit('sl_quick_cancel');
        else if (a === 'top') { var tl = $('#snk-top'); if (tl.is(':visible')) tl.addClass('hidden'); else socket.emit('sl_top'); }
        else if (a === 'invite') { var iu = $('#snk-inv-user').val().trim(); if (iu) socket.emit('sl_invite', { username: iu }); }
        else if (a === 'shareclub') socket.emit('sl_share_club');
        else if (a === 'join') {
            var c = $('#snk-join').val().trim().toUpperCase();
            if (!c) return err('أدخل كود الغرفة أولًا.');
            socket.emit('sl_join', { code: c });
        } else if (a === 'start') socket.emit('sl_start');
        else if (a === 'replay') replay();
        else if (a === 'roll') { if (last && last.game && last.game.turn === last.me && !busy) socket.emit('sl_roll'); }
        else if (a === 'leave') {
            if (!last) return APP.show('world-screen');
            socket.emit('sl_leave');
        } else if (a === 'again') { socket.emit('sl_leave'); }
        else if (a === 'copy') {
            var t = last ? last.code : '';
            if (navigator.clipboard && t) navigator.clipboard.writeText(t).then(function () { $('#snk-copy').text('تم النسخ ✔'); setTimeout(function () { $('#snk-copy').text('انسخ الكود'); }, 1500); }).catch(function () {});
        } else if (a === 'sound') { muted = !muted; try { localStorage.setItem('snk-mute', muted ? '1' : '0'); } catch (e) { /* */ } soundBtn(); }
    });
    $('#snk-join').on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('[data-snk=join]').trigger('click'); } });
    function soundBtn() { $('#snk-snd').text(muted ? '🔇' : '🔊'); }

    window.Snake = {
        busy: function () { return !!(last && last.started && last.game && last.game.winner === null); },
        leave: function () { if (last) socket.emit('sl_leave'); },
        open: function () { err(''); soundBtn(); modeNote(); refreshSkinUi(); socket.emit('profile_get'); socket.emit('sl_club_room_get'); if (!last) view('home'); else render(); }
    };
    soundBtn();
})();
