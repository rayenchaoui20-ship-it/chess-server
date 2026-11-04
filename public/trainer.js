/* التدريب على الافتتاحيات: تختار افتتاحية فتلعب خطواتها بنفسك والموقع يصحّح لك. يُحمَّل بعد app.js. */
(function () {
    'use strict';
    var APP = window.APP;
    if (!APP || typeof Chess === 'undefined' || typeof Chessboard === 'undefined') return;
    function $id(i) { return document.getElementById(i); }
    function fmt(s, p) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? p[k] : m; }); }
    function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
    var clean = function (s) { return String(s || '').replace(/[+#!?]/g, ''); };
    // الخطوط: side = الجهة التي تتدرّب عليها
    var OPS = [
        { id: 'italian', name: 'Italian Game', side: 'w', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6', idea: 'تطوير سريع: الفيل إلى c4 يستهدف f7، ثم c3 وd3 لبناء مركز هادئ.' },
        { id: 'ruy', name: 'Ruy Lopez', side: 'w', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6', idea: 'الفيل على b5 يضغط على الحصان الذي يحمي e5. خطة طويلة المدى وضغط على المركز.' },
        { id: 'qg', name: "Queen's Gambit", side: 'w', moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3', idea: 'تعرض بيدق c4 للسيطرة على المركز. إن أخذه الأسود تستعيده، وإن رفض تبني ضغطًا.' },
        { id: 'london', name: 'London System', side: 'w', moves: 'd4 d5 Nf3 Nf6 Bf4 e6 e3 Bd6 Bg3 O-O Nbd2 c5 c3 Nc6', idea: 'نظام سهل التعلم: نفس البناء تقريبًا ضد أي دفاع، فيل على f4 وبيدقا d4 وe3.' },
        { id: 'scotch', name: 'Scotch Game', side: 'w', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5', idea: 'تفتح المركز مبكرًا بـd4 لتنال مساحة وتطويرًا نشطًا.' },
        { id: 'najdorf', name: 'Sicilian: Najdorf', side: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5', idea: 'من أشهر دفاعات الأسود: a6 يمنع حصان الأبيض من b5 ويحضّر الهجوم بـb5 وe5.' },
        { id: 'french', name: 'French Defense', side: 'b', moves: 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7', idea: 'بنية صلبة: d5 يتحدّى مركز الأبيض، ثم تهاجم بيدق d4 لاحقًا بـc5.' },
        { id: 'caro', name: 'Caro-Kann Defense', side: 'b', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6', idea: 'دفاع صلب: c6 يدعم d5، ويخرج الفيل خارج سلسلة البيادق قبل e6.' },
        { id: 'kid', name: "King's Indian Defense", side: 'b', moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5', idea: 'تترك المركز للأبيض ثم تهاجمه بـe5، وغالبًا تنتهي بهجوم على الملك.' },
        { id: 'qgd', name: "Queen's Gambit Declined", side: 'b', moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7', idea: 'دفاع تقليدي صلب: e6 يدعم d5 مع تطوير هادئ للقطع.' },
        { id: 'scandi', name: 'Scandinavian Defense', side: 'b', moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6', idea: 'تأخذ البيدق فورًا بالوزير وتتطوّر بسرعة، لكن احذر من إضاعة الوقت بالوزير.' },
        { id: 'slav', name: 'Slav Defense', side: 'b', moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6', idea: 'c6 يدعم d5 دون أن يسد الفيل، ويسهّل استعادة بيدق c4.' },
        { id: 'pirc', name: 'Pirc Defense', side: 'b', moves: 'e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O', idea: 'تسمح للأبيض بالمركز ثم تهاجمه بالحصان والفيل المفتوح على g7.' }
    ];
    OPS.forEach(function (o) { o.seq = o.moves.split(' '); });
    var done = {}; try { done = JSON.parse(lget('chess-opn-done') || '{}') || {}; } catch (e) { done = {}; }
    var cur = null, game = null, board = null, ply = 0, errs = 0, busy = false, finished = false, sel = null, timer = null;

    function say(t, tone) { $id('tr-text').textContent = t; $id('tr-card').setAttribute('data-tone', tone || ''); }
    function renderList() {
        var box = $id('tr-list'); box.textContent = '';
        OPS.forEach(function (o) {
            var b = document.createElement('button'); b.type = 'button'; b.className = 'mode-row tr-item'; b.setAttribute('data-tr', 'pick'); b.setAttribute('data-id', o.id);
            var t = document.createElement('span'); t.className = 't'; t.textContent = (done[o.id] ? '✅ ' : '') + o.name;
            var d = document.createElement('span'); d.className = 'd'; d.textContent = (o.side === 'w' ? '⚪ ' : '⚫ ') + (o.side === 'w' ? 'تلعب بالأبيض' : 'تلعب بالأسود');
            b.appendChild(t); b.appendChild(d); box.appendChild(b);
        });
        var n = OPS.filter(function (o) { return done[o.id]; }).length;
        $id('tr-sub').textContent = fmt('أتقنت {n} من {m} افتتاحيات.', { n: n, m: OPS.length });
    }
    function showView(practice) {
        $id('tr-listview').classList.toggle('hidden', practice);
        $id('tr-practice').classList.toggle('hidden', !practice);
    }
    function clearMarks() { var b = $id('tboard'); if (b) [].forEach.call(b.querySelectorAll('.square-55d63'), function (q) { q.classList.remove('legal-move', 'legal-capture', 'selected-sq', 'hint-sq'); }); }
    function showLegal(src) {
        clearMarks();
        game.moves({ square: src, verbose: true }).forEach(function (m) { var q = $id('tboard').querySelector('.square-' + m.to); if (q) q.classList.add(m.captured ? 'legal-capture' : 'legal-move'); });
    }
    function progress() { $id('tr-meta').textContent = cur.name + ' · ' + fmt('الخطوة {a} من {b}', { a: Math.min(ply + 1, cur.seq.length), b: cur.seq.length }); }
    function opponentMove() {
        if (finished || ply >= cur.seq.length) return;
        busy = true;
        timer = setTimeout(function () {
            var mv = game.move(cur.seq[ply]);
            if (!mv) { busy = false; return; }
            ply++; board.position(game.fen()); busy = false;
            if (ply >= cur.seq.length) return finish();
            progress(); say('دورك: العب الخطوة التالية من النظرية.', '');
        }, 550);
    }
    function finish() {
        finished = true; busy = false; progress();
        var perfect = errs === 0;
        if (perfect) { done[cur.id] = 1; lset('chess-opn-done', JSON.stringify(done)); }
        say(perfect ? 'أحسنت! أتقنت هذا الخط بلا أخطاء.' : 'أنهيت الخط. أعده بلا أخطاء لتُحسب مُتقَنة.', perfect ? 'win' : 'draw');
        $id('tr-idea').textContent = cur.idea;
        renderList();
    }
    function tryMove(from, to) {
        if (busy || finished) return false;
        var legal = game.moves({ square: from, verbose: true }).filter(function (m) { return m.to === to; });
        if (!legal.length) return false;
        var mv = game.move({ from: from, to: to, promotion: 'q' });
        if (!mv) return false;
        if (clean(mv.san) === clean(cur.seq[ply])) {
            ply++; board.position(game.fen());
            if (ply >= cur.seq.length) finish(); else { progress(); say('صحيح! ✅', 'win'); opponentMove(); }
            return true;
        }
        game.undo(); errs++;
        setTimeout(function () { if (board) board.position(game.fen()); }, 150);
        say(errs >= 2 ? fmt('ليست من النظرية. الخطوة المطلوبة: {m}', { m: cur.seq[ply] }) : 'ليست الخطوة المعروفة في هذه الافتتاحية. حاول مرة أخرى.', 'loss');
        return true;
    }
    function tap(sq) {
        if (busy || finished || !game) return;
        if (sel && sel !== sq && tryMove(sel, sq)) { sel = null; clearMarks(); return; }
        var pc = game.get(sq);
        if (pc && pc.color === cur.side) { sel = sq; showLegal(sq); } else { sel = null; clearMarks(); }
    }
    function start(o) {
        clearTimeout(timer);
        $id('tr-idea').textContent = '';
        cur = o; game = new Chess(); ply = 0; errs = 0; busy = false; finished = false; sel = null;
        showView(true);
        if (board) board.destroy();
        board = Chessboard('tboard', {
            draggable: true, position: 'start', orientation: o.side === 'b' ? 'black' : 'white', pieceTheme: window.pieceTheme,
            moveSpeed: 130, snapSpeed: 40, snapbackSpeed: 130,
            onDragStart: function (source, piece) { if (busy || finished || piece.charAt(0) !== o.side || game.turn() !== o.side) return false; showLegal(source); },
            onDrop: function (source, target) { clearMarks(); if (source === target) { tap(source); return 'snapback'; } return tryMove(source, target) ? undefined : 'snapback'; },
            onSnapEnd: function () { clearMarks(); board.position(game.fen()); }
        });
        progress();
        if (o.side === 'b') { say('الأبيض يبدأ...', ''); opponentMove(); } else say('دورك: ابدأ بأول خطوة من هذه الافتتاحية.', '');
    }
    function hint() {
        if (!cur || busy || finished) return;
        try { var g = new Chess(game.fen()), m = g.move(cur.seq[ply]); clearMarks(); var q = $id('tboard').querySelector('.square-' + m.from); if (q) q.classList.add('hint-sq'); say(fmt('جرّب تحريك {p}.', { p: { p: 'البيدق', n: 'الحصان', b: 'الفيل', r: 'القلعة', q: 'الوزير', k: 'الملك' }[m.piece] }), ''); } catch (e) { /* */ }
    }
    document.addEventListener('click', function (e) {
        var sq = e.target.closest && e.target.closest('#tboard .square-55d63');
        if (sq) return tap(sq.getAttribute('data-square'));
        var b = e.target.closest && e.target.closest('[data-tr]');
        if (!b) return;
        var a = b.getAttribute('data-tr');
        if (a === 'open') { APP.show('trainer-screen'); renderList(); showView(false); }
        else if (a === 'pick') { var o = OPS.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; if (o) start(o); }
        else if (a === 'hint') hint();
        else if (a === 'restart' && cur) start(cur);
        else if (a === 'list') { clearTimeout(timer); showView(false); renderList(); }
    });
    window.Trainer = { start: start };
})();
