(function () {
    'use strict';
    // دروس مصغرة تفاعلية: افتتاحيات، نهايات، تكتيك، مبادئ.
    // الخطوة: { say } نص (مع fen/moves اختيارية تُلعب تلقائيًا) أو { try: 'SAN' } يلعبها المتعلّم.
    var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    var PIECE_THEME = 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png';

    var CATS = [
        { id: 'open', name: '♟ افتتاحيات' },
        { id: 'end', name: '🏁 نهايات' },
        { id: 'tac', name: '⚡ تكتيك' },
        { id: 'prin', name: '📘 مبادئ' }
    ];

    var LESSONS = [
        {
            id: 'italian', cat: 'open', title: 'الافتتاحية الإيطالية', fen: START,
            steps: [
                { say: 'ابدأ بالسيطرة على المركز: حرّك بيدق الملك خطوتين.', try: 'e4', ok: 'ممتاز! البيدق يحتل المركز ويفتح الطريق للوزير والفيل.', reply: 'e5' },
                { say: 'أخرج الحصان نحو المركز وهو يهاجم بيدق الأسود.', try: 'Nf3', ok: 'الحصان يطلّ على المركز ويهدد e5.', reply: 'Nc6' },
                { say: 'أخرج الفيل إلى c4 ليستهدف الخانة الضعيفة f7.', try: 'Bc4', ok: 'هذه هي الافتتاحية الإيطالية: الفيل على قطر جميل.', reply: 'Bc5' },
                { say: 'الآن بَيِّت الملك: اسحب الملك من e1 إلى g1.', try: 'O-O', ok: 'الملك في أمان والقلعة تدخل اللعب. القاعدة: قطعتان صغيرتان ثم التبييت.', reply: 'Nf6' },
                { say: 'أنهيت أهم أفكار الافتتاح: مركز، تطوير القطع الصغيرة، تبييت. بعدها تأتي d3 أو c3 ثم d4.' }
            ]
        },
        {
            id: 'scholar', cat: 'open', title: 'مات الحلاق وكيف تتفاداه', fen: START,
            steps: [
                { say: 'هذا فخّ مشهور للمبتدئين. العب كالأبيض: ابدأ بـ e4.', try: 'e4', ok: 'جيد.', reply: 'e5' },
                { say: 'الفيل يستهدف f7، أضعف نقطة عند الأسود في البداية.', try: 'Bc4', ok: 'f7 يحميها الملك فقط.', reply: 'Nc6' },
                { say: 'الوزير يظهر مبكرًا ليهاجم f7 أيضًا.', try: 'Qh5', ok: 'إنذار! الوزير والفيل يستهدفان f7.', reply: 'Nf6' },
                { say: 'الأسود غفل عن التهديد. اضرب f7 بالوزير!', try: 'Qxf7#', ok: 'كش مات في 4 حركات! الملك محاصر والوزير محميّ بالفيل.' },
                { say: 'والآن من جهة الأسود: كيف تدافع؟ شاهد الدفاع الصحيح: يُطرد الوزير ببيدق g6 ثم يُطوَّر الحصان.', fen: START, moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'g6', 'Qf3', 'Nf6'] },
                { say: 'القاعدة: لا تُخرج الوزير مبكرًا. إن فعل الخصم فاطرده بتطوير القطع وهو يضيّع الوقت.' }
            ]
        },
        {
            id: 'qg', cat: 'open', title: 'مناورة الوزير', fen: START,
            steps: [
                { say: 'افتتاحية قديمة وقوية. ابدأ ببيدق الوزير.', try: 'd4', ok: 'مركز قوي ومحميّ بالوزير.', reply: 'd5' },
                { say: 'اعرض بيدق c ليُضعف مركز الأسود. هذه المناورة، وليست خسارة حقيقية: إن أخذه فستستعيده.', try: 'c4', ok: 'هذه «مناورة الوزير».', reply: 'e6' },
                { say: 'طوّر الحصان ليضغط على المركز.', try: 'Nc3', ok: 'الحصان يدعم e4 ويضغط على d5.', reply: 'Nf6' },
                { say: 'الفيل يخرج قبل أن تُغلق البيادق طريقه، ويثبّت حصان الأسود.', try: 'Bg5', ok: 'تطوير نشِط للقطع الصغيرة مع تهديد المركز.', reply: 'Be7' },
                { say: 'الفكرة: سيطر على المركز بالبيادق ثم أخرج القطع إلى خانات تضغط عليه.' }
            ]
        },
        {
            id: 'backrank', cat: 'end', title: 'مات الصف الأخير', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
            steps: [
                { say: 'ملك الأسود خلف بيادقه الثلاثة ولا مخرج له. اكتشف كش المات بحركة واحدة.', try: 'Ra8#', ok: 'مات الصف الأخير! بيادقه الخاصة سدّت طريق ملكه.', hint: 'الرخ ينزل إلى الصف الثامن.', wrong: 'ليست هي. فكّر في الرخ والصف الأخير.' },
                { say: 'للوقاية: افتح «نافذة» لملكك بتحريك h3 أو g3 مبكرًا.' }
            ]
        },
        {
            id: 'kq', cat: 'end', title: 'مات الوزير والملك', fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1',
            steps: [
                { say: 'ملكك يحمي خانة g7. أين يذهب الوزير ليعلن كش مات؟', try: 'Qg7#', ok: 'الوزير محميّ بالملك فلا يمكن أخذه، وكل الخانات المجاورة محكومة.', hint: 'الوزير على عمود g إلى الأمام حتى ملاصقة ملك الأسود.', wrong: 'ليست الأقوى. ابحث عن خانة يحميها ملكك.' },
                { say: 'القاعدة: الوزير مع الملك يعملان معًا؛ الملك يحمي الوزير حين يقترب من الخصم.' }
            ]
        },
        {
            id: 'rr', cat: 'end', title: 'مات الرخين', fen: '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1',
            steps: [
                { say: 'طريقة «السلّم»: رخ يقطع الملك على صف، والآخر يعطي كش على الصف الأخير. ابدأ بقطع الصف السابع.', try: 'Rb7', ok: 'الملك لا يستطيع إلا الذهاب إلى g8.', hint: 'رخ b ينتقل إلى الصف السابع.', wrong: 'اقطع الصف السابع بالرخ الذي على عمود b.', reply: 'Kg8' },
                { say: 'الآن الرخ الآخر يعطي كش من الصف الثامن.', try: 'Ra8#', ok: 'كش مات! رخ يغلق الصف السابع والآخر يهاجم الثامن.', hint: 'الرخ على a2 إلى a8.' }
            ]
        },
        {
            id: 'stale', cat: 'end', title: 'احذر التعادل بالخنق', fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
            steps: [
                { say: 'أنت متفوّق بوزير. أمامك فخ: الحركة Qf7 تبدو قوية لكنها «خنق» (لا حركة قانونية للأسود وليس في كش) فتتعادل! ابحث عن كش مات.', try: 'Qf8#', ok: 'كش مات. المهم أن تترك للملك حركة أو تنهي المباراة فورًا.', bad: { san: 'Qf7', text: 'Qf7 تعادل بالخنق! الملك لا يملك حركة ولا كش عليه. جرّب خانة أخرى.' }, hint: 'الوزير على عمود f يصعد إلى الصف الثامن.', wrong: 'ليست الكش مات. الوزير إلى الصف الثامن يعطي كش.' },
                { say: 'قبل كل حركة في وضع رابح اسأل: هل بقيت للخصم أي حركة قانونية؟' }
            ]
        },
        {
            id: 'fork', cat: 'tac', title: 'شوكة الحصان', fen: 'r3k3/8/8/3NB3/8/8/8/4K3 w - - 0 1',
            steps: [
                { say: 'الحصان يهاجم خانتين معًا. ابحث عن خانة يعطي منها كش للملك ويهاجم الرخ في الوقت نفسه (الفيل يحميها).', try: 'Nc7+', ok: 'شوكة! الملك في كش والرخ مهدّد.', hint: 'الحصان إلى c7.', wrong: 'ابحث عن خانة تهاجم الملك e8 والرخ a8 معًا.', reply: 'Kf7' },
                { say: 'خُذ الرخ المجاني.', try: 'Nxa8', ok: 'كسبت رخًا كاملًا. الشوكة تنجح لأن الخصم لا يستطيع الدفاع عن الهدفين.', hint: 'الحصان يأخذ الرخ.' }
            ]
        },
        {
            id: 'rules', cat: 'prin', title: 'قواعد الافتتاح الذهبية', fen: START,
            steps: [
                { say: '١) سيطر على المركز: بيادق e4 وd4 أو ما يقابلها.', fen: START, moves: ['e4'] },
                { say: '٢) طوّر القطع الصغيرة (الأحصنة ثم الأفيال) قبل الوزير والرخ.', fen: START, moves: ['e4', 'e5', 'Nf3', 'Nc6'] },
                { say: '٣) بَيِّت الملك بسرعة لتأمينه وتحريك الرخ.', fen: START, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'] },
                { say: '٤) لا تحرّك القطعة نفسها مرتين في الافتتاح بلا سبب، ولا تُخرج الوزير مبكرًا، ولا تأخذ بيادق جانبية على حساب التطوير.' }
            ]
        }
    ];

    var done = {};
    try { done = JSON.parse(localStorage.getItem('chess-lessons') || '{}') || {}; } catch (e) { done = {}; }
    function save() { try { localStorage.setItem('chess-lessons', JSON.stringify(done)); } catch (e) { /* */ } }
    function sfx(n) { try { if (window.SFX && localStorage.getItem('chess-sound') !== 'off') window.SFX.play(n); } catch (e) { /* */ } }

    var cur = null, si = 0, board = null, game = null, waiting = false, timers = [], tries = 0;
    function later(f, ms) { var t = setTimeout(f, ms); timers.push(t); }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function stepOf() { return cur.steps[si]; }
    function strip(s) { return String(s).replace(/[+#!?]/g, ''); }

    function renderList() {
        var box = $('#ls-list').empty();
        var total = LESSONS.length, n = LESSONS.filter(function (l) { return done[l.id]; }).length;
        $('#ls-progress').text(n + ' / ' + total + ' دروس مكتملة');
        CATS.forEach(function (c) {
            var items = LESSONS.filter(function (l) { return l.cat === c.id; });
            if (!items.length) return;
            box.append($('<h3 class="sub-title">').text(c.name));
            var ul = $('<ul class="fr-list">');
            items.forEach(function (l) {
                ul.append($('<li>').append(
                    $('<span class="nm">').text((done[l.id] ? '✅ ' : '') + l.title),
                    $('<button class="btn secondary">').text(done[l.id] ? 'أعد' : 'ابدأ').attr('data-lesson', l.id)
                ));
            });
            box.append(ul);
        });
    }

    function open() {
        clearTimers();
        cur = null;
        $('#ls-view').addClass('hidden');
        $('#ls-menu').removeClass('hidden');
        renderList();
    }

    function setText(main, sub, tone) {
        $('#ls-say').text(main || '');
        $('#ls-sub').text(sub || '').attr('data-tone', tone || '');
    }
    function controls() {
        var s = stepOf();
        var isTry = !!(s && s.try) && waiting;
        $('#ls-hint').toggleClass('hidden', !isTry);
        $('#ls-next').toggleClass('hidden', isTry);
        $('#ls-step').text((si + 1) + ' / ' + cur.steps.length);
    }

    function place(fen, instant) {
        game = new Chess(fen);
        board.position(fen, !instant);
    }
    function playSeq(list, then) {
        var i = 0;
        (function go() {
            if (i >= list.length) return then && then();
            var m = game.move(list[i++]);
            if (!m) { setText('', 'تعذّر عرض هذه النقلة.', 'err'); return then && then(); }
            sfx(m.captured ? 'capture' : (m.flags.indexOf('k') >= 0 || m.flags.indexOf('q') >= 0) ? 'castle' : 'move');
            board.position(game.fen());
            later(go, 520);
        })();
    }

    function run() {
        clearTimers();
        var s = stepOf();
        waiting = false; tries = 0;
        $('#ls-board .square-55d63').removeClass('hint-sq');
        if (s.fen) place(s.fen, true);
        setText(s.say, '', '');
        var afterMoves = function () {
            if (s.try) { waiting = true; controls(); } else { controls(); }
        };
        controls();
        $('#ls-next').addClass('hidden'); $('#ls-hint').addClass('hidden');
        if (s.moves && s.moves.length) later(function () { playSeq(s.moves, afterMoves); }, s.fen ? 350 : 0);
        else afterMoves();
        $('#ls-next').text(si === cur.steps.length - 1 ? 'إنهاء الدرس' : 'التالي');
    }

    function startLesson(id) {
        cur = LESSONS.filter(function (l) { return l.id === id; })[0];
        if (!cur) return;
        si = 0;
        $('#ls-menu').addClass('hidden');
        $('#ls-view').removeClass('hidden');
        $('#ls-title').text(cur.title);
        if (board) board.destroy();
        game = new Chess(cur.fen);
        board = Chessboard('ls-board', {
            draggable: true, position: cur.fen, pieceTheme: PIECE_THEME,
            moveSpeed: 130, snapSpeed: 40, snapbackSpeed: 130, appearSpeed: 120, trashSpeed: 90,
            onDragStart: function (src, piece) {
                var s = stepOf();
                if (!waiting || !s || !s.try) return false;
                return piece.charAt(0) === game.turn();
            },
            onDrop: function (from, to) {
                if (from === to) return 'snapback';
                var s = stepOf();
                var m = game.move({ from: from, to: to, promotion: 'q' });
                if (!m) return 'snapback';
                if (strip(m.san) === strip(s.try)) {
                    waiting = false;
                    sfx(m.san.indexOf('#') >= 0 ? 'win' : m.captured ? 'capture' : 'move');
                    setText(s.say, '✔ ' + (s.ok || 'أحسنت!'), 'good');
                    controls();
                    if (s.reply) later(function () {
                        var r = game.move(s.reply);
                        if (r) { sfx(r.captured ? 'capture' : 'move'); board.position(game.fen()); }
                        finishStep();
                    }, 600);
                    else finishStep();
                    return;
                }
                game.undo();
                tries++;
                sfx('wrong');
                var txt = s.bad && strip(m.san) === strip(s.bad.san) ? s.bad.text : (s.wrong || 'ليست أفضل حركة هنا. جرّب مرة أخرى.');
                setText(s.say, '✖ ' + txt, 'err');
                return 'snapback';
            },
            onSnapEnd: function () { board.position(game.fen()); }
        });
        run();
    }

    function finishStep() {
        $('#ls-board .square-55d63').removeClass('hint-sq');
        $('#ls-next').removeClass('hidden').text(si === cur.steps.length - 1 ? 'إنهاء الدرس' : 'التالي');
        $('#ls-hint').addClass('hidden');
        var nxt = cur.steps[si + 1];
        if (nxt && nxt.try && !nxt.fen && !nxt.moves) later(function () { if (cur && stepOf() === cur.steps[si]) advance(); }, 1100);
    }

    function advance() {
        clearTimers();
        if (si >= cur.steps.length - 1) {
            done[cur.id] = 1; save();
            sfx('good');
            return open();
        }
        si++;
        run();
    }

    function hint() {
        var s = stepOf();
        if (!s || !s.try) return;
        var mv = game.moves({ verbose: true }).filter(function (m) { return strip(m.san) === strip(s.try); })[0];
        if (!mv) return;
        $('#ls-board .square-55d63').removeClass('hint-sq');
        $('#ls-board .square-' + mv.from).addClass('hint-sq');
        setText(s.say, '💡 ' + (s.hint || 'حرّك القطعة المضيئة.'), '');
    }

    $(document).on('click', '[data-lesson]', function () { startLesson($(this).attr('data-lesson')); });
    $(document).on('click', '#ls-next', advance);
    $(document).on('click', '#ls-hint', hint);
    $(document).on('click', '#ls-restart', function () { if (cur) { si = 0; startLesson(cur.id); } });
    $(document).on('click', '#ls-back', open);

    window.Lessons = { open: open, _data: LESSONS };
})();
