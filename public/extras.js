/* الوضع الفاتح · جرس الإشعارات · جولة الشرح للمبتدئين. يُحمَّل بعد app.js وshare.js. */
(function () {
    'use strict';
    var APP = window.APP;
    if (!APP) return;
    var socket = APP.socket;
    function $id(i) { return document.getElementById(i); }
    function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
    function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

    // ───────── الوضع الفاتح/الداكن ─────────
    function applyMode(m) {
        document.documentElement.setAttribute('data-mode', m);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', m === 'light' ? '#F4F6FB' : '#0B1324');
        var b = $id('mode-btn');
        if (b) { b.textContent = m === 'light' ? '🌙' : '☀️'; b.setAttribute('aria-label', m === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'); b.setAttribute('aria-pressed', String(m === 'light')); }
    }
    function curMode() { return document.documentElement.getAttribute('data-mode') === 'light' ? 'light' : 'dark'; }
    var stored = lget('chess-mode');
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    applyMode(stored === 'light' || stored === 'dark' ? stored : (mq && mq.matches ? 'light' : 'dark'));
    // بلا اختيار صريح: يتبع الموقع وضع الجهاز لحظةً بلحظة
    if (mq && mq.addEventListener) mq.addEventListener('change', function (e) { var s = lget('chess-mode'); if (s !== 'light' && s !== 'dark') applyMode(e.matches ? 'light' : 'dark'); });
    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('#mode-btn');
        if (!b) return;
        var n = curMode() === 'light' ? 'dark' : 'light';
        lset('chess-mode', n); applyMode(n);
    });

    // ───────── جرس الإشعارات ─────────
    var nt = { list: [], unread: 0 }, open = false;
    function ago(t) {
        var s = Math.max(1, Math.round((Date.now() - t) / 1000));
        if (s < 60) return 'الآن';
        if (s < 3600) return 'قبل ' + Math.round(s / 60) + ' د';
        if (s < 86400) return 'قبل ' + Math.round(s / 3600) + ' س';
        return 'قبل ' + Math.round(s / 86400) + ' يوم';
    }
    function paintBell() {
        var n = $id('bell-n'), b = $id('bell-btn');
        if (!n || !b) return;
        n.textContent = nt.unread > 9 ? '9+' : String(nt.unread);
        n.classList.toggle('hidden', !nt.unread);
        b.setAttribute('aria-label', 'الإشعارات' + (nt.unread ? ' (' + nt.unread + ' جديد)' : ''));
        var box = $id('bell-panel');
        if (!box || box.classList.contains('hidden')) return;
        box.textContent = '';
        var head = el('div', 'bell-head');
        head.appendChild(el('b', null, 'الإشعارات'));
        var clr = el('button', 'btn ghost', 'مسح الكل'); clr.type = 'button'; clr.setAttribute('data-bell', 'clear');
        head.appendChild(clr);
        box.appendChild(head);
        if (!nt.list.length) { box.appendChild(el('p', 'muted small bell-empty', 'لا توجد إشعارات بعد. ستظهر هنا الدعوات والبطولات.')); return; }
        var ul = el('ul', 'bell-list');
        nt.list.slice(0, 30).forEach(function (n, k) {
            var li = el('li', k < (nt.hl || 0) ? 'new' : '');
            li.appendChild(el('span', 'bt', n.x));
            li.appendChild(el('small', 'muted', ago(n.t)));
            ul.appendChild(li);
        });
        box.appendChild(ul);
    }
    function setList(d) {
        if (!d) return;
        nt.list = d.list || []; nt.unread = d.unread || 0; nt.hl = 0;
        paintBell();
    }
    function toggleBell(force) {
        var box = $id('bell-panel');
        if (!box) return;
        open = force === undefined ? box.classList.contains('hidden') : force;
        box.classList.toggle('hidden', !open);
        $id('bell-btn').setAttribute('aria-expanded', String(open));
        if (open) {
            nt.hl = nt.unread;              // الجديدة تبقى مظلّلة طالما القائمة مفتوحة
            if (nt.unread) { nt.unread = 0; socket.emit('nt_read'); }
        } else { if (nt.hl) socket.emit('nt_read'); nt.hl = 0; }
        paintBell();
    }
    document.addEventListener('click', function (e) {
        var t = e.target;
        var b = t.closest && t.closest('#bell-btn');
        if (b) { toggleBell(); return; }
        var c = t.closest && t.closest('[data-bell="clear"]');
        if (c) { socket.emit('nt_clear'); return; }
        if (open && !(t.closest && t.closest('#bell-panel'))) toggleBell(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) toggleBell(false); });

    socket.on('welcome', function (w) {
        var wrap = $id('bell-wrap');
        if (wrap) wrap.classList.toggle('hidden', !(w && w.user));
        if (w && w.nt) setList(w.nt); else setList({ list: [], unread: 0 });
    });
    socket.on('nt_list', function (d) {
        // بعد «قراءة» نُظهر القائمة كما هي لكن بلا عدّاد
        nt.list = d.list || []; nt.unread = open ? 0 : (d.unread || 0);
        if (!open) nt.hl = 0;
        paintBell();
    });
    // إشعار حيّ: يضيفه الخادم أيضًا إلى سجلّه، ونعرضه فورًا
    function live(text) {
        if (!text) return;
        nt.list.unshift({ t: Date.now(), x: String(text) });
        nt.list = nt.list.slice(0, 30);
        if (open) nt.hl = (nt.hl || 0) + 1; else nt.unread++;
        paintBell();
    }
    socket.on('notify', function (d) { live(d && d.text); });
    socket.on('mp_invite', function (d) { if (d && d.from) live('🎲 دعاك ' + d.from + ' إلى غرفة ملك المدينة'); });
    socket.on('sl_invite', function (d) { if (d && d.from) live('🐍 دعاك ' + d.from + ' إلى غرفة سلم وثعبان'); });

    // ───────── جولة الشرح ─────────
    var GUIDES = {
        mono: {
            title: 'كيف تلعب «ملك المدينة»؟',
            slides: [
                ['🎯', 'الهدف', 'تبدأ بـ1500 وتجمع المدن وتأخذ الإيجارات من خصومك. آخر لاعب لم يُفلس هو الفائز.'],
                ['🎲', 'دورك', 'اضغط «ارمِ النرد» وتتحرك قطعتك. الرقمان المتطابقان يعطيانك رمية إضافية، وثلاث متطابقات متتالية تُدخلك السجن. كل مرور على «انطلاق» يعطيك 200.'],
                ['🏠', 'الشراء والمزاد', 'إن نزلت على خانة بلا مالك يمكنك شراؤها. إن رفضت تُطرح للمزاد ويتنافس عليها الجميع، ومن يعرض أكثر يربحها.'],
                ['💰', 'الإيجار', 'إن نزلت على ملك لاعب آخر تدفع له إيجارًا. إن امتلك كل مدن اللون الواحد يتضاعف الإيجار. وبعد 60 جولة ترتفع الإيجارات كي تنتهي اللعبة.'],
                ['🏗', 'البناء', 'إذا ملكت كل مدن لون واحد ابنِ عليها منازل ثم فندقًا بالتساوي. اضغط أي خانة في اللوحة لترى سندها وإيجاراتها.'],
                ['⛓', 'السجن والبطاقات', 'في السجن اخرج بتعادل في النرد، أو ادفع 50، أو استعمل بطاقة الخروج. بطاقتا «الفرصة» و«صندوق الحظ» تعطيانك مكافآت أو غرامات.'],
                ['🤝', 'التبادل والرهن', 'اعرض تبادل مدن ومال مع أي لاعب. وإن نقص مالك ارهن ملكياتك بنصف سعرها. من لا يستطيع الدفع يُعلن إفلاسه.']
            ]
        },
        snk: {
            title: 'كيف تلعب «سلم وثعبان»؟',
            slides: [
                ['🎯', 'الهدف', 'كن أول من يصل إلى آخر خانة في اللوحة.'],
                ['🎲', 'دورك', 'ارمِ النرد وتحرّك بعدد الخانات. إن جاء الرقم 6 فلك رمية إضافية.'],
                ['🪜', 'السلالم والثعابين', 'السلم يرفعك إلى خانة أعلى، والثعبان يُنزلك. الخانات الخضراء فيها سلالم والحمراء فيها ثعابين.'],
                ['🏁', 'الوصول للنهاية', 'للوصول إلى آخر خانة تحتاج رقمًا مطابقًا تمامًا. إن زاد الرقم فتبقى مكانك.'],
                ['🎁', 'نمط المفاجآت', 'فيه خانات خاصة: 🎲 رمية إضافية، ↩ تراجع 3 خانات، 🛡 درع يحميك من لدغة ثعبان واحدة.']
            ]
        }
    };
    var tour = null;
    function closeTour() { if (tour) { tour.remove(); tour = null; } }
    function showGuide(key) {
        var g = GUIDES[key];
        if (!g) return;
        closeTour();
        var i = 0;
        tour = el('div', 'overlay tour');
        tour.setAttribute('role', 'dialog'); tour.setAttribute('aria-modal', 'true'); tour.setAttribute('aria-label', g.title);
        var dlg = el('div', 'dialog tour-dlg');
        var ic = el('div', 'tour-ic'), h = el('h2'), p = el('p', 'tour-tx'), dots = el('div', 'tour-dots'), row = el('div', 'tour-row');
        var prev = el('button', 'btn ghost', 'السابق'), next = el('button', 'btn primary', 'التالي'), skip = el('button', 'btn ghost tour-skip', 'تخطّي');
        [prev, next, skip].forEach(function (b) { b.type = 'button'; });
        row.appendChild(prev); row.appendChild(next);
        dlg.appendChild(el('small', 'muted', g.title)); dlg.appendChild(ic); dlg.appendChild(h); dlg.appendChild(p); dlg.appendChild(dots); dlg.appendChild(row); dlg.appendChild(skip);
        tour.appendChild(dlg); document.body.appendChild(tour);
        function paint() {
            var s = g.slides[i];
            ic.textContent = s[0]; h.textContent = s[1]; p.textContent = s[2];
            dots.textContent = '';
            g.slides.forEach(function (_, k) { dots.appendChild(el('i', k === i ? 'on' : '')); });
            prev.style.display = i ? '' : 'none';
            next.textContent = i === g.slides.length - 1 ? 'فهمت، لنلعب!' : 'التالي';
        }
        prev.addEventListener('click', function () { if (i > 0) { i--; paint(); } });
        next.addEventListener('click', function () { if (i < g.slides.length - 1) { i++; paint(); } else { lset('help-' + key, '1'); closeTour(); } });
        skip.addEventListener('click', function () { lset('help-' + key, '1'); closeTour(); });
        tour.addEventListener('click', function (e) { if (e.target === tour) { lset('help-' + key, '1'); closeTour(); } });
        document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); closeTour(); } });
        paint(); next.focus();
    }
    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-guide]');
        if (b) showGuide(b.getAttribute('data-guide'));
    });
    // أول دخول إلى كل لعبة يفتح الشرح تلقائيًا مرة واحدة
    function watch(screenId, key) {
        var s = $id(screenId);
        if (!s || !window.MutationObserver) return;
        new MutationObserver(function () {
            if (!s.classList.contains('hidden') && !lget('help-' + key)) setTimeout(function () { if (!s.classList.contains('hidden') && !lget('help-' + key) && !tour) showGuide(key); }, 500);
        }).observe(s, { attributes: true, attributeFilter: ['class'] });
    }
    watch('mono-screen', 'mono');
    watch('snk-screen', 'snk');
    window.Extras = { showGuide: showGuide, mode: curMode };
})();
