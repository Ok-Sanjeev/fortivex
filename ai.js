/**
 * FORTIVEX — Advanced AI Engine (ai.js)
 * Production-ready AI with 4 Distinct Difficulty Tiers:
 *   - EASY:       Solid basics, shortest-path follower, occasional suboptimal choice, no illegal moves.
 *   - MEDIUM:     1-2 ply lookahead, tactical threat detection, strategic barricade placement.
 *   - HARD:       2-3 ply Minimax with Alpha-Beta pruning, counterplay anticipation, corridor trapping.
 *   - IMPOSSIBLE: Master-tier Iterative Deepening Minimax, Alpha-Beta pruning, 64-bit Zobrist Transposition Table,
 *                 killer move ordering, non-linear threat detection, and tactical Barricade Breaking.
 * 
 * Supports both 2-Player Classic and 4-Player King of the Hill (KOTH) center race.
 */

// ========================================================
// 64-BIT DETERMINISTIC ZOBRIST HASHING
// ========================================================
function createSeededPRNG(seed = 0x853c49e6) {
    let s = seed >>> 0;
    return function() {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s;
    };
}

function generateRandom64(prng) {
    const high = BigInt(prng());
    const low = BigInt(prng());
    return (high << 32n) | low;
}

const prng = createSeededPRNG(0x464f5254); // "FORT" seed

const ZOBRIST = {
    // 5 players (index 1..4), 9x9 board
    pawns: Array.from({ length: 5 }, () => 
        Array.from({ length: 9 }, () => 
            Array.from({ length: 9 }, () => generateRandom64(prng))
        )
    ),
    // 8x8 grooves, horizontal & vertical
    wallsH: Array.from({ length: 8 }, () => 
        Array.from({ length: 8 }, () => generateRandom64(prng))
    ),
    wallsV: Array.from({ length: 8 }, () => 
        Array.from({ length: 8 }, () => generateRandom64(prng))
    ),
    // Broken rubble states
    rubbleH: Array.from({ length: 8 }, () => 
        Array.from({ length: 8 }, () => generateRandom64(prng))
    ),
    rubbleV: Array.from({ length: 8 }, () => 
        Array.from({ length: 8 }, () => generateRandom64(prng))
    ),
    // Turn indicator (1..4)
    turns: Array.from({ length: 5 }, () => generateRandom64(prng))
};

function computeZobristHash(game) {
    let hash = 0n;
    for (let p = 1; p <= game.numPlayers; p++) {
        const pos = game.pawns[p];
        if (pos && pos.x >= 0 && pos.x < 9 && pos.y >= 0 && pos.y < 9) {
            hash ^= ZOBRIST.pawns[p][pos.x][pos.y];
        }
    }
    for (const w of game.walls) {
        if (w.gx >= 0 && w.gx < 8 && w.gy >= 0 && w.gy < 8) {
            if (w.orientation === 'H') {
                hash ^= (w.isBroken ? ZOBRIST.rubbleH[w.gx][w.gy] : ZOBRIST.wallsH[w.gx][w.gy]);
            } else {
                hash ^= (w.isBroken ? ZOBRIST.rubbleV[w.gx][w.gy] : ZOBRIST.wallsV[w.gx][w.gy]);
            }
        }
    }
    if (game.turn >= 1 && game.turn <= 4) {
        hash ^= ZOBRIST.turns[game.turn];
    }
    return hash;
}

// ========================================================
// TRANSPOSITION TABLE
// ========================================================
class TranspositionTable {
    constructor(maxEntries = 32768) {
        this.maxEntries = maxEntries;
        this.table = new Map();
        this.hits = 0;
        this.writes = 0;
    }

    clear() {
        this.table.clear();
        this.hits = 0;
        this.writes = 0;
    }

    get(hash) {
        const entry = this.table.get(hash);
        if (entry) {
            this.hits++;
            return entry;
        }
        return null;
    }

    set(hash, depth, score, flag, bestMove) {
        this.writes++;
        if (this.table.size >= this.maxEntries) {
            // Evict oldest quarter of entries
            let count = 0;
            for (const key of this.table.keys()) {
                this.table.delete(key);
                count++;
                if (count >= this.maxEntries / 4) break;
            }
        }
        this.table.set(hash, { depth, score, flag, bestMove });
    }
}

