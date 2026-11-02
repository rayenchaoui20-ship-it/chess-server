/* أسماء الافتتاحيات الشائعة: تُطابَق بأطول بادئة من حركات المباراة. */
(function () {
    'use strict';
    var L = [
        ['Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5'], ['Ruy Lopez: Morphy Defense', 'e4 e5 Nf3 Nc6 Bb5 a6'], ['Ruy Lopez: Berlin Defense', 'e4 e5 Nf3 Nc6 Bb5 Nf6'],
        ['Italian Game', 'e4 e5 Nf3 Nc6 Bc4'], ['Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5'], ['Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6'],
        ['Scotch Game', 'e4 e5 Nf3 Nc6 d4'], ['Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6'], ['Petrov Defense', 'e4 e5 Nf3 Nf6'],
        ['Philidor Defense', 'e4 e5 Nf3 d6'], ['King\'s Gambit', 'e4 e5 f4'], ['Vienna Game', 'e4 e5 Nc3'], ['Bishop\'s Opening', 'e4 e5 Bc4'],
        ['Center Game', 'e4 e5 d4'], ['King\'s Pawn Game', 'e4 e5'],
        ['Sicilian Defense', 'e4 c5'], ['Sicilian: Open', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4'], ['Sicilian: Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
        ['Sicilian: Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'], ['Sicilian: Scheveningen', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6'],
        ['Sicilian: Classical', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6'], ['Sicilian: Sveshnikov', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5'],
        ['Sicilian: Taimanov', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6'], ['Sicilian: Kan', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6'],
        ['Sicilian: Alapin', 'e4 c5 c3'], ['Sicilian: Closed', 'e4 c5 Nc3'],
        ['French Defense', 'e4 e6'], ['French: Advance', 'e4 e6 d4 d5 e5'], ['French: Tarrasch', 'e4 e6 d4 d5 Nd2'], ['French: Winawer', 'e4 e6 d4 d5 Nc3 Bb4'],
        ['French: Classical', 'e4 e6 d4 d5 Nc3 Nf6'], ['French: Exchange', 'e4 e6 d4 d5 exd5'],
        ['Caro-Kann Defense', 'e4 c6'], ['Caro-Kann: Advance', 'e4 c6 d4 d5 e5'], ['Caro-Kann: Classical', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5'], ['Caro-Kann: Exchange', 'e4 c6 d4 d5 exd5'],
        ['Scandinavian Defense', 'e4 d5'], ['Alekhine Defense', 'e4 Nf6'], ['Pirc Defense', 'e4 d6 d4 Nf6 Nc3 g6'], ['Modern Defense', 'e4 g6'], ['Owen Defense', 'e4 b6'],
        ['Queen\'s Gambit', 'd4 d5 c4'], ['Queen\'s Gambit Declined', 'd4 d5 c4 e6'], ['Queen\'s Gambit Accepted', 'd4 d5 c4 dxc4'], ['Slav Defense', 'd4 d5 c4 c6'],
        ['Semi-Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6'], ['Albin Countergambit', 'd4 d5 c4 e5'], ['Chigorin Defense', 'd4 d5 c4 Nc6'],
        ['London System', 'd4 d5 Nf3 Nf6 Bf4'], ['London System', 'd4 Nf6 Nf3 e6 Bf4'], ['Colle System', 'd4 d5 Nf3 Nf6 e3'], ['Torre Attack', 'd4 Nf6 Nf3 e6 Bg5'], ['Trompowsky Attack', 'd4 Nf6 Bg5'],
        ['Indian Defense', 'd4 Nf6'], ['Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4'], ['Queen\'s Indian Defense', 'd4 Nf6 c4 e6 Nf3 b6'], ['King\'s Indian Defense', 'd4 Nf6 c4 g6 Nc3 Bg7'],
        ['Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5'], ['Benoni Defense', 'd4 Nf6 c4 c5'], ['Dutch Defense', 'd4 f5'], ['Catalan Opening', 'd4 Nf6 c4 e6 g3'],
        ['Queen\'s Pawn Game', 'd4 d5'], ['Queen\'s Pawn Game', 'd4'],
        ['English Opening', 'c4'], ['English: Symmetrical', 'c4 c5'], ['English: Reversed Sicilian', 'c4 e5'],
        ['Réti Opening', 'Nf3 d5 c4'], ['Réti Opening', 'Nf3'], ['King\'s Indian Attack', 'Nf3 d5 g3'],
        ['Bird\'s Opening', 'f4'], ['Larsen\'s Opening', 'b3'], ['Polish Opening', 'b4'], ['Grob Opening', 'g4']
    ];
    var T = L.map(function (x) { return [x[0], x[1].split(' ')]; });
    function clean(s) { return String(s).replace(/[+#!?]/g, ''); }
    window.OPENINGS = {
        // sans: قائمة SAN من أول حركة. يعيد أدقّ اسم يطابق أطول بادئة، أو null
        find: function (sans) {
            var best = null, bl = 0, s = (sans || []).slice(0, 24).map(clean);
            T.forEach(function (o) {
                var m = o[1];
                if (m.length <= bl || m.length > s.length) return;
                for (var i = 0; i < m.length; i++) if (m[i] !== s[i]) return;
                best = o[0]; bl = m.length;
            });
            return best;
        }
    };
})();
