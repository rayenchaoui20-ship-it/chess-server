/* سلم وثعبان: واجهة العميل. الخادم هو المرجع الوحيد للنرد والمواقع. */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;

    var LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
    var SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
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
    function cell(n) {                    // مركز المربع n على لوحة 100×100
        var r = Math.floor((n - 1) / 10), i = (n - 1) % 10;
        var c = r % 2 === 0 ? i : 9 - i;
        return { x: c * 10 + 5, y: (9 - r) * 10 + 5 };
    }
    function pt(n) { return n <= 0 ? { x: 5, y: 112 } : cell(n); }

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
    var built = false;
    function buildBoard() {
        if (built) return;
        built = true;
        var cells = '';
        for (var n = 100; n >= 1; n--) {
            var c = cell(n), r = Math.floor((n - 1) / 10), i = (n - 1) % 10, col = r % 2 === 0 ? i : 9 - i;
            var cls = 'snk-c' + ((r + col) % 2 ? ' alt' : '') + (LADDERS[n] ? ' lad' : '') + (SNAKES[n] ? ' snk' : '') + (n === 100 ? ' goal' : '');
            cells += '<div class="' + cls + '" style="left:' + (c.x - 5) + '%;top:' + (c.y - 5) + '%"><span>' + n + '</span></div>';
        }
        var svg = '<svg class="snk-svg" viewBox="0 0 100 100" aria-hidden="true">';
        Object.keys(LADDERS).forEach(function (a) { svg += ladderSvg(+a, LADDERS[a]); });
        var k = 0;
        Object.keys(SNAKES).forEach(function (a) { svg += snakeSvg(+a, SNAKES[a], SNAKE_COLORS[k++ % SNAKE_COLORS.length]); });
        svg += '</svg>';
        $('#snk-board').html(cells + svg + '<div id="snk-tokens" class="snk-tokens"></div>');
    }

    // ───────── الرموز ─────────
    function paintTokens() {
        if (!last || !shown) return;
        var box = $('#snk-tokens');
        last.players.forEach(function (p, i) {
            var el = box.children('[data-i=' + i + ']');
            if (!el.length) el = $('<i class="snk-tk">').attr('data-i', i).css('background', p.color).appendTo(box);
            var n = shown[i], c = pt(n);
            var same = shown.filter(function (v, j) { return j < i && v === n; }).length;
            var ox = (i % 2 ? 1.2 : -1.2) + same * 0.0, oy = (i < 2 ? -1.2 : 1.2);
            el.css({ left: (c.x + ox) + '%', top: (c.y + oy) + '%' }).toggleClass('me', i === last.me);
            el.attr('title', p.name);
        });
    }

    // ───────── عرض الحالة ─────────
    function render() {
        if (!last) return view('home');
        if (!last.started) { renderLobby(); return view('lobby'); }
        view('game');
        buildBoard();
        var g = last.game;
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
        $('#snk-start').toggleClass('hidden', !host).prop('disabled', last.players.length < 2);
        $('#snk-wait').text(host ? (last.players.length < 2 ? 'بانتظار لاعب آخر. أرسل الكود لصديقك.' : 'يمكنك بدء اللعبة الآن.') : 'بانتظار المضيف ليبدأ اللعبة...');
    }
    function renderPlayers() {
        var ul = $('#snk-plist').empty(), g = last.game;
        last.players.forEach(function (p, i) {
            ul.append($('<li>').toggleClass('cur', g.winner === null && i === g.turn).toggleClass('off', !p.on)
                .append($('<i class="snk-dot">').css('background', p.color), $('<span class="nm">').text(p.name + (i === last.me ? ' (أنت)' : '') + (p.bot ? ' 🤖' : '')),
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
                if (!l.via) return done();
                var tk = $('#snk-tokens > [data-i=' + l.p + ']');
                tk.addClass(l.via === 'ladder' ? 'climb' : 'slide');
                shown[l.p] = l.to; paintTokens();
                sfx(l.via === 'ladder' ? 'jump' : 'wrong');
                $('#snk-msg').text(l.via === 'ladder' ? '🪜 ' + who + ' صعد السلم إلى ' + l.to : '🐍 ' + who + ' لدغه ثعبان إلى ' + l.to);
                setTimeout(function () { tk.removeClass('climb slide'); done(); }, JUMP_MS);
            });
        }, DIE_MS);
    }
    function walk(l, cb) {
        var from = l.from, to = l.step;
        if (to === from) { $('#snk-msg').text('تحتاج رقمًا مطابقًا تمامًا للوصول إلى 100'); return cb(); }
        var n = from;
        (function step() {
            n++;
            shown[l.p] = n; paintTokens(); sfx('step');
            if (n >= to) return setTimeout(cb, 150);
            setTimeout(step, STEP_MS);
        })();
    }

    // ───────── أحداث الخادم ─────────
    socket.on('sl_update', function (d) {
        var first = !last;
        if (!last || last.code !== d.code) { shown = null; seenRolls = -1; busy = false; }
        last = d;
        err('');
        if (lget('chess-world') === 'snake' && !$('#snk-screen').is(':visible')) APP.show('snk-screen');
        if (first && d.started) { $('#snk-die').text('⚄'); $('#snk-msg').text(''); }
        render();
    });
    socket.on('sl_none', function () { last = null; shown = null; busy = false; seenRolls = -1; view('home'); });
    socket.on('sl_error', function (m) { err(m); });
    socket.on('welcome', function () { socket.emit('sl_rejoin'); });

    // ───────── الأزرار ─────────
    $(document).on('click', '#snk-screen [data-snk]', function () {
        var a = $(this).attr('data-snk');
        err('');
        if (a === 'ai') socket.emit('sl_create_ai', { bots: +$('#snk-bots').val() || 1 });
        else if (a === 'create') socket.emit('sl_create');
        else if (a === 'join') {
            var c = $('#snk-join').val().trim().toUpperCase();
            if (!c) return err('أدخل كود الغرفة أولًا.');
            socket.emit('sl_join', { code: c });
        } else if (a === 'start') socket.emit('sl_start');
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
        open: function () { err(''); soundBtn(); if (!last) view('home'); else render(); }
    };
    soundBtn();
})();