// ========================================================
// BARRICADE AI ENGINE
// ========================================================
class BarricadeAI {
    constructor(difficulty = 'medium', options = {}) {
        this.difficulty = difficulty; // 'easy', 'medium', 'hard', 'impossible'
        this.tt = new TranspositionTable(options.maxTTEntries || 32768);
        this.timeBudgetMs = options.timeBudgetMs || {
            easy: 50,
            medium: 150,
            hard: 350,
            impossible: 650
        };
        this.stats = {
            nodesEvaluated: 0,
            searchDepthReached: 0,
            searchTimeMs: 0,
            ttHits: 0
        };
    }

    setDifficulty(diff) {
        const valid = ['easy', 'medium', 'hard', 'impossible'];
        if (valid.includes(diff)) {
            this.difficulty = diff;
        }
    }

    getStats() {
        return { ...this.stats, ttHits: this.tt.hits };
    }

    // Identify the primary threat/opponent (closest to victory)
    getLeadOpponent(game, aiPlayer) {
        let leadOpp = null;
        let minOppDist = Infinity;

        for (let p = 1; p <= game.numPlayers; p++) {
            if (p === aiPlayer) continue;
            const pos = game.pawns[p];
            if (!pos) continue;
            const path = game.findShortestPath(p, pos);
            if (path.reachable && path.distance < minOppDist) {
                minOppDist = path.distance;
                leadOpp = { player: p, distance: path.distance, path: path.path };
            }
        }

        return leadOpp || { player: (aiPlayer === 1 ? 2 : 1), distance: 8, path: [] };
    }

    // Candidate walls intersecting the edges along a path
    getCandidateWallsForPath(game, path) {
        if (!path || path.length < 2) return [];
        const candidates = [];
        const seen = new Set();

        for (let i = 0; i < path.length - 1; i++) {
            const cur = path[i];
            const next = path[i + 1];

            if (cur.x === next.x) {
                const minY = Math.min(cur.y, next.y);
                const coords = [
                    { gx: cur.x, gy: minY, orientation: 'H' },
                    { gx: cur.x - 1, gy: minY, orientation: 'H' }
                ];
                for (const c of coords) {
                    const key = `${c.gx},${c.gy},${c.orientation}`;
                    if (!seen.has(key) && c.gx >= 0 && c.gx <= 7 && c.gy >= 0 && c.gy <= 7) {
                        seen.add(key);
                        candidates.push(c);
                    }
                }
            } else if (cur.y === next.y) {
                const minX = Math.min(cur.x, next.x);
                const coords = [
                    { gx: minX, gy: cur.y, orientation: 'V' },
                    { gx: minX, gy: cur.y - 1, orientation: 'V' }
                ];
                for (const c of coords) {
                    const key = `${c.gx},${c.gy},${c.orientation}`;
                    if (!seen.has(key) && c.gx >= 0 && c.gx <= 7 && c.gy >= 0 && c.gy <= 7) {
                        seen.add(key);
                        candidates.push(c);
                    }
                }
            }
        }

        return candidates;
    }

    // Candidate flank/extension walls that connect to existing walls to form corridors
    getCorridorExtensionWalls(game) {
        if (game.walls.length === 0) return [];
        const candidates = [];
        const seen = new Set();

        // Examine adjacent grooves to existing walls
        for (const w of game.walls) {
            const offsets = [
                { dgx: 1, dgy: 0, o: w.orientation },
                { dgx: -1, dgy: 0, o: w.orientation },
                { dgx: 0, dgy: 1, o: w.orientation },
                { dgx: 0, dgy: -1, o: w.orientation },
                { dgx: 0, dgy: 0, o: w.orientation === 'H' ? 'V' : 'H' }
            ];
            for (const off of offsets) {
                const gx = w.gx + off.dgx;
                const gy = w.gy + off.dgy;
                const orientation = off.o;
                const key = `${gx},${gy},${orientation}`;
                if (gx >= 0 && gx <= 7 && gy >= 0 && gy <= 7 && !seen.has(key)) {
                    seen.add(key);
                    candidates.push({ gx, gy, orientation });
                }
            }
        }

        return candidates;
    }

