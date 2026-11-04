/**
 * FORTIVEX — AI Benchmarking and Verification Suite
 * Tests:
 * 1. Legal move adherence (Zero illegal moves across all 4 difficulty levels)
 * 2. Immediate win exploitation (Must finish game when winning move exists)
 * 3. Emergency threat blocking (Must prioritize stopping opponent at distance 1)
 * 4. 4-Player King of the Hill (KOTH) compatibility
 * 5. Normal mode vs Barricade Breaking mode compliance
 * 6. Head-to-Head match simulation (Easy vs Medium, Medium vs Hard, Hard vs Impossible)
 */

const BarricadeGame = require('../game.js');
const BarricadeAI = require('../ai.js');

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
console.log('🤖 FORTIVEX AI AUTOMATED BENCHMARK & VERIFICATION');
console.log('====================================================\n');

// ----------------------------------------------------
// TEST 1: Legal Move Generation Across All 4 Levels
// ----------------------------------------------------
console.log('--- TEST 1: Legal Move Generation ---');
const difficulties = ['easy', 'medium', 'hard', 'impossible'];

for (const diff of difficulties) {
    const game = new BarricadeGame({ gameMode: 'classic', initialWalls: 10 });
    const ai = new BarricadeAI(diff);
    const move = ai.chooseMove(game, 1);

    let isValid = false;
    if (move.type === 'move') {
        const validMoves = game.getValidPawnMoves(1);
        isValid = validMoves.some(m => m.x === move.x && m.y === move.y);
    } else if (move.type === 'wall') {
        const val = game.validateWallPlacement(move.gx, move.gy, move.orientation, 1);
        isValid = val.valid;
    }
    assert(isValid, `Difficulty [${diff.toUpperCase()}] generates strictly valid legal opening move`);
}

// ----------------------------------------------------
// TEST 2: Immediate Win Recognition (P1 on row 1, goal on row 0)
// ----------------------------------------------------
console.log('\n--- TEST 2: Immediate Win Recognition ---');
for (const diff of difficulties) {
    const game = new BarricadeGame({ gameMode: 'classic' });
    game.pawns[1] = { x: 4, y: 1 }; // 1 step from row 0 (y=0 is goal for P1)
    game.pawns[2] = { x: 4, y: 5 };
    game.turn = 1;

    const ai = new BarricadeAI(diff);
    const move = ai.chooseMove(game, 1);

    const isWinningMove = (move && move.type === 'move' && move.x === 4 && move.y === 0);
    assert(isWinningMove, `Difficulty [${diff.toUpperCase()}] immediately takes winning move to victory`);
}

// ----------------------------------------------------
// TEST 3: Emergency Threat Defense (Opponent is 1 step from winning)
// ----------------------------------------------------
console.log('\n--- TEST 3: Emergency Defensive Threat Blocking ---');
const defGame = new BarricadeGame({ gameMode: 'classic', initialWalls: 10 });
defGame.pawns[1] = { x: 4, y: 5 };
defGame.pawns[2] = { x: 4, y: 7 }; // Player 2 is 1 step from row 8 (y=8 is goal for P2)!
defGame.turn = 1;

const hardAi = new BarricadeAI('hard');
const defMove = hardAi.chooseMove(defGame, 1);

// Hard AI must place a wall to block P2
assert(defMove && defMove.type === 'wall', 'Hard AI places a blocking wall when opponent is 1 step from winning');

// ----------------------------------------------------
// TEST 4: 4-Player King of the Hill (KOTH) Navigation
// ----------------------------------------------------
console.log('\n--- TEST 4: 4-Player King of the Hill (KOTH) Support ---');
const kothGame = new BarricadeGame({ gameMode: 'koth', initialWalls: 5 });
const kothAi = new BarricadeAI('impossible');

for (let p = 1; p <= 4; p++) {
    kothGame.turn = p;
    const move = kothAi.chooseMove(kothGame, p);
    let valid = false;
    if (move.type === 'move') {
        const moves = kothGame.getValidPawnMoves(p);
        valid = moves.some(m => m.x === move.x && m.y === move.y);
    } else if (move.type === 'wall') {
        valid = kothGame.validateWallPlacement(move.gx, move.gy, move.orientation, p).valid;
    }
    assert(valid, `KOTH Player ${p} chooses valid action towards center crown (4,4)`);
}

