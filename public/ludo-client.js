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
        [[2, 2], [4, 2], [2, 4], [4, 4]], [[11, 2], [13, 2], [11, 4], [13, 4]],
        [[11, 11], [13, 11], [11, 13], [13, 13]], [[2, 11], [4, 11], [2, 13], [4, 13]]
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
    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function lin(x0, y0, x1, y1, c0, c1) { var g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
    function lighten(h, k) { var n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
    function arrow(cx, cy, dir, col) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(dir * Math.PI / 2); ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(-9, -10); ctx.lineTo(9, -10); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    var boardImg = null;
    function drawBoardStatic() {
        // الخلفية
        ctx.fillStyle = lin(0, 0, SZ, SZ, '#fffaf0', '#efe6d2'); ctx.fillRect(0, 0, SZ, SZ);
        var quads = [[0, 0], [9, 0], [9, 9], [0, 9]];
        quads.forEach(function (q, i) {
            var x = q[0] * C, y = q[1] * C, w = 6 * C;
            ctx.fillStyle = lin(x, y, x + w, y + w, lighten(COLORS[i], 0.12), shade(COLORS[i])); ctx.fillRect(x, y, w, w);
            ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
            ctx.fillStyle = '#fffdf7'; rr(x + C * 0.9, y + C * 0.9, w - C * 1.8, w - C * 1.8, 26); ctx.fill(); ctx.restore();
            BASE[i].forEach(function (b) {
                var g = ctx.createRadialGradient(b[0] * C - 5, b[1] * C - 6, 2, b[0] * C, b[1] * C, 26);
                g.addColorStop(0, '#ffffff'); g.addColorStop(1, LIGHT[i]);
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b[0] * C, b[1] * C, 24, 0, 7); ctx.fill();
                ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 3; ctx.stroke();
                ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b[0] * C, b[1] * C, 20, 0.2, 2.6); ctx.stroke();
            });
        });
        // خانات المسار
        TRACK.forEach(function (c, i) {
            var col = -1; START.forEach(function (s, k) { if (s === i) col = k; });
            var x = c[0] * C, y = c[1] * C;
            ctx.fillStyle = col >= 0 ? lin(x, y, x + C, y + C, lighten(COLORS[col], 0.15), shade(COLORS[col])) : '#fffefa'; ctx.fillRect(x, y, C, C);
            ctx.strokeStyle = 'rgba(120,105,80,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, C - 1, C - 1);
            if (i % 13 === 8) star(x + C / 2, y + C / 2, 15, '#c7a54a');
            if (col >= 0) { star(x + C / 2, y + C / 2, 15, '#fff'); }
        });
        // أسهم الدخول إلى ممرات الفوز
        [[0, 7, 0.5 - 1.5 + 1], [7, 0, 2], [14, 7, 1], [7, 14, 0]].forEach(function () {});
        arrow(0.5 * C, 7.5 * C, -1, COLORS[0]); arrow(7.5 * C, 0.5 * C, 0, COLORS[1]); arrow(14.5 * C, 7.5 * C, 1, COLORS[2]); arrow(7.5 * C, 14.5 * C, 2, COLORS[3]);
        // ممرات الفوز
        COL.forEach(function (cells, k) {
            cells.forEach(function (c, n) {
                var x = c[0] * C, y = c[1] * C;
                ctx.fillStyle = lin(x, y, x + C, y + C, lighten(COLORS[k], 0.1 + n * 0.02), shade(COLORS[k])); ctx.fillRect(x, y, C, C);
                ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, C - 1, C - 1);
            });
        });
        // المركز
        var x0 = 6 * C, y0 = 6 * C, x1 = 9 * C, y1 = 9 * C, mx = 7.5 * C, my = 7.5 * C;
        [[x0, y0, x0, y1, 0], [x0, y0, x1, y0, 1], [x1, y0, x1, y1, 2], [x0, y1, x1, y1, 3]].forEach(function (t) {
            ctx.fillStyle = lin(mx, my, (t[0] + t[2]) / 2, (t[1] + t[3]) / 2, lighten(COLORS[t[4]], 0.2), shade(COLORS[t[4]]));
            ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        });
        var cg = ctx.createRadialGradient(mx, my, 2, mx, my, 18); cg.addColorStop(0, '#fff'); cg.addColorStop(1, '#e6d9b8');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(mx, my, 16, 0, 7); ctx.fill(); ctx.strokeStyle = '#b79a4b'; ctx.lineWidth = 2; ctx.stroke();
        star(mx, my, 11, '#c7a54a');
    }
    function drawBoard(t) {
        if (!boardImg) {
            boardImg = document.createElement('canvas'); boardImg.width = cv.width; boardImg.height = cv.height;
            var real = ctx; ctx = boardImg.getContext('2d'); ctx.setTransform(cv.width / SZ, 0, 0, cv.width / SZ, 0, 0); drawBoardStatic(); ctx = real;
        }
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(boardImg, 0, 0); ctx.restore();
        // توهّج قاعدة اللاعب صاحب الدور
        if (st && st.winner == null) {
            var q = [[0, 0], [9, 0], [9, 9], [0, 9]][st.players[st.turn].color];
            ctx.save(); ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t / 220); ctx.strokeStyle = '#fff'; ctx.lineWidth = 6;
            ctx.strokeRect(q[0] * C + 3, q[1] * C + 3, 6 * C - 6, 6 * C - 6); ctx.restore();
        }
        // آخر حركة
        if (st && st.last && !anim) {
            var l = st.last, pos = cellPos(st.players[l.seat].color, l.to, l.piece);
            ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = COLORS[st.players[l.seat].color]; ctx.beginPath(); ctx.arc(pos[0] * C, pos[1] * C, 24, 0, 7); ctx.fill(); ctx.restore();
        }
    }
    function drawPiece(x, y, color, glow, t) {
        var c = COLORS[color];
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 13, 14, 5.5, 0, 0, 7); ctx.fill();
        if (glow) { var k = 22 + Math.sin(t / 150) * 3; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y + 2, k, 0, 7); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y + 2, k + 2.5, 0, 7); ctx.stroke(); y -= 2 + Math.abs(Math.sin(t / 200)) * 3; }
        // قاعدة
        ctx.fillStyle = shade(c); ctx.beginPath(); ctx.ellipse(x, y + 10, 15, 6, 0, 0, 7); ctx.fill();
        // جسم
        var g = ctx.createLinearGradient(x - 12, 0, x + 12, 0); g.addColorStop(0, shade(c)); g.addColorStop(0.35, lighten(c, 0.35)); g.addColorStop(1, shade(c));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 13, y + 10); ctx.quadraticCurveTo(x - 6, y - 2, x - 5, y - 5); ctx.lineTo(x + 5, y - 5); ctx.quadraticCurveTo(x + 6, y - 2, x + 13, y + 10); ctx.closePath(); ctx.fill();
        // رأس
        var h = ctx.createRadialGradient(x - 4, y - 14, 1, x, y - 10, 11); h.addColorStop(0, '#fff'); h.addColorStop(0.3, lighten(c, 0.3)); h.addColorStop(1, shade(c));
        ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y - 10, 10, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 10, 10, 0, 7); ctx.stroke();
    }
    function shade(h) { var n = parseInt(h.slice(1), 16); var r = (n >> 16) * 0.66, g = ((n >> 8) & 255) * 0.66, b = (n & 255) * 0.66; return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
    function draw(t) {
        if (!st || !ctx) return;
        drawBoard(t);
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
        else if (st.watching) txt = '👁 ' + tr_('تشاهد') + ' · ' + tr_('دور') + ' ' + pl.name + (st.specs > 1 ? ' · 👁 ' + st.specs : '');
        else if (mine && st.phase === 'roll') txt = tr_('دورك: ارمِ النرد');
        else if (mine) txt = tr_('اختر قطعة لتحريكها');
        else txt = tr_('دور') + ' ' + pl.name;
        $t.text(txt);
        playersBar();
        $('#lu-roll').prop('disabled', !(mine && st.phase === 'roll' && !over));
        if (!rollingIv) setDie(st.dice || st.shown || 0);
        $('#lu-over').toggleClass('hidden', !over);
        if (over) {
            $('#lu-over-t').text(st.winner === me ? '🏆 ' + tr_('فزت!') : '🏁 ' + tr_('فاز') + ' ' + st.players[st.winner].name);
            $('#lu-again').toggleClass('hidden', !!st.watching);
            var iLost = !st.watching && st.winner !== me;
            if (!(st.rm && st.rm[me])) $('#lu-again').prop('disabled', false).text(iLost ? '⚔ ' + tr_('ثأر!') : '🔁 ' + tr_('العب مجددًا'));
            else $('#lu-again').prop('disabled', true).text('⏳ ' + tr_('بانتظار الباقين...'));
        }
    }
    function playersBar() {
        var $b = $('#lu-bar').empty();
        st.players.forEach(function (p, i) {
            var home = st.pieces[i].filter(function (x) { return x === 56; }).length;
            var $c = $('<div class="lu-chip"></div>').toggleClass('on', i === st.turn && st.winner == null).css('--c', COLORS[p.color]);
            $('<i></i>').appendTo($c);
            var nm = $('<span></span>').appendTo($c);
            if (window.Deco && p.d) nm.append(window.Deco.el(p.name, p.d), document.createTextNode((i === st.me ? ' ★' : '') + ((st.tally && st.tally[i]) ? ' 🏆' + st.tally[i] : '')));
            else nm.text(p.name + (i === st.me ? ' ★' : '') + ((st.tally && st.tally[i]) ? ' 🏆' + st.tally[i] : ''));
            $('<b></b>').text('🏠 ' + home + '/4').appendTo($c);
            $b.append($c);
        });
    }
    socket.on('lu_state', function (s) {
        err('');
        var prev = st;
        room = s;
        if (!s.started) { st = null; lobbyView(); return; }
        if (!$('#ludo-screen').is(':visible')) APP.show('ludo-screen');
        finishAnim();
        st = s;
        st.shown = s.rolled || (prev && prev.shown) || (s.last && s.last.dice) || 0;
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
        $('#lu-lobby .row:has([data-lu="wa"])').toggleClass('hidden', room.me < 0);
        $('#lu-start').toggleClass('hidden', !host); $('#lu-wait').toggleClass('hidden', host);
    }
    function homeView() { st = null; disp = null; finishAnim(); $('#lu-play,#lu-lobby').addClass('hidden'); $('#lu-home').removeClass('hidden'); }
    socket.on('lu_error', function (m) { err(m); });
    socket.on('lu_closed', function () { room = null; homeView(); err('انتهت هذه الغرفة.'); });
    socket.on('lu_react', function (d) {
        if (!d || typeof d.e !== 'string') return;
        var el = $('<div class="mp-react">').append($('<span class="re">').text(d.e), $('<span class="rn">').text(String(d.from || '')));
        var box = $('#lu-reacts').append(el);
        while (box.children().length > 6) box.children().first().remove();
        setTimeout(function () { el.remove(); }, 2800);
    });
    $(document).on('click', '#lu-reactbar [data-lreact]', function () { socket.emit('lu_react', { e: $(this).attr('data-lreact') }); });
    socket.on('lu_top', function (d) {
        var host = $('#lu-top').empty().removeClass('hidden');
        if (d && d.mine) host.append($('<p class="muted">').text(tr_('ألعابك') + ': ' + d.mine.g + ' · ' + tr_('انتصاراتك') + ': ' + d.mine.w + ' · ' + tr_('ضد بشر') + ': ' + d.mine.wh));
        function block(title, rows) {
            host.append($('<h4>').text(tr_(title)));
            var ul = $('<ul class="fr-list">').appendTo(host);
            if (!rows || !rows.length) return ul.append($('<li class="empty">').text(tr_('لا يوجد ترتيب بعد. اربح ضد لاعبين حقيقيين لتظهر هنا.')));
            rows.forEach(function (r, i) { ul.append($('<li>').append($('<span class="nm">').append(document.createTextNode((['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' '), window.Deco ? window.Deco.el(r.user, r.d) : document.createTextNode(r.user)), $('<span class="rt">').text(r.w + ' ' + tr_('فوز')))); });
        }
        block('هذا الشهر', d && d.month);
        block('كل الأوقات', d && d.all);
    });
    // العودة إلى لعبة جارية بعد انقطاع الاتصال أو إغلاق الصفحة
    function rejoin() { if ($('#ludo-screen').is(':visible') && !st) socket.emit('lu_rejoin'); }
    socket.on('connect', function () { setTimeout(rejoin, 400); });
    socket.on('welcome', function () { setTimeout(rejoin, 600); });
    socket.on('lu_searching', function (d) { $('#lu-searching').toggleClass('hidden', !d.on); });

    // ───────── الإدخال ─────────
    $(document).on('click', '#lu-canvas', function (e) {
        if (!st || st.phase !== 'move' || st.turn !== st.me || anim) return;
        var r = this.getBoundingClientRect(), x = (e.clientX - r.left) * SZ / r.width / C, y = (e.clientY - r.top) * SZ / r.height / C;
        var best = null, bd = 1.1;
        (st._items || []).forEach(function (it) { if (it.s === st.me && st.movable.indexOf(it.i) >= 0) { var d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = it; } } });
        if (best) socket.emit('lu_move', { piece: best.i });
    });
    function shareLink() { return location.origin + '/?ludo=' + (room ? room.code : ''); }
    function toastMsg(m) { var t = $('<div class="looks-toast"></div>').text(m).appendTo('body'); setTimeout(function () { t.remove(); }, 1800); }
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
        else if (a === 'again') { socket.emit('lu_rematch'); $('#lu-again').prop('disabled', true); }
        else if (a === 'watch') socket.emit('lu_watch', { code: $('#lu-join').val() })
        else if (a === 'wa') { var wl = shareLink(); window.open('https://wa.me/?text=' + encodeURIComponent(tr_('تعال العب ليدو معي! ادخل من هنا') + ': ' + wl), '_blank'); }
        else if (a === 'link') { try { navigator.clipboard.writeText(shareLink()); toastMsg(tr_('تم نسخ الرابط')); } catch (e) { /* */ } }
        else if (a === 'quick') { aiBots = 0; socket.emit('lu_quick'); }
        else if (a === 'quickcancel') socket.emit('lu_quick_cancel');
        else if (a === 'create') { aiBots = 0; socket.emit('lu_create'); }
        else if (a === 'join') { aiBots = 0; socket.emit('lu_join', { code: $('#lu-join').val() }); }
        else if (a === 'start') socket.emit('lu_start');
        else if (a === 'roll') rollNow();
        else if (a === 'top') { var tl = $('#lu-top'); if (tl.is(':visible')) tl.addClass('hidden'); else socket.emit('lu_top'); }
        else if (a === 'copy') { try { navigator.clipboard.writeText(room.code); } catch (e) { /* */ } }
        else if (a === 'leave' || a === 'exit') { socket.emit('lu_leave'); room = null; homeView(); }
    });
    // رابط التحدّي: /?ludo=ABCD يدخل صاحبه الغرفة مباشرة (حتى بلا تسجيل)
    var pendingCode = null;
    try { var pc = new URLSearchParams(location.search).get('ludo'); if (pc && /^[A-Za-z]{4}$/.test(pc)) { pendingCode = pc.toUpperCase(); history.replaceState(null, '', location.pathname); } } catch (e) { /* */ }
    socket.on('welcome', function () {
        if (!pendingCode) return;
        var c = pendingCode; pendingCode = null;
        setTimeout(function () { APP.show('ludo-screen'); aiBots = 0; $('#lu-join').val(c); socket.emit('lu_join', { code: c }); }, 900);
    });
    window.Ludo = {
        open: function () { err(''); socket.emit('lu_rejoin'); if (st) return; if (room && !room.started) lobbyView(); else homeView(); },
        leave: function () { socket.emit('lu_leave'); room = null; homeView(); }
    };
    cv = document.getElementById('lu-canvas'); ctx = cv && cv.getContext('2d');
    if (cv) { var k = Math.min(2, Math.max(1, window.devicePixelRatio || 1)); cv.width = SZ * k; cv.height = SZ * k; ctx.setTransform(k, 0, 0, k, 0, 0); }
    var lastVisible = false;
    setInterval(function () { var v = $('#ludo-screen').is(':visible'); if (lastVisible && !v && (st || room)) window.Ludo.leave(); lastVisible = v; }, 700);
})();
