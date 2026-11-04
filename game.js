/**
 * Barricade Game Engine - Robust Enterprise Edition
 * Full Move Snapshots, Analysis/Replay Engine, 4-Player Center Race (King of the Hill),
 * Differentiator "Break Wall" (-5 cost) Mechanic, Bulletproof BFS Pathfinding, Complete Quoridor Jump Rules.
 */

class BarricadeGame {
    constructor(options = {}) {
        this.boardSize = 9;
        this.gameMode = options.gameMode || 'classic'; // 'classic' (2 players) or 'koth' (4 players)
        this.gameplayMode = options.gameplayMode || 'breaking'; // 'normal' (no breaking) or 'breaking' (breaking enabled)
        this.breakCost = [3, 5, 7].includes(parseInt(options.breakCost, 10)) ? parseInt(options.breakCost, 10) : 5;
        this.numPlayers = (this.gameMode === 'koth') ? 4 : 2;
        this.initialWalls = options.initialWalls !== undefined ? options.initialWalls : (this.numPlayers === 4 ? 5 : 10);
        this.timeControl = options.timeControl || { initialSec: 180, incrementSec: 0 };

        this.currentPuzzle = null;
        this.reset();
    }

    reset() {
        this.numPlayers = (this.gameMode === 'koth') ? 4 : 2;

        // Pawns configuration:
        // P1: Blue (Bottom Center - e1)
        // P2: Red (Top Center - e9)
        // P3: Green (Left Center - a5)
        // P4: Yellow (Right Center - i5)
        this.pawns = [
            null,
            { x: 4, y: 8 },
            { x: 4, y: 0 },
            { x: 0, y: 4 },
            { x: 8, y: 4 }
        ];

        this.playerWalls = [
            null,
            this.initialWalls,
            this.initialWalls,
            this.initialWalls,
            this.initialWalls
        ];

        this.playerTimeLeft = [
            null,
            this.timeControl.initialSec,
            this.timeControl.initialSec,
            this.timeControl.initialSec,
            this.timeControl.initialSec
        ];

        this.turn = 1; // 1 to numPlayers
        this.walls = []; // Array of { gx, gy, orientation: 'H'|'V', player, id, isBroken: bool, brokenBy }
        this.history = [];
        this.moveLog = [];
        this.winner = null;
        this.winReason = null;
        this.lastClockTick = Date.now();

        // Save initial snapshot
        this.saveState('Game Start');
    }

    // Pawn position getters/setters for backwards compatibility
    get p1() { return this.pawns[1]; }
    set p1(pos) { this.pawns[1] = pos; }

    get p2() { return this.pawns[2]; }
    set p2(pos) { this.pawns[2] = pos; }

    get p3() { return this.pawns[3]; }
    set p3(pos) { this.pawns[3] = pos; }

    get p4() { return this.pawns[4]; }
    set p4(pos) { this.pawns[4] = pos; }

    // Wall getters/setters
    get p1Walls() { return this.playerWalls[1]; }
    set p1Walls(val) { this.playerWalls[1] = val; }

    get p2Walls() { return this.playerWalls[2]; }
    set p2Walls(val) { this.playerWalls[2] = val; }

    get p3Walls() { return this.playerWalls[3]; }
    set p3Walls(val) { this.playerWalls[3] = val; }

    get p4Walls() { return this.playerWalls[4]; }
    set p4Walls(val) { this.playerWalls[4] = val; }

    // Clock getters/setters
    get p1TimeLeft() { return this.playerTimeLeft[1]; }
    set p1TimeLeft(val) { this.playerTimeLeft[1] = val; }

    get p2TimeLeft() { return this.playerTimeLeft[2]; }
    set p2TimeLeft(val) { this.playerTimeLeft[2] = val; }

    get p3TimeLeft() { return this.playerTimeLeft[3]; }
    set p3TimeLeft(val) { this.playerTimeLeft[3] = val; }

    get p4TimeLeft() { return this.playerTimeLeft[4]; }
    set p4TimeLeft(val) { this.playerTimeLeft[4] = val; }

