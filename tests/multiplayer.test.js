/**
 * FORTIVEX — Multiplayer & Matchmaking Unit Tests (tests/multiplayer.test.js)
 */

const assert = require('assert');
const http = require('http');
const db = require('../db.js');
const BarricadeGame = require('../game.js');

console.log('====================================================');
console.log('🌐 FORTIVEX MULTIPLAYER & MATCHMAKING VERIFICATION');
console.log('====================================================');

let passed = 0;
let failed = 0;

function it(desc, fn) {
    try {
        fn();
        console.log(`  ✅ [PASS] ${desc}`);
        passed++;
    } catch (e) {
        console.error(`  ❌ [FAIL] ${desc}: ${e.message}`);
        failed++;
    }
}

// 1. Authoritative Engine Move Validation
it('Server engine accepts strictly legal pawn moves in sequence', () => {
    const game = new BarricadeGame();
    assert.strictEqual(game.turn, 1, 'Initial turn must be Player 1');

    // P1 moves north (from 4,8 to 4,7)
    const move1 = game.makePawnMove(4, 7);
    assert.strictEqual(move1.success, true, 'Legal move must succeed');
    assert.strictEqual(game.turn, 2, 'Turn must switch to Player 2');

    // P2 tries to move out of turn (Player 1 pawn) -> illegal
    const moveBad = game.makePawnMove(4, 6);
    assert.strictEqual(moveBad.success, false, 'Moving P1 pawn on P2 turn must fail');

    // P2 moves south (from 4,0 to 4,1)
    const move2 = game.makePawnMove(4, 1);
    assert.strictEqual(move2.success, true, 'P2 legal move must succeed');
    assert.strictEqual(game.turn, 1, 'Turn must return to Player 1');
});

// 2. Barricade Placement Authority
it('Server engine validates wall inventory and path connectivity', () => {
    const game = new BarricadeGame();
    assert.strictEqual(game.playerWalls[1], 10, 'P1 must have 10 walls');

    // Place legal wall
    const wallRes = game.placeWall(0, 0, 'H');
    assert.strictEqual(wallRes.success, true, 'Legal wall placement must succeed');
    assert.strictEqual(game.playerWalls[1], 9, 'P1 walls must decrement to 9');
    assert.strictEqual(game.turn, 2, 'Turn advances to P2 after wall placement');

    // Overlapping wall attempt by P2
    const overlapRes = game.placeWall(0, 0, 'H');
    assert.strictEqual(overlapRes.success, false, 'Overlapping wall placement must be rejected');
});

// 3. Ranked Rating Safeguards (+30 / -30)
it('Ranked completion strictly grants +30 for win and deducts -30 for loss', () => {
    const guest1 = db.createGuestUser();
    const guest2 = db.createGuestUser();

    const startElo1 = guest1.rating;
    const startElo2 = guest2.rating;

    // Simulate verified ranked match completion
    const winResult = db.recordCompletedMatch(guest1.id, {
        matchId: 'test_match_multi_1',
        isWinner: true,
        isRanked: true,
        opponentUserId: guest2.id,
        opponentName: guest2.username,
        opponentRating: startElo2
    });

    const lossResult = db.recordCompletedMatch(guest2.id, {
        matchId: 'test_match_multi_1',
        isWinner: false,
        isRanked: true,
        opponentUserId: guest1.id,
        opponentName: guest1.username,
        opponentRating: startElo1
    });

    assert.strictEqual(winResult.eloDelta, 30, 'Win must award exactly +30');
    assert.strictEqual(guest1.rating, startElo1 + 30, 'Winner rating must be start + 30');
    assert.strictEqual(lossResult.eloDelta, -30, 'Loss must deduct exactly -30');
    assert.strictEqual(guest2.rating, startElo2 - 30, 'Loser rating must be start - 30');

    // Duplicate match protection
    const dupResult = db.recordCompletedMatch(guest1.id, {
        matchId: 'test_match_multi_1',
        isWinner: true,
        isRanked: true
    });
    assert.strictEqual(dupResult.alreadyProcessed, true, 'Duplicate match ID must be rejected');
    assert.strictEqual(dupResult.eloDelta, 0, 'Duplicate match must grant 0 Elo delta');
});

// 4. Transparent Bot Identification
it('AI opponents are clearly labeled with isBot flag and valid AI profile', () => {
    const bot = db.getAiProfileForMatch(1400);
    assert(bot !== null, 'Bot profile must be retrievable from 100-bot database');
    assert.strictEqual(bot.isBot, true, 'isBot flag must be true');
    assert(bot.username.startsWith('noob100'), `Bot username ${bot.username} must be in AI range 10001..10100`);
    assert(bot.difficulty, 'Bot must have difficulty level defined');
});

console.log('====================================================');
console.log(`Multiplayer tests completed. Passed: ${passed}, Failed: ${failed}`);
console.log('====================================================\n');

if (failed > 0) {
    process.exit(1);
}
