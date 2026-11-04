const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const HOST = '0.0.0.0'; // Binds to all interfaces so phones can connect
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
const activeClients = new Map(); // clientId -> { lastSeen, ip, username, status, roomCode }
const activeRooms = new Map();   // roomCode -> { code, hostName, settings, p1, p2, p3, p4, status, moves, lastUpdate }

// Real Online Ranked Matchmaking Queue
const rankedQueue = [];          // Array of { clientId, username, rating, joinedAt }
const matchedPairs = new Map();  // clientId -> { roomCode, role, opponent: { username, rating } }

// Clean inactive sessions every 5 seconds
setInterval(() => {
    const now = Date.now();
    for (const [id, c] of activeClients.entries()) {
        if (now - c.lastSeen > 14000) {
            activeClients.delete(id);
        }
    }
    for (const [code, r] of activeRooms.entries()) {
        if (now - r.lastUpdate > 10 * 60 * 1000) { // 10 min room timeout
            activeRooms.delete(code);
        }
    }
    // Clean stale matchmaking queue
    for (let i = rankedQueue.length - 1; i >= 0; i--) {
        if (now - rankedQueue[i].joinedAt > 60000) {
            rankedQueue.splice(i, 1);
        }
    }
}, 5000);

function parseJsonBody(req, callback) {
    let body = '';
    req.on('data', chunk => {
        body += chunk;
        if (body.length > 1e6) req.destroy(); // 1MB protection
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
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const parsedUrl = url.parse(req.url, true);
    const reqPath = parsedUrl.pathname;

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // ==========================================
    // REAL DATA API ENDPOINTS
    // ==========================================

    // 1. Heartbeat from client (updates real online & in-game counters)
    if (req.method === 'POST' && reqPath === '/api/heartbeat') {
        parseJsonBody(req, (err, data) => {
            if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
            const clientId = data.clientId || clientIp;
            activeClients.set(clientId, {
                lastSeen: Date.now(),
                ip: clientIp,
                username: data.username || 'Guest',
                status: data.status || 'lobby',
                roomCode: data.roomCode || null
            });

            const inGameCount = Array.from(activeClients.values()).filter(c => c.status === 'game').length;
            sendJson(res, 200, {
                success: true,
                onlineCount: activeClients.size,
                inGameCount: inGameCount,
                roomsCount: activeRooms.size,
                queueCount: rankedQueue.length
            });
        });
        return;
    }

    // 2. Query real live server stats
    if (req.method === 'GET' && reqPath === '/api/stats') {
        const inGameCount = Array.from(activeClients.values()).filter(c => c.status === 'game').length;
        sendJson(res, 200, {
            onlineCount: activeClients.size,
            inGameCount: inGameCount,
            roomsCount: activeRooms.size,
            queueCount: rankedQueue.length
        });
        return;
    }

    // 3. REAL ONLINE RANKED MATCHMAKING
    if (req.method === 'POST' && reqPath === '/api/matchmaking/join') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.clientId) return sendJson(res, 400, { error: 'Missing clientId' });
            const clientId = data.clientId;
            const username = data.username || 'Player';
            const rating = parseInt(data.rating || '1385', 10);

            // Remove any existing entry for this client
            const existingIdx = rankedQueue.findIndex(q => q.clientId === clientId);
            if (existingIdx !== -1) rankedQueue.splice(existingIdx, 1);

            // If another real player is in queue, pair them immediately!
            if (rankedQueue.length > 0) {
                const opp = rankedQueue.shift();
                const roomCode = 'RANK-' + Math.floor(1000 + Math.random() * 9000);

                const room = {
                    code: roomCode,
                    hostName: opp.username,
                    settings: { mode: 'classic', timeSec: 180, walls: 10, isRanked: true, hostColor: 'blue' },
                    p1: opp.username,
                    p2: username,
                    p3: null,
                    p4: null,
                    maxPlayers: 2,
                    status: 'playing',
                    moves: [],
                    lastUpdate: Date.now()
                };
                activeRooms.set(roomCode, room);

                // Notify host
                matchedPairs.set(opp.clientId, {
                    roomCode,
                    role: 1,
                    opponent: { username, rating }
                });

                // Return match to joiner
                return sendJson(res, 200, {
                    matched: true,
                    roomCode,
                    role: 2,
                    opponent: { username: opp.username, rating: opp.rating }
                });
            } else {
                // Wait in queue
                rankedQueue.push({ clientId, username, rating, joinedAt: Date.now() });
                return sendJson(res, 200, {
                    matched: false,
                    queueLength: rankedQueue.length
                });
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

    // 4. Build / Create Room
    if (req.method === 'POST' && reqPath === '/api/rooms/create') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.code) return sendJson(res, 400, { error: 'Missing room code' });
            const code = data.code.toUpperCase();
            const mode = data.settings?.mode || 'classic';
            const maxPlayers = mode === 'koth' ? 4 : 2;

            const room = {
                code,
                hostName: data.hostName || 'Host',
                settings: data.settings || {},
                maxPlayers: maxPlayers,
                p1: data.hostName || 'Host',
                p2: null,
                p3: null,
                p4: null,
                status: 'waiting',
                moves: [],
                lastUpdate: Date.now()
            };
            activeRooms.set(code, room);
            sendJson(res, 200, { success: true, room });
        });
        return;
    }

    // 5. Join Room (Supports 2-player Classic and 4-player King of the Hill)
    if (req.method === 'POST' && reqPath === '/api/rooms/join') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.code) return sendJson(res, 400, { error: 'Missing room code' });
            const code = data.code.toUpperCase();
            const room = activeRooms.get(code);

            if (!room) {
                return sendJson(res, 404, { success: false, reason: 'Room code not found' });
            }

            const guestName = data.guestName || 'Player';
            let assignedRole = null;

            if (!room.p2) {
                room.p2 = guestName;
                assignedRole = 2;
                if (room.maxPlayers === 2) room.status = 'playing';
            } else if (room.maxPlayers === 4 && !room.p3) {
                room.p3 = guestName;
                assignedRole = 3;
            } else if (room.maxPlayers === 4 && !room.p4) {
                room.p4 = guestName;
                assignedRole = 4;
                room.status = 'playing';
            } else {
                return sendJson(res, 403, { success: false, reason: 'Room is already full' });
            }

            room.lastUpdate = Date.now();
            sendJson(res, 200, { success: true, room, role: assignedRole });
        });
        return;
    }

    // 6. Send Move / Break Wall to Room
    if (req.method === 'POST' && reqPath === '/api/rooms/move') {
        parseJsonBody(req, (err, data) => {
            if (err || !data.code) return sendJson(res, 400, { error: 'Missing room data' });
            const code = data.code.toUpperCase();
            const room = activeRooms.get(code);

            if (!room) {
                return sendJson(res, 404, { success: false, reason: 'Room expired or not found' });
            }

            room.moves.push({
                player: data.player,
                move: data.move,
                index: room.moves.length,
                timestamp: Date.now()
            });
            room.lastUpdate = Date.now();

            sendJson(res, 200, { success: true, moveIndex: room.moves.length });
        });
        return;
    }

    // 7. Poll Room Updates & Opponent Moves
    if (req.method === 'GET' && reqPath === '/api/rooms/poll') {
        const code = (parsedUrl.query.code || '').toUpperCase();
        const since = parseInt(parsedUrl.query.since || '0', 10);
        const room = activeRooms.get(code);

        if (!room) {
            return sendJson(res, 404, { success: false, reason: 'Room not found' });
        }

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
            totalMoves: room.moves.length
        });
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

        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, HOST, () => {
    console.log('====================================================');
    console.log('🎮 BARRICADE GAME & MULTIPLAYER SERVER ACTIVE!');
    console.log('');
    console.log(`📱 On your Phone:   http://192.168.31.162:${PORT}`);
    console.log(`💻 On this PC:     http://localhost:${PORT}`);
    console.log('====================================================');
});