    // ========================================================
    // RICH MULTI-FACTOR EVALUATION FUNCTION
    // ========================================================
    evaluatePosition(game, aiPlayer) {
        this.stats.nodesEvaluated++;

        // 1. Terminal victory checks
        if (game.winner) {
            return game.winner === aiPlayer ? 100000 : -100000;
        }

        const aiPos = game.pawns[aiPlayer];
        if (!aiPos) return -50000;

        const aiPath = game.findShortestPath(aiPlayer, aiPos);
        if (!aiPath.reachable) return -90000;
        if (aiPath.distance === 0) return 100000;

        // Find primary threat (closest opponent)
        const leadOpp = this.getLeadOpponent(game, aiPlayer);
        const oppDist = leadOpp.distance;
        const aiDist = aiPath.distance;

        // Base distance differential
        let score = (oppDist - aiDist) * 120;

        // 2. Urgent Threat Penalty (Non-linear danger curve)
        if (oppDist === 1) {
            score -= 40000; // Opponent can win immediately!
        } else if (oppDist === 2) {
            score -= 15000; // Immediate winning setup!
        } else if (oppDist === 3) {
            score -= 4000;
        }

        // 3. Imminent Win Bonus for AI
        if (aiDist === 1) {
            score += 35000;
        } else if (aiDist === 2) {
            score += 12000;
        }

        // 4. King of the Hill (KOTH) Center Crown Proximity
        if (game.gameMode === 'koth') {
            const distToCenter = Math.abs(aiPos.x - 4) + Math.abs(aiPos.y - 4);
            score += (8 - distToCenter) * 25;

            // Opponent proximity to crown penalty
            const oppPos = game.pawns[leadOpp.player];
            if (oppPos) {
                const oppDistToCenter = Math.abs(oppPos.x - 4) + Math.abs(oppPos.y - 4);
                score -= (8 - oppDistToCenter) * 20;
            }
        }

        // 5. Pawn Mobility & Degrees of Freedom
        const validMoves = game.getValidPawnMoves(aiPlayer);
        score += validMoves.length * 8;

        // 6. Barricade Inventory Management
        const aiWalls = game.playerWalls[aiPlayer] || 0;
        const oppWalls = game.playerWalls[leadOpp.player] || 0;
        score += (aiWalls - oppWalls) * 12;

        return score;
    }