    loadPuzzle(puzzleOrIdx = 0) {
        let puzzle;
        if (typeof puzzleOrIdx === 'object' && puzzleOrIdx !== null) {
            puzzle = puzzleOrIdx;
        } else {
            const puzzles = BarricadeGame.PUZZLES;
            puzzle = puzzles[puzzleOrIdx % puzzles.length];
        }
        this.currentPuzzle = puzzle;
        this.gameMode = 'puzzle';
        this.numPlayers = 2;
        this.boardSize = 9;
        this.pawns[1] = { ...puzzle.p1 };
        this.pawns[2] = { ...puzzle.p2 };
        this.playerWalls[1] = puzzle.p1Walls;
        this.playerWalls[2] = puzzle.p2Walls;
        this.turn = puzzle.turn;
        this.walls = (puzzle.walls || []).map(w => ({ ...w, isBroken: false }));
        this.history = [];
        this.moveLog = [];
        this.winner = null;
        this.winReason = null;
        this.saveState(`Puzzle: ${puzzle.title || 'Tactical'}`);
        return puzzle;
    }

    cloneState() {
        return {
            gameMode: this.gameMode,
            gameplayMode: this.gameplayMode,
            breakCost: this.breakCost,
            numPlayers: this.numPlayers,
            pawns: this.pawns.map(p => p ? { ...p } : null),
            playerWalls: [...this.playerWalls],
            playerTimeLeft: [...this.playerTimeLeft],
            turn: this.turn,
            walls: this.walls.map(w => ({ ...w })),
            winner: this.winner,
            winReason: this.winReason,
            moveLog: [...this.moveLog]
        };
    }

    clone() {
        const copy = Object.create(BarricadeGame.prototype);
        copy.boardSize = this.boardSize || 9;
        copy.gameMode = this.gameMode;
        copy.gameplayMode = this.gameplayMode || 'breaking';
        copy.breakCost = this.breakCost || 5;
        copy.initialWalls = this.initialWalls;
        copy.timeControl = { ...(this.timeControl || { baseSec: 180, incrementSec: 2 }) };
        copy.numPlayers = this.numPlayers || (this.gameMode === 'koth' ? 4 : 2);
        copy.pawns = this.pawns.map(p => p ? { x: p.x, y: p.y } : null);
        copy.playerWalls = [...this.playerWalls];
        copy.playerTimeLeft = [...this.playerTimeLeft];
        copy.turn = this.turn;
        copy.walls = this.walls.map(w => ({ gx: w.gx, gy: w.gy, orientation: w.orientation, player: w.player, isBroken: !!w.isBroken }));
        copy.winner = this.winner;
        copy.winReason = this.winReason;
        copy.moveLog = [];
        copy.history = [];
        return copy;
    }

    serialize() {
        return {
            boardSize: this.boardSize,
            gameMode: this.gameMode,
            gameplayMode: this.gameplayMode,
            breakCost: this.breakCost,
            numPlayers: this.numPlayers,
            initialWalls: this.initialWalls,
            timeControl: { ...this.timeControl },
            pawns: this.pawns.map(p => p ? { ...p } : null),
            playerWalls: [...this.playerWalls],
            playerTimeLeft: [...this.playerTimeLeft],
            turn: this.turn,
            walls: this.walls.map(w => ({ ...w })),
            winner: this.winner,
            winReason: this.winReason,
            moveLog: [...this.moveLog]
        };
    }

    static deserialize(data) {
        if (!data) return null;
        const game = new BarricadeGame({
            gameMode: data.gameMode,
            gameplayMode: data.gameplayMode,
            breakCost: data.breakCost,
            initialWalls: data.initialWalls,
            timeControl: data.timeControl
        });
        game.boardSize = data.boardSize || 9;
        game.numPlayers = data.numPlayers || (data.gameMode === 'koth' ? 4 : 2);
        game.pawns = data.pawns.map(p => p ? { ...p } : null);
        game.playerWalls = [...data.playerWalls];
        game.playerTimeLeft = [...data.playerTimeLeft];
        game.turn = data.turn;
        game.walls = (data.walls || []).map(w => ({ ...w }));
        game.winner = data.winner;
        game.winReason = data.winReason;
        game.moveLog = [...(data.moveLog || [])];
        game.history = [{ state: game.cloneState(), actionDesc: 'Restored State' }];
        return game;
    }

    saveState(actionDesc) {
        this.history.push({
            state: this.cloneState(),
            actionDesc
        });
    }

