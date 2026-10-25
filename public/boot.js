// يحمّل المكتبات بالترتيب: النسخة المحلية أولًا ثم CDN كاحتياط، ثم يشغّل التطبيق.
(function () {
    'use strict';

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
        var btn = document.getElementById('install-btn');
        if (btn) btn.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', function () {
        installEv = null;
        var btn = document.getElementById('install-btn');
        if (btn) btn.classList.add('hidden');
    });
    document.addEventListener('click', function (ev) {
        if (!ev.target.closest || !ev.target.closest('#install-btn') || !installEv) return;
        installEv.prompt();
        installEv.userChoice.then(function () { installEv = null; document.getElementById('install-btn').classList.add('hidden'); });
    });

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
        return loadScript(['/sfx.js']).catch(function () {}).then(function () { return loadScript(['/castle960.js']).catch(function () {}); }).then(function () { return loadScript(['/app.js']); }).then(function () { return loadScript(['/monopoly.js']).then(function () { return loadScript(['/mp-voice.js']); }).catch(function () {}).then(function () { return loadScript(['/lessons.js']).catch(function () {}); }); });
    });
})();
