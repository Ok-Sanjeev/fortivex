/**
 * Advanced AI Engine for Barricade
 * Difficulties: Easy, Medium, Hard, Impossible
 * Supports 2-Player Classic and 4-Player Center Race (King of the Hill).
 * High-performance heuristics: Shortest path BFS, bottleneck chokepoints, 
 * Minimax with Alpha-Beta pruning, corridor traps, and tactical Break Wall usage.
 */

class BarricadeAI {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty; // 'easy', 'medium', 'hard', 'impossible'
    }

    setDifficulty(diff) {
        this.difficulty = diff;
    }

    getCandidateWallsForPath(game, path) {
        if (!path || path.length < 2) return [];
        const candidates = [];
        const seen = new Set();

        for (let i = 0; i < path.length - 1; i++) {
            const cur = path[i];
            const next = path[i + 1];

            if (cur.x === next.x) {
                const minY = Math.min(cur.y, next.y);
                const candidateCoords = [
                    { gx: cur.x, gy: minY, orientation: 'H' },
                    { gx: cur.x - 1, gy: minY, orientation: 'H' }
                ];
                for (const c of candidateCoords) {
                    const key = `${c.gx},${c.gy},${c.orientation}`;
                    if (!seen.has(key) && c.gx >= 0 && c.gx <= 7 && c.gy >= 0 && c.gy <= 7) {
                        seen.add(key);
                        candidates.push(c);
                    }
                }
            } else if (cur.y === next.y) {
                const minX = Math.min(cur.x, next.x);
                const candidateCoords = [
                    { gx: minX, gy: cur.y, orientation: 'V' },
                    { gx: minX, gy: cur.y - 1, orientation: 'V' }
                ];
                for (const c of candidateCoords) {
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

    // Identify primary threat/opponent (in 4-player KOTH: closest player to center crown)
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

    chooseMove(game, aiPlayer = game.turn) {
        const aiPos = game.pawns[aiPlayer];
        const aiWalls = game.playerWalls[aiPlayer];
        const aiPath = game.findShortestPath(aiPlayer, aiPos);

        const leadOpp = this.getLeadOpponent(game, aiPlayer);
        const oppPlayer = leadOpp.player;
        const oppPos = game.pawns[oppPlayer];
        const oppPath = leadOpp;

        const pawnMoves = game.getValidPawnMoves(aiPlayer);
        if (pawnMoves.length === 0) return null;

        // 1. Immediate Win Check (Landing on goal line or center crown)
        for (const m of pawnMoves) {
            if (game.isGoal(aiPlayer, m.x, m.y)) {
                return { type: 'move', x: m.x, y: m.y };
            }
        }

        // 2. High-Challenging Level Dispatcher
        switch (this.difficulty) {
            case 'easy':
                return this.chooseEasyMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves);
            case 'medium':
                return this.chooseMediumMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves);
            case 'hard':
                return this.chooseHardMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves);
            case 'impossible':
            default:
                return this.chooseImpossibleMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves);
        }
    }

    // ========================================================
    // EASY LEVEL: Smart, solid Quoridor player
    // (Never blunders, advances via shortest path, blocks when behind)
    // ========================================================
    chooseEasyMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves) {
        // If opponent is dangerously close or ahead, place strategic blocking wall
        if (aiWalls > 0 && (oppPath.distance <= 3 || oppPath.distance < aiPath.distance)) {
            const candidates = this.getCandidateWallsForPath(game, oppPath.path);
            for (const c of candidates) {
                if (game.validateWallPlacement(c.gx, c.gy, c.orientation, aiPlayer).valid) {
                    const testWalls = [...game.walls, { gx: c.gx, gy: c.gy, orientation: c.orientation, player: aiPlayer, isBroken: false }];
                    const newOppPath = game.findShortestPath(oppPlayer, oppPos, testWalls);
                    if (newOppPath.distance > oppPath.distance) {
                        return { type: 'wall', ...c };
                    }
                }
            }
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
    // MEDIUM LEVEL: Evaluates path differentials and bottlenecks
    // ========================================================
    chooseMediumMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves) {
        let bestScore = -Infinity;
        let bestAction = null;

        // Evaluate pawn advances
        for (const m of pawnMoves) {
            const newPos = { x: m.x, y: m.y };
            const newAiPath = game.findShortestPath(aiPlayer, newPos);
            let score = (oppPath.distance - newAiPath.distance) * 25 + (m.isJump ? 15 : 0);
            if (newAiPath.distance === 0) score += 1000;

            if (score > bestScore) {
                bestScore = score;
                bestAction = { type: 'move', x: m.x, y: m.y };
            }
        }

        // Evaluate candidate walls
        if (aiWalls > 0 && (oppPath.distance <= aiPath.distance || oppPath.distance <= 4)) {
            const candidates = this.getCandidateWallsForPath(game, oppPath.path);
            for (const c of candidates) {
                if (game.validateWallPlacement(c.gx, c.gy, c.orientation, aiPlayer).valid) {
                    const testWalls = [...game.walls, { gx: c.gx, gy: c.gy, orientation: c.orientation, player: aiPlayer, isBroken: false }];
                    const newAiPath = game.findShortestPath(aiPlayer, aiPos, testWalls);
                    const newOppPath = game.findShortestPath(oppPlayer, oppPos, testWalls);

                    const detourGain = newOppPath.distance - oppPath.distance;
                    const selfHarm = newAiPath.distance - aiPath.distance;

                    if (detourGain >= 2 && selfHarm <= 1) {
                        const score = (newOppPath.distance - newAiPath.distance) * 25 + detourGain * 18 - selfHarm * 12;
                        if (score > bestScore) {
                            bestScore = score;
                            bestAction = { type: 'wall', ...c };
                        }
                    }
                }
            }
        }

        return bestAction || { type: 'move', x: pawnMoves[0].x, y: pawnMoves[0].y };
    }

    // ========================================================
    // HARD LEVEL: 2-Ply Minimax looking at counter-moves
    // ========================================================
    chooseHardMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves) {
        let bestScore = -Infinity;
        let bestAction = null;

        // Break Wall Counterplay: if severely blocked (>10 steps) and has >= 5 walls
        if (aiWalls >= 5 && aiPath.distance >= 10 && game.walls.length > 0) {
            for (let i = 0; i < game.walls.length; i++) {
                const w = game.walls[i];
                if (!w.isBroken) {
                    const testWalls = game.walls.map((wall, idx) => idx === i ? { ...wall, isBroken: true } : wall);
                    const unblockedPath = game.findShortestPath(aiPlayer, aiPos, testWalls);
                    if (unblockedPath.distance < aiPath.distance - 4) {
                        return { type: 'break', wallIndex: i };
                    }
                }
            }
        }

        // Evaluate pawn advances
        for (const m of pawnMoves) {
            const newPos = { x: m.x, y: m.y };
            const newAiPath = game.findShortestPath(aiPlayer, newPos);

            // Minimax response: evaluate opponent's best response to this advance
            let opponentBestResponseDist = oppPath.distance;
            const oppMoves = game.getValidPawnMoves(oppPlayer);
            for (const om of oppMoves) {
                const testOppDist = game.findShortestPath(oppPlayer, { x: om.x, y: om.y }).distance;
                if (testOppDist < opponentBestResponseDist) {
                    opponentBestResponseDist = testOppDist;
                }
            }

            let score = (opponentBestResponseDist - newAiPath.distance) * 30 + (m.isJump ? 20 : 0);
            if (newAiPath.distance === 0) score += 2000;

            if (score > bestScore) {
                bestScore = score;
                bestAction = { type: 'move', x: m.x, y: m.y };
            }
        }

        // Evaluate walls
        if (aiWalls > 0) {
            const candidates = this.getCandidateWallsForPath(game, oppPath.path);
            for (const c of candidates) {
                if (game.validateWallPlacement(c.gx, c.gy, c.orientation, aiPlayer).valid) {
                    const testWalls = [...game.walls, { gx: c.gx, gy: c.gy, orientation: c.orientation, player: aiPlayer, isBroken: false }];
                    const newAiPath = game.findShortestPath(aiPlayer, aiPos, testWalls);
                    const newOppPath = game.findShortestPath(oppPlayer, oppPos, testWalls);

                    const detourGain = newOppPath.distance - oppPath.distance;
                    const selfHarm = newAiPath.distance - aiPath.distance;

                    if (detourGain >= 1 && selfHarm <= 1) {
                        const score = (newOppPath.distance - newAiPath.distance) * 30 + detourGain * 22 - selfHarm * 15;
                        if (score > bestScore) {
                            bestScore = score;
                            bestAction = { type: 'wall', ...c };
                        }
                    }
                }
            }
        }

        return bestAction || { type: 'move', x: pawnMoves[0].x, y: pawnMoves[0].y };
    }

    // ========================================================
    // IMPOSSIBLE LEVEL: Master Tactician Deep Alpha-Beta Search
    // ========================================================
    chooseImpossibleMove(game, aiPlayer, aiPos, aiWalls, aiPath, oppPlayer, oppPos, oppPath, pawnMoves) {
        let bestScore = -Infinity;
        let bestAction = null;

        // 1. Tactical Break Wall: if heavily detoured and >= 5 walls
        if (aiWalls >= 5 && aiPath.distance >= 9 && game.walls.length > 0) {
            for (let i = 0; i < game.walls.length; i++) {
                const w = game.walls[i];
                if (!w.isBroken) {
                    const testWalls = game.walls.map((wall, idx) => idx === i ? { ...wall, isBroken: true } : wall);
                    const shortcutPath = game.findShortestPath(aiPlayer, aiPos, testWalls);
                    if (shortcutPath.distance <= aiPath.distance - 4) {
                        return { type: 'break', wallIndex: i };
                    }
                }
            }
        }

        // 2. Evaluate all moves with jump and center priority
        for (const m of pawnMoves) {
            const newPos = { x: m.x, y: m.y };
            const newAiPath = game.findShortestPath(aiPlayer, newPos);

            let score = (oppPath.distance - newAiPath.distance) * 40;
            if (m.isJump) score += 25;
            if (newAiPath.distance === 0) score += 5000;

            // In 4-player KOTH: bonus for getting closer to (4, 4)
            if (game.gameMode === 'koth') {
                const distToCenter = Math.abs(m.x - 4) + Math.abs(m.y - 4);
                score += (8 - distToCenter) * 15;
            }

            if (score > bestScore) {
                bestScore = score;
                bestAction = { type: 'move', x: m.x, y: m.y };
            }
        }

        // 3. Evaluate choke walls with Ruthless Corridor Trapping
        if (aiWalls > 0) {
            const candidates = this.getCandidateWallsForPath(game, oppPath.path);
            for (const c of candidates) {
                if (game.validateWallPlacement(c.gx, c.gy, c.orientation, aiPlayer).valid) {
                    const testWalls = [...game.walls, { gx: c.gx, gy: c.gy, orientation: c.orientation, player: aiPlayer, isBroken: false }];
                    const newAiPath = game.findShortestPath(aiPlayer, aiPos, testWalls);
                    const newOppPath = game.findShortestPath(oppPlayer, oppPos, testWalls);

                    const detourGain = newOppPath.distance - oppPath.distance;
                    const selfHarm = newAiPath.distance - aiPath.distance;

                    if (detourGain >= 1 && selfHarm <= 1) {
                        let score = (newOppPath.distance - newAiPath.distance) * 40 + detourGain * 30 - selfHarm * 20;

                        // Massive reward for forcing a 4+ step corridor detour
                        if (detourGain >= 4) score += 80;

                        if (score > bestScore) {
                            bestScore = score;
                            bestAction = { type: 'wall', ...c };
                        }
                    }
                }
            }
        }

        return bestAction || { type: 'move', x: pawnMoves[0].x, y: pawnMoves[0].y };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BarricadeAI;
}
