/* التجميلات (أفاتار/لقب/إطار/لون اسم)، مكافآت الموسم، العضوية الداعمة، والإعلانات (اختيارية). مظهر فقط: لا أي أفضلية في اللعب. */
(function () {
    'use strict';
    var APP = window.APP, $ = window.jQuery;
    if (!APP || !$) return;
    var socket = APP.socket;
    var S = null, cfg = null, vipActive = false;
    function tr_(s) { return (window.Lang && window.Lang.t) ? window.Lang.t(s) : s; }

    // عنصر الاسم مع الزينة: يستعمله الجميع (الملف، الترتيب، الدوري، ليدو)
    window.Deco = {
        el: function (user, d, prefix) {
            var s = $('<span class="dc"></span>');
            if (prefix) s.append(document.createTextNode(prefix));
            if (d && (d.av || d.fr)) {
                var a = $('<i class="dc-av"></i>').text(d.av || '●');
                if (d.fr) a.css('box-shadow', '0 0 0 2px ' + d.fr + ', 0 0 9px ' + d.fr);
                s.append(a);
            }
            var n = $('<b class="dc-nm" translate="no"></b>').text(user);
            if (d && d.nc) n.css('color', d.nc);
            s.append(n);
            if (d && d.vip) s.append($('<span class="dc-vip" title="VIP"></span>').text('💎'));
            if (d && d.ti) s.append($('<small class="dc-ti"></small>').text(d.ti));
            return s;
        }
    };

    // ───────── نافذة «مظهري» ─────────
    var KIND_NAMES = { av: 'الصورة الرمزية', ti: 'اللقب', fr: 'الإطار', nc: 'لون الاسم' };
    function ensureDialog() {
        if ($('#cos-dialog').length) return;
        $('body').append('<div id="cos-dialog" class="overlay hidden"><div class="dialog cos-box"><h3>🎨 مظهري</h3><div id="cos-body"></div><button class="btn ghost full" id="cos-close">إغلاق</button></div></div>');
        $('#cos-close').on('click', function () { $('#cos-dialog').addClass('hidden'); });
        $('#cos-dialog').on('click', function (e) { if (e.target === this) $(this).addClass('hidden'); });
    }
    function need(it) {
        if (it.pk) return '🛍 ' + tr_(it.pk === 'arab' ? 'حزمة الزخارف' : 'حزمة الملوك');
        if (it.vip) return '💎 ' + tr_('للداعمين');
        if (it.ach) return '🔒 ' + tr_((S.titles && S.titles[it.ach]) || it.ach);
        return '🔒';
    }
    var KIND_REW = { fr: 'إطار الموسم', nc: 'لون الموسم', ti: 'لقب الموسم' };
    function render() {
        if (!S) return;
        var b = $('#cos-body').empty();
        if (S.guest) { b.append($('<p class="muted"></p>').text(tr_('سجّل حسابًا مجانيًا لتختار صورتك ولقبك وإطارك.'))); return; }
        var me = window.__myName || '';
        $('<div class="cos-prev"></div>').append(window.Deco.el(me || tr_('أنت'), S.display)).appendTo(b);
        // الموسم
        var se = S.season, sc = $('<div class="cos-season"></div>').css('--c', se.c).appendTo(b);
        $('<h4></h4>').text(se.icon + ' ' + tr_(se.name) + ' · ' + tr_('يتبقى') + ' ' + se.left + ' ' + tr_('يوم')).appendTo(sc);
        $('<p class="muted small"></p>').text(tr_('انتصاراتك هذا الشهر') + ': ' + se.w + ' — ' + tr_('اجمع انتصارات لتفتح مكافآت دائمة بمظهر هذا الموسم.')).appendTo(sc);
        var tl = $('<div class="cos-tiers"></div>').appendTo(sc);
        se.tiers.forEach(function (t) { $('<span></span>').toggleClass('done', !!t.done).text((t.done ? '✅ ' : '⬜ ') + t.w + ' ' + tr_('فوز') + ' → ' + tr_(KIND_REW[t.kind])).appendTo(tl); });
        // مناسبة عالمية جارية
        if (se.event) {
            var ev = se.event, ec = $('<div class="cos-season"></div>').css('--c', ev.c).appendTo(b);
            $('<h4></h4>').text(ev.icon + ' ' + tr_(ev.name) + ' · ' + tr_('يتبقى') + ' ' + ev.left + ' ' + tr_('يوم')).appendTo(ec);
            $('<p class="muted small"></p>').text(tr_('مناسبة خاصة: انتصاراتك الآن') + ': ' + ev.w).appendTo(ec);
            var et = $('<div class="cos-tiers"></div>').appendTo(ec);
            ev.tiers.forEach(function (t) { $('<span></span>').toggleClass('done', !!t.done).text((t.done ? '✅ ' : '⬜ ') + t.w + ' ' + tr_('فوز') + ' → ' + tr_(KIND_REW[t.kind])).appendTo(et); });
        }
        // المتجر: حزم تُشترى مرة واحدة
        if (S.packs && S.packs.length) {
            var sh = $('<div class="cos-store"></div>').appendTo(b);
            $('<h4></h4>').text('🛍 ' + tr_('المتجر') + ' · ' + tr_('دفعة واحدة بلا اشتراك')).appendTo(sh);
            S.packs.forEach(function (pk) {
                var card = $('<div class="cos-pack"></div>').toggleClass('owned', !!pk.owned).appendTo(sh);
                $('<b></b>').text(pk.e + ' ' + tr_(pk.n)).appendTo(card);
                $('<small class="muted"></small>').text(pk.items.map(function (x) { return tr_(x); }).join(' · ')).appendTo(card);
                if (pk.owned) $('<span class="cos-owned"></span>').text('✅ ' + tr_('تملكها')).appendTo(card);
                else if (pk.url) $('<a class="btn primary" target="_blank" rel="noopener"></a>').attr('href', pk.url).text(tr_('اشترِ') + (pk.price ? ' · ' + pk.price : '')).appendTo(card);
            });
        }
        // الدعم
        if (S.cfg && (S.cfg.vip || S.cfg.support)) {
            var vc = $('<div class="cos-vip"></div>').appendTo(b);
            $('<h4></h4>').text('💎 ' + tr_('عضوية الداعمين')).appendTo(vc);
            if (S.vip.active) $('<p></p>').text(tr_('عضويتك فعّالة حتى') + ' ' + new Date(S.vip.until).toLocaleDateString()).appendTo(vc);
            else $('<p class="muted small"></p>').text(tr_('تدعم الموقع وتحصل على: بلا إعلانات، أفاتارات وإطار وألوان وثيمات حصرية، ولقب «داعم الموقع». لا أي أفضلية في اللعب.')).appendTo(vc);
            var r = $('<div class="cos-btns"></div>').appendTo(vc);
            if (S.cfg.vip && S.checkout) $('<a class="btn primary" target="_blank" rel="noopener"></a>').attr('href', S.checkout).text((S.vip.active ? tr_('جدّد العضوية') : '💎 ' + tr_('كن داعمًا')) + (S.cfg.price ? ' · ' + S.cfg.price : '')).appendTo(r);
            if (S.cfg.year && S.checkoutYear) $('<a class="btn primary" target="_blank" rel="noopener"></a>').attr('href', S.checkoutYear).text('⭐ ' + tr_('الخطة السنوية') + (S.cfg.priceYear ? ' · ' + S.cfg.priceYear : '')).appendTo(r);
            if (S.cfg.support) $('<a class="btn secondary" target="_blank" rel="noopener"></a>').attr('href', S.cfg.support).text('☕ ' + tr_('ادعم الموقع بتبرّع')).appendTo(r);
        }
        ['av', 'ti', 'fr', 'nc'].forEach(function (kind) {
            b.append($('<h4></h4>').text(tr_(KIND_NAMES[kind])));
            var g = $('<div class="cos-grid"></div>').appendTo(b);
            (S.catalog[kind] || []).forEach(function (it) {
                var on = S.sel[kind] === it.id;
                var btn = $('<button type="button" class="cos-item"></button>').toggleClass('on', on).toggleClass('locked', !it.open);
                if (kind === 'av') $('<span class="cos-e"></span>').text(it.e || '🎖').appendTo(btn);
                if (kind === 'fr' || kind === 'nc') $('<span class="cos-sw"></span>').css(kind === 'fr' ? { boxShadow: '0 0 0 3px ' + (it.c === 'transparent' ? 'rgba(128,128,128,.4)' : it.c) } : { background: it.c || '#999' }).appendTo(btn);
                $('<span class="cos-n"></span>').text(tr_(it.n)).appendTo(btn);
                if (!it.open) $('<small class="cos-lock"></small>').text(need(it)).appendTo(btn);
                btn.on('click', function () {
                    if (!it.open) return toast(need(it));
                    var o = {}; o[kind] = it.id; socket.emit('cos_set', o);
                });
                g.append(btn);
            });
        });
    }
    function toast(m) { var t = $('<div class="looks-toast"></div>').text(m).appendTo('body'); setTimeout(function () { t.remove(); }, 2200); }
    function open() { ensureDialog(); $('#cos-dialog').removeClass('hidden'); render(); socket.emit('cos_get'); }
    $(document).on('click', '[data-cos="open"]', open);
    function addBtn() {
        if ($('#pf-cos').length || !$('#profile-screen .panel').length) return;
        $('<button class="btn secondary" id="pf-cos" data-cos="open">🎨 مظهري والمكافآت</button>').insertAfter('#pf-title');
    }
    setInterval(function () { if ($('#profile-screen').is(':visible')) addBtn(); }, 700);

    socket.on('cos_state', function (d) {
        S = d; cfg = d && d.cfg; vipActive = !!(d && d.vip && d.vip.active);
        if ($('#cos-dialog').length && !$('#cos-dialog').hasClass('hidden')) render();
        adsDecide(); sponsorRender();
    });
    socket.on('welcome', function (w) { window.__myName = w && w.user ? w.user : ''; setTimeout(function () { socket.emit('cos_get'); }, 700); });

    // ───────── إعلانات (تظهر فقط إن ضُبطت في الخادم، ولا تظهر أثناء اللعب ولا للداعمين) ─────────
    var ADS = null, adsLoaded = false;
    var AD_SCREENS = ['landing-screen', 'world-screen', 'menu-screen'];
    function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
    function consentBanner() {
        if ($('#ads-consent').length) return;
        var bar = $('<div id="ads-consent" class="ads-consent" role="dialog" aria-label="الإعلانات"></div>');
        $('<p></p>').text(tr_('نعرض إعلانات بسيطة خارج المباريات لندعم تكلفة الموقع. تستطيع قبولها أو الاكتفاء بإعلانات غير مخصّصة.')).appendTo(bar);
        var row = $('<div class="row"></div>').appendTo(bar);
        $('<button class="btn primary"></button>').text(tr_('موافق')).on('click', function () { lset('ads-consent', 'all'); bar.remove(); adsLoad(); }).appendTo(row);
        $('<button class="btn ghost"></button>').text(tr_('إعلانات غير مخصّصة')).on('click', function () { lset('ads-consent', 'npa'); bar.remove(); adsLoad(); }).appendTo(row);
        $('body').append(bar);
    }
    function adsLoad() {
        if (!ADS || vipActive || adsLoaded || !lget('ads-consent')) return;
        adsLoaded = true;
        window.adsbygoogle = window.adsbygoogle || [];
        if (lget('ads-consent') === 'npa') window.adsbygoogle.requestNonPersonalizedAds = 1;
        AD_SCREENS.forEach(function (id) {
            var sc = document.getElementById(id);
            if (!sc || sc.querySelector('.ad-wrap')) return;
            var w = document.createElement('div'); w.className = 'ad-wrap';
            w.innerHTML = '<small class="muted">' + tr_('إعلان') + '</small><ins class="adsbygoogle" style="display:block" data-ad-format="auto" data-full-width-responsive="true"></ins>';
            var ins = w.querySelector('ins'); ins.setAttribute('data-ad-client', ADS.client); ins.setAttribute('data-ad-slot', ADS.slot);
            sc.appendChild(w);
        });
        var s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADS.client);
        s.onload = function () { $('.ad-wrap ins').each(function () { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* */ } }); };
        document.head.appendChild(s);
    }
    function adsDecide() {
        if (vipActive) { $('.ad-wrap,#ads-consent').remove(); return; }
        if (!ADS) return;
        if (lget('ads-consent')) adsLoad(); else consentBanner();
    }
    // ───────── راعٍ مباشر (بلا تتبّع ولا موافقة؛ يختفي للداعمين) + تذييل ─────────
    var SP = null, CONTACT = null;
    function sponsorRender() {
        $('.sponsor-wrap').remove();
        if (!SP || vipActive) return;
        AD_SCREENS.forEach(function (id) {
            var sc = document.getElementById(id);
            if (!sc) return;
            var a = $('<a class="sponsor-wrap" target="_blank" rel="sponsored nofollow noopener"></a>').attr('href', SP.url);
            $('<small class="muted"></small>').text(tr_('برعاية')).appendTo(a);
            $('<b translate="no"></b>').text(SP.name).appendTo(a);
            if (SP.text) $('<span translate="no"></span>').text(SP.text).appendTo(a);
            $('<em></em>').text(SP.cta + ' ›').attr('translate', 'no').appendTo(a);
            var ft = $(sc).children('#site-foot');
            if (ft.length) a.insertBefore(ft); else $(sc).append(a);
        });
    }
    function footerRender() {
        if ($('#site-foot').length) return;
        var f = $('<footer id="site-foot" class="site-foot"></footer>');
        var nav = $('<nav aria-label="Games"></nav>').appendTo(f);
        [['/', 'الشطرنج وملك المدينة وليدو'], ['/chess', 'شطرنج'], ['/monopoly', 'ملك المدينة'], ['/ludo', 'ليدو'], ['/snakes', 'سلم وثعبان']].forEach(function (x, i) {
            if (i) $('<a></a>').attr('href', x[0]).text(tr_(x[1])).appendTo(nav);
        });
        var ln = $('<nav class="lang" aria-label="Language"></nav>').appendTo(f);
        [['/', 'العربية'], ['/en', 'English'], ['/fr', 'Français']].forEach(function (x) { $('<a></a>').attr('href', x[0]).attr('translate', 'no').text(x[1]).appendTo(ln); });
        if (CONTACT && !SP) $('<a class="foot-ad"></a>').attr('href', CONTACT).attr('target', '_blank').attr('rel', 'noopener').text('📣 ' + tr_('أعلن معنا')).appendTo(f);
        $('#landing-screen').append(f);
    }
    footerRender();
    try {
        fetch('/monet.json').then(function (r) { return r.json(); }).then(function (c) { ADS = c && c.ads; SP = c && c.sponsor; CONTACT = c && c.contact; if (SP || CONTACT) { $('#site-foot').remove(); footerRender(); } sponsorRender(); if (ADS) setTimeout(adsDecide, 1500); }).catch(function () { /* بلا إعلانات */ });
    } catch (e) { /* */ }
})();