    undo() {
        if (this.history.length <= 1) return false;
        this.history.pop();
        const last = this.history[this.history.length - 1];

        this.gameMode = last.state.gameMode;
        this.gameplayMode = last.state.gameplayMode || 'breaking';
        this.breakCost = last.state.breakCost || 5;
        this.numPlayers = last.state.numPlayers;
        this.pawns = last.state.pawns.map(p => p ? { ...p } : null);
        this.playerWalls = [...last.state.playerWalls];
        this.playerTimeLeft = [...last.state.playerTimeLeft];
        this.turn = last.state.turn;
        this.walls = last.state.walls.map(w => ({ ...w }));
        this.winner = last.state.winner;
        this.winReason = last.state.winReason;
        this.moveLog = [...last.state.moveLog];
        return true;
    }

    isInside(x, y) {
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }

    isGoal(player, x, y) {
        if (this.gameMode === 'koth') {
            // King of the Hill: center crown tile (4, 4) is the goal for all 4 players!
            return x === 4 && y === 4;
        }
        if (player === 1) return y === 0;
        if (player === 2) return y === 8;
        if (player === 3) return x === 8;
        if (player === 4) return x === 0;
        return false;
    }

    // Real-time Advantage calculation
    getAdvantage() {
        const p1Path = this.findShortestPath(1, this.pawns[1]);
        const p2Path = this.findShortestPath(2, this.pawns[2]);

        if (!p1Path.reachable) return { p1Percent: 0, p2Percent: 100, delta: -99 };
        if (!p2Path.reachable) return { p1Percent: 100, p2Percent: 0, delta: 99 };

        const d1 = p1Path.distance;
        const d2 = p2Path.distance;
        const delta = d2 - d1;

        let p1Percent = 50 + delta * 8;
        p1Percent = Math.max(5, Math.min(95, p1Percent));

        if (d1 === 0) p1Percent = 100;
        if (d2 === 0) p1Percent = 0;

        return {
            p1Dist: d1,
            p2Dist: d2,
            delta,
            p1Percent: Math.round(p1Percent),
            p2Percent: 100 - Math.round(p1Percent)
        };
    }

    // Check if movement between adjacent cells (x1, y1) and (x2, y2) is blocked by a wall
    // NOTE: Broken walls (isBroken: true) DO NOT block pawns! Pawns can walk through rubble!
    isEdgeBlocked(x1, y1, x2, y2, walls = this.walls) {
        if (x1 === x2) {
            const minY = Math.min(y1, y2);
            return walls.some(w => 
                !w.isBroken &&
                w.orientation === 'H' && 
                w.gy === minY && 
                (w.gx === x1 || w.gx === x1 - 1)
            );
        } else if (y1 === y2) {
            const minX = Math.min(x1, x2);
            return walls.some(w => 
                !w.isBroken &&
                w.orientation === 'V' && 
                w.gx === minX && 
                (w.gy === y1 || w.gy === y1 - 1)
            );
        }
        return true;
    }

    isCellOccupied(x, y, excludePlayer = null) {
        for (let p = 1; p <= this.numPlayers; p++) {
            if (p === excludePlayer) continue;
            if (this.pawns[p] && this.pawns[p].x === x && this.pawns[p].y === y) {
                return p;
            }
        }
        return null;
    }

    // Robust Pawn Movement & Tournament Jump Rules (Supports 2 and 4 Players)
    getValidPawnMoves(player = this.turn) {
        if (this.winner) return [];
        const currentPos = this.pawns[player];
        if (!currentPos) return [];

        const moves = [];
        const directions = [
            { dx: 0, dy: -1 }, // Up
            { dx: 0, dy: 1 },  // Down
            { dx: -1, dy: 0 }, // Left
            { dx: 1, dy: 0 }   // Right
        ];

        for (const dir of directions) {
            const nx = currentPos.x + dir.dx;
            const ny = currentPos.y + dir.dy;

            if (!this.isInside(nx, ny)) continue;
            if (this.isEdgeBlocked(currentPos.x, currentPos.y, nx, ny)) continue;

            const occupiedPlayer = this.isCellOccupied(nx, ny, player);
            if (occupiedPlayer) {
                // Adjacent pawn detected: Try straight jump over it!
                const jx = nx + dir.dx;
                const jy = ny + dir.dy;
                const canStraightJump = this.isInside(jx, jy) && 
                                        !this.isEdgeBlocked(nx, ny, jx, jy) && 
                                        !this.isCellOccupied(jx, jy, player);

                if (canStraightJump) {
                    moves.push({ x: jx, y: jy, isJump: true });
                } else {
                    // Straight jump blocked by wall, board edge, or another pawn -> Diagonal jump allowed!
                    const perpDirs = (dir.dx === 0) 
                        ? [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }] 
                        : [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];

                    for (const pDir of perpDirs) {
                        const diagX = nx + pDir.dx;
                        const diagY = ny + pDir.dy;
                        if (this.isInside(diagX, diagY) && 
                            !this.isEdgeBlocked(nx, ny, diagX, diagY) && 
                            !this.isCellOccupied(diagX, diagY, player)) {
                            moves.push({ x: diagX, y: diagY, isJump: true });
                        }
                    }
                }
            } else {
                moves.push({ x: nx, y: ny, isJump: false });
            }
        }