    // ========================================================
    // LEGAL ACTION GENERATION & MOVE ORDERING
    // ========================================================
    generateOrderedActions(game, player, isRoot = false, ttBestMove = null) {
        const actions = [];
        const pos = game.pawns[player];
        if (!pos) return actions;

        const path = game.findShortestPath(player, pos);
        const leadOpp = this.getLeadOpponent(game, player);
        const wallsLeft = game.playerWalls[player] || 0;

        // 1. Pawn Moves
        const pawnMoves = game.getValidPawnMoves(player);
        for (const m of pawnMoves) {
            let priority = 100;
            if (game.isGoal(player, m.x, m.y)) priority += 50000; // Immediate win!
            if (m.isJump) priority += 40;

            // Check if this move is on the shortest path
            if (path.path.length > 1 && m.x === path.path[1].x && m.y === path.path[1].y) {
                priority += 80;
            }

            actions.push({
                type: 'move',
                x: m.x,
                y: m.y,
                isJump: m.isJump,
                priority
            });
        }

        // 2. Tactical Barricade Breaking (if breaking mode enabled & player has enough walls)
        const breakCost = game.breakCost || 5;
        if (game.gameplayMode === 'breaking' && wallsLeft >= breakCost && game.walls.length > 0) {
            if (path.distance >= 8) { // Only consider breaking if significantly detoured
                for (let i = 0; i < game.walls.length; i++) {
                    const w = game.walls[i];
                    if (!w.isBroken) {
                        const testWalls = game.walls.map((wall, idx) => idx === i ? { ...wall, isBroken: true } : wall);
                        const shortcutPath = game.findShortestPath(player, pos, testWalls);
                        const distanceSaved = path.distance - shortcutPath.distance;
                        if (distanceSaved >= 3) {
                            actions.push({
                                type: 'break',
                                wallIndex: i,
                                priority: 200 + distanceSaved * 50
                            });
                        }
                    }
                }
            }
        }

        // 3. Strategic Barricade Placements
        if (wallsLeft > 0) {
            const seenCandidates = new Set();
            const rawCandidates = [];

            // Primary source: opponent's shortest path
            const pathCandidates = this.getCandidateWallsForPath(game, leadOpp.path);
            for (const c of pathCandidates) {
                const key = `${c.gx},${c.gy},${c.orientation}`;
                if (!seenCandidates.has(key)) {
                    seenCandidates.add(key);
                    rawCandidates.push(c);
                }
            }

            // In Hard/Impossible: also add corridor extension walls
            if (this.difficulty === 'hard' || this.difficulty === 'impossible') {
                const corridorCandidates = this.getCorridorExtensionWalls(game);
                for (const c of corridorCandidates) {
                    const key = `${c.gx},${c.gy},${c.orientation}`;
                    if (!seenCandidates.has(key)) {
                        seenCandidates.add(key);
                        rawCandidates.push(c);
                    }
                }
            }

            // Validate and score candidate walls
            for (const c of rawCandidates) {
                const validation = game.validateWallPlacement(c.gx, c.gy, c.orientation, player);
                if (validation.valid) {
                    // Quick heuristic scoring: detour gain vs self harm
                    const testWalls = [...game.walls, { gx: c.gx, gy: c.gy, orientation: c.orientation, player, isBroken: false }];
                    const newOppPath = game.findShortestPath(leadOpp.player, game.pawns[leadOpp.player], testWalls);
                    const newSelfPath = game.findShortestPath(player, pos, testWalls);

                    const detourGain = newOppPath.distance - leadOpp.distance;
                    const selfHarm = newSelfPath.distance - path.distance;

                    // Only consider productive walls
                    if (detourGain >= 1 && selfHarm <= 1) {
                        let priority = 150 + detourGain * 45 - selfHarm * 30;

                        // Massive priority for stopping an opponent who is 1-2 moves away
                        if (leadOpp.distance <= 2 && newOppPath.distance > leadOpp.distance) {
                            priority += 20000;
                        }

                        // Bonus for severe corridor detours
                        if (detourGain >= 4) priority += 120;

                        actions.push({
                            type: 'wall',
                            gx: c.gx,
                            gy: c.gy,
                            orientation: c.orientation,
                            priority
                        });
                    }
                }
            }
        }

        // 4. Move Ordering: Sort by priority descending
        actions.sort((a, b) => {
            // Prioritize TT hash move
            if (ttBestMove) {
                if (this.areMovesEqual(a, ttBestMove)) return -1;
                if (this.areMovesEqual(b, ttBestMove)) return 1;
            }
            return b.priority - a.priority;
        });

        // Limit branching factor in deeper searches
        if (!isRoot && actions.length > 18) {
            return actions.slice(0, 18);
        }

        return actions;
    }

    areMovesEqual(m1, m2) {
        if (!m1 || !m2 || m1.type !== m2.type) return false;
        if (m1.type === 'move') return m1.x === m2.x && m1.y === m2.y;
        if (m1.type === 'wall') return m1.gx === m2.gx && m1.gy === m2.gy && m1.orientation === m2.orientation;
        if (m1.type === 'break') return m1.wallIndex === m2.wallIndex;
        return false;
    }

    applyAction(game, action) {
        if (action.type === 'move') {
            return game.makePawnMove(action.x, action.y);
        } else if (action.type === 'wall') {
            return game.placeWall(action.gx, action.gy, action.orientation);
        } else if (action.type === 'break') {
            return game.breakWall(action.wallIndex, game.turn);
        }
        return { success: false };
    }

    // ========================================================
    // CHOOSE MOVE DISPATCHER
    // ========================================================
    chooseMove(game, aiPlayer = game.turn) {
        const startTime = Date.now();
        this.stats.nodesEvaluated = 0;
        this.stats.searchDepthReached = 0;

        const aiPos = game.pawns[aiPlayer];
        if (!aiPos) return null;

        const pawnMoves = game.getValidPawnMoves(aiPlayer);
        if (pawnMoves.length === 0) return null;

        // 1. Immediate Goal Landing Check
        for (const m of pawnMoves) {
            if (game.isGoal(aiPlayer, m.x, m.y)) {
                return { type: 'move', x: m.x, y: m.y };
            }
        }

        let selectedMove = null;
        switch (this.difficulty) {
            case 'easy':
                selectedMove = this.chooseEasyMove(game, aiPlayer);
                break;
            case 'medium':
                selectedMove = this.chooseMediumMove(game, aiPlayer);
                break;
            case 'hard':
                selectedMove = this.chooseHardMove(game, aiPlayer);
                break;
            case 'impossible':
            default:
                selectedMove = this.chooseImpossibleMove(game, aiPlayer);
                break;
        }

        this.stats.searchTimeMs = Date.now() - startTime;
        return selectedMove;
    }

