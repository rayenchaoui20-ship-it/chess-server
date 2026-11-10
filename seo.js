'use strict';
// صفحات البحث بثلاث لغات: ar على المسار العادي، en تحت /en، fr تحت /fr. كل صفحة فيها hreflang وشرح للقواعد.
const LANGS = ['ar', 'en', 'fr'];
const LOCALE = { ar: 'ar_AR', en: 'en_US', fr: 'fr_FR' };
const SITE = { ar: 'الألعاب اللوحية', en: 'Board Games', fr: 'Jeux de société' };
const META = {
    home: { img: '/og-image.png', cat: 'Game' },
    chess: { img: '/og-chess.png', cat: 'Chess' },
    monopoly: { img: '/og-monopoly.png', cat: 'Board game' },
    ludo: { img: '/og-ludo.png', cat: 'Board game' },
    snakes: { img: '/og-snakes.png', cat: 'Board game' },
    cards: { img: '/og-cards.png', cat: 'Card game' }
};
const PAGES = {
    ar: {
        home: { t: 'الشطرنج وملك المدينة وسلم وثعبان: ألعاب لوحية أونلاين مجانًا', d: 'العب الشطرنج وملك المدينة وسلم وثعبان وليدو مع أصدقائك أو ضد لاعبين حقيقيين والحاسوب. بلا تحميل وبلا اشتراك، مع تصنيف وبطولات وإنجازات.', h: 'ألعاب لوحية أونلاين مجانًا', rules: [] },
        chess: { t: 'العب الشطرنج أونلاين مجانًا: تصنيف وألغاز وبطولات', d: 'شطرنج مباشر مع لاعبين حقيقيين أو ضد الحاسوب، مع تصنيف ولوحة متصدرين وألغاز يومية ودروس افتتاحيات وبطولات للنوادي.', h: 'الشطرنج أونلاين', rules: ['لكل لاعب 16 قطعة. يفوز من يحاصر ملك خصمه بحيث لا مهرب له (كش مات).', 'يتحرك البيدق للأمام، والحصان على شكل L، والفيل قطريًا، والرخ مستقيمًا، والوزير في كل الاتجاهات، والملك خطوة واحدة.', 'هناك حركات خاصة: التبييت وأخذ البيدق في الممر والترقية.', 'تنتهي المباراة بالتعادل في حالة الخنق أو تكرار الوضع أو قلة القطع.'] },
        monopoly: { t: 'ملك المدينة: لعبة تجارة وعقارات أونلاين مع الأصدقاء', d: 'اشترِ المدن وابنِ الفنادق وأفلس خصومك في ملك المدينة. حتى 8 لاعبين، مزادات وتبادل ودردشة صوتية وبطولات للنوادي.', h: 'ملك المدينة: لعبة العقارات', rules: ['يرمي كل لاعب النرد ويتقدم على لوحة المدن ويشتري ما يقف عليه إن كان بلا مالك.', 'عندما يقف خصمك على ملكيتك يدفع لك إيجارًا، ويزيد الإيجار إذا جمعت كل مدن اللون وبنيت عليها.', 'يمكنك الرهن والتبادل والمزاد، ومن يفلس يخرج من اللعبة.', 'يفوز آخر لاعب يبقى بماله.'] },
        ludo: { t: 'ليدو أونلاين: العب مع أصدقائك أو ضد الحاسوب', d: 'لعبة ليدو كلاسيكية لحتى 4 لاعبين: أخرج قطعك وكُل قطع خصومك وسبقهم إلى البيت. العب مع الأصدقاء بكود غرفة أو ضد الحاسوب.', h: 'ليدو أونلاين', rules: ['لكل لاعب أربع قطع. لا تخرج القطعة من القاعدة إلا برمية 6.', 'تتحرك القطع حول اللوحة، وإذا نزلت قطعتك على قطعة خصم خارج المربعات الآمنة تعود قطعته إلى القاعدة.', 'الأكل أو الوصول إلى البيت يمنحك رمية إضافية، وثلاث ستات متتالية تلغي الدور.', 'يفوز من يُدخل قطعه الأربع إلى البيت أولًا.'] },
        snakes: { t: 'سلم وثعبان أونلاين: العب مع أصدقائك أو ضد الحاسوب', d: 'لعبة سلم وثعبان بأربعة أنماط: كلاسيكية وسريعة وفوضى ومفاجآت. العب مع الأصدقاء أو لاعبين عشوائيين، مع ترتيب شهري وبطولات.', h: 'سلم وثعبان أونلاين', rules: ['ارمِ النرد وتقدّم بعدد الخانات.', 'إذا نزلت عند أسفل سلم صعدت إلى أعلاه، وإذا نزلت عند رأس ثعبان هبطت إلى ذيله.', 'يفوز من يصل أولًا إلى الخانة الأخيرة.'] },
        cards: { t: 'لعبة الورق أونلاين: العب مع أصدقائك أو ضد الحاسوب', d: 'لعبة ورق سريعة وممتعة لحتى 4 لاعبين: تخلّص من أوراقك أولًا بمطابقة اللون أو الرقم، واستخدم أوراق المنع والعكس والسحب والبرّية. العب بكود غرفة أو ضد الحاسوب.', h: 'لعبة الورق أونلاين', rules: ['يبدأ كل لاعب بسبع أوراق. ألقِ ورقة تطابق لون الورقة المكشوفة أو رقمها.', 'ورقة المنع تتخطّى اللاعب التالي، والعكس يقلب اتجاه اللعب، وورقة +2 تجعل التالي يسحب ورقتين ويخسر دوره.', 'البرّية تغيّر اللون، والبرّية +4 تغيّر اللون وتجعل التالي يسحب أربعًا.', 'إن لم تملك ورقة صالحة اسحب واحدة. يفوز من يتخلص من كل أوراقه أولًا.'] }
    },
    en: {
        home: { t: 'Chess, Monopoly-style, Ludo and Snakes & Ladders: free online board games', d: 'Play chess, City King (a Monopoly-style game), Ludo and Snakes & Ladders online with friends, real players or the computer. Free, no download, with ratings, tournaments and achievements.', h: 'Free online board games', rules: [] },
        chess: { t: 'Play chess online for free: ratings, puzzles and tournaments', d: 'Live chess against real players or the computer, with ratings, leaderboards, daily puzzles, opening lessons and club tournaments. No download, no sign-up needed.', h: 'Play chess online', rules: ['Each player has 16 pieces. You win by checkmating the opponent\'s king so it cannot escape.', 'Pawns move forward, knights jump in an L shape, bishops move diagonally, rooks in straight lines, the queen in any direction and the king one square.', 'Special moves include castling, en passant and pawn promotion.', 'A game is drawn by stalemate, repetition or insufficient material.'] },
        monopoly: { t: 'City King: a Monopoly-style property trading game online', d: 'Buy cities, build hotels and bankrupt your rivals in City King. Up to 8 players, auctions, trading, voice chat and club tournaments. Free in your browser.', h: 'City King: property trading game', rules: ['Roll the dice, move around the board and buy any property you land on that has no owner.', 'When an opponent lands on your property they pay rent. Rent grows when you own the whole colour set and build on it.', 'You can mortgage, trade and auction. A player who cannot pay is bankrupt and out.', 'The last player left with money wins.'] },
        ludo: { t: 'Play Ludo online with friends or against the computer', d: 'Classic Ludo for up to 4 players: bring your pieces out, capture your opponents\' pieces and race them home. Play with friends using a room code, or against the computer.', h: 'Play Ludo online', rules: ['Each player has four pieces. A piece leaves the base only on a roll of 6.', 'Pieces travel around the board. Landing on an opponent outside the safe squares sends it back to its base.', 'Capturing or reaching home gives you an extra roll. Three sixes in a row cancel your turn.', 'The first player to bring all four pieces home wins.'] },
        snakes: { t: 'Play Snakes & Ladders online with friends or the computer', d: 'Snakes & Ladders in four modes: classic, quick, chaos and surprises. Play with friends or random players, with monthly rankings and tournaments.', h: 'Play Snakes & Ladders online', rules: ['Roll the dice and move forward that many squares.', 'Land at the bottom of a ladder to climb it, or on a snake\'s head to slide down to its tail.', 'The first player to reach the last square wins.'] },
        cards: { t: 'Play the card game online with friends or the computer', d: 'A fast, fun card game for up to 4 players: be first to empty your hand by matching colour or number, with skip, reverse, draw and wild cards. Play with a room code or against the computer.', h: 'Play the card game online', rules: ['Each player starts with seven cards. Play a card that matches the colour or number of the card on top.', 'Skip passes over the next player, reverse flips the direction, and +2 makes the next player draw two and lose their turn.', 'Wild changes the colour, and Wild +4 changes it and makes the next player draw four.', 'If you have no playable card, draw one. The first player to empty their hand wins.'] }
    },
    fr: {
        home: { t: 'Échecs, Roi de la Ville, Ludo et Serpents et Échelles : jeux de société en ligne gratuits', d: 'Jouez aux échecs, au Roi de la Ville (un jeu façon Monopoly), au Ludo et aux Serpents et Échelles en ligne avec des amis, de vrais joueurs ou l\'ordinateur. Gratuit, sans téléchargement, avec classement, tournois et succès.', h: 'Jeux de société en ligne gratuits', rules: [] },
        chess: { t: 'Jouer aux échecs en ligne gratuitement : classement, problèmes et tournois', d: 'Échecs en direct contre de vrais joueurs ou l\'ordinateur, avec classement, tableau des meilleurs, problèmes quotidiens, leçons d\'ouvertures et tournois de clubs. Sans téléchargement.', h: 'Jouer aux échecs en ligne', rules: ['Chaque joueur a 16 pièces. On gagne en mettant le roi adverse échec et mat, sans issue possible.', 'Le pion avance, le cavalier saute en L, le fou va en diagonale, la tour en ligne droite, la dame dans toutes les directions et le roi d\'une case.', 'Coups spéciaux : le roque, la prise en passant et la promotion du pion.', 'La partie est nulle par pat, par répétition ou par manque de matériel.'] },
        monopoly: { t: 'Roi de la Ville : un jeu d\'immobilier façon Monopoly en ligne', d: 'Achetez des villes, construisez des hôtels et ruinez vos adversaires dans Roi de la Ville. Jusqu\'à 8 joueurs, enchères, échanges, vocal et tournois de clubs. Gratuit dans votre navigateur.', h: 'Roi de la Ville : jeu d\'immobilier', rules: ['Lancez les dés, avancez sur le plateau et achetez les propriétés libres sur lesquelles vous tombez.', 'Quand un adversaire tombe sur votre propriété, il vous paie un loyer, plus élevé si vous possédez toute la couleur et y construisez.', 'Vous pouvez hypothéquer, échanger et mettre aux enchères. Un joueur qui ne peut pas payer est en faillite.', 'Le dernier joueur qui reste gagne.'] },
        ludo: { t: 'Jouer au Ludo en ligne avec des amis ou contre l\'ordinateur', d: 'Le Ludo classique jusqu\'à 4 joueurs : sortez vos pions, capturez ceux de vos adversaires et courez jusqu\'à la maison. Jouez entre amis avec un code de salon ou contre l\'ordinateur.', h: 'Jouer au Ludo en ligne', rules: ['Chaque joueur a quatre pions. Un pion ne quitte la base qu\'avec un 6.', 'Les pions font le tour du plateau. Tomber sur un adversaire hors des cases sûres le renvoie à sa base.', 'Capturer ou arriver à la maison donne un lancer supplémentaire. Trois 6 de suite annulent le tour.', 'Le premier à ramener ses quatre pions à la maison gagne.'] },
        snakes: { t: 'Jouer aux Serpents et Échelles en ligne avec des amis ou l\'ordinateur', d: 'Serpents et Échelles en quatre modes : classique, rapide, chaos et surprises. Jouez entre amis ou avec des inconnus, avec classement mensuel et tournois.', h: 'Jouer aux Serpents et Échelles en ligne', rules: ['Lancez le dé et avancez d\'autant de cases.', 'En bas d\'une échelle, vous montez ; sur la tête d\'un serpent, vous glissez jusqu\'à sa queue.', 'Le premier arrivé à la dernière case gagne.'] },
        cards: { t: 'Jouer au jeu de cartes en ligne avec des amis ou l\'ordinateur', d: 'Un jeu de cartes rapide pour jusqu\'à 4 joueurs : videz votre main en premier en jouant la même couleur ou le même chiffre, avec cartes passe, inversion, pioche et joker. Jouez avec un code de salon ou contre l\'ordinateur.', h: 'Jouer au jeu de cartes en ligne', rules: ['Chaque joueur commence avec sept cartes. Jouez une carte de la même couleur ou du même chiffre que la carte du dessus.', 'Passe saute le joueur suivant, inversion change le sens, et +2 fait piocher deux cartes au suivant qui perd son tour.', 'Le joker change la couleur, et le joker +4 la change et fait piocher quatre cartes au suivant.', 'Sans carte jouable, piochez-en une. Le premier à vider sa main gagne.'] }
    }
};
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// مسار الصفحة بلغة معيّنة: ar بلا بادئة، وغيرها تحت /en أو /fr
function pathOf(lang, key) {
    const tail = key === 'home' ? '' : '/' + key;
    if (lang === 'ar') return tail || '/';
    return '/' + lang + tail;
}
// كل المسارات المخدومة مع لغتها ومفتاحها
function routes() {
    const out = [];
    for (const lang of LANGS) for (const key of Object.keys(META)) out.push({ path: pathOf(lang, key), lang, key });
    return out;
}
// من مسار الطلب إلى { lang, key }، أو null
function parse(p) {
    const m = /^\/(en|fr)(\/.*)?$/.exec(p);
    const lang = m ? m[1] : 'ar';
    const rest = m ? (m[2] || '') : p;
    const k = rest.replace(/^\/|\/$/g, '') || 'home';
    return META[k] ? { lang, key: k } : null;
}
function altLinks(site, key) {
    const l = LANGS.map((g) => '<link rel="alternate" hreflang="' + g + '" href="' + site + pathOf(g, key) + '">');
    l.push('<link rel="alternate" hreflang="x-default" href="' + site + pathOf('en', key) + '">');
    return l;
}
function render(base, site, lang, key) {
    const pg = PAGES[lang][key], mt = META[key];
    const url = site + pathOf(lang, key), img = site + mt.img;
    const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebApplication', name: pg.t, url, description: pg.d, applicationCategory: 'GameApplication', genre: mt.cat, inLanguage: lang, operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }).replace(/</g, '\\u003c');
    const links = LANGS.map((g) => '<a href="' + pathOf(g, key) + '" hreflang="' + g + '">' + { ar: 'العربية', en: 'English', fr: 'Français' }[g] + '</a>').join(' · ');
    const nos = '<noscript><main style="padding:16px;max-width:720px;margin:auto"><h1>' + esc(pg.h) + '</h1><p>' + esc(pg.d) + '</p>' +
        (pg.rules.length ? '<ul>' + pg.rules.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '') + '<p>' + links + '</p></main></noscript>';
    const block = [
        '<meta name="description" content="' + esc(pg.d) + '">',
        '<link rel="canonical" href="' + url + '">',
        ...altLinks(site, key),
        '<meta property="og:type" content="website">', '<meta property="og:locale" content="' + LOCALE[lang] + '">', '<meta property="og:site_name" content="' + esc(SITE[lang]) + '">',
        '<meta property="og:title" content="' + esc(pg.t) + '">', '<meta property="og:description" content="' + esc(pg.d) + '">', '<meta property="og:url" content="' + url + '">',
        '<meta property="og:image" content="' + img + '">', '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="' + esc(pg.t) + '">',
        '<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:title" content="' + esc(pg.t) + '">', '<meta name="twitter:description" content="' + esc(pg.d) + '">', '<meta name="twitter:image" content="' + img + '">',
        '<script type="application/ld+json">' + ld + '</script>'
    ].join('\n    ');
    return base
        .replace(/<html lang="[^"]*" dir="[^"]*"/, '<html lang="' + lang + '" dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '"')
        .replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(pg.t) + '</title>')
        .replace(/<meta name="description"[^>]*>\s*/g, '')
        .replace(/<link rel="canonical"[^>]*>\s*/g, '')
        .replace(/<meta property="og:[^>]*>\s*/g, '')
        .replace(/<meta name="twitter:[^>]*>\s*/g, '')
        .replace('</head>', '    ' + block + '\n</head>')
        .replace(/<body([^>]*)>/, '<body$1>\n' + nos);
}
function sitemap(site, day) {
    const urls = Object.keys(META).flatMap((key) => LANGS.map((lang) => {
        const alts = altLinks(site, key).map((l) => '    ' + l.replace('<link rel="alternate"', '<xhtml:link rel="alternate"').replace(/>$/, '/>')).join('\n');
        return '  <url><loc>' + site + pathOf(lang, key) + '</loc><lastmod>' + day + '</lastmod><priority>' + (key === 'home' ? '1.0' : '0.8') + '</priority>\n' + alts + '\n  </url>';
    })).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + urls + '\n</urlset>\n';
}
module.exports = { LANGS, PAGES, META, pathOf, routes, parse, render, sitemap };
