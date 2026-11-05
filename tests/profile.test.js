const assert = require('assert');
const db = require('../db');
const { FORTIVEX_RANKS, getRankBadgeSvg, getRankForRating } = require('../ranks');

console.log('--- RUNNING FORTIVEX PROFILE & STATISTICS VERIFICATION TESTS ---');

// 0. Verify Centralized 9 Competitive Ranks
assert.strictEqual(FORTIVEX_RANKS.length, 9, 'Must have exactly 9 competitive ranks');
assert.strictEqual(FORTIVEX_RANKS[0].id, 'grandmaster', 'Highest tier should be Grandmaster');
assert.strictEqual(FORTIVEX_RANKS[0].min, 2400, 'Grandmaster min threshold should be 2400');
assert.strictEqual(FORTIVEX_RANKS[8].id, 'iron', 'Lowest tier should be Iron');
assert.strictEqual(FORTIVEX_RANKS[8].min, 0, 'Iron min threshold should be 0');

// Test Silver threshold calculation (like in screenshot: 1385 rating -> Silver, 15 to Gold)
const rankCalc1385 = getRankForRating(1385);
assert.strictEqual(rankCalc1385.id, 'silver', '1385 should be Silver');
assert.strictEqual(rankCalc1385.pointsToNext, 15, '1385 should be 15 to Gold');
assert.strictEqual(rankCalc1385.nextRank, 'Gold', 'Next rank should be Gold');
assert(rankCalc1385.progressPercent > 90, 'Progress percent should be > 90%');

// Test default starting rank (1200)
const defaultRank = getRankForRating(1200);
assert.strictEqual(defaultRank.id, 'silver', 'New player at 1200 must start in Silver');
assert.strictEqual(defaultRank.pointsToNext, 200, 'Starting at 1200 should be 200 to Gold');
assert.strictEqual(defaultRank.progressPercent, 0, 'Starting at 1200 should have 0% progress to Gold');

// Verify SVG badge generation
const svgTest = getRankBadgeSvg('silver', 48);
assert(svgTest.includes('<svg') && svgTest.includes('</svg>'), 'Rank badge must generate valid SVG vector markup');
console.log('✓ Verified 9 Competitive Ranks and progression calculations');

// 1. Create or retrieve test user
const user = db.createGuestUser();
assert(user.id.startsWith('usr_'), 'User ID must start with usr_');
assert(user.username.startsWith('noob'), 'Username must start with sequential noob');
const permanentId = user.id;
console.log(`✓ Guest created: ${user.username} (${user.id})`);

// 2. Fetch complete Profile Data Bundle
const profile = db.getUserProfileData(user.id);
assert(profile !== null, 'Profile bundle must not be null');
assert.strictEqual(profile.id, permanentId, 'Profile ID must match permanent user ID');
assert.strictEqual(profile.avatar, '💎', 'Default avatar should be 💎');
assert.strictEqual(profile.rating, 1200, 'Starting rating should be 1200');
assert.strictEqual(profile.rankTier.name, 'Silver', '1200 rating should map to Silver tier');
assert.strictEqual(profile.country, 'India', 'Default country should be India');
assert(profile.recordSummary, 'recordSummary must be present');
assert(profile.recordSummary.all1v1, 'all1v1 must be in recordSummary');
assert(profile.recordSummary.ranked, 'ranked must be in recordSummary');
assert(Array.isArray(profile.recentForm), 'recentForm must be an array');

// Verify 10 Main Stats
const m = profile.mainStats;
assert.strictEqual(m.totalGames, 0, 'Total games should be 0');
assert.strictEqual(m.totalWins, 0, 'Total wins should be 0');
assert.strictEqual(m.totalLosses, 0, 'Total losses should be 0');
assert.strictEqual(m.draws, 0, 'Draws should be 0');
assert.strictEqual(m.winRate, 0, 'Win rate should be 0');
assert.strictEqual(m.currentRating, 1200, 'Current rating should be 1200');
assert.strictEqual(m.bestRating, 1200, 'Peak rating should be 1200');
assert.strictEqual(m.currentWinningStreak, 0, 'Current winning streak should be 0');
assert.strictEqual(m.bestWinningStreak, 0, 'Best winning streak should be 0');
assert.strictEqual(m.currentLosingStreak, 0, 'Current losing streak should be 0');
console.log('✓ Verified 10 Main Career Stats structure and defaults');

// Verify 9 Additional Stats
const a = profile.additionalStats;
assert.strictEqual(a.rankedPlayed, 0, 'Ranked played should be 0');
assert.strictEqual(a.casualPlayed, 0, 'Casual played should be 0');
assert.strictEqual(a.humanDefeated, 0, 'Human defeated should be 0');
assert.strictEqual(a.aiDefeated, 0, 'AI defeated should be 0');
assert.strictEqual(a.avgMatchDurationSec, 0, 'Avg duration should be 0');
assert.strictEqual(a.totalPlayTimeSec, 0, 'Total playtime should be 0');
assert.strictEqual(a.dailyGames, 0, 'Daily games should be 0');
assert.strictEqual(a.dailyWins, 0, 'Daily wins should be 0');
assert.strictEqual(a.dailyLosses, 0, 'Daily losses should be 0');
console.log('✓ Verified 9 Additional Competitive Stats structure and defaults');

