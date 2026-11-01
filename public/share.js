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
    function draw(d) {
        var S = 1080, c = document.createElement('canvas');
        c.width = S; c.height = S;
        var x = c.getContext('2d');
        var acc = d.accent || '#e2b14b';
        var g = x.createLinearGradient(0, 0, S, S);
        g.addColorStop(0, '#0b1324'); g.addColorStop(1, '#16264a');
        x.fillStyle = g; x.fillRect(0, 0, S, S);
        var rg = x.createRadialGradient(S / 2, 330, 40, S / 2, 330, 520);
        rg.addColorStop(0, acc + '66'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = rg; x.fillRect(0, 0, S, S);
        x.strokeStyle = acc; x.lineWidth = 8; x.strokeRect(36, 36, S - 72, S - 72);
        x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle';
        var F = '"Segoe UI", Tahoma, "Noto Sans Arabic", Arial, sans-serif';
        x.font = '200px ' + F; x.fillStyle = '#fff';
        x.fillText(d.emoji || '🎲', S / 2, 250);
        x.font = '800 96px ' + F; x.fillStyle = acc;
        var tl = wrap(x, d.title || '', S - 200), y = 450;
        tl.slice(0, 2).forEach(function (t) { x.fillText(t, S / 2, y); y += 104; });
        x.font = '600 52px ' + F; x.fillStyle = '#dbe5fb';
        (d.lines || []).slice(0, 4).forEach(function (ln) {
            wrap(x, ln, S - 220).slice(0, 2).forEach(function (t) { x.fillText(t, S / 2, y + 30); y += 66; });
        });
        x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(120, S - 250, S - 240, 3);
        x.font = '700 46px ' + F; x.fillStyle = '#fff';
        x.fillText('تحدَّني في ' + (d.game || 'الألعاب اللوحية'), S / 2, S - 190);
        x.font = '600 40px ' + F; x.fillStyle = acc; x.direction = 'ltr';
        x.fillText(location.host + (user ? '  ·  @' + user : ''), S / 2, S - 120);
        return c;
    }

    function run(name) {
        var p = providers[name];
        var d = p ? p() : null;
        if (!d) return;
        var c;
        try { c = draw(d); } catch (e) { return toast('تعذّر إنشاء الصورة.'); }
        var url = myLink();
        var text = (d.text || d.title) + ' ' + url;
        c.toBlob(function (blob) {
            if (!blob) return toast('تعذّر إنشاء الصورة.');
            var file = null;
            try { file = new File([blob], 'result.png', { type: 'image/png' }); } catch (e) { /* */ }
            if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: d.title, text: text }).catch(function (e) { if (e && e.name !== 'AbortError') toast('تعذّرت المشاركة.'); });
                return;
            }
            // حاسوب: نحفظ الصورة وننسخ الرابط
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'result.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
            toast('حُفظت الصورة ونُسخ الرابط، الصقه عند النشر.');
        }, 'image/png');
    }

    // مزوّد الشطرنج: يقرأ نافذة النتيجة
    providers.chess = function () {
        var t = ($id('result-title') || {}).textContent || '', r = ($id('result-reason') || {}).textContent || '', dl = ($id('result-delta') || {}).textContent || '';
        return { emoji: '♟', game: 'الشطرنج', title: t || 'مباراة شطرنج', lines: [r, dl].filter(Boolean), accent: '#e2b14b', text: t + '. ' + r };
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
        run(k);
    });

    window.Share = { providers: providers, run: run, link: myLink, toast: toast };
})();
