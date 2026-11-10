/* تحدّي اليوم: بطاقة في شاشة اختيار اللعبة (3 تحدّيات، سلسلة أيام، ترتيب اليوم). */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;
    function tr_(s) { return (window.Lang && window.Lang.t) ? window.Lang.t(s) : s; }
    function host() {
        var h = $('#gc-card');
        if (h.length) return h;
        h = $('<section id="gc-card" class="gc-card hidden" aria-label="تحدّي اليوم"></section>');
        $('#world-screen .world-grid').after(h);
        return h;
    }
    function render(d) {
        if (!d) return;
        var h = host().removeClass('hidden').empty();
        var head = $('<div class="gc-head"></div>').appendTo(h);
        $('<h3></h3>').text('🎯 ' + tr_('تحدّي اليوم')).appendTo(head);
        if (!d.guest) $('<span class="gc-streak"></span>').text('🔥 ' + d.streak + ' ' + tr_('يوم')).appendTo(head);
        var ul = $('<ul class="gc-list"></ul>').appendTo(h);
        (d.list || []).forEach(function (c) {
            var li = $('<li></li>').toggleClass('done', !!c.done).appendTo(ul);
            $('<span class="gc-ck"></span>').text(c.done ? '✅' : '⬜').appendTo(li);
            $('<span class="gc-tx"></span>').text(tr_(c.text)).appendTo(li);
            $('<b class="gc-pg"></b>').text(c.prog + '/' + c.n).appendTo(li);
        });
        if (d.guest) $('<p class="muted small"></p>').text(tr_('سجّل حسابًا مجانيًا لتُحتسب تحدّياتك وتظهر في الترتيب.')).appendTo(h);
        var det = $('<details class="gc-top"></details>').appendTo(h);
        $('<summary></summary>').text('🏆 ' + tr_('ترتيب اليوم')).appendTo(det);
        var tl = $('<ol></ol>').appendTo(det);
        if (!d.top || !d.top.length) $('<li class="empty"></li>').text(tr_('لا أحد أنجز تحدّيًا بعد. كن الأول!')).appendTo(tl);
        (d.top || []).forEach(function (r, i) {
            $('<li></li>').append($('<span></span>').append(document.createTextNode((['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' '), window.Deco ? window.Deco.el(r.user, r.d) : document.createTextNode(r.user)), $('<b></b>').text(r.n + '/' + (d.total || 3))).appendTo(tl);
        });
    }

    // ───────── دوري الأصدقاء الأسبوعي ─────────
    var pendingLg = null;
    try { var pl = new URLSearchParams(location.search).get('league'); if (pl && /^[A-Za-z0-9]{5}$/.test(pl)) { pendingLg = pl.toUpperCase(); history.replaceState(null, '', location.pathname); } } catch (e) { /* */ }
    function lgHost() {
        var h = $('#lg-card');
        if (h.length) return h;
        h = $('<section id="lg-card" class="gc-card lg-card hidden" aria-label="دوري الأصدقاء"></section>');
        ($('#gc-card').length ? $('#gc-card') : $('#world-screen .world-grid')).after(h);
        return h;
    }
    function lgLink(code) { return location.origin + '/?league=' + code; }
    function lgRender(d) {
        if (!d) return;
        var h = lgHost().removeClass('hidden').empty();
        $('<div class="gc-head"></div>').append($('<h3></h3>').text('👥 ' + tr_('دوري الأصدقاء الأسبوعي'))).appendTo(h);
        $('<p class="lg-err small"></p>').appendTo(h);
        if (d.guest) { $('<p class="muted small"></p>').text(tr_('سجّل حسابًا مجانيًا لتنشئ دوريًا مع أصدقائك.')).appendTo(h); return; }
        if (d.none) {
            $('<p class="muted small"></p>').text(tr_('العبوا ضد بعض في كل الألعاب. فوز = 3 نقاط، تعادل = 2، مشاركة = 1. يفوز من يجمع أكثر في الأسبوع.')).appendTo(h);
            var r1 = $('<div class="row"></div>').appendTo(h);
            $('<input type="text" class="field" id="lg-name" maxlength="24" autocomplete="off">').attr({ placeholder: tr_('اسم الدوري'), 'aria-label': tr_('اسم الدوري') }).appendTo(r1);
            $('<button class="btn primary" data-lg="create"></button>').text(tr_('أنشئ')).appendTo(r1);
            var r2 = $('<div class="row"></div>').appendTo(h);
            $('<input type="text" class="field code-input" id="lg-code" maxlength="5" autocomplete="off" autocapitalize="characters" dir="ltr">').attr({ placeholder: 'ABCDE', 'aria-label': tr_('كود الدوري') }).appendTo(r2);
            $('<button class="btn secondary" data-lg="join"></button>').text(tr_('انضم')).appendTo(r2);
            return;
        }
        $('<p class="small"></p>').append($('<b translate="no"></b>').text(d.name), document.createTextNode(' · ' + tr_('الكود') + ' '), $('<code dir="ltr"></code>').text(d.code), document.createTextNode(' · ' + tr_('يتبقى') + ' ' + d.left + ' ' + tr_('يوم'))).appendTo(h);
        if (d.fri) $('<p class="lg-fri"></p>').text('🔥 ' + tr_('ليلة الجمعة: نقاط دوري الأصدقاء مضاعفة اليوم!')).appendTo(h);
        var ol = $('<ol class="lg-rows"></ol>').appendTo(h);
        d.rows.forEach(function (r, i) {
            $('<li></li>').toggleClass('me', !!r.me).append($('<span></span>').append(document.createTextNode((['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' '), window.Deco ? window.Deco.el(r.user, r.d) : document.createTextNode(r.user)), $('<small></small>').text(r.w + '/' + r.g), $('<b></b>').text(r.pts)).appendTo(ol);
        });
        if (d.hist && d.hist.length) {
            var det = $('<details class="gc-top"></details>').appendTo(h);
            $('<summary></summary>').text('🏆 ' + tr_('أبطال الأسابيع السابقة')).appendTo(det);
            var hl = $('<ul class="lg-hist"></ul>').appendTo(det);
            d.hist.forEach(function (x) { $('<li translate="no"></li>').text(x.week + ' · 👑 ' + x.user + ' (' + x.pts + ')').appendTo(hl); });
        }
        var row = $('<div class="row lg-btns"></div>').appendTo(h);
        $('<button class="btn secondary" data-lg="wa"></button>').text('📲 ' + tr_('ادعُ أصدقاءك')).data('code', d.code).appendTo(row);
        $('<button class="btn ghost" data-lg="link"></button>').text('🔗 ' + tr_('انسخ الرابط')).data('code', d.code).appendTo(row);
        $('<button class="btn ghost" data-lg="leave"></button>').text(tr_('غادر الدوري')).appendTo(row);
    }
    socket.on('lg_state', lgRender);
    socket.on('lg_error', function (m) { $('#lg-card .lg-err').text(tr_(m)); });
    $(document).on('click', '#lg-card [data-lg]', function () {
        var a = $(this).data('lg');
        if (a === 'create') socket.emit('lg_create', { name: $('#lg-name').val() });
        else if (a === 'join') socket.emit('lg_join', { code: $('#lg-code').val() });
        else if (a === 'leave') socket.emit('lg_leave');
        else if (a === 'link') { try { navigator.clipboard.writeText(lgLink($(this).data('code'))); $('#lg-card .lg-err').text(tr_('تم نسخ الرابط')); } catch (e) { /* */ } }
        else if (a === 'wa') window.open('https://wa.me/?text=' + encodeURIComponent(tr_('انضم إلى دوري أصدقائنا الأسبوعي!') + ' ' + lgLink($(this).data('code'))), '_blank');
    });
    socket.on('welcome', function (w) {
        if (pendingLg && w && w.user) { var c = pendingLg; pendingLg = null; setTimeout(function () { APP.show('world-screen'); socket.emit('lg_join', { code: c }); }, 1000); }
    });
    socket.on('gc_state', render);
    function ask() { if ($('#world-screen').is(':visible') && socket.connected) { socket.emit('gc_get'); socket.emit('lg_get'); } }
    var was = false;
    setInterval(function () { var v = $('#world-screen').is(':visible'); if (v && !was) ask(); was = v; }, 600);
    setInterval(ask, 30000);
    socket.on('welcome', function () { setTimeout(ask, 500); });
})();