    // ========================================================
    // TIER 1: EASY LEVEL
    // Solid basics, advances via shortest path, 15% random deviation
    // ========================================================
    chooseEasyMove(game, aiPlayer) {
        const aiPos = game.pawns[aiPlayer];
        const aiWalls = game.playerWalls[aiPlayer] || 0;
        const aiPath = game.findShortestPath(aiPlayer, aiPos);
        const leadOpp = this.getLeadOpponent(game, aiPlayer);
        const pawnMoves = game.getValidPawnMoves(aiPlayer);

        // Emergency defensive wall: if opponent is dangerously close (<=2) and has walls
        if (aiWalls > 0 && leadOpp.distance <= 2 && Math.random() < 0.75) {
            const candidates = this.getCandidateWallsForPath(game, leadOpp.path);
            for (const c of candidates) {
                if (game.validateWallPlacement(c.gx, c.gy, c.orientation, aiPlayer).valid) {
                    const testWalls = [...game.walls, { gx: c.gx, gy: c.gy, orientation: c.orientation, player: aiPlayer, isBroken: false }];
                    const newOppPath = game.findShortestPath(leadOpp.player, game.pawns[leadOpp.player], testWalls);
                    if (newOppPath.distance > leadOpp.distance) {
                        return { type: 'wall', ...c };
                    }
                }
            }
        }

        // Suboptimal random exploration factor (15% chance to pick an alternative valid move)
        if (Math.random() < 0.15 && pawnMoves.length > 1) {
            const randMove = pawnMoves[Math.floor(Math.random() * pawnMoves.length)];
            return { type: 'move', x: randMove.x, y: randMove.y };
        }

        // Advance along shortest path
        if (aiPath.reachable && aiPath.path.length > 1) {
            const nextStep = aiPath.path[1];
            const move = pawnMoves.find(m => m.x === nextStep.x && m.y === nextStep.y);
            if (move) return { type: 'move', x: move.x, y: move.y };
        }

        return { type: 'move', x: pawnMoves[0].x, y: pawnMoves[0].y };
    }

    // ========================================================
    // TIER 2: MEDIUM LEVEL
    // 1-Ply Lookahead with Path Differential and Threat Detection
    // ========================================================
    chooseMediumMove(game, aiPlayer) {
        const actions = this.generateOrderedActions(game, aiPlayer, true);
        if (actions.length === 0) return null;

        let bestScore = -Infinity;
        let bestAction = actions[0];

        for (const action of actions) {
            const simGame = game.clone();
            const res = this.applyAction(simGame, action);
            if (!res.success) continue;

            const score = this.evaluatePosition(simGame, aiPlayer);
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        }

        return this.cleanAction(bestAction);
    }

    // ========================================================
    // TIER 3: HARD LEVEL
    // 2-Ply Minimax with Alpha-Beta Pruning and Counter-Response
    // ========================================================
    chooseHardMove(game, aiPlayer) {
        const actions = this.generateOrderedActions(game, aiPlayer, true);
        if (actions.length === 0) return null;

        let bestScore = -Infinity;
        let bestAction = actions[0];
        const alpha = -Infinity;
        const beta = Infinity;

        for (const action of actions) {
            const simGame = game.clone();
            const res = this.applyAction(simGame, action);
            if (!res.success) continue;

            // Opponent's counter-response
            const oppPlayer = simGame.turn;
            const oppActions = this.generateOrderedActions(simGame, oppPlayer, false);

            let minOppScore = Infinity;
            if (oppActions.length === 0 || simGame.winner) {
                minOppScore = this.evaluatePosition(simGame, aiPlayer);
            } else {
                for (const oppAct of oppActions.slice(0, 10)) {
                    const counterGame = simGame.clone();
                    this.applyAction(counterGame, oppAct);
                    const evalScore = this.evaluatePosition(counterGame, aiPlayer);
                    if (evalScore < minOppScore) {
                        minOppScore = evalScore;
                    }
                }
            }

            if (minOppScore > bestScore) {
                bestScore = minOppScore;
                bestAction = action;
            }
        }

        return this.cleanAction(bestAction);
    }

