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
const { FORTIVEX_RANKS, getRankBadgeSvg, getRankForRating } = require('./ranks.js');
const { verifyGoogleIdToken } = require('./auth_google.js');

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
const rankedQueue = [];           // Array of { clientId, userId, username, rating, mode, gameplayMode, breakCost, joinedAt, canOptInBot }
const matchedPairs = new Map();   // clientId -> match payload

// Simple In-Memory IP Rate Limiter
const ipRequestCounts = new Map();
function checkRateLimit(ip) {
    const now = Date.now();
    let record = ipRequestCounts.get(ip);
    if (!record || now - record.resetTime > 60000) {
        record = { count: 1, resetTime: now };
        ipRequestCounts.set(ip, record);
        return true;
    }
    record.count++;
    if (record.count > 240) { // 240 requests/min max
        return false;
    }
    return true;
}

// Clean inactive sessions & flag bot opt-in eligibility after 15s wait
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

    // 3. Human-First Ranked Matchmaking:
    // If a player has waited >= 15 seconds with no matching human opponent,
    // flag canOptInBot = true so the client can present an EXPLICIT choice to the user:
    // "Practice vs Fortivex AI (Ranked Practice Bot)" or "Keep Searching".
    // DO NOT deceptively force a bot match!
    for (const item of rankedQueue) {
        if (now - item.joinedAt >= 15000) {
            item.canOptInBot = true;
        }
    }
}, 2000);

// ==========================================
// SERVER-AUTHORITATIVE TURN CLOCKS & GRACE TIMER (1s LOOP)
// ==========================================
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of activeRooms.entries()) {
        if (room.status !== 'playing' || !room.game || room.game.winner) continue;

        // 1. Tick current player's clock
        const currentTurn = room.game.turn;
        if (room.timers && room.timers[currentTurn] !== undefined) {
            room.timers[currentTurn] = Math.max(0, room.timers[currentTurn] - 1);

            // Timeout check
            if (room.timers[currentTurn] <= 0) {
                const loserRole = currentTurn;
                const winnerRole = (loserRole === 1) ? 2 : 1;
                finalizeRoomMatch(room, winnerRole, `Time out (Player ${loserRole} ran out of time)`);
                continue;
            }
        }

        // 2. Disconnect Grace Period Check (45s grace period)
        if (room.disconnectGrace && now >= room.disconnectGrace.expiresAt) {
            const disconnectedRole = room.disconnectGrace.role;
            const winnerRole = (disconnectedRole === 1) ? 2 : 1;
            finalizeRoomMatch(room, winnerRole, `Opponent disconnected (Abandonment timeout)`);
            room.disconnectGrace = null;
        }
    }
}, 1000);

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
    const initialTime = settings.timeSec || 180;

    const game = new BarricadeGame({
        gameMode: mode,
        gameplayMode: settings.gameplayMode || 'normal',
        breakCost: (settings.gameplayMode === 'breaking') ? (settings.breakCost || 5) : 0,
        initialWalls: settings.walls || (mode === 'koth' ? 5 : 10),
        timeControl: { initialSec: initialTime, incrementSec: 2 }
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
        spectators: 0,
        timers: { 1: initialTime, 2: initialTime, 3: initialTime, 4: initialTime },
        disconnectGrace: null
    };

    activeRooms.set(code, room);
    if (!roomSockets.has(code)) {
        roomSockets.set(code, new Set());
    }

    // Persist active room state for crash recovery
    db.persistActiveRoom(code, serializeRoomForPersistence(room));

    return room;
}

function serializeRoomForPersistence(room) {
    if (!room) return null;
    return {
        code: room.code,
        title: room.title,
        isPublic: room.isPublic,
        password: room.password,
        hasPassword: !!room.password,
        hostName: room.hostName,
        hostUserId: room.hostUserId,
        hostRating: room.hostRating,
        settings: room.settings,
        maxPlayers: room.maxPlayers,
        p1: room.p1,
        p2: room.p2,
        p3: room.p3,
        p4: room.p4,
        playerUserIds: room.playerUserIds,
        status: room.status,
        moves: room.moves,
        createdAt: room.createdAt,
        lastUpdate: room.lastUpdate,
        isRanked: room.isRanked,
        isBotMatch: room.isBotMatch,
        botProfile: room.botProfile,
        spectators: room.spectators || 0,
        timers: room.timers,
        gameState: room.game ? room.game.serialize() : null
    };
}

