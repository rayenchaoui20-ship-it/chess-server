'use strict';
// نظام إعادة أو تسجيل الحركات/الجولات (Monopoly Replay)

function init(deps) {
    // deps يمكن أن تتضمن قاعدة البيانات أو الأدوات المساعدة حسب الحاجة
    const db = () => deps.getDb ? deps.getDb() : null;

    // حفظ تفاصيل الجولة أو إعادة العرض
    function saveReplay(gameId, data) {
        const d = db();
        if (!d) return false;
        d.replays = d.replays || {};
        d.replays[gameId] = {
            at: Date.now(),
            data: data
        };
        if (deps.saveSoon) deps.saveSoon();
        return true;
    }

    // جلب بيانات الإعادة
    function getReplay(gameId) {
        const d = db();
        if (!d || !d.replays) return null;
        return d.replays[gameId] || null;
    }

    return {
        saveReplay,
        getReplay
    };
}

module.exports = { init };
