/**
 * FORTIVEX — 100 Persistent AI Player Profiles (ai_profiles.js)
 * Synchronized with the centralized database (noob10001 - noob10100)
 */

const db = require('./db.js');

module.exports = {
    get AI_PROFILES() {
        return db.getAllAiProfiles();
    },
    getAiProfileForRating: (userRating, preferredDiff = null) => {
        return db.getAiProfileForMatch(userRating, preferredDiff);
    }
};
