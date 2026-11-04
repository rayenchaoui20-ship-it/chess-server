/* ليدو: واجهة العميل. الخادم هو المرجع الوحيد للنرد والحركة. */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;
    var C = 48, SZ = 720;
    var COLORS = ['#e5484d', '#3fae7a', '#f5b83d', '#3e8ef7'];
    var LIGHT = ['#fbd5d6', '#cfeedd', '#fdecc2', '#cfe1fc'];
    var START = [0, 13, 26, 39];
    // مسار الـ52 خانة (عمود، صف) باتجاه عقارب الساعة
    var TRACK = [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0],
        [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8],
        [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14],
        [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6]];
    var COL = [
        [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
        [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]]
    ];
    var BASE = [
        [[2, 2], [4, 2], [2, 4], [4, 4]], [[10, 2], [12, 2], [10, 4], [12, 4]],
        [[10, 10], [12, 10], [10, 12], [12, 12]], [[2, 10], [4, 10], [2, 12], [4, 12]]
    ];
    var HOME = [[6.45, 7.5], [7.5, 6.45], [8.55, 7.5], [7.5, 8.55]];
    var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    var cv, ctx, st = null, disp = null, anim = null, raf = 0, rollingIv = 0, aiBots = 0, room = null;
    function tr_(s) { return (window.Lang && window.Lang.t) ? window.Lang.t(s) : s; }
    function err(m) { $('#lu-error').text(m ? tr_(m) : ''); }
    function setDie(n) {
        var d = $('#lu-die').empty().attr('data-v', n || 0);
        for (var c = 0; c < 9; c++) d.append($('<s>').toggleClass('on', !!n && PIPS[n].indexOf(c) >= 0));
    }
    function cellPos(color, p, idx) {
        if (p === -1) { var b = BASE[color][idx]; return [b[0], b[1]]; }
        if (p === 56) { var h = HOME[color]; return [h[0] + (idx % 2 ? 0.22 : -0.22) * (color % 2 ? 0 : 1), h[1] + (idx % 2 ? 0.22 : -0.22) * (color % 2 ? 1 : 0)]; }
        var c = p <= 50 ? TRACK[(START[color] + p) % 52] : COL[color][p - 51];
        return [c[0] + 0.5, c[1] + 0.5];
    }
    function isSafeAbs(a) { return a % 13 === 0 || a % 13 === 8; }

    // ───────── الرسم ─────────
    function star(x, y, r, col) {
        ctx.fillStyle = col; ctx.beginPath();
        for (var i = 0; i < 10; i++) { var rr = i % 2 ? r * 0.45 : r, an = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
        ctx.closePath(); ctx.fill();
    }
    function drawBoard() {
        ctx.fillStyle = '#f7f2e6'; ctx.fillRect(0, 0, SZ, SZ);
        var quads = [[0, 0], [9, 0], [9, 9], [0, 9]];
        quads.forEach(function (q, i) {
            ctx.fillStyle = COLORS[i]; ctx.fillRect(q[0] * C, q[1] * C, 6 * C, 6 * C);
            ctx.fillStyle = '#fff'; ctx.fillRect((q[0] + 1) * C, (q[1] + 1) * C, 4 * C, 4 * C);
            BASE[i].forEach(function (b) { ctx.fillStyle = LIGHT[i]; ctx.beginPath(); ctx.arc(b[0] * C, b[1] * C, 22, 0, 7); ctx.fill(); ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 3; ctx.stroke(); });
        });
        ctx.strokeStyle = '#b9b2a2'; ctx.lineWidth = 1;
        TRACK.forEach(function (c, i) {
            var col = -1; START.forEach(function (s, k) { if (s === i) col = k; });
            ctx.fillStyle = col >= 0 ? COLORS[col] : '#fff'; ctx.fillRect(c[0] * C, c[1] * C, C, C); ctx.strokeRect(c[0] * C, c[1] * C, C, C);
            if (i % 13 === 8) star((c[0] + 0.5) * C, (c[1] + 0.5) * C, 15, '#9a8f7a');
            if (col >= 0) star((c[0] + 0.5) * C, (c[1] + 0.5) * C, 14, '#fff');
        });
        COL.forEach(function (cells, k) { cells.forEach(function (c) { ctx.fillStyle = COLORS[k]; ctx.fillRect(c[0] * C, c[1] * C, C, C); ctx.strokeRect(c[0] * C, c[1] * C, C, C); }); });
        // المركز
        var x0 = 6 * C, y0 = 6 * C, x1 = 9 * C, y1 = 9 * C, mx = 7.5 * C, my = 7.5 * C;
        [[x0, y0, x0, y1, 0], [x0, y0, x1, y0, 1], [x1, y0, x1, y1, 2], [x0, y1, x1, y1, 3]].forEach(function (t) {
            ctx.fillStyle = COLORS[t[4]]; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); ctx.closePath(); ctx.fill();
        });
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, 3 * C, 3 * C);
    }
    function drawPiece(x, y, color, glow, t) {
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + 12, 15, 6, 0, 0, 7); ctx.fill();
        if (glow) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 21 + Math.sin(t / 160) * 3, 0, 7); ctx.stroke(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke(); }
        var g = ctx.createRadialGradient(x - 5, y - 6, 2, x, y, 19);
        g.addColorStop(0, '#fff'); g.addColorStop(0.25, COLORS[color]); g.addColorStop(1, shade(COLORS[color]));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    function shade(h) { var n = parseInt(h.slice(1), 16); var r = (n >> 16) * 0.68, g = ((n >> 8) & 255) * 0.68, b = (n & 255) * 0.68; return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
    function draw(t) {
        if (!st || !ctx) return;
        drawBoard();
        var items = [], mine = st.me, mov = (st.phase === 'move' && st.turn === mine) ? st.movable : [];
        st.players.forEach(function (pl, s) {
            var col = pl.color;
            (disp || st.pieces)[s].forEach(function (p, i) {
                var pos = cellPos(col, p, i), key = p === -1 || p === 56 ? 'x' + s + i : pos[0].toFixed(2) + ',' + pos[1].toFixed(2);
                items.push({ s: s, i: i, p: p, col: col, x: pos[0], y: pos[1], key: key, glow: s === mine && mov.indexOf(i) >= 0 && !anim });
            });
        });
        var groups = {};
        items.forEach(function (it) { (groups[it.key] = groups[it.key] || []).push(it); });
        Object.keys(groups).forEach(function (k) {
            var g = groups[k];
            g.forEach(function (it, n) { if (g.length > 1 && k.charAt(0) !== 'x') { var an = n * 2 * Math.PI / g.length; it.x += Math.cos(an) * 0.2; it.y += Math.sin(an) * 0.2; } });
        });
        items.sort(function (a, b) { return a.y - b.y; });
        items.forEach(function (it) { drawPiece(it.x * C, it.y * C, it.col, it.glow, t); });
        st._items = items;
    }
    function loop(t) { raf = requestAnimationFrame(loop); if ($('#ludo-screen').is(':visible')) draw(t); }

    // ───────── الحالة ─────────
    function finishAnim() { if (anim) { clearInterval(anim.iv); anim = null; } if (st) disp = st.pieces.map(function (a) { return a.slice(); }); }
    function animate(last) {
        var s = last.seat, i = last.piece, steps = [];
        if (last.from === -1) steps = [last.to]; else for (var p = last.from + 1; p <= last.to; p++) steps.push(p);
        var base = st.pieces.map(function (a) { return a.slice(); });
        // القطع المأكولة تبقى حيث كانت حتى تصل القطعة الآكلة
        (last.cap || []).forEach(function (c) { base[c.seat][c.piece] = capPos(c, last); });
        disp = base; disp[s][i] = last.from;
        var n = 0;
        anim = { iv: setInterval(function () {
            if (n >= steps.length) { finishAnim(); return; }
            disp[s][i] = steps[n++];
        }, last.from === -1 ? 60 : 150) };
        anim.s = s;
    }
    function capPos(c, last) { return (st.pieces[last.seat][last.piece] >= 0) ? lastAbsAsOwn(c, last) : -1; }
    function lastAbsAsOwn(c, last) {
        // موقع القطعة المأكولة بالنسبة إلى لونها (هي على نفس الخانة المطلقة)
        var abs = (START[st.players[last.seat].color] + last.to) % 52;
        return (abs - START[st.players[c.seat].color] + 52) % 52;
    }
    function render() {
        if (!st) return;
        var me = st.me, mine = st.turn === me, over = st.winner !== null && st.winner !== undefined;
        var pl = st.players[st.turn];
        var $t = $('#lu-turn').css('background', over ? '#444' : COLORS[pl.color]);
        var txt;
        if (over) txt = '🏆 ' + tr_('انتهت اللعبة');
        else if (mine && st.phase === 'roll') txt = tr_('دورك: ارمِ النرد');
        else if (mine) txt = tr_('اختر قطعة لتحريكها');
        else txt = tr_('دور') + ' ' + pl.name;
        $t.text(txt);
        $('#lu-roll').prop('disabled', !(mine && st.phase === 'roll' && !over));
        if (!rollingIv) setDie(st.dice || st.shown || 0);
        $('#lu-over').toggleClass('hidden', !over);
        if (over) {
            $('#lu-over-t').text(st.winner === me ? '🏆 ' + tr_('فزت!') : '🏁 ' + tr_('فاز') + ' ' + st.players[st.winner].name);
            $('[data-lu="again"]').toggleClass('hidden', !aiBots);
        }
    }
    socket.on('lu_state', function (s) {
        err('');
        var prev = st;
        room = s;
        if (!s.started) { st = null; lobbyView(); return; }
        if (!$('#ludo-screen').is(':visible')) APP.show('ludo-screen');
        finishAnim();
        st = s;
        if (s.rolled) st.shown = s.rolled;
        if (!prev || !prev.pieces) disp = s.pieces.map(function (a) { return a.slice(); });
        else if (s.last && JSON.stringify(prev.pieces) !== JSON.stringify(s.pieces)) animate(s.last);
        else disp = s.pieces.map(function (a) { return a.slice(); });
        if (rollingIv) { clearInterval(rollingIv); rollingIv = 0; }
        if (s.rolled && !prev) setDie(s.rolled);
        $('#lu-home,#lu-lobby').addClass('hidden'); $('#lu-play').removeClass('hidden');
        if (!raf) raf = requestAnimationFrame(loop);
        render();
        if (s.passed) { $('#lu-turn').text((s.triple ? '⚠ ' + tr_('ثلاث ستات! ضاع الدور') : tr_('لا حركة ممكنة'))); setDie(s.rolled); }
    });
    function lobbyView() {
        $('#lu-home,#lu-play').addClass('hidden'); $('#lu-lobby').removeClass('hidden');
        $('#lu-code').text(room.code);
        var $l = $('#lu-players').empty();
        room.players.forEach(function (p, i) {
            var $li = $('<li class="lu-pl"></li>');
            $('<i></i>').css('background', COLORS[[0, 1, 2, 3][i]]).appendTo($li);
            $('<span></span>').text(p.name + (i === room.me ? ' (' + tr_('أنت') + ')' : '') + (i === 0 ? ' 👑' : '')).appendTo($li);
            $l.append($li);
        });
        var host = room.me === 0;
        $('#lu-start').toggleClass('hidden', !host); $('#lu-wait').toggleClass('hidden', host);
    }
    function homeView() { st = null; disp = null; finishAnim(); $('#lu-play,#lu-lobby').addClass('hidden'); $('#lu-home').removeClass('hidden'); }
    socket.on('lu_error', function (m) { err(m); });
    socket.on('lu_searching', function (d) { $('#lu-searching').toggleClass('hidden', !d.on); });

    // ───────── الإدخال ─────────
    $(document).on('click', '#lu-canvas', function (e) {
        if (!st || st.phase !== 'move' || st.turn !== st.me || anim) return;
        var r = this.getBoundingClientRect(), x = (e.clientX - r.left) * SZ / r.width / C, y = (e.clientY - r.top) * SZ / r.height / C;
        var best = null, bd = 1.1;
        (st._items || []).forEach(function (it) { if (it.s === st.me && st.movable.indexOf(it.i) >= 0) { var d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = it; } } });
        if (best) socket.emit('lu_move', { piece: best.i });
    });
    function rollNow() {
        if (!st || st.turn !== st.me || st.phase !== 'roll') return;
        socket.emit('lu_roll');
        $('#lu-roll').prop('disabled', true);
        var n = 0; rollingIv = setInterval(function () { setDie(1 + Math.floor(Math.random() * 6)); if (++n > 14) { clearInterval(rollingIv); rollingIv = 0; } }, 70);
    }
    $(document).on('keydown', function (e) { if (e.key === ' ' && $('#lu-play').is(':visible') && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) { e.preventDefault(); rollNow(); } });
    $(document).on('click', '#ludo-screen [data-lu]', function () {
        var a = $(this).data('lu');
        if (a === 'help') $('#lu-help').toggleClass('hidden');
        else if (a === 'ai') { aiBots = parseInt($('#lu-bots').val(), 10) || 3; socket.emit('lu_create_ai', { bots: aiBots }); }
        else if (a === 'again') { socket.emit('lu_leave'); homeView(); setTimeout(function () { socket.emit('lu_create_ai', { bots: aiBots }); }, 150); }
        else if (a === 'quick') { aiBots = 0; socket.emit('lu_quick'); }
        else if (a === 'quickcancel') socket.emit('lu_quick_cancel');
        else if (a === 'create') { aiBots = 0; socket.emit('lu_create'); }
        else if (a === 'join') { aiBots = 0; socket.emit('lu_join', { code: $('#lu-join').val() }); }
        else if (a === 'start') socket.emit('lu_start');
        else if (a === 'roll') rollNow();
        else if (a === 'copy') { try { navigator.clipboard.writeText(room.code); } catch (e) { /* */ } }
        else if (a === 'leave' || a === 'exit') { socket.emit('lu_leave'); room = null; homeView(); }
    });
    window.Ludo = {
        open: function () { err(''); if (st) return; if (room && !room.started) lobbyView(); else homeView(); },
        leave: function () { socket.emit('lu_leave'); room = null; homeView(); }
    };
    cv = document.getElementById('lu-canvas'); ctx = cv && cv.getContext('2d');
    var lastVisible = false;
    setInterval(function () { var v = $('#ludo-screen').is(':visible'); if (lastVisible && !v && (st || room)) window.Ludo.leave(); lastVisible = v; }, 700);
})();
