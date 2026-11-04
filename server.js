/**
 * FORTIVEX — Real-Time Server-Authoritative Cloud Multiplayer & WebSocket Server (server.js)
 * 
 * Features:
 *   - Real-time WebSockets (ws) + transparent HTTP fallback
 *   - Server-Authoritative Game State Engine (validates every move before state updates)
 *   - Centralized Sequential Identity System (noob10001+)
 *   - 100 Persistent Logical AI Profiles in Database (noob10001 - noob10100)
 *   - Public Custom Room Browser with real-time discovery and filters
 *   - Ranked Matchmaking with +30 Win / -30 Loss Elo rating updates
 *   - Automatic AI Pool Fallback from the 100-bot database
 *   - Human-only chat (AI automatic chat strictly disabled)
 *   - Full Match Replay archiving and Live Spectator broadcasting
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { WebSocketServer, WebSocket } = require('ws');

const BarricadeGame = require('./game.js');
const db = require('./db.js');
const { AI_PROFILES, getAiProfileForRating } = require('./ai_profiles.js');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

// ==========================================
// REAL-TIME STATE ENGINE: CLIENTS & ROOMS
// ==========================================
const activeClients = new Map();  // clientId -> { lastSeen, ip, username, status, roomCode, ws }
const activeRooms = new Map();    // roomCode -> Room Object
const roomSockets = new Map();    // roomCode -> Set of { ws, clientId, username, role, isSpectator }

// Ranked Matchmaking Queue
const rankedQueue = [];           // Array of { clientId, userId, username, rating, joinedAt }
const matchedPairs = new Map();   // clientId -> match payload

// Clean inactive sessions & handle matchmaking fallback every 2 seconds
setInterval(() => {
    const now = Date.now();

    // 1. Clean stale clients (20s timeout)
    for (const [id, c] of activeClients.entries()) {
        if (now - c.lastSeen > 20000) {
            activeClients.delete(id);
        }
    }

    // 2. Clean stale rooms (15 min idle)
    for (const [code, r] of activeRooms.entries()) {
        if (now - r.lastUpdate > 15 * 60 * 1000) {
            activeRooms.delete(code);
            roomSockets.delete(code);
        }
    }

    // 3. Ranked Matchmaking AI Pool Fallback:
    // If a human has waited >= 5 seconds and no human opponent arrived,
    // automatically select an available AI profile from the 100-bot database!
    for (let i = rankedQueue.length - 1; i >= 0; i--) {
        const item = rankedQueue[i];
        if (now - item.joinedAt >= 5000) {
            rankedQueue.splice(i, 1);
            const botProfile = db.getAiProfileForMatch(item.rating);
            const roomCode = 'FORT-R' + Math.floor(1000 + Math.random() * 9000);

            const room = createServerRoom({
                code: roomCode,
                title: `Ranked Match: ${item.username} vs ${botProfile.username}`,
                isPublic: false,
                hostName: item.username,
                hostUserId: item.userId,
                hostRating: item.rating,
                settings: {
                    mode: 'classic',
                    gameplayMode: 'breaking',
                    breakCost: 5,
                    timeSec: 180,
                    walls: 10,
                    isRanked: true
                },
                p1: item.username,
                p2: botProfile.username, // Strictly noobXXXXX
                isBotMatch: true,
                botProfile
            });

            matchedPairs.set(item.clientId, {
                matched: true,
                roomCode,
                role: 1,
                opponent: {
                    username: botProfile.username, // Strictly noobXXXXX
                    rating: botProfile.rating,
                    isBot: true,
                    difficulty: botProfile.difficulty,
                    playstyle: botProfile.playstyle
                }
            });
        }
    }
}, 2000);

function createServerRoom({
    code,
    title = null,
    isPublic = true,
    password = null,
    hostName,
    hostUserId = null,
    hostRating = 1200,
    settings = {},
    p1,
    p2 = null,
    isBotMatch = false,
    botProfile = null
}) {
    const mode = settings.mode || 'classic';
    const maxPlayers = mode === 'koth' ? 4 : 2;

    const game = new BarricadeGame({
        gameMode: mode,
        gameplayMode: settings.gameplayMode || 'breaking',
        breakCost: settings.breakCost || 5,
        initialWalls: settings.walls || (mode === 'koth' ? 5 : 10),
        timeControl: { initialSec: settings.timeSec || 180, incrementSec: 2 }
    });

    const room = {
        code,
        title: title || `${hostName}'s Arena`,
        isPublic: isPublic !== false,
        password: password || null,
        hasPassword: !!password,
        hostName,
        hostUserId,
        hostRating: hostRating || 1200,
        settings,
        maxPlayers,
        p1: p1 || hostName,
        p2: p2,
        p3: null,
        p4: null,
        playerUserIds: { 1: hostUserId, 2: null, 3: null, 4: null },
        status: p2 ? 'playing' : 'waiting',
        game,
        moves: [],
        createdAt: Date.now(),
        lastUpdate: Date.now(),
        isRanked: !!settings.isRanked,
        isBotMatch,
        botProfile,
        spectators: 0
    };

    activeRooms.set(code, room);
    if (!roomSockets.has(code)) {
        roomSockets.set(code, new Set());
    }
    return room;
}

function broadcastToRoom(roomCode, message, excludeWs = null) {
    const sockets = roomSockets.get(roomCode);
    if (!sockets) return;
    const payload = JSON.stringify(message);
    for (const client of sockets) {
        if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(payload);
            } catch (e) {
                console.error('Error sending WS message:', e);
            }
        }
    }
}

function parseJsonBody(req, callback) {
    let body = '';
    req.on('data', chunk => {
        body += chunk;
        if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
        try {
            const data = body ? JSON.parse(body) : {};
            callback(null, data);
        } catch (e) {
            callback(e);
        }
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(JSON.stringify(data));
}

function serializeRoom(room) {
    return {
        code: room.code,
        title: room.title,
        isPublic: room.isPublic,
        hasPassword: !!room.password,
        hostName: room.hostName,
        hostRating: room.hostRating,
        settings: room.settings,
        maxPlayers: room.maxPlayers,
        currentPlayers: (room.p1 ? 1 : 0) + (room.p2 ? 1 : 0) + (room.p3 ? 1 : 0) + (room.p4 ? 1 : 0),
        p1: room.p1,
        p2: room.p2,
        p3: room.p3,
        p4: room.p4,
        status: room.status,
        totalMoves: room.moves.length
    };
}

// ==========================================
// HTTP SERVER & REST API
// ==========================================
const server = http.createServer((req, res) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const parsedUrl = url.parse(req.url, true);
    const reqPath = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    // 1. Centralized Identity: Guest Creation
    if (req.method === 'POST' && reqPath === '/api/auth/guest') {
        parseJsonBody(req, (err, data) => {
            const user = db.createGuestUser();
            sendJson(res, 200, { success: true, user });
        });
        return;
    }

    // 2. Centralized Identity: Claim Custom Username
    if (req.method === 'POST' && reqPath === '/api/auth/custom-name') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.userId || !data.username) {
                return sendJson(res, 400, { success: false, reason: 'Missing userId or username' });
            }
            const result = db.claimCustomUsername(data.userId, data.username);
            sendJson(res, result.success ? 200 : 400, result);
        });
        return;
    }

    // 3. Centralized Identity: Social Login Mock / Endpoint
    if (req.method === 'POST' && reqPath === '/api/auth/social') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.provider || !data.providerId) {
                return sendJson(res, 400, { success: false, reason: 'Missing provider credentials' });
            }
            const user = db.bindSocialAccount(
                data.userId,
                data.provider,
                data.providerId,
                data.email || `${data.provider}_${data.providerId.slice(0, 6)}@fortivex.io`,
                data.name
            );
            sendJson(res, 200, { success: true, user });
        });
        return;
    }

    // 4. User Profile & Stats Bundle
    if (req.method === 'GET' && reqPath === '/api/user/profile') {
        const userId = parsedUrl.query.userId || parsedUrl.query.username;
        const profile = db.getUserProfileData(userId);
        if (!profile) return sendJson(res, 404, { success: false, reason: 'User not found' });
        sendJson(res, 200, {
            success: true,
            profile,
            user: {
                id: profile.id,
                username: profile.username,
                displayName: profile.displayName,
                avatar: profile.avatar,
                rating: profile.rating,
                streak: profile.mainStats.currentWinningStreak,
                isGuest: profile.isGuest
            },
            recentMatches: profile.recentMatches ? profile.recentMatches.matches : []
        });
        return;
    }

    // 4b. Update Profile Avatar
    if (req.method === 'POST' && reqPath === '/api/user/update-avatar') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.userId || !data.avatar) {
                return sendJson(res, 400, { success: false, reason: 'Missing userId or avatar' });
            }
            const result = db.updateAvatar(data.userId, data.avatar);
            sendJson(res, result.success ? 200 : 400, result);
        });
        return;
    }

    // 4c. Paginated Match History
    if (req.method === 'GET' && reqPath === '/api/user/matches') {
        const userId = parsedUrl.query.userId || parsedUrl.query.username;
        const page = parseInt(parsedUrl.query.page || '1', 10);
        const limit = parseInt(parsedUrl.query.limit || '10', 10);
        const filter = parsedUrl.query.filter || 'all';
        const history = db.getUserMatchHistory(userId, page, limit, filter);
        sendJson(res, 200, { success: true, ...history });
        return;
    }

    // 4d. Rating Progression History Points
    if (req.method === 'GET' && reqPath === '/api/user/rating-history') {
        const userId = parsedUrl.query.userId || parsedUrl.query.username;
        const period = parsedUrl.query.period || 'all'; // '7d', '30d', 'all'
        const history = db.getRatingHistory(userId, period);
        sendJson(res, 200, { success: true, history });
        return;
    }

    // 4e. Record Completed Match / Ranked Result
    if (req.method === 'POST' && (reqPath === '/api/user/record-match' || reqPath === '/api/user/ranked-result')) {
        parseJsonBody(req, (err, data) => {
            if (err || !data.userId) {
                return sendJson(res, 400, { success: false, reason: 'Missing userId' });
            }
            const result = db.recordCompletedMatch(data.userId, {
                isWinner: data.isWinner !== undefined ? !!data.isWinner : !!data.isWin,
                isDraw: !!data.isDraw,
                isRanked: data.isRanked !== undefined ? !!data.isRanked : true,
                isBot: data.isBot !== undefined ? !!data.isBot : true,
                opponentName: data.opponentName || 'Opponent',
                opponentRating: parseInt(data.opponentRating || '1200', 10),
                opponentUserId: data.opponentUserId || null,
                durationSec: parseInt(data.durationSec || '60', 10),
                mode: data.mode || 'classic',
                gameplayMode: data.gameplayMode || 'breaking',
                breakCost: parseInt(data.breakCost || '5', 10),
                wallsPlaced: parseInt(data.wallsPlaced || '0', 10),
                wallsBroken: parseInt(data.wallsBroken || '0', 10),
                moveCount: parseInt(data.moveCount || '0', 10),
                replay: data.replay || null
            });
            if (!result) return sendJson(res, 404, { success: false, reason: 'User not found' });
            sendJson(res, 200, { success: true, user: result.user, eloDelta: result.eloDelta, match: result.matchRecord });
        });
        return;
    }

    // 4f. Fetch Match Replay
    if (req.method === 'GET' && reqPath === '/api/replay') {
        const matchId = parsedUrl.query.matchId;
        if (!matchId) return sendJson(res, 400, { success: false, reason: 'Missing matchId' });
        const replay = db.getReplay(matchId);
        if (!replay) return sendJson(res, 404, { success: false, reason: 'Replay not found' });
        sendJson(res, 200, { success: true, replay });
        return;
    }

    // 5. Global Leaderboard
    if (req.method === 'GET' && reqPath === '/api/leaderboard') {
        const leaderboard = db.getLeaderboard(25);
        sendJson(res, 200, { success: true, leaderboard });
        return;
    }

    // 6. Platform Statistics (Clearly Separated Online Stats)
    if (req.method === 'POST' && reqPath === '/api/heartbeat') {
        parseJsonBody(req, (err, data) => {
            const clientId = data.clientId || clientIp;
            activeClients.set(clientId, {
                lastSeen: Date.now(),
                ip: clientIp,
                username: data.username || 'Guest',
                status: data.status || 'lobby',
                roomCode: data.roomCode || null
            });
            const inGameCount = Array.from(activeClients.values()).filter(c => c.status === 'game').length;
            const activeMatchesCount = Array.from(activeRooms.values()).filter(r => r.status === 'playing').length;
            const publicRoomsCount = Array.from(activeRooms.values()).filter(r => r.isPublic && r.status === 'waiting').length;

            sendJson(res, 200, {
                success: true,
                onlineCount: Math.max(activeClients.size, 1),
                humanOnlineCount: Math.max(activeClients.size, 1),
                aiAvailableCount: 100,
                activeMatchesCount,
                publicRoomsCount,
                inGameCount,
                roomsCount: activeRooms.size,
                queueCount: rankedQueue.length
            });
        });
        return;
    }

    if (req.method === 'GET' && reqPath === '/api/stats') {
        const inGameCount = Array.from(activeClients.values()).filter(c => c.status === 'game').length;
        const activeMatchesCount = Array.from(activeRooms.values()).filter(r => r.status === 'playing').length;
        const publicRoomsCount = Array.from(activeRooms.values()).filter(r => r.isPublic && r.status === 'waiting').length;

        sendJson(res, 200, {
            onlineCount: Math.max(activeClients.size, 1),
            humanOnlineCount: Math.max(activeClients.size, 1),
            aiAvailableCount: 100,
            activeMatchesCount,
            publicRoomsCount,
            inGameCount,
            roomsCount: activeRooms.size,
            queueCount: rankedQueue.length
        });
        return;
    }

    // 7. PUBLIC ROOM BROWSER ENDPOINT
    if (req.method === 'GET' && reqPath === '/api/rooms/public') {
        const publicList = [];
        const modeFilter = parsedUrl.query.mode;
        const gameplayFilter = parsedUrl.query.gameplay;

        for (const [code, r] of activeRooms.entries()) {
            if (r.isPublic && r.status === 'waiting' && !r.isBotMatch) {
                if (modeFilter && modeFilter !== 'all' && r.settings.mode !== modeFilter) continue;
                if (gameplayFilter && gameplayFilter !== 'all' && r.settings.gameplayMode !== gameplayFilter) continue;

                publicList.push({
                    code: r.code,
                    title: r.title,
                    hostName: r.hostName,
                    hostRating: r.hostRating || 1200,
                    mode: r.settings.mode || 'classic',
                    gameplayMode: r.settings.gameplayMode || 'breaking',
                    breakCost: r.settings.breakCost || 5,
                    walls: r.settings.walls || 10,
                    timeSec: r.settings.timeSec || 180,
                    hasPassword: !!r.password,
                    currentPlayers: (r.p1 ? 1 : 0) + (r.p2 ? 1 : 0) + (r.p3 ? 1 : 0) + (r.p4 ? 1 : 0),
                    maxPlayers: r.maxPlayers,
                    status: r.status,
                    createdAt: r.createdAt
                });
            }
        }
        sendJson(res, 200, { success: true, rooms: publicList });
        return;
    }

    // 8. Ranked Matchmaking Queue
    if (req.method === 'POST' && reqPath === '/api/matchmaking/join') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.clientId) return sendJson(res, 400, { error: 'Missing clientId' });
            const clientId = data.clientId;
            const username = data.username || 'Player';
            const userId = data.userId || null;
            const rating = parseInt(data.rating || '1200', 10);

            // Clean previous entry
            const idx = rankedQueue.findIndex(q => q.clientId === clientId);
            if (idx !== -1) rankedQueue.splice(idx, 1);

            // If another human is waiting, pair them immediately!
            if (rankedQueue.length > 0) {
                const opp = rankedQueue.shift();
                const roomCode = 'FORT-R' + Math.floor(1000 + Math.random() * 9000);

                const room = createServerRoom({
                    code: roomCode,
                    title: `Ranked Match: ${opp.username} vs ${username}`,
                    isPublic: false,
                    hostName: opp.username,
                    hostUserId: opp.userId,
                    hostRating: opp.rating,
                    settings: {
                        mode: 'classic',
                        gameplayMode: 'breaking',
                        breakCost: 5,
                        timeSec: 180,
                        walls: 10,
                        isRanked: true
                    },
                    p1: opp.username,
                    p2: username,
                    isBotMatch: false
                });
                room.playerUserIds[2] = userId;

                matchedPairs.set(opp.clientId, {
                    matched: true,
                    roomCode,
                    role: 1,
                    opponent: { username, rating, isBot: false }
                });

                return sendJson(res, 200, {
                    matched: true,
                    roomCode,
                    role: 2,
                    opponent: { username: opp.username, rating: opp.rating, isBot: false }
                });
            } else {
                rankedQueue.push({ clientId, userId, username, rating, joinedAt: Date.now() });
                return sendJson(res, 200, { matched: false, queueLength: rankedQueue.length });
            }
        });
        return;
    }

    if ((req.method === 'GET' || req.method === 'POST') && reqPath === '/api/matchmaking/poll') {
        const handlePoll = (clientId) => {
            if (clientId && matchedPairs.has(clientId)) {
                const matchInfo = matchedPairs.get(clientId);
                matchedPairs.delete(clientId);
                return sendJson(res, 200, { matched: true, ...matchInfo });
            }
            return sendJson(res, 200, { matched: false, queueLength: rankedQueue.length });
        };

        if (req.method === 'POST') {
            parseJsonBody(req, (err, data) => {
                const cid = (data && data.clientId) || parsedUrl.query.clientId;
                handlePoll(cid);
            });
        } else {
            handlePoll(parsedUrl.query.clientId);
        }
        return;
    }

    if (req.method === 'POST' && reqPath === '/api/matchmaking/leave') {
        parseJsonBody(req, (err, data) => {
            const clientId = data.clientId;
            if (clientId) {
                const idx = rankedQueue.findIndex(q => q.clientId === clientId);
                if (idx !== -1) rankedQueue.splice(idx, 1);
                matchedPairs.delete(clientId);
            }
            sendJson(res, 200, { success: true });
        });
        return;
    }

    // 9. Custom Room Creation (Supports Public/Private and Optional Password)
    if (req.method === 'POST' && reqPath === '/api/rooms/create') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.code) return sendJson(res, 400, { error: 'Missing room code' });
            const code = data.code.toUpperCase();
            const hostUser = data.userId ? db.getUser(data.userId) : null;
            const hostRating = hostUser ? hostUser.rating : 1200;

            const room = createServerRoom({
                code,
                title: data.title || `${data.hostName || 'Host'}'s Arena`,
                isPublic: data.isPublic !== false,
                password: data.password || null,
                hostName: data.hostName || 'Host',
                hostUserId: data.userId || null,
                hostRating,
                settings: data.settings || {},
                p1: data.hostName || 'Host',
                isBotMatch: false
            });
            sendJson(res, 200, { success: true, room: serializeRoom(room) });
        });
        return;
    }

    // 10. Join Room (With Password Verification & Capacity Checks)
    if (req.method === 'POST' && reqPath === '/api/rooms/join') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.code) return sendJson(res, 400, { error: 'Missing room code' });
            const code = data.code.toUpperCase();
            const room = activeRooms.get(code);

            if (!room) {
                return sendJson(res, 404, { success: false, reason: 'Room code not found or expired' });
            }

            if (room.status !== 'waiting') {
                return sendJson(res, 403, { success: false, reason: 'Match is already in progress' });
            }

            // Password check
            if (room.password) {
                if (!data.password || data.password !== room.password) {
                    return sendJson(res, 401, { success: false, reason: 'Incorrect room password' });
                }
            }

            const guestName = data.guestName || 'Player';
            let assignedRole = null;

            if (!room.p2) {
                room.p2 = guestName;
                room.playerUserIds[2] = data.userId || null;
                assignedRole = 2;
                if (room.maxPlayers === 2) room.status = 'playing';
            } else if (room.maxPlayers === 4 && !room.p3) {
                room.p3 = guestName;
                room.playerUserIds[3] = data.userId || null;
                assignedRole = 3;
            } else if (room.maxPlayers === 4 && !room.p4) {
                room.p4 = guestName;
                room.playerUserIds[4] = data.userId || null;
                assignedRole = 4;
                room.status = 'playing';
            } else {
                return sendJson(res, 403, { success: false, reason: 'Room is already full' });
            }

            room.lastUpdate = Date.now();
            broadcastToRoom(code, {
                type: 'player_joined',
                role: assignedRole,
                username: guestName,
                status: room.status
            });

            sendJson(res, 200, { success: true, room: serializeRoom(room), role: assignedRole });
        });
        return;
    }

    // 11. Authoritative Move Submission (HTTP Fallback)
    if (req.method === 'POST' && reqPath === '/api/rooms/move') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.code || !data.move) return sendJson(res, 400, { error: 'Missing move data' });
            const code = data.code.toUpperCase();
            const room = activeRooms.get(code);
            if (!room) return sendJson(res, 404, { success: false, reason: 'Room not found' });

            const result = applyAuthoritativeMove(room, data.player, data.move);
            sendJson(res, result.success ? 200 : 400, result);
        });
        return;
    }

    // 12. Room Polling (HTTP Fallback)
    if (req.method === 'GET' && reqPath === '/api/rooms/poll') {
        const code = (parsedUrl.query.code || '').toUpperCase();
        const since = parseInt(parsedUrl.query.since || '0', 10);
        const room = activeRooms.get(code);
        if (!room) return sendJson(res, 404, { success: false, reason: 'Room not found' });

        const newMoves = room.moves.slice(since);
        sendJson(res, 200, {
            success: true,
            status: room.status,
            maxPlayers: room.maxPlayers,
            p1: room.p1,
            p2: room.p2,
            p3: room.p3,
            p4: room.p4,
            moves: newMoves,
            totalMoves: room.moves.length,
            turn: room.game.turn,
            winner: room.game.winner,
            winReason: room.game.winReason
        });
        return;
    }

    // 13. Spectator Active Rooms List
    if (req.method === 'GET' && reqPath === '/api/spectate/rooms') {
        const list = [];
        for (const [code, r] of activeRooms.entries()) {
            if (r.status === 'playing') {
                list.push({
                    code,
                    title: r.title,
                    mode: r.settings.mode || 'classic',
                    gameplayMode: r.settings.gameplayMode || 'breaking',
                    p1: r.p1,
                    p2: r.p2,
                    p3: r.p3,
                    p4: r.p4,
                    moveCount: r.moves.length,
                    spectators: r.spectators || 0
                });
            }
        }
        sendJson(res, 200, { success: true, rooms: list });
        return;
    }

    // 14. Replay Retrieval
    if (req.method === 'GET' && reqPath.startsWith('/api/replays/')) {
        const matchId = reqPath.split('/api/replays/')[1];
        const replay = db.getReplay(matchId);
        if (!replay) return sendJson(res, 404, { success: false, reason: 'Replay not found' });
        sendJson(res, 200, { success: true, replay });
        return;
    }

    // ==========================================
    // STATIC FILE SERVING
    // ==========================================
    let filePathStr = reqPath === '/' ? '/index.html' : reqPath;
    const safePath = path.normalize(filePathStr).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const headers = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        };
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            headers['Clear-Site-Data'] = '"cache"';
        }
        res.writeHead(200, headers);

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

// ==========================================
// SERVER-AUTHORITATIVE ENGINE VALIDATION
// ==========================================
function applyAuthoritativeMove(room, playerRole, move) {
    if (room.game.winner) {
        return { success: false, reason: 'Match already finished' };
    }
    if (room.game.turn !== playerRole) {
        return { success: false, reason: `Not your turn (Current turn: P${room.game.turn})` };
    }

    let result = { success: false };
    if (move.type === 'move') {
        result = room.game.makePawnMove(move.x, move.y);
    } else if (move.type === 'wall') {
        result = room.game.placeWall(move.gx, move.gy, move.orientation);
    } else if (move.type === 'break') {
        result = room.game.breakWall(move.wallIndex, playerRole);
    } else {
        return { success: false, reason: 'Unknown move type' };
    }

    if (!result.success) {
        return { success: false, reason: result.reason || 'Illegal move' };
    }

    const moveRecord = {
        player: playerRole,
        move,
        index: room.moves.length,
        timestamp: Date.now()
    };
    room.moves.push(moveRecord);
    room.lastUpdate = Date.now();

    // Check if match ended
    let matchFinalResult = null;
    if (room.game.winner) {
        room.status = 'finished';

        // Record Ranked progression (+30 Win / -30 Loss)
        let eloUpdates = {};
        if (room.isRanked) {
            for (let p = 1; p <= room.maxPlayers; p++) {
                const uId = room.playerUserIds[p];
                if (uId) {
                    const isWin = (p === room.game.winner);
                    const update = db.recordMatchResult(uId, isWin);
                    if (update) eloUpdates[p] = update;
                }
            }

            // Update persistent AI rating if bot match
            if (room.isBotMatch && room.botProfile) {
                const isBotWin = (room.game.winner === 2);
                db.recordAiMatchResult(room.botProfile.username, isBotWin, isBotWin ? 30 : -30);
            }
        }

        // Save match and replay to persistent DB
        const savedMatch = db.saveMatch({
            roomCode: room.code,
            mode: room.settings.mode || 'classic',
            gameplayMode: room.settings.gameplayMode || 'breaking',
            breakCost: room.settings.breakCost || 5,
            isRanked: room.isRanked,
            players: [
                { role: 1, username: room.p1, userId: room.playerUserIds[1] },
                { role: 2, username: room.p2, userId: room.playerUserIds[2] }
            ],
            winner: room.game.winner,
            winReason: room.game.winReason,
            moveCount: room.moves.length,
            durationSec: Math.round((Date.now() - room.createdAt) / 1000),
            replay: {
                initialState: {
                    mode: room.settings.mode,
                    walls: room.settings.walls
                },
                moves: room.moves,
                history: room.game.history
            }
        });

        matchFinalResult = {
            winner: room.game.winner,
            winReason: room.game.winReason,
            matchId: savedMatch.id,
            eloUpdates
        };
    }

    // Broadcast verified move to all room members over WebSockets
    broadcastToRoom(room.code, {
        type: 'move_broadcast',
        roomCode: room.code,
        player: playerRole,
        move,
        moveIndex: room.moves.length,
        turn: room.game.turn,
        winner: room.game.winner,
        winReason: room.game.winReason,
        matchFinalResult
    });

    return {
        success: true,
        moveIndex: room.moves.length,
        turn: room.game.turn,
        winner: room.game.winner,
        matchFinalResult
    };
}

// ==========================================
// WEBSOCKET SERVER IMPLEMENTATION
// ==========================================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    let clientSession = {
        ws,
        clientId: null,
        roomCode: null,
        role: null,
        username: 'Guest',
        isSpectator: false
    };

    ws.on('message', (messageRaw) => {
        try {
            const data = JSON.parse(messageRaw);

            // 1. Join Room channel
            if (data.type === 'join_room') {
                const code = (data.code || '').toUpperCase();
                const room = activeRooms.get(code);
                if (!room) {
                    return ws.send(JSON.stringify({ type: 'error', reason: 'Room not found' }));
                }

                clientSession.clientId = data.clientId;
                clientSession.roomCode = code;
                clientSession.role = data.role;
                clientSession.username = data.username || 'Player';
                clientSession.isSpectator = !!data.isSpectator;

                if (!roomSockets.has(code)) roomSockets.set(code, new Set());
                roomSockets.get(code).add(clientSession);

                if (clientSession.isSpectator) {
                    room.spectators = (room.spectators || 0) + 1;
                }

                ws.send(JSON.stringify({
                    type: 'room_joined',
                    room: serializeRoom(room),
                    state: room.game.serialize(),
                    moves: room.moves
                }));

                broadcastToRoom(code, {
                    type: 'presence_update',
                    spectators: room.spectators || 0
                });
            }

            // 2. Authoritative Move
            else if (data.type === 'make_move') {
                const code = clientSession.roomCode;
                const room = activeRooms.get(code);
                if (!room) return ws.send(JSON.stringify({ type: 'move_error', reason: 'Room not found' }));

                const result = applyAuthoritativeMove(room, data.player || clientSession.role, data.move);
                if (!result.success) {
                    ws.send(JSON.stringify({ type: 'move_error', reason: result.reason }));
                }
            }

            // 3. In-Game Real-Time Chat (Human-to-Human ONLY, never bot matches!)
            else if (data.type === 'chat') {
                const code = clientSession.roomCode;
                const room = activeRooms.get(code);
                if (!code || !data.text) return;

                // Explicit Requirement: AI matches have chat strictly disabled
                if (room && room.isBotMatch) {
                    return;
                }

                const cleanText = String(data.text).slice(0, 120).trim();
                broadcastToRoom(code, {
                    type: 'chat_broadcast',
                    sender: clientSession.username,
                    role: clientSession.role,
                    text: cleanText,
                    timestamp: Date.now()
                });
            }

            // 4. Heartbeat / Ping
            else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (e) {
            console.error('Error handling WS message:', e);
        }
    });

    ws.on('close', () => {
        if (clientSession.roomCode) {
            const sockets = roomSockets.get(clientSession.roomCode);
            if (sockets) {
                sockets.delete(clientSession);
                const room = activeRooms.get(clientSession.roomCode);
                if (room && clientSession.isSpectator) {
                    room.spectators = Math.max(0, (room.spectators || 1) - 1);
                }
                broadcastToRoom(clientSession.roomCode, {
                    type: 'player_left',
                    role: clientSession.role,
                    username: clientSession.username
                });
            }
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log('====================================================');
    console.log('🎮 FORTIVEX SERVER ACTIVE (WebSockets + Authoritative Engine)');
    console.log(`📡 Listening on:   http://${HOST}:${PORT}`);
    console.log(`🌐 Local URL:       http://localhost:${PORT}`);
    console.log('====================================================');
});
