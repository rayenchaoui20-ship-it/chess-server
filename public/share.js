/* مشاركة النتائج كصورة + رابط الدعوة الشخصي. يُحمَّل بعد app.js. */
(function () {
    'use strict';
    var APP = window.APP;
    if (!APP) return;
    var socket = APP.socket;
    var user = null;
    var providers = {};
    function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
    function $id(i) { return document.getElementById(i); }

    // ───────── رابط الدعوة ─────────
    var ref = null;
    try {
        var m = /[?&]ref=([\w.\-]{1,20})/.exec(location.search);
        if (m) { ref = m[1]; lset('chess-ref', ref); }
    } catch (e) { /* */ }
    function origin() { return location.origin || (location.protocol + '//' + location.host); }
    function myLink() { return origin() + '/' + (user ? '?ref=' + encodeURIComponent(user) : ''); }

    // شريط «دعاك فلان» في الصفحة الافتتاحية
    function showInviter() {
        var r = ref || lget('chess-ref');
        var el = $id('land-ref');
        if (el && r) { el.textContent = '🎟 دعاك ' + r + ' للانضمام. سجّل الآن وتحصلان معًا على شارة.'; el.classList.remove('hidden'); }
    }
    showInviter();

    socket.on('welcome', function (w) { user = w && w.user ? w.user : null; });
    socket.on('profile', function (p) {
        var box = $id('pf-invite');
        if (!box) return;
        box.classList.toggle('hidden', !p.me);
        if (p.me) {
            $id('pf-ref').value = myLink();
            $id('pf-ref-n').textContent = p.refs ? ('دعوت ' + p.refs + ' صديقًا') : '';
        }
    });

    // ───────── تنبيه صغير ─────────
    var tt = null;
    function toast(msg) {
        var el = $id('global-toast');
        if (!el) return;
        el.textContent = msg; el.classList.remove('hidden');
        clearTimeout(tt); tt = setTimeout(function () { el.classList.add('hidden'); }, 3200);
    }

    // ───────── رسم البطاقة ─────────
    function wrap(ctx, text, maxW) {
        var words = String(text).split(/\s+/), lines = [], cur = '';
        words.forEach(function (w) {
            var t = cur ? cur + ' ' + w : w;
            if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
        });
        if (cur) lines.push(cur);
        return lines;
    }
    function T(s) { try { return window.Lang ? window.Lang.t(s) : s; } catch (e) { return s; } }
    var RTL = function () { try { return window.Lang ? window.Lang.get() === 'ar' : true; } catch (e) { return true; } };
    var FMT = { square: [1080, 1080], story: [1080, 1920], wide: [1200, 675] };
    function draw(d, fmt) {
        var dim = FMT[fmt] || FMT.square, W = dim[0], H = dim[1], c = document.createElement('canvas');
        c.width = W; c.height = H;
        var x = c.getContext('2d'), rtl = RTL(), wide = fmt === 'wide';
        var acc = d.accent || '#e2b14b';
        var g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#0b1324'); g.addColorStop(1, '#16264a');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        var cy = wide ? 190 : (fmt === 'story' ? 560 : 330);
        var rg = x.createRadialGradient(W / 2, cy, 40, W / 2, cy, Math.min(W, H) * .55);
        rg.addColorStop(0, acc + '66'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = rg; x.fillRect(0, 0, W, H);
        x.strokeStyle = acc; x.lineWidth = 8; x.strokeRect(36, 36, W - 72, H - 72);
        x.direction = rtl ? 'rtl' : 'ltr'; x.textAlign = 'center'; x.textBaseline = 'middle';
        var F = '"Segoe UI", Tahoma, "Noto Sans Arabic", Arial, sans-serif';
        var k = wide ? .62 : 1, top0 = wide ? 110 : (fmt === 'story' ? 520 : 250);
        x.font = Math.round(200 * k) + 'px ' + F; x.fillStyle = '#fff';
        x.fillText(d.emoji || '🎲', W / 2, top0);
        x.font = '800 ' + Math.round(96 * k) + 'px ' + F; x.fillStyle = acc;
        var y = top0 + Math.round(200 * k);
        wrap(x, T(d.title || ''), W - 200).slice(0, 2).forEach(function (t) { x.fillText(t, W / 2, y); y += Math.round(104 * k); });
        x.font = '600 ' + Math.round(52 * k) + 'px ' + F; x.fillStyle = '#dbe5fb';
        (d.lines || []).slice(0, 4).forEach(function (ln) {
            wrap(x, T(ln), W - 220).slice(0, 2).forEach(function (t) { x.fillText(t, W / 2, y + 30); y += Math.round(66 * k); });
        });
        var fy = H - (wide ? 150 : 250);
        x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(120, fy, W - 240, 3);
        x.font = '700 ' + Math.round(46 * k) + 'px ' + F; x.fillStyle = '#fff';
        x.fillText(T('تحدَّني في') + ' ' + T(d.game || 'الألعاب اللوحية'), W / 2, fy + Math.round(60 * (wide ? .8 : 1)));
        x.font = '600 ' + Math.round(40 * k) + 'px ' + F; x.fillStyle = acc; x.direction = 'ltr';
        x.fillText(location.host + (user ? '  ·  @' + user : ''), W / 2, fy + Math.round(130 * (wide ? .7 : 1)));
        return c;
    }

    // نافذة اختيار المقاس
    var fmtBox = null, pending = null;
    function chooseFmt(name) {
        pending = name;
        if (!fmtBox) {
            fmtBox = document.createElement('div');
            fmtBox.className = 'overlay hidden'; fmtBox.id = 'share-fmt';
            var inner = document.createElement('div'); inner.className = 'dialog';
            var h = document.createElement('h3'); h.textContent = T('شارك النتيجة كصورة');
            inner.appendChild(h);
            [['square', '▣ ' + T('مربّعة (واتساب، إنستغرام)')], ['story', '▯ ' + T('قصة (إنستغرام، واتساب ستاتوس)')], ['wide', '▭ ' + T('عريضة (X، فيسبوك)')]].forEach(function (f) {
                var b = document.createElement('button'); b.className = 'btn secondary block'; b.type = 'button'; b.textContent = f[1];
                b.addEventListener('click', function () { fmtBox.classList.add('hidden'); run(pending, f[0]); });
                inner.appendChild(b);
            });
            var cl = document.createElement('button'); cl.className = 'btn ghost block'; cl.type = 'button'; cl.textContent = T('إلغاء');
            cl.addEventListener('click', function () { fmtBox.classList.add('hidden'); });
            inner.appendChild(cl);
            fmtBox.appendChild(inner);
            fmtBox.addEventListener('click', function (e) { if (e.target === fmtBox) fmtBox.classList.add('hidden'); });
            document.body.appendChild(fmtBox);
        }
        fmtBox.querySelector('h3').textContent = T('شارك النتيجة كصورة');
        fmtBox.classList.remove('hidden');
    }

    function run(name, fmt) {
        var p = providers[name];
        var d = p ? p() : null;
        if (!d) return;
        var c;
        try { c = draw(d, fmt || 'square'); } catch (e) { return toast(T('تعذّر إنشاء الصورة.')); }
        var url = myLink();
        var text = T(d.text || d.title) + ' ' + url;
        c.toBlob(function (blob) {
            if (!blob) return toast(T('تعذّر إنشاء الصورة.'));
            var file = null;
            try { file = new File([blob], 'result.png', { type: 'image/png' }); } catch (e) { /* */ }
            if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: T(d.title), text: text }).catch(function (e) { if (e && e.name !== 'AbortError') toast('تعذّرت المشاركة.'); });
                return;
            }
            // حاسوب: نحفظ الصورة وننسخ الرابط
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'result.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
            toast(T('حُفظت الصورة ونُسخ الرابط، الصقه عند النشر.'));
        }, 'image/png');
    }

    // مزوّد الشطرنج: يقرأ نافذة النتيجة
    providers.chess = function () {
        var t = ($id('result-title') || {}).textContent || '', r = ($id('result-reason') || {}).textContent || '', dl = ($id('result-delta') || {}).textContent || '';
        return { emoji: '♟', game: 'الشطرنج', title: t || 'مباراة شطرنج', lines: [r, dl].filter(Boolean), accent: '#e2b14b', text: t + '. ' + r };
    };

    providers.ludo = function () {
        var t = ($id('lu-over-t') || {}).textContent || '';
        if (!t) return null;
        var won = t.indexOf('🏆') === 0;
        return { emoji: won ? '🏆' : '🎲', game: 'ليدو', accent: '#e8575a', title: won ? 'فزت في ليدو!' : 'لعبنا ليدو!', lines: [t.replace(/^[^\s]+\s*/, '')], text: won ? 'فزت في ليدو!' : 'لعبنا ليدو!' };
    };

    providers.cards = function () {
        var t = ($id('cd-over-t') || {}).textContent || '';
        if (!t) return null;
        var won = ($id('cd-over-e') || {}).textContent === '🏆';
        var sub = (($id('cd-over-s') || {}).textContent || '').split('\n')[0];
        return { emoji: won ? '🏆' : '🃏', game: 'لعبة الورق', accent: '#1eaa78', title: won ? 'فزت في لعبة الورق!' : 'لعبنا لعبة الورق!', lines: [t].concat(sub ? [sub] : []), text: won ? 'فزت في لعبة الورق!' : 'لعبنا لعبة الورق!' };
    };

    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-share]');
        if (!b) return;
        var k = b.getAttribute('data-share');
        if (k === 'ref') {
            var l = myLink();
            if (navigator.share) { navigator.share({ title: 'انضم إلي في الألعاب اللوحية', url: l }).catch(function () {}); return; }
            if (navigator.clipboard) navigator.clipboard.writeText(l).then(function () { toast('نُسخ رابط دعوتك.'); }).catch(function () { toast(l); });
            else toast(l);
            return;
        }
        if (providers[k] && providers[k]()) chooseFmt(k); else run(k);
    });

    window.Share = { providers: providers, run: run, link: myLink, toast: toast };
})();
