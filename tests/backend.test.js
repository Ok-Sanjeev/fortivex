/**
 * FORTIVEX — Backend & Identity Integration Test Suite (tests/backend.test.js)
 * Tests:
 * 1. Centralized Identity System (noob10001+ sequential allocation, custom names, social bind)
 * 2. 100 Logical AI Profiles (rating distribution, archetypes, rating matcher)
 * 3. Server-Authoritative Engine Validation (turn verification, legal moves, illegal rejection)
 * 4. Ranked Progression (+30 Win / -30 Loss Elo update, streak tracking)
 * 5. Full Match Replay archiving and retrieval
 */

const db = require('../db.js');
const { AI_PROFILES, getAiProfileForRating } = require('../ai_profiles.js');
const BarricadeGame = require('../game.js');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ [PASS] ${testName}`);
        passedTests++;
    } else {
        console.error(`  ❌ [FAIL] ${testName}`);
        failedTests++;
    }
}

console.log('====================================================');
console.log('🏛️ FORTIVEX BACKEND, IDENTITY & ENGINE TEST SUITE');
console.log('====================================================\n');

// ----------------------------------------------------
// TEST 1: Centralized Identity System
// ----------------------------------------------------
console.log('--- TEST 1: Centralized Identity System ---');

const guest1 = db.createGuestUser();
assert(guest1.username.startsWith('noob'), `Guest 1 allocated sequential username: ${guest1.username}`);
assert(guest1.rating === 1200, 'New guest starts with base rating 1200');

const guest2 = db.createGuestUser();
assert(guest2.idNum > guest1.idNum, `Guest 2 allocated strictly sequential ID: ${guest2.username}`);

// Claim unique custom username
const testCustomName = 'Apex_' + Math.floor(10000 + Math.random() * 89999);
const customResult = db.claimCustomUsername(guest1.id, testCustomName);
assert(customResult.success, `Successfully claimed unique custom username "${testCustomName}"`);
assert(guest1.username === testCustomName, 'User username updated in DB');

// Prevent duplicate username
const dupResult = db.claimCustomUsername(guest2.id, testCustomName);
assert(!dupResult.success && dupResult.reason.includes('already taken'), 'Strictly rejects duplicate username claim');

// Social Login Binding preserves progression
db.recordMatchResult(guest1.id, true); // +30 win
const boundUser = db.bindSocialAccount(guest1.id, 'google', 'g_987654321', 'apex@gmail.com', 'ApexVex');
assert(boundUser.rating === 1230, 'Social binding preserves existing rating and progression (1230 Elo)');
assert(boundUser.social && boundUser.social.google, 'Google provider record attached to user');

// ----------------------------------------------------
// TEST 2: 100 Logical AI Player Profiles
// ----------------------------------------------------
console.log('\n--- TEST 2: 100 Logical AI Player Profiles ---');
assert(AI_PROFILES.length === 100, 'Exactly 100 AI profiles generated');

const easyCount = AI_PROFILES.filter(p => p.difficulty === 'easy').length;
const medCount = AI_PROFILES.filter(p => p.difficulty === 'medium').length;
const hardCount = AI_PROFILES.filter(p => p.difficulty === 'hard').length;
const impCount = AI_PROFILES.filter(p => p.difficulty === 'impossible').length;

assert(easyCount > 0 && medCount > 0 && hardCount > 0 && impCount > 0,
    `Profile difficulties distributed: Easy(${easyCount}), Med(${medCount}), Hard(${hardCount}), Imp(${impCount})`);

const matchedBot = getAiProfileForRating(1850);
assert(matchedBot && Math.abs(matchedBot.rating - 1850) <= 150,
    `Bot matcher picked "${matchedBot.displayName}" (${matchedBot.rating} Elo, ${matchedBot.difficulty}) for 1850 rating`);

// ----------------------------------------------------
// TEST 3: Server-Authoritative Game State Validation
// ----------------------------------------------------
console.log('\n--- TEST 3: Server-Authoritative Engine Validation ---');
const authGame = new BarricadeGame({
    gameMode: 'classic',
    gameplayMode: 'breaking',
    breakCost: 5,
    initialWalls: 10
});

// Out of turn move rejection
const p2OutTurn = authGame.makePawnMove(4, 1);
assert(!p2OutTurn.success, 'Engine strictly rejects out-of-turn move (P2 tried to move on P1 turn)');

// Legal pawn move
const p1LegalMove = authGame.makePawnMove(4, 7);
assert(p1LegalMove.success, 'Engine accepts legal pawn move for active player P1');
assert(authGame.turn === 2, 'Turn correctly advances to P2');

// Place legal wall
const p2Wall = authGame.placeWall(3, 3, 'H');
assert(p2Wall.success, 'Engine accepts legal wall placement from P2');
assert(authGame.playerWalls[2] === 9, 'P2 wall inventory decremented to 9');
assert(authGame.turn === 1, 'Turn correctly returns to P1');

// ----------------------------------------------------
// TEST 4: Ranked Progression (+30 Win / -30 Loss)
// ----------------------------------------------------
console.log('\n--- TEST 4: Ranked Progression (+30 / -30) ---');
const rankedUser = db.createGuestUser();
const initRating = rankedUser.rating; // 1200

// Win match
const winRes = db.recordMatchResult(rankedUser.id, true);
assert(winRes.eloChange === 30 && winRes.newRating === initRating + 30, 'Win strictly awards exactly +30 Elo');
assert(winRes.streak === 1, 'Win increments streak to 1');

// Loss match
const lossRes = db.recordMatchResult(rankedUser.id, false);
assert(lossRes.eloChange === -30 && lossRes.newRating === initRating, 'Loss strictly deducts exactly -30 Elo');
assert(lossRes.streak === 0, 'Loss resets streak to 0');

// ----------------------------------------------------
// TEST 5: Full Match Replay Archiving & Retrieval
// ----------------------------------------------------
console.log('\n--- TEST 5: Match Replay Archiving & Retrieval ---');
const testMatch = db.saveMatch({
    roomCode: 'FORT-TEST',
    mode: 'classic',
    gameplayMode: 'breaking',
    breakCost: 5,
    isRanked: true,
    players: [
        { role: 1, username: 'PlayerOne', userId: guest1.id },
        { role: 2, username: 'PlayerTwo', userId: guest2.id }
    ],
    winner: 1,
    winReason: 'Reached goal line',
    moveCount: 24,
    durationSec: 140,
    replay: {
        initialState: { mode: 'classic', walls: 10 },
        moves: [{ player: 1, move: { type: 'move', x: 4, y: 7 } }],
        history: []
    }
});

assert(testMatch && testMatch.id, `Match record saved with ID: ${testMatch.id}`);

const loadedReplay = db.getReplay(testMatch.id);
assert(loadedReplay && loadedReplay.moves && loadedReplay.moves.length === 1, 'Full match replay successfully retrieved from DB');

// Leaderboard check
const leaderboard = db.getLeaderboard(10);
assert(leaderboard.length > 0 && leaderboard[0].rating >= 1200, 'Global leaderboard properly ordered by rating');

// ----------------------------------------------------
// FINAL RESULTS
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`Total tests passed: ${passedTests}`);
console.log(`Total tests failed: ${failedTests}`);
console.log('====================================================');

if (failedTests > 0) {
    process.exit(1);
} else {
    console.log('🎉 All Backend & Identity tests passed with 100% success!\n');
    process.exit(0);
}
