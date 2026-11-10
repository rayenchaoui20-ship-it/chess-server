/* لعبة الورق: واجهة العميل. الخادم هو المرجع الوحيد للأوراق والقواعد؛ هنا العرض والحركات فقط. */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;
    var SKIP = 10, REV = 11, DRAW2 = 12, WILD = 13, WILD4 = 14;
    var COLOR_NAMES = ['أحمر', 'أزرق', 'أخضر', 'ذهبي'];
    var SHAPES = ['●', '▲', '■', '◆'];
    var st = null, room = null, prev = null, aiBots = 0, pendingFrom = null, pendingWild = null, tick = 0, overT = 0;
    // العبارات ذات المتغيرات: نركّب النص العربي أولًا ثم يطابقه نمط الترجمة (مثل 'دور {n}')
    function tr_(s, p) {
        var x = p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return p[k]; }) : s;
        return (window.Lang && window.Lang.t) ? window.Lang.t(x) : x;
    }
    function err(m) { $('#cd-error').text(m ? tr_(m) : ''); }
    function toastMsg(m) { var t = $('<div class="looks-toast"></div>').text(m).appendTo('body'); setTimeout(function () { t.remove(); }, 1800); }

    // ───────── رسم الورقة ─────────
    var SVG = {
        skip: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="6"/><path d="M13 35 35 13" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>',
        rev: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 18h26l-7-7M40 30H14l7 7" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        wild: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 24V6a18 18 0 0 1 18 18z" fill="#3080e2"/><path d="M24 24h18a18 18 0 0 1-18 18z" fill="#f7b028"/><path d="M24 24v18A18 18 0 0 1 6 24z" fill="#1eaa78"/><path d="M24 24H6A18 18 0 0 1 24 6z" fill="#ec5448"/></svg>'
    };
    function face(card) {
        var v = card.v;
        if (v <= 9) return '<span class="cdk-n">' + v + '</span>';
        if (v === SKIP) return '<span class="cdk-i">' + SVG.skip + '</span>';
        if (v === REV) return '<span class="cdk-i">' + SVG.rev + '</span>';
        if (v === DRAW2) return '<span class="cdk-n sm">+2</span>';
        if (v === WILD) return '<span class="cdk-i pie">' + SVG.wild + '</span>';
        return '<span class="cdk-i pie">' + SVG.wild + '<b>+4</b></span>';
    }
    function corner(card) {
        var t = card.v <= 9 ? card.v : card.v === DRAW2 ? '+2' : card.v === WILD4 ? '+4' : card.v === SKIP ? '⦸' : card.v === REV ? '⇄' : '✦';
        return t + (card.c < 4 ? '<s>' + SHAPES[card.c] + '</s>' : '');
    }
    function cardEl(card, extra) {
        var el = $('<div class="cdk"></div>').attr('data-c', card.c).attr('data-v', card.v).addClass(extra || '');
        el.append('<i class="cdk-c tl">' + corner(card) + '</i><div class="cdk-m">' + face(card) + '</div><i class="cdk-c br">' + corner(card) + '</i>');
        return el;
    }
    function backEl(extra) { return $('<div class="cdk back"></div>').addClass(extra || '').append('<div class="cdk-m"><span class="cdk-star"></span></div>'); }

    // ───────── الحركات ─────────
    function fly(srcRect, dstEl, ms) {
        try {
            if (!srcRect || !dstEl || !dstEl.getBoundingClientRect || !dstEl.animate) return;
            var d = dstEl.getBoundingClientRect();
            var dx = srcRect.left + srcRect.width / 2 - (d.left + d.width / 2), dy = srcRect.top + srcRect.height / 2 - (d.top + d.height / 2);
            var k = Math.max(0.35, Math.min(1.2, srcRect.width / Math.max(1, d.width)));
            dstEl.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ') rotate(-18deg)', opacity: .5 }, { transform: 'none', opacity: 1 }], { duration: ms || 420, easing: 'cubic-bezier(.2,.8,.25,1)' });
        } catch (e) { /* */ }
    }
    function flash(text, cls) {
        var f = $('#cd-flash').empty();
        $('<span class="cd-fl"></span>').addClass(cls || '').text(text).appendTo(f);
        clearTimeout(flash.t); flash.t = setTimeout(function () { f.empty(); }, 1300);
    }
    function nm(i) { return st && st.players[i] ? st.players[i].name : ''; }

    // ───────── العرض ─────────
    function render() {
        if (!st) return;
        var me = st.me, myTurn = !st.watching && st.turn === me && st.winner === null;
        // الخصوم بترتيب الجلوس بعد اللاعب
        var order = [], n = st.players.length;
        if (st.watching) { for (var q = 0; q < n; q++) order.push(q); } else { for (var k = 1; k < n; k++) order.push((me + k) % n); }
        var $o = $('#cd-opps').empty().attr('data-n', order.length);
        order.forEach(function (i) {
            var p = st.players[i];
            var $p = $('<div class="cd-opp" data-seat="' + i + '"></div>').toggleClass('turn', st.turn === i && st.winner === null).toggleClass('gone', !!p.gone);
            var av = $('<div class="cd-av"></div>');
            if (window.Deco) av.append(window.Deco.el(p.name, p.d)); else av.text(p.name);
            $p.append(av);
            var fan = $('<div class="cd-ofan"></div>');
            for (var j = 0; j < Math.min(p.n, 6); j++) fan.append(backEl('mini'));
            $p.append(fan).append($('<span class="cd-cnt"></span>').text(p.n));
            if (p.n === 1 && st.winner === null) $p.append($('<span class="cd-last"></span>').text(tr_('آخر ورقة!')));
            if (p.bot) $p.addClass('bot');
            $o.append($p);
        });
        // الوسط
        $('#cd-deck-n').text(st.deckN);
        var top = st.top;
        var $pile = $('#cd-pile').empty();
        var tel = cardEl(top, 'on-pile').css('--rot', ((top.c * 7 + top.v * 3) % 15 - 7) + 'deg');
        $pile.append(tel);
        $('#cd-ring').attr('data-c', st.color);
        $('#cd-dir').text(st.dir === 1 ? '↻' : '↺').attr('data-c', st.color);
        var lastKey = st.last ? JSON.stringify(st.last) : '';
        var fresh = lastKey && (!prev || JSON.stringify(prev.last || null) !== lastKey);
        if (fresh && st.last.type === 'play') {
            var src = null;
            if (st.last.by === me) src = pendingFrom;
            else { var oe = $('#cd-opps .cd-opp[data-seat="' + st.last.by + '"]')[0]; if (oe) src = oe.getBoundingClientRect(); }
            fly(src, tel[0], 440);
            var c = st.last.card;
            if (c.v === SKIP) flash('🚫 ' + tr_('منع') + ' ' + nm(st.last.skipped), 'sk');
            else if (c.v === REV) flash('🔄 ' + tr_('عكس!'), 'rv');
            else if (c.v === DRAW2) flash('+2 · ' + nm(st.last.skipped), 'dr');
            else if (c.v === WILD4) flash('+4 · ' + nm(st.last.skipped), 'dr');
            else if (c.v === WILD) flash('🎨 ' + tr_(COLOR_NAMES[st.last.color]), 'wd');
        }
        pendingFrom = null;
        // الدور
        var tt;
        if (st.winner !== null) tt = '';
        else if (myTurn) tt = st.phase === 'drawn' ? tr_('يمكنك لعب الورقة المسحوبة أو التمرير') : tr_('دورك');
        else tt = tr_('دور {n}', { n: nm(st.turn) });
        $('#cd-turn').text(tt).toggleClass('mine', myTurn);
        // يدي
        var $h = $('#cd-hand').empty().toggleClass('hidden', st.watching);
        $('#cd-me').toggleClass('hidden', st.watching).toggleClass('turn', myTurn);
        if (!st.watching) {
            var mp = st.players[me], $m = $('#cd-me').empty();
            var a = $('<span class="cd-me-n"></span>');
            if (window.Deco) a.append(window.Deco.el(mp.name, mp.d)); else a.text(mp.name);
            $m.append(a).append($('<span class="cd-cnt"></span>').text(st.hand.length));
            if (st.hand.length === 1 && st.winner === null) $m.append($('<span class="cd-last"></span>').text(tr_('آخر ورقة!')));
            var prevLen = prev && prev.hand && prev.started && !(prev.winner !== null) ? prev.hand.length : st.hand.length;
            var list = st.hand.map(function (c, i) { return { c: c, i: i }; });
            list.sort(function (x, y) { return (x.c.c - y.c.c) || (x.c.v - y.c.v); });
            var okSet = {}; (st.ok || []).forEach(function (i) { okSet[i] = 1; });
            var width = $('#cd-hand').width() || 340, cw = 72;
            var ov = list.length > 1 ? Math.min(0, Math.max(-cw + 18, (width - 8 - cw * list.length) / (list.length - 1))) : 0;
            var deckEl = $('#cd-deck')[0];
            list.forEach(function (x, idx) {
                var ok = !!okSet[x.i] && myTurn;
                var el = cardEl(x.c, 'hand-c').toggleClass('ok', ok).toggleClass('dim', myTurn && !ok).attr('data-i', x.i).css('margin-inline-start', idx ? ov + 'px' : 0).attr('tabindex', ok ? 0 : -1);
                if (ok) el.attr('role', 'button');
                $h.append(el);
                if (x.i >= prevLen && deckEl && st.winner === null) fly(deckEl.getBoundingClientRect(), el[0], 460);
            });
        }
        // الأزرار
        $('#cd-drawbtn').toggleClass('hidden', st.watching).prop('disabled', !(myTurn && st.phase === 'play'));
        $('#cd-pass').toggleClass('hidden', !(myTurn && st.phase === 'drawn'));
        $('#cd-deck').toggleClass('can', myTurn && st.phase === 'play');
        $('#cd-reactbar').toggleClass('hidden', false);
        // النهاية
        if (st.winner !== null) showOver(); else { clearTimeout(overT); $('#cd-over').addClass('hidden'); $('#cd-again').prop('disabled', false); }
    }
    function showOver() {
        clearTimeout(overT);
        overT = setTimeout(function () {
            if (!st || st.winner === null) return;
            var won = !st.watching && st.winner === st.me;
            $('#cd-over-e').text(won ? '🏆' : '🃏');
            $('#cd-over-t').text(won ? tr_('فزت بالجولة!') : tr_('فاز {n}', { n: nm(st.winner) }));
            var left = st.players.map(function (p, i) { return i === st.winner ? null : p.name + ': ' + (st.reveal ? st.reveal[i].length : p.n); }).filter(Boolean).join(' · ');
            var tally = (st.tally || []).map(function (t, i) { return st.players[i] ? st.players[i].name + ' ' + t : ''; }).join(' · ');
            $('#cd-over-s').text((left ? tr_('الأوراق المتبقية') + ': ' + left : '') + (tally ? '\n' + tr_('النتيجة') + ': ' + tally : ''));
            $('#cd-over').removeClass('hidden');
        }, 900);
    }
    function lobbyView() {
        $('#cd-home,#cd-play').addClass('hidden'); $('#cd-lobby').removeClass('hidden');
        $('#cd-code').text(room.code);
        var $l = $('#cd-players').empty();
        room.players.forEach(function (p, i) {
            var $li = $('<li class="lu-pl"></li>');
            $('<i></i>').css('background', ['#ec5448', '#3080e2', '#1eaa78', '#f7b028'][i % 4]).appendTo($li);
            $('<span></span>').text(p.name + (i === room.me ? ' (' + tr_('أنت') + ')' : '') + (i === 0 ? ' 👑' : '')).appendTo($li);
            $l.append($li);
        });
        var host = room.me === 0;
        $('#cd-lobby .row:has([data-cd="wa"])').toggleClass('hidden', room.me < 0);
        $('#cd-start').toggleClass('hidden', !host); $('#cd-wait').toggleClass('hidden', host);
    }
    function homeView() { st = null; prev = null; $('#cd-play,#cd-lobby').addClass('hidden'); $('#cd-home').removeClass('hidden'); $('#cd-over,#cd-colorpick').addClass('hidden'); }

    socket.on('cd_state', function (s) {
        err('');
        room = s;
        if (!s.started) { st = null; lobbyView(); return; }
        if (!$('#cards-screen').is(':visible')) APP.show('cards-screen');
        prev = st; st = s;
        $('#cd-home,#cd-lobby').addClass('hidden'); $('#cd-play').removeClass('hidden');
        render();
        startTick();
    });
    function startTick() {
        clearInterval(tick);
        tick = setInterval(function () {
            if (!st || !st.deadline || st.winner !== null || st.turn !== st.me || st.watching) { $('#cd-turn .cd-sec').remove(); return; }
            var left = Math.max(0, Math.ceil((st.deadline - Date.now()) / 1000));
            var $s = $('#cd-turn .cd-sec'); if (!$s.length) $s = $('<span class="cd-sec"></span>').appendTo('#cd-turn');
            $s.text(' · ' + left + 's').toggleClass('low', left <= 8);
        }, 500);
    }
    socket.on('cd_error', function (m) { err(m); });
    socket.on('cd_closed', function () { room = null; homeView(); err('انتهت هذه الغرفة.'); });
    socket.on('cd_searching', function (d) { $('#cd-searching').toggleClass('hidden', !d.on); });
    socket.on('cd_react', function (d) {
        if (!d || typeof d.e !== 'string') return;
        var el = $('<div class="mp-react">').append($('<span class="re">').text(d.e), $('<span class="rn">').text(String(d.from || '')));
        var box = $('#cd-reacts').append(el);
        while (box.children().length > 6) box.children().first().remove();
        setTimeout(function () { el.remove(); }, 2800);
    });
    $(document).on('click', '#cd-reactbar [data-creact]', function () { socket.emit('cd_react', { e: $(this).attr('data-creact') }); });
    socket.on('cd_top', function (d) {
        var host = $('#cd-top').empty().removeClass('hidden');
        if (d && d.mine) host.append($('<p class="muted">').text(tr_('ألعابك') + ': ' + d.mine.g + ' · ' + tr_('انتصاراتك') + ': ' + d.mine.w + ' · ' + tr_('ضد بشر') + ': ' + d.mine.wh));
        function block(title, rows) {
            host.append($('<h4>').text(tr_(title)));
            var ul = $('<ul class="fr-list">').appendTo(host);
            if (!rows || !rows.length) return ul.append($('<li class="empty">').text(tr_('لا يوجد ترتيب بعد. اربح ضد لاعبين حقيقيين لتظهر هنا.')));
            rows.forEach(function (r, i) { ul.append($('<li>').append($('<span class="nm">').append(document.createTextNode((['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' '), window.Deco ? window.Deco.el(r.user, r.d) : document.createTextNode(r.user)), $('<span class="muted">').text(' · ' + r.w + ' ' + tr_('فوز')))); });
        }
        block('هذا الشهر', d && d.month);
        block('كل الأوقات', d && d.all);
    });
    function rejoin() { if ($('#cards-screen').is(':visible') && !st) socket.emit('cd_rejoin'); }
    socket.on('connect', function () { setTimeout(rejoin, 400); });
    socket.on('welcome', function () { setTimeout(rejoin, 600); });

    // ───────── الإدخال ─────────
    function playCard(i, rect) {
        if (!st || st.watching || st.turn !== st.me || (st.ok || []).indexOf(i) < 0) return;
        var c = st.hand[i];
        pendingFrom = rect || null;
        if (c.c === 4) { pendingWild = i; openPicker(); return; }
        socket.emit('cd_play', { idx: i });
    }
    function openPicker() {
        var row = $('#cd-cp-row').empty();
        ['#ec5448', '#3080e2', '#1eaa78', '#f7b028'].forEach(function (col, k) {
            $('<button type="button" class="cd-cp"></button>').css('background', col).attr('data-k', k).attr('aria-label', tr_(COLOR_NAMES[k])).text(SHAPES[k]).appendTo(row);
        });
        $('#cd-colorpick').removeClass('hidden');
    }
    $(document).on('click', '#cd-cp-row .cd-cp', function () {
        var k = parseInt($(this).attr('data-k'), 10);
        $('#cd-colorpick').addClass('hidden');
        if (pendingWild !== null) socket.emit('cd_play', { idx: pendingWild, color: k });
        pendingWild = null;
    });
    $(document).on('click keydown', '#cd-hand .cdk.ok', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        playCard(parseInt($(this).attr('data-i'), 10), this.getBoundingClientRect());
    });
    function shareLink() { return location.origin + '/?cards=' + (room ? room.code : ''); }
    $(document).on('click', '#cards-screen [data-cd]', function () {
        var a = $(this).data('cd');
        if (a === 'help') $('#cd-help').toggleClass('hidden');
        else if (a === 'ai') { aiBots = parseInt($('#cd-bots').val(), 10) || 2; socket.emit('cd_create_ai', { bots: aiBots }); }
        else if (a === 'again') { socket.emit('cd_rematch'); $('#cd-again').prop('disabled', true); }
        else if (a === 'watch') socket.emit('cd_watch', { code: $('#cd-join').val() });
        else if (a === 'wa') { window.open('https://wa.me/?text=' + encodeURIComponent(tr_('تعال العب لعبة الورق معي! ادخل من هنا') + ': ' + shareLink()), '_blank'); }
        else if (a === 'link') { try { navigator.clipboard.writeText(shareLink()); toastMsg(tr_('تم نسخ الرابط')); } catch (e) { /* */ } }
        else if (a === 'quick') { aiBots = 0; socket.emit('cd_quick'); }
        else if (a === 'quickcancel') socket.emit('cd_quick_cancel');
        else if (a === 'create') { aiBots = 0; socket.emit('cd_create'); }
        else if (a === 'join') { aiBots = 0; socket.emit('cd_join', { code: $('#cd-join').val() }); }
        else if (a === 'start') socket.emit('cd_start');
        else if (a === 'draw') { if (st && st.turn === st.me && st.phase === 'play') socket.emit('cd_draw'); }
        else if (a === 'pass') socket.emit('cd_pass');
        else if (a === 'cpcancel') { $('#cd-colorpick').addClass('hidden'); pendingWild = null; }
        else if (a === 'top') { var tl = $('#cd-top'); if (tl.is(':visible')) tl.addClass('hidden'); else socket.emit('cd_top'); }
        else if (a === 'copy') { try { navigator.clipboard.writeText(room.code); } catch (e) { /* */ } }
        else if (a === 'leave' || a === 'exit') { socket.emit('cd_leave'); room = null; homeView(); }
    });
    // رابط التحدّي: /?cards=ABCD
    var pendingCode = null;
    try { var pc = new URLSearchParams(location.search).get('cards'); if (pc && /^[A-Za-z]{4}$/.test(pc)) { pendingCode = pc.toUpperCase(); history.replaceState(null, '', location.pathname); } } catch (e) { /* */ }
    socket.on('welcome', function () {
        if (!pendingCode) return;
        var c = pendingCode; pendingCode = null;
        setTimeout(function () { APP.show('cards-screen'); aiBots = 0; $('#cd-join').val(c); socket.emit('cd_join', { code: c }); }, 900);
    });
    window.addEventListener('resize', function () { if (st && $('#cards-screen').is(':visible')) { var p = prev; render(); prev = p; } });
    window.Cards = {
        open: function () { err(''); socket.emit('cd_rejoin'); if (st) return; if (room && !room.started) lobbyView(); else homeView(); },
        leave: function () { socket.emit('cd_leave'); room = null; homeView(); },
        state: function () { return st; }
    };
    var lastVisible = false;
    setInterval(function () { var v = $('#cards-screen').is(':visible'); if (lastVisible && !v && (st || room)) window.Cards.leave(); lastVisible = v; }, 700);
})();
