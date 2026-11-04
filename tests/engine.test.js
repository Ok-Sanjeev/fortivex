const assert = require('assert');
const BarricadeGame = require('../game.js');

console.log('====================================================');
console.log('🧪 FORTIVEX GAME ENGINE AUTOMATED UNIT TEST SUITE');
console.log('====================================================\n');

let passedTests = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// 1. Initial State & Board Setup
test('Classic 2-player initialization', () => {
    const game = new BarricadeGame({ gameMode: 'classic', initialWalls: 10 });
    assert.strictEqual(game.numPlayers, 2);
    assert.strictEqual(game.turn, 1);
    assert.deepStrictEqual(game.pawns[1], { x: 4, y: 8 });
    assert.deepStrictEqual(game.pawns[2], { x: 4, y: 0 });
    assert.strictEqual(game.playerWalls[1], 10);
    assert.strictEqual(game.playerWalls[2], 10);
    assert.strictEqual(game.gameplayMode, 'breaking');
    assert.strictEqual(game.breakCost, 5);
});

// 2. Normal Mode vs Breaking Mode
test('Normal mode strictly forbids barricade breaking', () => {
    const game = new BarricadeGame({ gameMode: 'classic', gameplayMode: 'normal', initialWalls: 10 });
    assert.strictEqual(game.gameplayMode, 'normal');

    // Place a wall as P1
    const place = game.placeWall(3, 3, 'H');
    assert.strictEqual(place.success, true);

    // P2 moves pawn
    game.makePawnMove(4, 1);

    // P1 tries to break wall in Normal mode
    const res = game.breakWall(0, 1);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'Barricade breaking is disabled in Normal mode');
    assert.strictEqual(game.walls[0].isBroken, false);
    assert.strictEqual(game.playerWalls[1], 9); // Unchanged
});

// 3. Breaking Mode with Configurable Cost (3, 5, 7)
test('Breaking mode supports cost 3, 5, 7 and deducts from player inventory', () => {
    [3, 5, 7].forEach(cost => {
        const game = new BarricadeGame({ gameMode: 'classic', gameplayMode: 'breaking', breakCost: cost, initialWalls: 10 });
        assert.strictEqual(game.breakCost, cost);

        // Place a wall as P1
        game.placeWall(3, 3, 'H');
        assert.strictEqual(game.playerWalls[1], 9);

        // P2 moves pawn
        game.makePawnMove(4, 1);

        // P1 breaks wall
        const breakRes = game.breakWall(0, 1);
        assert.strictEqual(breakRes.success, true);
        assert.strictEqual(breakRes.cost, cost);
        assert.strictEqual(game.playerWalls[1], 9 - cost);
        assert.strictEqual(game.walls[0].isBroken, true);
        assert.strictEqual(game.walls[0].brokenBy, 1);
    });
});

test('Breaking fails if player has insufficient barricades', () => {
    const game = new BarricadeGame({ gameMode: 'classic', gameplayMode: 'breaking', breakCost: 7, initialWalls: 5 });
    // P1 places wall (now has 4 walls left)
    game.placeWall(2, 2, 'H');
    game.makePawnMove(4, 1);

    // P1 tries to break with cost 7 when having only 4 walls
    const res = game.breakWall(0, 1);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'Breaking a barricade requires 7 barricades!');
});

// 4. Broken Wall Rubble: Pawns Traverse & Rubble Permanently Blocks Placements
test('Broken wall rubble allows pawns to walk through', () => {
    const game = new BarricadeGame({ gameMode: 'classic', gameplayMode: 'breaking', breakCost: 5, initialWalls: 10 });
    game.placeWall(3, 3, 'H'); // Wall between row 3 and 4 at columns 3 and 4
    assert.strictEqual(game.isEdgeBlocked(3, 3, 3, 4), true);
    assert.strictEqual(game.isEdgeBlocked(4, 3, 4, 4), true);

    game.makePawnMove(4, 1);
    game.breakWall(0, 1);

    // Broken wall rubble: pawns can now walk through freely!
    assert.strictEqual(game.isEdgeBlocked(3, 3, 3, 4), false);
    assert.strictEqual(game.isEdgeBlocked(4, 3, 4, 4), false);
});

test('Broken wall rubble permanently prevents placing new barricade at that position', () => {
    const game = new BarricadeGame({ gameMode: 'classic', gameplayMode: 'breaking', breakCost: 5, initialWalls: 10 });
    game.placeWall(3, 3, 'H');
    game.makePawnMove(4, 1);
    game.breakWall(0, 1);

    // P2's turn: cannot place horizontal overlapping wall or vertical crossing wall
    const overlapH = game.validateWallPlacement(3, 3, 'H', 2);
    assert.strictEqual(overlapH.valid, false);

    const crossV = game.validateWallPlacement(3, 3, 'V', 2);
    assert.strictEqual(crossV.valid, false);
});