        return moves;
    }

    makePawnMove(tx, ty) {
        if (this.winner) return { success: false, reason: 'Game over' };

        const validMoves = this.getValidPawnMoves(this.turn);
        const targetMove = validMoves.find(m => m.x === tx && m.y === ty);
        if (!targetMove) {
            return { success: false, reason: 'Invalid destination' };
        }

        const colLetter = String.fromCharCode(97 + tx);
        const rowNum = 9 - ty;
        const actionDesc = `${colLetter}${rowNum}`;

        this.pawns[this.turn] = { x: tx, y: ty };
        if (this.timeControl.incrementSec) {
            this.playerTimeLeft[this.turn] += this.timeControl.incrementSec;
        }

        if (this.isGoal(this.turn, tx, ty)) {
            this.winner = this.turn;
            this.winReason = (this.gameMode === 'koth') ? 'Captured the center crown!' : 'Reached goal line';
        }

        this.moveLog.push({
            turn: this.turn,
            type: 'move',
            isJump: targetMove.isJump,
            desc: actionDesc,
            to: { x: tx, y: ty }
        });

        const activeTurn = this.turn;
        if (!this.winner) {
            this.turn = (this.turn % this.numPlayers) + 1;
        }

        this.saveState(`P${activeTurn}: ${actionDesc}`);
        return { success: true, isJump: targetMove.isJump, winner: this.winner };
    }

    // Collision check: prevent overlapping or crossing existing barricades (Both active AND broken!)
    // Once broken, rubble permanently stays on the slot so no new wall can be placed there!
    doesWallCollide(gx, gy, orientation, walls = this.walls) {
        if (gx < 0 || gx > 7 || gy < 0 || gy > 7) return true;

        for (const w of walls) {
            if (w.orientation === orientation) {
                if (orientation === 'H') {
                    if (w.gy === gy && (w.gx === gx || w.gx === gx - 1 || w.gx === gx + 1)) {
                        return true;
                    }
                } else {
                    if (w.gx === gx && (w.gy === gy || w.gy === gy - 1 || w.gy === gy + 1)) {
                        return true;
                    }
                }
            } else {
                if (w.gx === gx && w.gy === gy) {
                    return true;
                }
            }
        }
        return false;
    }

    // Fast Breadth-First Search (BFS) for shortest path to goal
    findShortestPath(player, startPos, walls = this.walls) {
        if (!startPos) return { reachable: false, distance: Infinity, path: [] };
        const queue = [{ x: startPos.x, y: startPos.y, dist: 0, path: [{ x: startPos.x, y: startPos.y }] }];
        const visited = new Uint8Array(81);
        visited[startPos.y * 9 + startPos.x] = 1;

        const directions = [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 }
        ];

        while (queue.length > 0) {
            const current = queue.shift();

            if (this.isGoal(player, current.x, current.y)) {
                return {
                    reachable: true,
                    distance: current.dist,
                    path: current.path
                };
            }

            for (const dir of directions) {
                const nx = current.x + dir.dx;
                const ny = current.y + dir.dy;
                const idx = ny * 9 + nx;

                if (this.isInside(nx, ny) && !visited[idx]) {
                    if (!this.isEdgeBlocked(current.x, current.y, nx, ny, walls)) {
                        visited[idx] = 1;
                        queue.push({
                            x: nx,
                            y: ny,
                            dist: current.dist + 1,
                            path: [...current.path, { x: nx, y: ny }]
                        });
                    }
                }
            }
        }

        return { reachable: false, distance: Infinity, path: [] };
    }

    validateWallPlacement(gx, gy, orientation, player = this.turn) {
        if (this.winner) return { valid: false, reason: 'Game over' };

        const wallCount = this.playerWalls[player];
        if (wallCount <= 0) {
            return { valid: false, reason: 'No walls remaining' };
        }

        if (this.doesWallCollide(gx, gy, orientation)) {
            return { valid: false, reason: 'Barricade collides with an existing barricade or broken rubble' };
        }

        // Test if wall completely traps ANY active player from their goal
        const hypotheticalWalls = [...this.walls, { gx, gy, orientation, player, isBroken: false }];
        for (let p = 1; p <= this.numPlayers; p++) {
            const path = this.findShortestPath(p, this.pawns[p], hypotheticalWalls);
            if (!path.reachable) {
                return { valid: false, reason: `Cannot completely block Player ${p} from reaching the goal!` };
            }
        }

        return { valid: true };
    }

    placeWall(gx, gy, orientation) {
        const validation = this.validateWallPlacement(gx, gy, orientation, this.turn);
        if (!validation.valid) {
            return { success: false, reason: validation.reason };
        }

        const colLetter = String.fromCharCode(97 + gx);
        const rowNum = 8 - gy;
        const actionDesc = `${orientation}${colLetter}${rowNum}`;

        this.walls.push({
            gx,
            gy,
            orientation,
            player: this.turn,
            isBroken: false,
            id: `wall_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
        });

        this.playerWalls[this.turn]--;
        if (this.timeControl.incrementSec) {
            this.playerTimeLeft[this.turn] += this.timeControl.incrementSec;
        }

        this.moveLog.push({
            turn: this.turn,
            type: 'wall',
            desc: actionDesc,
            wall: { gx, gy, orientation, player: this.turn }
        });

        const activeTurn = this.turn;
        this.turn = (this.turn % this.numPlayers) + 1;
        this.saveState(`P${activeTurn}: ${actionDesc}`);

        return { success: true };
    }

    // ==========================================
    // THE DIFFERENTIATOR: BREAK WALL MECHANIC (-3, -5, or -7 COST)
    // ==========================================
    breakWall(wallIndex, player = this.turn) {
        if (this.winner) return { success: false, reason: 'Game over' };
        if (this.turn !== player) return { success: false, reason: 'Not your turn' };

        if (this.gameplayMode === 'normal') {
            return { success: false, reason: 'Barricade breaking is disabled in Normal mode' };
        }

        const cost = this.breakCost || 5;
        const currentWalls = this.playerWalls[player];
        if (currentWalls < cost) {
            return { success: false, reason: `Breaking a barricade requires ${cost} barricades!` };
        }

        if (wallIndex < 0 || wallIndex >= this.walls.length) {
            return { success: false, reason: 'Invalid barricade selected' };
        }

        const wall = this.walls[wallIndex];
        if (wall.isBroken) {
            return { success: false, reason: 'This barricade is already broken!' };
        }

        // Deduct configured breakCost from player's own inventory
        this.playerWalls[player] -= cost;
        wall.isBroken = true;
        wall.brokenBy = player;

        const colLetter = String.fromCharCode(97 + wall.gx);
        const rowNum = 8 - wall.gy;
        const actionDesc = `💥 Break ${wall.orientation}${colLetter}${rowNum}`;

        this.moveLog.push({
            turn: player,
            type: 'break',
            desc: actionDesc,
            wallIndex,
            cost: cost,
            wall: { ...wall }
        });

        const activeTurn = this.turn;
        this.turn = (this.turn % this.numPlayers) + 1;
        this.saveState(`P${activeTurn}: ${actionDesc}`);

        return { success: true, wall, cost };
    }

    resign(player = this.turn) {
        if (this.winner) return;
        this.winner = (player === 1) ? 2 : 1;
        this.winReason = `Player ${player} resigned`;
        this.saveState(`Player ${player} resigned`);
        return { winner: this.winner, reason: this.winReason };
    }

    updateClock(now = Date.now()) {
        if (this.winner) return;
        const elapsedSec = (now - this.lastClockTick) / 1000;
        this.lastClockTick = now;

        const currentActive = this.turn;
        this.playerTimeLeft[currentActive] = Math.max(0, this.playerTimeLeft[currentActive] - elapsedSec);
        if (this.playerTimeLeft[currentActive] <= 0) {
            this.winner = (currentActive === 1) ? 2 : 1;
            this.winReason = `Player ${currentActive} ran out of time`;
        }
    }
}


// Comprehensive Suite of 15 Tournament Tactical Puzzles
BarricadeGame.PUZZLES = [
    {
        title: "The Winning Jump",
        desc: "Face-to-face with the opponent at the threshold. Jump over and capture the goal line!",
        p1: { x: 4, y: 2 },
        p2: { x: 4, y: 1 },
        p1Walls: 2,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 2, gy: 1, orientation: 'V', player: 2 },
            { gx: 5, gy: 1, orientation: 'V', player: 2 }
        ],
        solution: { type: 'move', x: 4, y: 0 }
    },
    {
        title: "The Critical Detour",
        desc: "Opponent is just 2 steps away from victory! Place a barricade to force a 5-step detour.",
        p1: { x: 4, y: 4 },
        p2: { x: 4, y: 6 },
        p1Walls: 3,
        p2Walls: 0,
        turn: 1,
        walls: [
            { gx: 3, gy: 7, orientation: 'H', player: 1 }
        ],
        solution: { type: 'wall', gx: 3, gy: 6, orientation: 'H' }
    },
    {
        title: "Diagonal Sidestep",
        desc: "Opponent has a wall directly behind them. Execute the tournament diagonal jump!",
        p1: { x: 3, y: 4 },
        p2: { x: 3, y: 3 },
        p1Walls: 1,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 3, gy: 2, orientation: 'H', player: 2 }
        ],
        solution: { type: 'move', x: 4, y: 3 }
    },
    {
        title: "The Double Chokepoint",
        desc: "Opponent has two open paths. Place the critical wall that seals one route completely!",
        p1: { x: 4, y: 3 },
        p2: { x: 4, y: 5 },
        p1Walls: 2,
        p2Walls: 0,
        turn: 1,
        walls: [
            { gx: 2, gy: 6, orientation: 'H', player: 1 },
            { gx: 5, gy: 6, orientation: 'H', player: 1 }
        ],
        solution: { type: 'wall', gx: 4, gy: 6, orientation: 'H' }
    },
    {
        title: "King of the Hill Sprint",
        desc: "Center race! Jump past opponent's wall and reach the crown square (4,4).",
        p1: { x: 4, y: 5 },
        p2: { x: 4, y: 3 },
        p1Walls: 1,
        p2Walls: 0,
        turn: 1,
        walls: [
            { gx: 2, gy: 4, orientation: 'V', player: 2 },
            { gx: 5, gy: 4, orientation: 'V', player: 2 }
        ],
        solution: { type: 'move', x: 4, y: 4 }
    },
    {
        title: "Flank Lockout",
        desc: "Opponent is sprinting down column 7. Place a vertical wall to cut off their sprint!",
        p1: { x: 6, y: 4 },
        p2: { x: 7, y: 5 },
        p1Walls: 2,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 6, gy: 7, orientation: 'H', player: 2 }
        ],
        solution: { type: 'wall', gx: 6, gy: 5, orientation: 'V' }
    },
    {
        title: "The Overpass",
        desc: "Both flanks are sealed with walls. Leap straight over the opponent for the breakthrough!",
        p1: { x: 2, y: 4 },
        p2: { x: 2, y: 3 },
        p1Walls: 1,
        p2Walls: 2,
        turn: 1,
        walls: [
            { gx: 1, gy: 3, orientation: 'V', player: 2 },
            { gx: 2, gy: 3, orientation: 'V', player: 2 }
        ],
        solution: { type: 'move', x: 2, y: 2 }
    },
    {
        title: "The Backdoor Trap",
        desc: "Opponent took a detour to the left. Seal the exit corridor to force them back!",
        p1: { x: 4, y: 3 },
        p2: { x: 1, y: 4 },
        p1Walls: 2,
        p2Walls: 0,
        turn: 1,
        walls: [
            { gx: 0, gy: 5, orientation: 'H', player: 1 }
        ],
        solution: { type: 'wall', gx: 1, gy: 5, orientation: 'H' }
    },
    {
        title: "The Cross Corridor",
        desc: "Opponent wants to slip through center file 4. Place a horizontal wall to redirect them.",
        p1: { x: 5, y: 3 },
        p2: { x: 4, y: 4 },
        p1Walls: 3,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 3, gy: 5, orientation: 'V', player: 2 }
        ],
        solution: { type: 'wall', gx: 3, gy: 4, orientation: 'H' }
    },
    {
        title: "Escaping the Net",
        desc: "Opponent tries to box you in from the right. Leap left diagonally to escape!",
        p1: { x: 5, y: 5 },
        p2: { x: 5, y: 4 },
        p1Walls: 1,
        p2Walls: 2,
        turn: 1,
        walls: [
            { gx: 4, gy: 3, orientation: 'H', player: 2 }
        ],
        solution: { type: 'move', x: 4, y: 4 }
    },
    {
        title: "Tempo Steal",
        desc: "Opponent is 3 moves out. Advance your pawn forward to maintain your tempo advantage!",
        p1: { x: 4, y: 2 },
        p2: { x: 1, y: 6 },
        p1Walls: 0,
        p2Walls: 0,
        turn: 1,
        walls: [
            { gx: 3, gy: 1, orientation: 'V', player: 2 }
        ],
        solution: { type: 'move', x: 4, y: 1 }
    },
    {
        title: "The Iron Gate",
        desc: "Opponent has a straight runway to row 8. Place the wall that shuts down the entire wing.",
        p1: { x: 3, y: 3 },
        p2: { x: 2, y: 5 },
        p1Walls: 2,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 2, gy: 6, orientation: 'H', player: 1 }
        ],
        solution: { type: 'wall', gx: 1, gy: 5, orientation: 'H' }
    },
    {
        title: "Diagonal Leap",
        desc: "A horizontal wall behind your opponent blocks a straight jump. Execute the diagonal leap right!",
        p1: { x: 6, y: 3 },
        p2: { x: 6, y: 2 },
        p1Walls: 1,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 5, gy: 1, orientation: 'H', player: 2 }
        ],
        solution: { type: 'move', x: 7, y: 2 }
    },
    {
        title: "Central Stranglehold",
        desc: "Opponent is descending through file 3. Place a vertical barrier to push them to the rim.",
        p1: { x: 4, y: 4 },
        p2: { x: 3, y: 4 },
        p1Walls: 2,
        p2Walls: 0,
        turn: 1,
        walls: [
            { gx: 2, gy: 5, orientation: 'H', player: 1 }
        ],
        solution: { type: 'wall', gx: 2, gy: 3, orientation: 'V' }
    },
    {
        title: "Crown Infiltration",
        desc: "King of the Hill mode! Opponent blocks file 4. Sidestep into crown center tile (4,4).",
        p1: { x: 3, y: 4 },
        p2: { x: 5, y: 4 },
        p1Walls: 1,
        p2Walls: 1,
        turn: 1,
        walls: [
            { gx: 3, gy: 3, orientation: 'H', player: 2 },
            { gx: 3, gy: 4, orientation: 'H', player: 2 }
        ],
        solution: { type: 'move', x: 4, y: 4 }
    }
];

// 3 Free Daily Puzzles Rotating Every Day Based on Calendar Date
BarricadeGame.getDailyPuzzles = function(dateStr) {
    if (!dateStr) {
        dateStr = new Date().toISOString().slice(0, 10);
    }
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
    }
    const total = BarricadeGame.PUZZLES.length;
    const idx1 = hash % total;
    const idx2 = (hash + 5) % total;
    const idx3 = (hash + 11) % total;

    const selected = [idx1];
    if (!selected.includes(idx2)) selected.push(idx2);
    else selected.push((idx2 + 1) % total);

    let third = idx3;
    while (selected.includes(third)) {
        third = (third + 1) % total;
    }
    selected.push(third);

    return selected.map((idx, dailyNum) => ({
        ...BarricadeGame.PUZZLES[idx],
        dailyNumber: dailyNum + 1, // 1, 2, or 3
        puzzleIndex: idx
    }));
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BarricadeGame;
}
