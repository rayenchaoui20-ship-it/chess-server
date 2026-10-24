/* تبييت شطرنج فيشر (Chess960).
   مكتبة chess.js لا تدعم تبييت 960، لذلك تُلعب كل الحركات الأخرى عبرها (حقل التبييت في FEN هو «-»)،
   وتتولى هذه الوحدة وحدها: حقوق التبييت، وتوليد حركات التبييت القانونية، وتنفيذها.
   تعمل في Node (require) وفي المتصفح (window.Castle960)، وتتعامل مع chess.js 1.x و0.10.3 معًا.

   حقوق التبييت نص مثل «HAha»: أحرف كبيرة = ملفات قلاع الأبيض، صغيرة = قلاع الأسود (صيغة Shredder).
   طريقة اللعب: اسحب الملك إلى قلعته، أو إلى مربع وصوله (g أو c) إن لم يكن ذلك خطوة عادية. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Castle960 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var FILES = 'abcdefgh';

    // ───────── FEN ─────────
    function parseFen(fen) {
        var p = String(fen).split(' ');
        var rows = p[0].split('/').map(function (r) {
            var out = [];
            for (var i = 0; i < r.length; i++) {
                var ch = r[i];
                if (/\d/.test(ch)) for (var k = 0; k < +ch; k++) out.push(null); else out.push(ch);
            }
            return out;
        });
        return { rows: rows, turn: p[1] || 'w', cas: p[2] || '-', ep: p[3] || '-', half: parseInt(p[4], 10) || 0, full: parseInt(p[5], 10) || 1 };
    }
    function toFen(p) {
        var placement = p.rows.map(function (row) {
            var s = '', n = 0;
            row.forEach(function (c) { if (c) { if (n) { s += n; n = 0; } s += c; } else n++; });
            return s + (n ? n : '');
        }).join('/');
        return [placement, p.turn, p.cas, p.ep, p.half, p.full].join(' ');
    }
    var isWhitePiece = function (c) { return c === c.toUpperCase(); };
    var backRow = function (color) { return color === 'w' ? 7 : 0; };       // rows[0] = الصف الثامن
    var rankOf = function (color) { return color === 'w' ? '1' : '8'; };

    // ───────── هل المربع مهاجَم من لون معيّن؟ ─────────
    function isAttacked(rows, r, f, by) {
        var up = by === 'w';                       // البيدق الأبيض يهاجم نحو الصف الثامن (r أصغر)
        var P = up ? 'P' : 'p', N = up ? 'N' : 'n', B = up ? 'B' : 'b', R = up ? 'R' : 'r', Q = up ? 'Q' : 'q', K = up ? 'K' : 'k';
        var at = function (rr, ff) { return rr >= 0 && rr < 8 && ff >= 0 && ff < 8 ? rows[rr][ff] : undefined; };
        var pr = up ? r + 1 : r - 1;
        if (at(pr, f - 1) === P || at(pr, f + 1) === P) return true;
        var kn = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
        for (var i = 0; i < kn.length; i++) if (at(r + kn[i][0], f + kn[i][1]) === N) return true;
        for (var dr = -1; dr <= 1; dr++) for (var df = -1; df <= 1; df++) {
            if ((dr || df) && at(r + dr, f + df) === K) return true;
        }
        var dirs = [[1, 0, 'r'], [-1, 0, 'r'], [0, 1, 'r'], [0, -1, 'r'], [1, 1, 'b'], [1, -1, 'b'], [-1, 1, 'b'], [-1, -1, 'b']];
        for (var d = 0; d < dirs.length; d++) {
            var rr = r + dirs[d][0], ff = f + dirs[d][1];
            while (at(rr, ff) !== undefined) {
                var c = rows[rr][ff];
                if (c) {
                    if (c === Q || (dirs[d][2] === 'r' ? c === R : c === B)) return true;
                    break;
                }
                rr += dirs[d][0]; ff += dirs[d][1];
            }
        }
        return false;
    }

    // ───────── حقوق التبييت ─────────
    // من مركز البداية: قلعة على كل جانب من الملك في الصف الخلفي
    function startRights(fen) {
        if (!fen) return '-';
        var p = parseFen(fen), out = '';
        ['w', 'b'].forEach(function (color) {
            var row = p.rows[backRow(color)];
            var K = color === 'w' ? 'K' : 'k', Rk = color === 'w' ? 'R' : 'r';
            var kf = row.indexOf(K);
            if (kf < 0) return;
            var leftOuter = -1, rightOuter = -1, g, h;           // القلعة الخارجية على كل جانب من الملك
            for (g = 0; g < kf; g++) if (row[g] === Rk) { leftOuter = g; break; }
            for (h = 7; h > kf; h--) if (row[h] === Rk) { rightOuter = h; break; }
            var letters = [];
            if (rightOuter >= 0) letters.push(FILES[rightOuter]);
            if (leftOuter >= 0) letters.push(FILES[leftOuter]);
            out += letters.map(function (l) { return color === 'w' ? l.toUpperCase() : l; }).join('');
        });
        return out || '-';
    }

    // حقوق التبييت بعد حركة عادية
    function updateRights(cr, fenBefore, from, to) {
        if (!cr || cr === '-') return '-';
        var p = parseFen(fenBefore);
        var fc = FILES.indexOf(from[0]), fr = 8 - parseInt(from[1], 10);
        var mover = p.rows[fr] && p.rows[fr][fc];
        var out = cr.split('');
        if (mover && mover.toLowerCase() === 'k') {
            var white = isWhitePiece(mover);
            out = out.filter(function (ch) { return (ch === ch.toUpperCase()) !== white; });
        }
        out = out.filter(function (ch) {
            var sq = ch.toLowerCase() + (ch === ch.toUpperCase() ? '1' : '8');
            return sq !== from && sq !== to;            // تحرّكت القلعة أو أُخذت
        });
        return out.join('') || '-';
    }
    function dropColor(cr, color) {
        var out = cr.split('').filter(function (ch) { return ch !== '-' && (ch === ch.toUpperCase()) !== (color === 'w'); }).join('');
        return out || '-';
    }

    // ───────── حركات التبييت القانونية للاعب الذي عليه الدور ─────────
    function castleOptions(fen, cr) {
        if (!cr || cr === '-') return [];
        var p = parseFen(fen), color = p.turn, enemy = color === 'w' ? 'b' : 'w';
        var back = backRow(color), row = p.rows[back], rank = rankOf(color);
        var K = color === 'w' ? 'K' : 'k', Rk = color === 'w' ? 'R' : 'r';
        var kf = row.indexOf(K);
        if (kf < 0) return [];
        var mine = cr.split('').filter(function (ch) { return ch !== '-' && (ch === ch.toUpperCase()) === (color === 'w'); });
        if (!mine.length) return [];
        if (isAttacked(p.rows, back, kf, enemy)) return [];             // لا تبييت من كش
        var res = [];
        mine.forEach(function (ch) {
            var rf = FILES.indexOf(ch.toLowerCase());
            if (rf < 0 || rf === kf || row[rf] !== Rk) return;
            var kingside = rf > kf;
            var kd = kingside ? 6 : 2, rd = kingside ? 5 : 3;
            var lo = Math.min(kf, rf, kd, rd), hi = Math.max(kf, rf, kd, rd), f;
            for (f = lo; f <= hi; f++) {
                if (f !== kf && f !== rf && row[f]) return;               // يجب خلو كل ما بين الملك والقلعة ووجهتيهما
            }
            if (kd !== kf) {                                              // مسار الملك غير مهاجَم (مربع البداية فُحص أعلاه)
                var step = kd > kf ? 1 : -1;
                for (f = kf + step; ; f += step) {
                    if (isAttacked(p.rows, back, f, enemy)) return;
                    if (f === kd) break;
                }
            }
            var rows2 = p.rows.map(function (r) { return r.slice(); });   // بعد التبييت: الملك لا يُهاجَم في وجهته (القلعة لم تعد تحجب)
            rows2[back][kf] = null; rows2[back][rf] = null;
            rows2[back][kd] = K; rows2[back][rd] = Rk;
            if (isAttacked(rows2, back, kd, enemy)) return;
            res.push({
                side: kingside ? 'k' : 'q', color: color, piece: 'k', san: kingside ? 'O-O' : 'O-O-O',
                from: FILES[kf] + rank, rook: FILES[rf] + rank, to: FILES[kd] + rank, rookTo: FILES[rd] + rank,
                flags: kingside ? 'k' : 'q', castle: true
            });
        });
        return res;
    }

    function applyCastle(fen, opt) {
        var p = parseFen(fen);
        var back = backRow(opt.color), K = opt.color === 'w' ? 'K' : 'k', Rk = opt.color === 'w' ? 'R' : 'r';
        var col = function (sq) { return FILES.indexOf(sq[0]); };
        p.rows[back][col(opt.from)] = null;
        p.rows[back][col(opt.rook)] = null;
        p.rows[back][col(opt.to)] = K;
        p.rows[back][col(opt.rookTo)] = Rk;
        p.turn = p.turn === 'w' ? 'b' : 'w';
        p.cas = '-'; p.ep = '-';
        p.half += 1;
        if (opt.color === 'b') p.full += 1;
        return toFen(p);
    }

    // ───────── لعبة 960: غلاف فوق chess.js ─────────
    // يوفّر الواجهتين (camelCase لـ1.x و snake_case لـ0.10.3) ويضيف التبييت.
    function createGame(Lib, startFen) {
        var g, cr, hist, sf = startFen || null;
        var probe = new Lib(sf || undefined);
        var modern = typeof probe.inCheck === 'function';           // 1.x ترمي استثناءً عند الحركة غير القانونية
        function flag(camel, snake) { return typeof g[camel] === 'function' ? g[camel]() : g[snake](); }
        function reset() { g = sf ? new Lib(sf) : new Lib(); cr = startRights(sf); hist = []; }
        reset();

        function castles() { return castleOptions(g.fen(), cr); }
        function suffixFor(lib) {
            var mate = typeof lib.isCheckmate === 'function' ? lib.isCheckmate() : lib.in_checkmate();
            if (mate) return '#';
            var chk = typeof lib.inCheck === 'function' ? lib.inCheck() : lib.in_check();
            return chk ? '+' : '';
        }
        function fail() { if (modern) throw new Error('Invalid move'); return null; }
        function normalLegal(m) {
            return g.moves({ square: m.from, verbose: true }).some(function (x) { return x.to === m.to; });
        }
        function doNormal(m) {
            var before = g.fen(), mv = null;
            try { mv = g.move(m); } catch (e) { mv = null; }
            if (!mv) return fail();
            cr = updateRights(cr, before, mv.from, mv.to);
            hist.push(mv.san);
            return mv;
        }
        function doCastle(opt) {
            var next = applyCastle(g.fen(), opt);
            g = new Lib(next);
            cr = dropColor(cr, opt.color);
            var san = opt.san + suffixFor(g);
            hist.push(san);
            return { color: opt.color, from: opt.from, to: opt.to, piece: 'k', flags: opt.side, san: san, rook: opt.rook, rookTo: opt.rookTo, castle: true };
        }

        var api = {
            get startFen() { return sf; },
            rights: function () { return cr; },
            castles: castles,
            fen: function () { return g.fen(); },
            turn: function () { return g.turn(); },
            get: function (sq) { return g.get(sq); },
            board: function () { return g.board(); },
            reset: reset,
            load: function (fen, rights) { g = new Lib(fen); if (rights != null) cr = rights; hist = []; return true; },
            history: function () { return hist.slice(); },
            moves: function (opts) {
                var list = g.moves(opts || {});
                var cs = castles();
                if (opts && opts.square) cs = cs.filter(function (c) { return c.from === opts.square; });
                if (opts && opts.verbose) return list.concat(cs);
                return list.concat(cs.map(function (c) { return c.san; }));
            },
            move: function (m) {
                var opt = null, cs;
                if (typeof m === 'string') {
                    var t = m.replace(/[+#!?]/g, '');
                    cs = castles();
                    if (t === 'O-O' || t === '0-0') opt = cs.filter(function (c) { return c.side === 'k'; })[0];
                    else if (t === 'O-O-O' || t === '0-0-0') opt = cs.filter(function (c) { return c.side === 'q'; })[0];
                } else if (m && m.from && m.to) {
                    cs = castles().filter(function (c) { return c.from === m.from; });
                    opt = cs.filter(function (c) { return c.rook === m.to; })[0] || null;     // الملك فوق قلعته = تبييت صريح
                    if (!opt && cs.length && !normalLegal(m)) opt = cs.filter(function (c) { return c.to === m.to; })[0] || null;
                }
                return opt ? doCastle(opt) : doNormal(m);
            },
            undo: function () {
                if (!hist.length) return null;
                var keep = hist.slice(0, -1), last = hist[hist.length - 1];
                reset();
                keep.forEach(function (s) { api.move(s); });
                return { san: last };
            },
            inCheck: function () { return flag('inCheck', 'in_check'); },
            isCheckmate: function () { return flag('isCheckmate', 'in_checkmate'); },
            isStalemate: function () { return flag('isStalemate', 'in_stalemate') && !castles().length; },
            isInsufficientMaterial: function () { return flag('isInsufficientMaterial', 'insufficient_material'); },
            isThreefoldRepetition: function () { return flag('isThreefoldRepetition', 'in_threefold_repetition'); },
            isDraw: function () {
                if (!flag('isDraw', 'in_draw')) return false;
                return !(flag('isStalemate', 'in_stalemate') && castles().length);   // جمود لكن التبييت متاح = ليس تعادلًا
            }
        };
        api.in_check = api.inCheck; api.in_checkmate = api.isCheckmate; api.in_stalemate = api.isStalemate;
        api.insufficient_material = api.isInsufficientMaterial; api.in_threefold_repetition = api.isThreefoldRepetition; api.in_draw = api.isDraw;
        return api;
    }

    // يعيد لعبة بعد تنفيذ قائمة حركات SAN، أو null إن فشلت إحداها
    function replay(Lib, startFen, history) {
        var game = createGame(Lib, startFen);
        for (var i = 0; i < history.length; i++) {
            var mv = null;
            try { mv = game.move(history[i]); } catch (e) { mv = null; }
            if (!mv) return null;
        }
        return game;
    }

    return { createGame: createGame, replay: replay, castleOptions: castleOptions, applyCastle: applyCastle, startRights: startRights, updateRights: updateRights, isAttacked: isAttacked, parseFen: parseFen, toFen: toFen };
});
