/* بطولة الأسبوع (برعاية اختيارية) + فصولي (نسخة المدارس). بطاقتان في شاشة الألعاب. */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;
    function tr_(s, p) { var x = p ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return p[k]; }) : s; return (window.Lang && window.Lang.t) ? window.Lang.t(x) : x; }
    function after() { return $('#lg-card').length ? $('#lg-card') : $('#gc-card').length ? $('#gc-card') : $('#world-screen .world-grid'); }
    function name(u, d) { return window.Deco ? window.Deco.el(u, d) : document.createTextNode(u); }

    // ───────── بطولة الأسبوع ─────────
    function tnHost() {
        var h = $('#tn-card');
        if (h.length) return h;
        h = $('<section id="tn-card" class="gc-card tn-card hidden" aria-label="بطولة الأسبوع"></section>');
        after().after(h);
        return h;
    }
    socket.on('tn_state', function (d) {
        if (!d) return;
        var h = tnHost().removeClass('hidden').empty();
        $('<div class="gc-head"></div>').append($('<h3></h3>').text('🏆 ' + tr_('بطولة الأسبوع')), $('<span class="muted small"></span>').text(tr_('يتبقى') + ' ' + d.left + ' ' + tr_('يوم'))).appendTo(h);
        if (d.sponsor) $('<a class="tn-sp" target="_blank" rel="sponsored nofollow noopener"></a>').attr('href', d.sponsor.url).attr('translate', 'no').append($('<small class="muted"></small>').text(tr_('برعاية') + ' '), $('<b></b>').text(d.sponsor.name)).appendTo(h);
        $('<p class="muted small"></p>').text(tr_('كل لعبة ضد لاعبين حقيقيين تجمع نقاطًا: فوز 3، تعادل 2، مشاركة 1. أول ثلاثة ينالون إطارًا حصريًا، والأول يأخذ لقبًا. الجوائز شرفية فقط.')).appendTo(h);
        if (!d.rows.length) { $('<p class="muted"></p>').text(tr_('لا نقاط بعد هذا الأسبوع. العب ضد لاعبين حقيقيين لتتصدّر!')).appendTo(h); return; }
        var ol = $('<ol class="tn-list"></ol>').appendTo(h);
        d.rows.slice(0, 5).forEach(function (r, i) {
            $('<li></li>').append($('<span class="tn-r"></span>').text(['🥇', '🥈', '🥉'][i] || (i + 1)), $('<span class="tn-n"></span>').append(name(r.user, r.d)), $('<b class="tn-p"></b>').text(r.pts)).appendTo(ol);
        });
        if (d.me) $('<p class="small tn-me"></p>').text(tr_('ترتيبك: {r} · نقاطك: {p}', { r: d.me.rank, p: d.me.pts })).appendTo(h);
        else $('<p class="small muted tn-me"></p>').text(tr_('لم تجمع نقاطًا بعد هذا الأسبوع.')).appendTo(h);
    });

    // ───────── فصولي ─────────
    function clsHost() {
        var h = $('#cls-card');
        if (h.length) return h;
        h = $('<section id="cls-card" class="gc-card cls-card hidden" aria-label="فصولي"></section>');
        ($('#tn-card').length ? $('#tn-card') : after()).after(h);
        return h;
    }
    var last = null;
    function clsRender(d) {
        last = d;
        var h = clsHost().empty();
        if (!d || d.guest) { h.addClass('hidden'); return; }
        h.removeClass('hidden');
        $('<div class="gc-head"></div>').append($('<h3></h3>').text('🎓 ' + tr_('فصولي'))).appendTo(h);
        $('<p class="cls-err small"></p>').appendTo(h);
        if (d.teacher) {
            $('<p class="muted small"></p>').text(tr_('أنشئ فصلًا، وأعطِ طلابك الكود، وتابع تقدّمهم في الشطرنج والألغاز.')).appendTo(h);
            var r1 = $('<div class="row"></div>').appendTo(h);
            $('<input type="text" class="field" id="cls-name" maxlength="30" autocomplete="off">').attr({ placeholder: tr_('اسم الفصل'), 'aria-label': tr_('اسم الفصل') }).appendTo(r1);
            $('<button class="btn primary" data-cls="create"></button>').text(tr_('أنشئ')).appendTo(r1);
            d.classes.forEach(function (c) {
                var box = $('<div class="cls-box"></div>').appendTo(h);
                $('<div class="cls-bh"></div>').append($('<b translate="no"></b>').text(c.name), $('<span class="cls-code" dir="ltr" translate="no"></span>').text(c.code), $('<button class="btn ghost" data-cls="copy"></button>').data('code', c.code).text(tr_('انسخ الكود')), $('<button class="btn ghost" data-cls="destroy"></button>').data('code', c.code).text('🗑')).appendTo(box);
                if (!c.students.length) $('<p class="muted small"></p>').text(tr_('لا طلاب بعد. أعطهم الكود ليدخلوا من «انضم إلى فصل».')).appendTo(box);
                else {
                    var t = $('<div class="cls-tw"><table class="cls-t"><thead><tr></tr></thead><tbody></tbody></table></div>').appendTo(box);
                    ['الطالب', 'التصنيف', 'المباريات', 'الألغاز', 'نقاط الأسبوع', ''].forEach(function (x) { $('<th></th>').text(tr_(x)).appendTo(t.find('tr')); });
                    c.students.forEach(function (s) {
                        $('<tr></tr>').append($('<td translate="no"></td>').text(s.user), $('<td></td>').text(s.rating || '—'), $('<td></td>').text(s.games), $('<td></td>').text(s.puzzles), $('<td></td>').text(s.wk),
                            $('<td></td>').append($('<button class="btn ghost" data-cls="remove"></button>').data({ code: c.code, user: s.user }).text('✕'))).appendTo(t.find('tbody'));
                    });
                }
            });
        } else if (!d.student) {
            $('<p class="muted small"></p>').text(tr_('لديك كود فصل من مدرّبك؟ انضم هنا ليتابع تقدّمك.')).appendTo(h);
        }
        if (d.student) {
            $('<p></p>').append(document.createTextNode(tr_('أنت في فصل') + ' '), $('<b translate="no"></b>').text(d.student.name), document.createTextNode(d.student.teacher ? ' · ' + tr_('المدرّب') + ': ' : ''), $('<span translate="no"></span>').text(d.student.teacher || '')).appendTo(h);
            $('<button class="btn ghost" data-cls="leave"></button>').text(tr_('غادر الفصل')).appendTo(h);
        } else {
            var r2 = $('<div class="row"></div>').appendTo(h);
            $('<input type="text" class="field code-input" id="cls-code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false">').attr({ placeholder: 'ABC123', 'aria-label': tr_('كود الفصل') }).appendTo(r2);
            $('<button class="btn secondary" data-cls="join"></button>').text(tr_('انضم إلى فصل')).appendTo(r2);
        }
        if (!d.teacher && d.cfg && (d.cfg.school || d.cfg.contact)) {
            var t2 = $('<details class="cls-lic"></details>').appendTo(h);
            $('<summary></summary>').text('👩‍🏫 ' + tr_('أنا مدرّب أو مدرسة')).appendTo(t2);
            $('<p class="muted small"></p>').text(tr_('ترخيص سنوي لإنشاء فصول (حتى 5 فصول و60 طالبًا لكل فصل) مع لوحة متابعة التقدّم.')).appendTo(t2);
            if (d.checkout) $('<a class="btn primary" target="_blank" rel="noopener"></a>').attr('href', d.checkout).text(tr_('احصل على الترخيص') + (d.cfg.price ? ' · ' + d.cfg.price : '')).appendTo(t2);
            else if (d.cfg.contact) $('<a class="btn primary" target="_blank" rel="noopener"></a>').attr('href', d.cfg.contact).text(tr_('تواصل معنا')).appendTo(t2);
        } else if (d.teacher && d.until) $('<p class="muted small"></p>').text(tr_('ترخيصك ساري حتى') + ' ' + new Date(d.until).toLocaleDateString()).appendTo(h);
    }
    socket.on('cls_state', clsRender);
    socket.on('cls_error', function (m) { $('#cls-card .cls-err').text(tr_(m)); });
    $(document).on('click', '#cls-card [data-cls]', function () {
        var a = $(this).data('cls');
        if (a === 'create') socket.emit('cls_create', { name: $('#cls-name').val() });
        else if (a === 'join') socket.emit('cls_join', { code: $('#cls-code').val() });
        else if (a === 'leave') socket.emit('cls_leave');
        else if (a === 'copy') { try { navigator.clipboard.writeText($(this).data('code')); $('#cls-card .cls-err').text(tr_('تم نسخ الرابط')); } catch (e) { /* */ } }
        else if (a === 'remove') socket.emit('cls_remove', { code: $(this).data('code'), user: $(this).data('user') });
        else if (a === 'destroy') {
            var b = $(this);
            if (!b.data('sure')) { b.data('sure', 1).text(tr_('تأكيد الحذف؟')); setTimeout(function () { b.data('sure', 0).text('🗑'); }, 3500); return; }
            socket.emit('cls_destroy', { code: b.data('code') });
        }
    });
    function ask() { if ($('#world-screen').is(':visible') && socket.connected) { socket.emit('tn_get'); socket.emit('cls_get'); } }
    var was = false;
    setInterval(function () { var v = $('#world-screen').is(':visible'); if (v && !was) setTimeout(ask, 200); was = v; }, 600);
    setInterval(ask, 60000);
    socket.on('welcome', function () { setTimeout(ask, 900); });
})();