function restoreActiveRoomsFromPersistence() {
    try {
        const persisted = db.loadActiveRooms();
        const codes = Object.keys(persisted);
        if (codes.length > 0) {
            console.log(`[Fortivex Recovery] Restoring ${codes.length} active rooms from persistent storage...`);
            for (const code of codes) {
                const r = persisted[code];
                if (!r || (r.status !== 'playing' && r.status !== 'waiting')) continue;

                const game = new BarricadeGame({
                    gameMode: r.settings?.mode || 'classic',
                    gameplayMode: r.settings?.gameplayMode || 'normal',
                    breakCost: (r.settings?.gameplayMode === 'breaking') ? (r.settings?.breakCost || 5) : 0,
                    initialWalls: r.settings?.walls || (r.settings?.mode === 'koth' ? 5 : 10),
                    timeControl: { initialSec: r.settings?.timeSec || 180, incrementSec: 2 }
                });

                if (r.gameState) {
                    game.deserialize(r.gameState);
                }

                const restoredRoom = {
                    ...r,
                    game,
                    disconnectGrace: null
                };

                activeRooms.set(code, restoredRoom);
                if (!roomSockets.has(code)) {
                    roomSockets.set(code, new Set());
                }
            }
        }
    } catch (e) {
        console.error('[Fortivex Recovery] Error restoring active rooms:', e);
    }
}
restoreActiveRoomsFromPersistence();

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

    // Rate Limiting Protection
    if (!checkRateLimit(clientIp)) {
        return sendJson(res, 429, { error: 'Rate limit exceeded. Please wait a moment.' });
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    // Health Endpoint for Cloud Deployment & Monitoring
    if (req.method === 'GET' && reqPath === '/health') {
        return sendJson(res, 200, {
            status: 'healthy',
            uptime: Math.round(process.uptime()),
            memory: process.memoryUsage().rss,
            activeRooms: activeRooms.size,
            activeClients: activeClients.size,
            timestamp: Date.now()
        });
    }

    // 1. Centralized Identity: Guest Creation
    if (req.method === 'POST' && reqPath === '/api/auth/guest') {
        parseJsonBody(req, (err, data) => {
            const user = db.createGuestUser();
            sendJson(res, 200, { success: true, user });
        });
        return;
    }

    // 1b. Google Play Data Safety & Account Deletion Compliance
    if (req.method === 'POST' && reqPath === '/api/auth/delete-account') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.userId) return sendJson(res, 400, { success: false, reason: 'Missing userId' });
            for (let i = rankedQueue.length - 1; i >= 0; i--) {
                if (rankedQueue[i].userId === data.userId) {
                    rankedQueue.splice(i, 1);
                }
            }
            const result = db.deleteUserAccount(data.userId);
            sendJson(res, result.success ? 200 : 404, result);
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

    // 3. Genuine Google OAuth 2.0 Token Verification & Account Binding
    if (req.method === 'POST' && reqPath === '/api/auth/google') {
        parseJsonBody(req, async (err, data) => {
            const token = (data && (data.idToken || data.credential || data.token));
            if (!token) {
                return sendJson(res, 400, { success: false, reason: 'Missing Google ID token' });
            }
            try {
                const verification = await verifyGoogleIdToken(token);
                if (!verification.valid) {
                    return sendJson(res, 401, { success: false, reason: verification.error || 'Invalid Google token' });
                }

                const { googleId, email, name, avatar } = verification.user;
                let user = db.getUserBySocial('google', googleId);
                if (!user && data.userId) {
                    user = db.bindSocialAccount(data.userId, 'google', googleId, email, name);
                }
                if (!user) {
                    user = db.createGuestUser();
                    user = db.bindSocialAccount(user.id, 'google', googleId, email, name);
                }

                if (avatar && (!user.avatar || user.avatar === '💎')) {
                    user.avatar = avatar;
                }

                const sessionToken = db.createSession(user.id);
                user.sessionToken = sessionToken;
                db.saveUsers();

                return sendJson(res, 200, {
                    success: true,
                    user,
                    token: sessionToken
                });
            } catch (authErr) {
                return sendJson(res, 500, { success: false, reason: 'Authentication verification failed: ' + authErr.message });
            }
        });
        return;
    }

    // 3b. Centralized Logout & Session Revocation
    if (req.method === 'POST' && reqPath === '/api/auth/logout') {
        parseJsonBody(req, (err, data) => {
            const authHeader = req.headers['authorization'];
            let token = null;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.slice(7).trim();
            } else if (data && data.token) {
                token = data.token;
            }
            if (token) {
                db.invalidateSessionToken(token);
            }
            sendJson(res, 200, { success: true });
        });
        return;
    }

    // 3c. Centralized Identity: Social Login Mock / Endpoint
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

    // 4g. Centralized Competitive Ranks
    if (req.method === 'GET' && reqPath === '/api/ranks') {
        sendJson(res, 200, { success: true, ranks: FORTIVEX_RANKS });
        return;
    }

    // 4h. Update Profile (Avatar, Display Name, Country)
    if (req.method === 'POST' && reqPath === '/api/user/update-profile') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.userId) return sendJson(res, 400, { success: false, reason: 'Missing userId' });
            const user = db.getUser(data.userId);
            if (!user) return sendJson(res, 404, { success: false, reason: 'User not found' });
            if (data.avatar) user.avatar = data.avatar;
            if (data.country) user.country = data.country;
            if (data.displayName) {
                const clean = String(data.displayName).trim().slice(0, 15);
                if (clean.length >= 3 && !db.isUsernameTaken(clean, user.id)) {
                    user.displayName = clean;
                }
            }
            db.saveUsers();
            sendJson(res, 200, { success: true, user });
        });
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

            const totalOnline = activeClients.size + 100; // All 100 persistent profiles are counted as online players
            sendJson(res, 200, {
                success: true,
                onlineCount: totalOnline,
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
        const totalOnline = activeClients.size + 100;

        sendJson(res, 200, {
            onlineCount: totalOnline,
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

    // 8. Ranked Matchmaking Queue (Supports Mode Selection)
    if (req.method === 'POST' && reqPath === '/api/matchmaking/join') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.clientId) return sendJson(res, 400, { error: 'Missing clientId' });
            const clientId = data.clientId;
            const username = data.username || 'Player';
            const userId = data.userId || null;
            const rating = parseInt(data.rating || '1200', 10);
            const mode = data.mode || 'classic';
            const gameplayMode = data.gameplayMode || 'normal';
            const breakCost = (gameplayMode === 'breaking') ? parseInt(data.breakCost || '5', 10) : 0;

            // Clean previous entry
            const idx = rankedQueue.findIndex(q => q.clientId === clientId);
            if (idx !== -1) rankedQueue.splice(idx, 1);

            // If another human is waiting in compatible mode, pair them immediately!
            const matchIdx = rankedQueue.findIndex(q => q.mode === mode && q.gameplayMode === gameplayMode);
            if (matchIdx !== -1) {
                const opp = rankedQueue.splice(matchIdx, 1)[0];
                const roomCode = 'FORT-R' + Math.floor(1000 + Math.random() * 9000);

                const room = createServerRoom({
                    code: roomCode,
                    title: `Ranked Match: ${opp.username} vs ${username}`,
                    isPublic: false,
                    hostName: opp.username,
                    hostUserId: opp.userId,
                    hostRating: opp.rating,
                    settings: {
                        mode,
                        gameplayMode,
                        breakCost,
                        timeSec: 180,
                        walls: (mode === 'koth') ? 5 : 10,
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
                rankedQueue.push({ clientId, userId, username, rating, mode, gameplayMode, breakCost, joinedAt: Date.now(), canOptInBot: false });
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
            const item = rankedQueue.find(q => q.clientId === clientId);
            const waitSec = item ? Math.floor((Date.now() - item.joinedAt) / 1000) : 0;
            const canOptInBot = item ? !!item.canOptInBot : false;
            return sendJson(res, 200, { matched: false, queueLength: rankedQueue.length, waitSec, canOptInBot });
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

    // Explicit User Choice to practice against clearly labeled AI bot
    if (req.method === 'POST' && reqPath === '/api/matchmaking/optin-bot') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.clientId) return sendJson(res, 400, { error: 'Missing clientId' });
            const idx = rankedQueue.findIndex(q => q.clientId === data.clientId);
            let item;
            if (idx !== -1) {
                item = rankedQueue.splice(idx, 1)[0];
            } else {
                item = data;
            }
            const botProfile = db.getAiProfileForMatch(item.rating || 1200);
            const roomCode = 'FORT-R' + Math.floor(1000 + Math.random() * 9000);
            const room = createServerRoom({
                code: roomCode,
                title: `Practice Match: ${item.username} vs [AI] ${botProfile.username}`,
                isPublic: false,
                hostName: item.username,
                hostUserId: item.userId,
                hostRating: item.rating || 1200,
                settings: {
                    mode: item.mode || 'classic',
                    gameplayMode: item.gameplayMode || 'normal',
                    breakCost: item.breakCost || 0,
                    timeSec: 180,
                    walls: (item.mode === 'koth') ? 5 : 10,
                    isRanked: true
                },
                p1: item.username,
                p2: botProfile.username,
                isBotMatch: true,
                botProfile
            });

            const matchInfo = {
                matched: true,
                roomCode,
                role: 1,
                settings: room.settings,
                opponent: {
                    username: botProfile.username,
                    displayName: `${botProfile.username} (AI Bot)`,
                    rating: botProfile.rating,
                    avatar: botProfile.avatar || '🤖',
                    isBot: true,
                    difficulty: botProfile.difficulty,
                    playstyle: botProfile.playstyle
                }
            };
            matchedPairs.set(item.clientId, matchInfo);
            sendJson(res, 200, matchInfo);
        });
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
function finalizeRoomMatch(room, winnerRole, winReason) {
    if (room.status === 'finished') return null;
    room.status = 'finished';
    room.game.winner = winnerRole;
    room.game.winReason = winReason;
    room.lastUpdate = Date.now();

    // Record Ranked progression (+30 Win / -30 Loss)
    let eloUpdates = {};
    if (room.isRanked) {
        for (let p = 1; p <= room.maxPlayers; p++) {
            const uId = room.playerUserIds[p];
            if (uId) {
                const isWin = (p === winnerRole);
                const update = db.recordMatchResult(uId, isWin);
                if (update) eloUpdates[p] = update;
            }
        }

        // Update persistent AI rating if bot match
        if (room.isBotMatch && room.botProfile) {
            const isBotWin = (winnerRole === 2);
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
        winner: winnerRole,
        winReason: winReason,
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

    const matchFinalResult = {
        winner: winnerRole,
        winReason: winReason,
        matchId: savedMatch.id,
        eloUpdates
    };

    // Remove finished match from crash recovery store
    db.removeActiveRoom(room.code);

    broadcastToRoom(room.code, {
        type: 'match_finished',
        roomCode: room.code,
        winner: winnerRole,
        winReason: winReason,
        matchFinalResult
    });

    return matchFinalResult;
}

function applyAuthoritativeMove(room, playerRole, move) {
    if (room.game.winner) {
        return { success: false, reason: 'Match already finished' };
    }
    if (room.game.turn !== playerRole) {
        return { success: false, reason: `Not your turn (Current turn: P${room.game.turn})` };
    }

    // Protection against duplicate replayed move
    if (move.clientMoveIndex !== undefined && move.clientMoveIndex < room.moves.length) {
        return { success: false, reason: 'Duplicate move already executed' };
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

    // Turn clock increment (+2s for completing legal move)
    if (room.timers && room.timers[playerRole] !== undefined) {
        room.timers[playerRole] += 2;
    }

    const moveRecord = {
        player: playerRole,
        move,
        index: room.moves.length,
        timestamp: Date.now()
    };
    room.moves.push(moveRecord);
    room.lastUpdate = Date.now();

    // Check if match ended by goal reached
    let matchFinalResult = null;
    if (room.game.winner) {
        matchFinalResult = finalizeRoomMatch(room, room.game.winner, room.game.winReason);
    } else {
        // Persist updated game state for crash recovery
        db.persistActiveRoom(room.code, serializeRoomForPersistence(room));
    }

    // Broadcast verified move to all room members over WebSockets
    broadcastToRoom(room.code, {
        type: 'move_broadcast',
        roomCode: room.code,
        player: playerRole,
        move,
        moveIndex: room.moves.length,
        turn: room.game.turn,
        timers: room.timers,
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

                if (room.password && room.password !== data.password) {
                    return ws.send(JSON.stringify({ type: 'error', reason: 'Incorrect room password' }));
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
                    moves: room.moves,
                    timers: room.timers
                }));

                broadcastToRoom(code, {
                    type: 'presence_update',
                    spectators: room.spectators || 0
                });
            }

            // 1b. Reconnect to ongoing match after network interruption
            else if (data.type === 'reconnect_room') {
                const code = (data.code || '').toUpperCase();
                const room = activeRooms.get(code);
                if (!room) {
                    return ws.send(JSON.stringify({ type: 'reconnect_error', reason: 'Room expired or not found' }));
                }

                const role = parseInt(data.role, 10);
                clientSession.clientId = data.clientId;
                clientSession.roomCode = code;
                clientSession.role = role;
                clientSession.username = data.username || (role === 1 ? room.p1 : room.p2);

                if (!roomSockets.has(code)) roomSockets.set(code, new Set());
                roomSockets.get(code).add(clientSession);

                // Cancel disconnect grace if matching role reconnected!
                if (room.disconnectGrace && room.disconnectGrace.role === role) {
                    room.disconnectGrace = null;
                }

                ws.send(JSON.stringify({
                    type: 'room_reconnected',
                    room: serializeRoom(room),
                    state: room.game.serialize(),
                    moves: room.moves,
                    timers: room.timers,
                    turn: room.game.turn,
                    status: room.status
                }));

                broadcastToRoom(code, {
                    type: 'player_reconnected',
                    role,
                    username: clientSession.username
                }, ws);
            }

            // 2. Authoritative Move
            else if (data.type === 'make_move') {
                const code = clientSession.roomCode;
                const room = activeRooms.get(code);
                if (!room) return ws.send(JSON.stringify({ type: 'move_error', reason: 'Room not found' }));

                if (clientSession.isSpectator || !clientSession.role) {
                    return ws.send(JSON.stringify({ type: 'move_error', reason: 'Spectators cannot make moves' }));
                }

                // Strictly enforce session role to eliminate role spoofing
                const playerRole = clientSession.role;
                const result = applyAuthoritativeMove(room, playerRole, data.move);
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
                if (room) {
                    if (clientSession.isSpectator) {
                        room.spectators = Math.max(0, (room.spectators || 1) - 1);
                    } else if (room.status === 'playing' && !room.game.winner && !room.isBotMatch) {
                        // Start 45-second reconnect grace period
                        room.disconnectGrace = {
                            role: clientSession.role,
                            username: clientSession.username,
                            expiresAt: Date.now() + 45000
                        };
                        broadcastToRoom(clientSession.roomCode, {
                            type: 'player_disconnected',
                            role: clientSession.role,
                            username: clientSession.username,
                            graceSeconds: 45
                        });
                        return;
                    }
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

// Graceful Process Termination
function gracefulShutdown(signal) {
    console.log(`\nReceived ${signal}. Gracefully shutting down Fortivex server...`);
    for (const [code, sockets] of roomSockets.entries()) {
        for (const client of sockets) {
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(JSON.stringify({ type: 'server_shutdown', message: 'Server restarting' }));
                    client.ws.close(1001, 'Server shutting down');
                } catch (e) {}
            }
        }
    }
    try {
        db.saveUsers();
        db.saveMatches();
        db.saveReplays();
        db.saveSessions();
    } catch (e) {
        console.error('Error saving DB during shutdown:', e);
    }
    server.close(() => {
        console.log('HTTP and WebSocket server closed.');
        process.exit(0);
    });
    setTimeout(() => {
        process.exit(0);
    }, 3000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
    console.log('====================================================');
    console.log('🎮 FORTIVEX SERVER ACTIVE (WebSockets + Authoritative Engine)');
    console.log(`📡 Listening on:   http://${HOST}:${PORT}`);
    console.log(`🌐 Local URL:       http://localhost:${PORT}`);
    console.log('====================================================');
});