// Verify 11 Achievements
assert.strictEqual(profile.achievements.length, 11, 'Must have exactly 11 competitive achievements');
const firstWinAchieve = profile.achievements.find(ach => ach.id === 'first_win');
assert(firstWinAchieve, 'Must have first_win achievement');
assert.strictEqual(firstWinAchieve.unlocked, false, 'first_win should initially be locked');
console.log('✓ Verified 11 Competitive Achievements definition');

// 3. Test Avatar Update
const avatarRes = db.updateAvatar(user.id, '👑');
assert.strictEqual(avatarRes.success, true, 'Avatar update should succeed');
assert.strictEqual(avatarRes.user.avatar, '👑', 'Avatar should be updated to 👑');
console.log('✓ Verified avatar customization');

// 4. Test Display Name Claim with permanent ID preservation
const uniqueTag = 'Vex_' + Math.floor(1000 + Math.random() * 9000);
const claimRes = db.claimCustomUsername(user.id, uniqueTag);
assert.strictEqual(claimRes.success, true, 'Valid custom name claim should succeed');
assert.strictEqual(claimRes.user.id, permanentId, 'Permanent user ID must never change on renaming');
assert.strictEqual(claimRes.user.username, uniqueTag, 'Username should update to custom gamer tag');
console.log('✓ Verified username claim and identity preservation');

// 5. Test Social Account Link with permanent ID preservation
const socialRes = db.bindSocialAccount(user.id, 'google', 'g_sub_999888', 'vex@google.com', 'Alex Vex');
assert.strictEqual(socialRes.id, permanentId, 'Permanent user ID must never change on social linking');
assert(socialRes.social.google, 'Google social object should be populated');
console.log('✓ Verified social account binding and identity preservation');

// 6. Test Match Record: Win (+30 ELO, Streak +1, Achievement Unlock)
const winResult = db.recordCompletedMatch(user.id, {
    isWinner: true,
    isRanked: true,
    isBot: true,
    opponentName: 'noob10050',
    opponentRating: 1560,
    durationSec: 120,
    mode: 'classic',
    gameplayMode: 'breaking',
    breakCost: 5,
    wallsPlaced: 4,
    wallsBroken: 1,
    moveCount: 18,
    replay: {
        initialState: { p1: { x: 4, y: 8 }, p2: { x: 4, y: 0 } },
        moves: [{ type: 'move', player: 1, to: { x: 4, y: 7 } }]
    }
});

assert.strictEqual(winResult.eloDelta, 30, 'Ranked win must yield exactly +30 ELO');
assert.strictEqual(winResult.user.rating, 1230, 'Rating should be 1230');
assert.strictEqual(winResult.user.streak, 1, 'Winning streak should be 1');
assert.strictEqual(winResult.user.wins, 1, 'Wins should be 1');
assert.strictEqual(winResult.user.aiDefeated, 1, 'AI defeated should be 1');
assert.strictEqual(winResult.user.achievements['first_win'].unlocked, true, 'First win achievement must unlock');
console.log('✓ Verified ranked victory recording (+30 ELO, streak increment, achievement unlock)');

// 7. Verify Match Replay Saved & Retrieved
const savedReplay = db.getReplay(winResult.matchRecord.id);
assert(savedReplay !== null, 'Replay must be archived for the match');
assert.strictEqual(savedReplay.moves.length, 1, 'Replay should preserve moves');
console.log('✓ Verified match replay archive and retrieval');

// 8. Test Match Record: Loss (-30 ELO, Streak Reset)
const lossResult = db.recordCompletedMatch(user.id, {
    isWinner: false,
    isRanked: true,
    isBot: true,
    opponentName: 'noob10080',
    opponentRating: 1950,
    durationSec: 85,
    mode: 'classic',
    gameplayMode: 'breaking'
});

assert.strictEqual(lossResult.eloDelta, -30, 'Ranked loss must subtract strictly -30 ELO');
assert.strictEqual(lossResult.user.rating, 1200, 'Rating should return to 1200');
assert.strictEqual(lossResult.user.streak, 0, 'Winning streak must reset to 0 on loss');
assert.strictEqual(lossResult.user.currentLosingStreak, 1, 'Losing streak should be 1');
assert.strictEqual(lossResult.user.losses, 1, 'Losses should be 1');
console.log('✓ Verified ranked defeat recording (-30 ELO, streak reset, losing streak tracking)');

// 9. Verify Rating Progression History
const ratingHist = db.getRatingHistory(user.id, 'all');
assert(ratingHist.points.length >= 3, 'Must have account creation + 2 match points');
console.log(`✓ Verified rating history points (count: ${ratingHist.points.length})`);

// 10. Verify Paginated Match History
const matchHist = db.getUserMatchHistory(user.id, 1, 10, 'all');
assert.strictEqual(matchHist.totalMatches, 2, 'Should have 2 matches recorded');
assert.strictEqual(matchHist.matches.length, 2, 'Should return 2 match items');
assert.strictEqual(matchHist.matches[0].result, 'DEFEAT', 'Newest match should be defeat');
assert.strictEqual(matchHist.matches[1].result, 'VICTORY', 'Previous match should be victory');
console.log('✓ Verified paginated match history query');

console.log('\n========================================');
console.log('ALL FORTIVEX PROFILE & STATS TESTS PASSED!');
console.log('========================================\n');
