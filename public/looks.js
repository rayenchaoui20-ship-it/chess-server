(function () {
    'use strict';
    if (!window.APP) return;
    var APP = window.APP, $ = window.jQuery;
    var tr = function (s) { return (window.Lang && window.Lang.t) ? window.Lang.t(s) : s; };
    // ما يلزم لفتح كل مظهر: معرّف الإنجاز (بدون = مفتوح للجميع)
    var NEED = {
        theme: { ice: 'first_win', ocean: 'wins_10', rose: 'puzzles_10', emerald: 'daily_7', marble: 'rating_1600', gold: 'champion', obsidian: 'games_100' },
        pieces: { california: 'first_win', companion: 'wins_10', fantasy: 'puzzles_10', spatial: 'rating_1600', gioco: 'games_100', maestro: 'champion' }
    };
    var NAMES = { classic: 'كلاسيكي', green: 'أخضر', brown: 'بني', slate: 'رمادي', coral: 'مرجاني', purple: 'بنفسجي', night: 'ليلي', ice: 'جليدي', ocean: 'محيطي', rose: 'وردي', emerald: 'زمردي', marble: 'رخامي', gold: 'ذهبي', obsidian: 'سبج' };
    var TITLES = {};
    var unlocked = {};
    try { unlocked = JSON.parse(localStorage.getItem('chess-looks-ach') || '{}') || {}; } catch (e) { unlocked = {}; }
    function save() { try { localStorage.setItem('chess-looks-ach', JSON.stringify(unlocked)); } catch (e) { /* */ } }

    function isOpen(kind, id) {
        var need = NEED[kind] && NEED[kind][id];
        return !need || !!unlocked[need];
    }
    window.Looks = { isOpen: isOpen };

    function ensureDialog() {
        if ($('#looks-dialog').length) return;
        var h = '<div id="looks-dialog" class="overlay hidden"><div class="dialog looks-box">' +
            '<h3>🎨 المظهر</h3>' +
            '<p class="muted small">افتح مظاهر جديدة بالإنجازات.</p>' +
            '<h4>شكل اللوحة</h4><div id="looks-themes" class="looks-grid"></div>' +
            '<h4>شكل القطع</h4><div id="looks-pieces" class="looks-grid"></div>' +
            '<button class="btn ghost full" id="looks-close">إغلاق</button></div></div>';
        $('body').append(h);
        $('#looks-close').on('click', close);
        $('#looks-dialog').on('click', function (e) { if (e.target === this) close(); });
            }
    function lockLabel(need) { return '🔒 ' + tr(TITLES[need] || need); }
    function render() {
        var cur = APP.curTheme(), curP = APP.curPieces();
        var $t = $('#looks-themes').empty();
        APP.themes().forEach(function (id) {
            var open = isOpen('theme', id);
            var $b = $('<button type="button" class="look-item"></button>').attr('data-t', id).toggleClass('on', id === cur).toggleClass('locked', !open);
            $('<span class="look-sw"></span>').attr('data-theme-prev', id).appendTo($b);
            $('<span class="look-nm"></span>').text(tr(NAMES[id] || id)).appendTo($b);
            if (!open) $('<span class="look-lock"></span>').text(lockLabel(NEED.theme[id])).appendTo($b);
            $b.on('click', function () { if (!open) return toast(lockLabel(NEED.theme[id])); APP.setTheme(id); render(); });
            $t.append($b);
        });
        var $p = $('#looks-pieces').empty(), sets = APP.pieceSets();
        Object.keys(sets).forEach(function (id) {
            var open = isOpen('pieces', id);
            var $b = $('<button type="button" class="look-item"></button>').attr('data-p', id).toggleClass('on', id === curP).toggleClass('locked', !open);
            $('<span class="look-nm"></span>').text(tr(sets[id])).appendTo($b);
            if (!open) $('<span class="look-lock"></span>').text(lockLabel(NEED.pieces[id])).appendTo($b);
            $b.on('click', function () { if (!open) return toast(lockLabel(NEED.pieces[id])); APP.setPieces(id); setTimeout(render, 700); });
            $p.append($b);
        });
    }
    function toast(m) { var t = $('<div class="looks-toast"></div>').text(m).appendTo('body'); setTimeout(function () { t.remove(); }, 2200); }
    function open() { ensureDialog(); render(); $('#looks-dialog').removeClass('hidden'); }
    function close() { $('#looks-dialog').addClass('hidden'); }

    // زر في القائمة الجانبية للّعب
    $(document).on('click', '[data-looks="open"]', open);
    function addBtn() {
        if ($('#looks-btn').length) return;
        $('<button id="looks-btn" class="btn ghost" data-looks="open">🎨 المظهر</button>').insertAfter('#pieces-btn');
    }
    addBtn();

    // نعرف الإنجازات المفتوحة من ملف اللاعب
    APP.socket.on('profile', function (p) {
        if (!p || !p.me) return;
        var u = {};
        (p.ach || []).forEach(function (a) { u[a.id] = 1; });
        (p.all || []).forEach(function (a) { TITLES[a.id] = a.title; });
        unlocked = u; save();
        if (!$('#looks-dialog').hasClass('hidden') && $('#looks-dialog').length) render();
    });
    APP.socket.on('ach_new', function (d) {
        (d.list || []).forEach(function (a) { unlocked[a.id] = 1; TITLES[a.id] = a.title; });
        save();
    });
    APP.socket.on('welcome', function (w) { if (w && w.user) setTimeout(function () { APP.socket.emit('profile_get', {}); }, 600); });
})();
