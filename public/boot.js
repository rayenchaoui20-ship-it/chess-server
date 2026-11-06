// يحمّل المكتبات بالترتيب: النسخة المحلية أولًا ثم CDN كاحتياط، ثم يشغّل التطبيق.
(function () {
    'use strict';
    // الوضع الفاتح قبل أي رسم كي لا يومض الموقع بالداكن أولًا
    try {
        var sm = localStorage.getItem('chess-mode');
        if (sm !== 'light' && sm !== 'dark') sm = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
        document.documentElement.setAttribute('data-mode', sm);
    } catch (e) { /* */ }

    // اللغة المحفوظة قبل أي رسم (اتجاه الصفحة)
    try { var L = localStorage.getItem('chess-lang'); if (L === 'en' || L === 'fr') { document.documentElement.setAttribute('lang', L); document.documentElement.setAttribute('dir', 'ltr'); } } catch (e) { /* */ }

    function loadScript(srcs) {
        return new Promise(function (resolve, reject) {
            var i = 0;
            (function next() {
                if (i >= srcs.length) return reject(new Error(srcs[0]));
                var s = document.createElement('script');
                s.src = srcs[i++];
                s.async = false;
                s.onload = function () { resolve(); };
                s.onerror = function () { s.remove(); next(); };
                document.head.appendChild(s);
            })();
        });
    }

    function loadCss(hrefs) {
        var i = 0;
        (function next() {
            if (i >= hrefs.length) return;
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = hrefs[i++];
            l.onerror = function () { l.remove(); next(); };
            document.head.appendChild(l);
        })();
    }

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
        window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
    }

    var installEv = null;
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault(); installEv = e;
        ['install-btn', 'land-install'].forEach(function (i) { var x = document.getElementById(i); if (x) x.classList.remove('hidden'); });
    });
    window.addEventListener('appinstalled', function () {
        installEv = null;
        ['install-btn', 'land-install'].forEach(function (i) { var x = document.getElementById(i); if (x) x.classList.add('hidden'); });
    });
    document.addEventListener('click', function (ev) {
        if (!ev.target.closest || !ev.target.closest('#install-btn, #land-install-btn') || !installEv) return;
        installEv.prompt();
        installEv.userChoice.then(function () { installEv = null; ['install-btn', 'land-install'].forEach(function (i) { var e = document.getElementById(i); if (e) e.classList.add('hidden'); }); });
    });
    // آيفون لا يدعم زر التثبيت: نعرض الخطوات
    (function () {
        var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
        var standalone = window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        if (ios && !standalone) window.addEventListener('load', function () { var e = document.getElementById('ios-hint'); if (e) e.classList.remove('hidden'); });
    })();

    // الترجمة تُحمَّل مستقلة: إن فشلت يبقى الموقع بالعربية
    loadScript(['/i18n-data.js']).then(function () { return loadScript(['/i18n.js']); }).catch(function () {});

    loadCss([
        '/vendor/chessboard/chessboard-1.0.0.min.css',
        'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.css'
    ]);

    var libs = [
        ['socket.io', ['/socket.io/socket.io.js']],
        ['jQuery', ['/vendor/jquery/jquery.min.js', 'https://code.jquery.com/jquery-3.6.0.min.js']],
        ['chess.js', ['/vendor/chess/chess.js', '/vendor/chess/chess.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js']],
        ['chessboard.js', ['/vendor/chessboard/chessboard-1.0.0.min.js', 'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.js']]
    ];

    var missing = [];
    libs.reduce(function (p, lib) {
        return p.then(function () {
            return loadScript(lib[1]).catch(function () { missing.push(lib[0]); });
        });
    }, Promise.resolve()).then(function () {
        if (missing.length) {
            var b = document.createElement('div');
            b.className = 'lib-banner';
            b.textContent = 'تعذّر تحميل: ' + missing.join('، ') + '. تحقق من الاتصال بالإنترنت أو عطّل مانع الإعلانات ثم أعد تحميل الصفحة.';
            var app = document.getElementById('app');
            app.insertBefore(b, app.firstChild);
            return;
        }
        return loadScript(['/sfx.js']).catch(function () {}).then(function () { return loadScript(['/castle960.js']).catch(function () {}); }).then(function () { return loadScript(['/openings.js']).catch(function () {}); }).then(function () { return loadScript(['/app.js']).then(function () { return loadScript(['/share.js']).catch(function () {}).then(function () { return loadScript(['/extras.js']).catch(function () {}).then(function () { return loadScript(['/mistakes.js']).catch(function () {}).then(function () { return loadScript(['/trainer.js']).catch(function () {}).then(function () { return loadScript(['/looks.js']).catch(function () {}); }); }); }); }).then(function () { return loadScript(['/ludo-client.js']).catch(function () {}).then(function () { return loadScript(['/dchallenge.js']).catch(function () {}).then(function () { return loadScript(['/cosmetics-client.js']).catch(function () {}); }); }); }); }); }).then(function () { return loadScript(['/monopoly.js']).then(function () { return loadScript(['/mp-voice.js']); }).catch(function () {}).then(function () { return loadScript(['/lessons.js']).catch(function () {}); }).then(function () { return loadScript(['/snakes-client.js']).catch(function () {}); }); });
    });
})();