// 5. 4-Player King of the Hill (KOTH) Center Race
test('4-Player King of the Hill rules, goals, and turn order', () => {
    const game = new BarricadeGame({ gameMode: 'koth', initialWalls: 5 });
    assert.strictEqual(game.numPlayers, 4);
    assert.deepStrictEqual(game.pawns[1], { x: 4, y: 8 });
    assert.deepStrictEqual(game.pawns[2], { x: 4, y: 0 });
    assert.deepStrictEqual(game.pawns[3], { x: 0, y: 4 });
    assert.deepStrictEqual(game.pawns[4], { x: 8, y: 4 });

    // Goal for all 4 players must be (4, 4)
    assert.strictEqual(game.isGoal(1, 4, 4), true);
    assert.strictEqual(game.isGoal(2, 4, 4), true);
    assert.strictEqual(game.isGoal(3, 4, 4), true);
    assert.strictEqual(game.isGoal(4, 4, 4), true);
    assert.strictEqual(game.isGoal(1, 4, 0), false);

    // Turn rotation: 1 -> 2 -> 3 -> 4 -> 1
    assert.strictEqual(game.turn, 1);
    game.makePawnMove(4, 7);
    assert.strictEqual(game.turn, 2);
    game.makePawnMove(4, 1);
    assert.strictEqual(game.turn, 3);
    game.makePawnMove(1, 4);
    assert.strictEqual(game.turn, 4);
    game.makePawnMove(7, 4);
    assert.strictEqual(game.turn, 1);
});

// 6. Tournament Quoridor Jumping Mechanics
test('Straight jump over adjacent opponent pawn', () => {
    const game = new BarricadeGame({ gameMode: 'classic' });
    game.pawns[1] = { x: 4, y: 5 };
    game.pawns[2] = { x: 4, y: 4 };
    game.turn = 1;

    const moves = game.getValidPawnMoves(1);
    const straightJump = moves.find(m => m.x === 4 && m.y === 3 && m.isJump);
    assert.ok(straightJump, 'Should have straight jump over opponent to (4, 3)');
});

test('Diagonal jump when straight jump is blocked by wall', () => {
    const game = new BarricadeGame({ gameMode: 'classic' });
    game.pawns[1] = { x: 4, y: 5 };
    game.pawns[2] = { x: 4, y: 4 };
    // Wall directly behind P2 (blocking straight jump to 4, 3)
    game.walls.push({ gx: 3, gy: 3, orientation: 'H', player: 2, isBroken: false });
    game.turn = 1;

    const moves = game.getValidPawnMoves(1);
    const diagLeft = moves.find(m => m.x === 3 && m.y === 4 && m.isJump);
    const diagRight = moves.find(m => m.x === 5 && m.y === 4 && m.isJump);
    assert.ok(diagLeft, 'Should have diagonal jump to (3, 4)');
    assert.ok(diagRight, 'Should have diagonal jump to (5, 4)');
});

// 7. Path Trapping Validation
test('Wall placement cannot completely block path to goal', () => {
    const game = new BarricadeGame({ gameMode: 'classic' });
    // Place walls across row 0 leaving only column 8 open
    game.walls.push({ gx: 0, gy: 0, orientation: 'H', player: 1, isBroken: false });
    game.walls.push({ gx: 2, gy: 0, orientation: 'H', player: 1, isBroken: false });
    game.walls.push({ gx: 4, gy: 0, orientation: 'H', player: 1, isBroken: false });
    game.walls.push({ gx: 6, gy: 0, orientation: 'H', player: 1, isBroken: false });
    // Attempting to place the vertical wall at (7, 0) that seals the last exit for Player 2
    const trap = game.validateWallPlacement(7, 0, 'V', 1);
    assert.strictEqual(trap.valid, false);
    assert.ok(trap.reason.includes('Cannot completely block Player 2'));
});

// 8. Serialization & Deserialization
test('Full engine state serialization and deserialization', () => {
    const game = new BarricadeGame({
        gameMode: 'koth',
        gameplayMode: 'breaking',
        breakCost: 3,
        initialWalls: 5
    });
    game.makePawnMove(4, 7);
    game.placeWall(2, 2, 'H');

    const serialized = game.serialize();
    const restored = BarricadeGame.deserialize(serialized);

    assert.strictEqual(restored.gameMode, 'koth');
    assert.strictEqual(restored.gameplayMode, 'breaking');
    assert.strictEqual(restored.breakCost, 3);
    assert.strictEqual(restored.numPlayers, 4);
    assert.strictEqual(restored.turn, 3);
    assert.deepStrictEqual(restored.pawns[1], { x: 4, y: 7 });
    assert.strictEqual(restored.walls.length, 1);
    assert.strictEqual(restored.playerWalls[2], 4);
});

console.log(`\n🎉 All ${passedTests} engine tests passed successfully!\n`);