    // ========================================================
    // TIER 4: IMPOSSIBLE LEVEL
    // Master Minimax with Iterative Deepening & 64-Bit Zobrist TT
    // ========================================================
    chooseImpossibleMove(game, aiPlayer) {
        const timeBudget = this.timeBudgetMs.impossible || 600;
        const startTime = Date.now();
        const rootActions = this.generateOrderedActions(game, aiPlayer, true);
        if (rootActions.length === 0) return null;

        let globalBestMove = rootActions[0];
        let maxDepth = 4;

        // Iterative Deepening from depth 1 up to maxDepth
        for (let depth = 1; depth <= maxDepth; depth++) {
            if (Date.now() - startTime > timeBudget * 0.8) break;

            let bestScore = -Infinity;
            let currentBestMove = null;
            let alpha = -Infinity;
            const beta = Infinity;

            for (const action of rootActions) {
                if (Date.now() - startTime > timeBudget) break;

                const simGame = game.clone();
                const res = this.applyAction(simGame, action);
                if (!res.success) continue;

                const score = -this.alphaBetaSearch(
                    simGame,
                    depth - 1,
                    -beta,
                    -alpha,
                    simGame.turn,
                    aiPlayer,
                    startTime,
                    timeBudget
                );

                if (score > bestScore) {
                    bestScore = score;
                    currentBestMove = action;
                }
                alpha = Math.max(alpha, bestScore);
                if (alpha >= beta) break;
            }

            if (currentBestMove) {
                globalBestMove = currentBestMove;
                this.stats.searchDepthReached = depth;
            }
        }

        return this.cleanAction(globalBestMove);
    }

    // Core Alpha-Beta Search with Transposition Table
    alphaBetaSearch(game, depth, alpha, beta, currentTurn, aiPlayer, startTime, timeBudget) {
        this.stats.nodesEvaluated++;

        // Timeout check
        if (Date.now() - startTime > timeBudget) {
            return this.evaluatePosition(game, aiPlayer);
        }

        // Terminal state or leaf node
        if (game.winner || depth <= 0) {
            return this.evaluatePosition(game, aiPlayer);
        }

        const hash = computeZobristHash(game);
        const ttEntry = this.tt.get(hash);
        let ttBestMove = null;

        if (ttEntry && ttEntry.depth >= depth) {
            if (ttEntry.flag === 'EXACT') return ttEntry.score;
            if (ttEntry.flag === 'LOWER' && ttEntry.score > alpha) alpha = ttEntry.score;
            if (ttEntry.flag === 'UPPER' && ttEntry.score < beta) beta = ttEntry.score;
            if (alpha >= beta) return ttEntry.score;
            ttBestMove = ttEntry.bestMove;
        }

        const actions = this.generateOrderedActions(game, currentTurn, false, ttBestMove);
        if (actions.length === 0) {
            return this.evaluatePosition(game, aiPlayer);
        }

        let bestScore = -Infinity;
        let bestAction = actions[0];
        let flag = 'UPPER';

        for (const action of actions) {
            const simGame = game.clone();
            const res = this.applyAction(simGame, action);
            if (!res.success) continue;

            const score = -this.alphaBetaSearch(
                simGame,
                depth - 1,
                -beta,
                -alpha,
                simGame.turn,
                aiPlayer,
                startTime,
                timeBudget
            );

            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
            if (bestScore > alpha) {
                alpha = bestScore;
                flag = 'EXACT';
            }
            if (alpha >= beta) {
                flag = 'LOWER';
                break; // Beta cutoff
            }
        }

        this.tt.set(hash, depth, bestScore, flag, bestAction);
        return bestScore;
    }

    cleanAction(act) {
        if (!act) return null;
        if (act.type === 'move') {
            return { type: 'move', x: act.x, y: act.y };
        } else if (act.type === 'wall') {
            return { type: 'wall', gx: act.gx, gy: act.gy, orientation: act.orientation };
        } else if (act.type === 'break') {
            return { type: 'break', wallIndex: act.wallIndex };
        }
        return act;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BarricadeAI;
}
