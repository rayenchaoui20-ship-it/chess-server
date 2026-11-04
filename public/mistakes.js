/* تمارين من أخطائي: يجمع أخطاءك من المباريات التي حلّلتها ويعيدها إليك لتجد النقلة الصحيحة. يُحمَّل بعد app.js. */
(function () {
    'use strict';
    var APP = window.APP;
    if (!APP || typeof Chess === 'undefined' || typeof Chessboard === 'undefined') return;
    var socket = APP.socket;
    function $id(i) { return document.getElementById(i); }
    function fmt(s, p) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? p[k] : m; }); }
    function T(s) { return s; }
    var tt = fmt;   // النص يُكتب بالعربية ثم يترجمه i18n.js تلقائيًا بحسب اللغة
    var list = [], idx = -1, cur = null, game = null, board = null, solved = false, tries = 0, stats = null;
    var PH = ['الافتتاح', 'الوسط', 'النهاية'];
    var PN = { p: 'البيدق', n: 'الحصان', b: 'الفيل', r: 'القلعة', q: 'الوزير', k: 'الملك' };
    var clean = function (s) { return String(s || '').replace(/[+#!?]/g, ''); };

    function say(text, tone) {
        $id('mist-text').textContent = text;
        $id('mist-card').setAttribute('data-tone', tone || '');
    }
    function summary() {
        var el = $id('mist-sub'), el2 = $id('mist-sub2');
        el2.textContent = '';
        if (!stats || !stats.total) { el.textContent = ''; return; }
        var ph = stats.ph || [0, 0, 0], mx = ph.indexOf(Math.max(ph[0], ph[1], ph[2]));
        var pk = Object.keys(stats.pc || {}).sort(function (a, b) { return stats.pc[b] - stats.pc[a]; })[0];
        el.textContent = tt('{n} خطأ محفوظ، أتقنت منها {m}.', { n: stats.total, m: stats.mastered });
        el2.textContent = tt('أكثر أخطائك في {p}، وغالبًا بحركة {q}.', { p: PH[mx], q: PN[pk] || '' });
    }
    function clearMarks() { var b = $id('mboard'); if (b) [].forEach.call(b.querySelectorAll('.square-55d63'), function (q) { q.classList.remove('legal-move', 'legal-capture', 'selected-sq', 'hint-sq'); }); }
    function showLegal(src) {
        clearMarks();
        game.moves({ square: src, verbose: true }).forEach(function (m) {
            var q = $id('mboard').querySelector('.square-' + m.to);
            if (q) q.classList.add(m.captured ? 'legal-capture' : 'legal-move');
        });
    }
    var sel = null;
    function tryMove(from, to) {
        if (solved || !game) return false;
        var legal = game.moves({ square: from, verbose: true }).filter(function (m) { return m.to === to; });
        if (!legal.length) return false;
        var mv = game.move({ from: from, to: to, promotion: 'q' });
        if (!mv) return false;
        tries++;
        if (clean(mv.san) === clean(cur.best)) {
            solved = true;
            board.position(game.fen());
            say(tt('✅ أحسنت! هذه هي الأفضل: {m}', { m: mv.san }), 'win');
            socket.emit('mist_result', { id: cur.id, ok: tries === 1 });
            if (tries === 1 && stats) { cur.ok = (cur.ok || 0) + 1; }
        } else {
            game.undo();
            setTimeout(function () { if (board) board.position(game.fen()); }, 150);
            say(tt('❌ {m} ليست الأفضل. حاول مرة أخرى، أو اضغط «تلميح».', { m: mv.san }), 'loss');
            if (tries === 1) socket.emit('mist_result', { id: cur.id, ok: false });
        }
        return true;
    }
    function hintSquare() {
        try {
            var g = new Chess(cur.fen), m = g.move(cur.best);
            var q = m && $id('mboard').querySelector('.square-' + m.from);
            clearMarks(); if (q) q.classList.add('hint-sq');
            say(tt('جرّب تحريك {p}.', { p: T(PN[m.piece] || '') }), '');
        } catch (e) { /* */ }
    }
    function showSolution() {
        try {
            var g = new Chess(cur.fen), m = g.move(cur.best);
            board.position(g.fen()); solved = true; clearMarks();
            say(tt('الحل: {m}. كنتَ قد لعبت {p} في المباراة.', { m: cur.best, p: cur.played }), 'draw');
            socket.emit('mist_result', { id: cur.id, ok: false });
        } catch (e) { /* */ }
    }
    function start(p) {
        cur = p; solved = false; tries = 0; sel = null;
        game = new Chess(p.fen);
        var side = game.turn();
        if (board) board.destroy();
        board = Chessboard('mboard', {
            draggable: true, position: p.fen, orientation: side === 'b' ? 'black' : 'white', pieceTheme: window.pieceTheme,
            moveSpeed: 130, snapSpeed: 40, snapbackSpeed: 130,
            onDragStart: function (source, piece) { if (solved || piece.charAt(0) !== game.turn()) return false; showLegal(source); },
            onDrop: function (source, target) { clearMarks(); if (source === target) { tap(source); return 'snapback'; } return tryMove(source, target) ? undefined : 'snapback'; },
            onSnapEnd: function () { clearMarks(); board.position(game.fen()); }
        });
        $id('mist-meta').textContent = tt('تمرين {i} من {n} · خسرتَ {l}% من فرصة الفوز هنا', { i: idx + 1, n: list.length, l: p.loss });
        say(tt('أنت تلعب بـ{c}. ما أفضل نقلة؟', { c: T(side === 'w' ? 'الأبيض' : 'الأسود') }), '');
        $id('mist-hint').disabled = false; $id('mist-show').disabled = false;
    }
    function tap(sq) {
        if (solved || !game) return;
        if (sel && sel !== sq && tryMove(sel, sq)) { sel = null; clearMarks(); return; }
        var pc = game.get(sq);
        if (pc && pc.color === game.turn()) { sel = sq; showLegal(sq); } else { sel = null; clearMarks(); }
    }
    document.addEventListener('click', function (e) {
        var sq = e.target.closest && e.target.closest('#mboard .square-55d63');
        if (sq) return tap(sq.getAttribute('data-square'));
        var b = e.target.closest && e.target.closest('[data-mist]');
        if (!b) return;
        var a = b.getAttribute('data-mist');
        if (a === 'open') { APP.show('mist-screen'); load(); }
        else if (a === 'next') next();
        else if (a === 'hint' && cur) hintSquare();
        else if (a === 'show' && cur && !solved) showSolution();
    });
    function next() {
        if (!list.length) return;
        idx = (idx + 1) % list.length;
        start(list[idx]);
    }
    function load() { say(tt('جارٍ التحميل...'), ''); socket.emit('mist_get'); }
    socket.on('mist_list', function (d) {
        list = (d && d.list) || []; stats = d && d.stats; idx = -1;
        summary();
        var empty = !list.length;
        $id('mist-empty').classList.toggle('hidden', !empty);
        $id('mboard').parentNode.classList.toggle('hidden', empty);
        $id('mist-card').classList.toggle('hidden', empty);
        [].forEach.call(document.querySelectorAll('[data-mist="hint"],[data-mist="show"],[data-mist="next"]'), function (b) { b.classList.toggle('hidden', empty); });
        if (empty) { if (stats && stats.total) $id('mist-empty').textContent = tt('أحسنت! أتقنت كل أخطائك المحفوظة. حلّل مباريات جديدة لتظهر لك أخطاء أخرى.'); return; }
        next();
    });
    window.Mistakes = { start: start };
})();