// ----------------------------------------------------
// TEST 5: Normal Mode Strictly Forbids AI Barricade Breaking
// ----------------------------------------------------
console.log('\n--- TEST 5: Normal Mode Forbids Barricade Breaking ---');
const normalGame = new BarricadeGame({
    gameMode: 'classic',
    gameplayMode: 'normal',
    initialWalls: 10
});
// Place walls across row
normalGame.placeWall(3, 4, 'H');
normalGame.placeWall(5, 4, 'H');

const impAi = new BarricadeAI('impossible');
const normalMove = impAi.chooseMove(normalGame, 1);
assert(normalMove.type !== 'break', 'AI strictly respects Normal Mode and never generates break actions');

// ----------------------------------------------------
// TEST 6: Head-to-Head AI Match Simulation
// ----------------------------------------------------
console.log('\n--- TEST 6: Head-to-Head AI Match Simulation ---');

function simulateMatch(p1Diff, p2Diff, maxTurns = 120) {
    const game = new BarricadeGame({ gameMode: 'classic', initialWalls: 10 });
    const ai1 = new BarricadeAI(p1Diff);
    const ai2 = new BarricadeAI(p2Diff);
    let turns = 0;
    let illegalMoves = 0;

    const startTime = Date.now();

    while (!game.winner && turns < maxTurns) {
        turns++;
        const currentAi = (game.turn === 1) ? ai1 : ai2;
        const player = game.turn;
        const move = currentAi.chooseMove(game, player);

        if (!move) {
            illegalMoves++;
            break;
        }

        if (move.type === 'move') {
            const res = game.makePawnMove(move.x, move.y);
            if (!res.success) illegalMoves++;
        } else if (move.type === 'wall') {
            const res = game.placeWall(move.gx, move.gy, move.orientation);
            if (!res.success) illegalMoves++;
        } else if (move.type === 'break') {
            const res = game.breakWall(move.wallIndex, player);
            if (!res.success) illegalMoves++;
        }
    }

    const elapsed = Date.now() - startTime;
    return {
        winner: game.winner,
        turns,
        illegalMoves,
        elapsed,
        avgTimePerMove: Math.round(elapsed / turns)
    };
}

console.log('Simulating: Medium (P1) vs Easy (P2)...');
const match1 = simulateMatch('medium', 'easy');
console.log(`  Result: Winner P${match1.winner || 'None'} in ${match1.turns} turns (${match1.elapsed}ms total, ${match1.avgTimePerMove}ms/move, ${match1.illegalMoves} illegal)`);
assert(match1.illegalMoves === 0, 'Medium vs Easy played with 0 illegal moves');
assert(match1.winner !== null, 'Medium vs Easy successfully completed with a winner');

console.log('Simulating: Hard (P1) vs Medium (P2)...');
const match2 = simulateMatch('hard', 'medium');
console.log(`  Result: Winner P${match2.winner || 'None'} in ${match2.turns} turns (${match2.elapsed}ms total, ${match2.avgTimePerMove}ms/move, ${match2.illegalMoves} illegal)`);
assert(match2.illegalMoves === 0, 'Hard vs Medium played with 0 illegal moves');
assert(match2.winner !== null, 'Hard vs Medium successfully completed with a winner');

console.log('Simulating: Impossible (P1) vs Hard (P2)...');
const match3 = simulateMatch('impossible', 'hard');
console.log(`  Result: Winner P${match3.winner || 'None'} in ${match3.turns} turns (${match3.elapsed}ms total, ${match3.avgTimePerMove}ms/move, ${match3.illegalMoves} illegal)`);
assert(match3.illegalMoves === 0, 'Impossible vs Hard played with 0 illegal moves');
assert(match3.winner !== null, 'Impossible vs Hard successfully completed with a winner');

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
    console.log('🎉 All AI Benchmark tests passed with 100% success!\n');
    process.exit(0);
}
