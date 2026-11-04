/**
 * FORTIVEX — Data Persistence Layer (db.js)
 * Manages atomic persistence for:
 *   - Sequential user accounts (noob10001+)
 *   - Custom unique usernames & social logins
 *   - Ranked ratings (+30 / -30), win streaks, match statistics
 *   - Match history, move logs, and full match replays
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const MATCHES_FILE = path.join(DB_DIR, 'matches.json');
const REPLAYS_FILE = path.join(DB_DIR, 'replays.json');

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

function safeReadJson(filePath, defaultVal) {
    try {
        if (!fs.existsSync(filePath)) return defaultVal;
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw ? JSON.parse(raw) : defaultVal;
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
        return defaultVal;
    }
}

function safeWriteJson(filePath, data) {
    try {
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    } catch (e) {
        console.error(`Error writing ${filePath}:`, e);
    }
}

class FortivexDB {
    constructor() {
        this.users = safeReadJson(USERS_FILE, {});
        this.matches = safeReadJson(MATCHES_FILE, []);
        this.replays = safeReadJson(REPLAYS_FILE, {});
        this.meta = safeReadJson(path.join(DB_DIR, 'meta.json'), {
            nextUserId: 10101 // Starts after AI pool 10001..10100
        });
    }

    saveUsers() {
        safeWriteJson(USERS_FILE, this.users);
    }

    saveMatches() {
        safeWriteJson(MATCHES_FILE, this.matches);
    }

    saveReplays() {
        safeWriteJson(REPLAYS_FILE, this.replays);
    }

    saveMeta() {
        safeWriteJson(path.join(DB_DIR, 'meta.json'), this.meta);
    }

    // ==========================================
    // USER IDENTITY & PROGRESSION
    // ==========================================
    createGuestUser() {
        const idNum = this.meta.nextUserId++;
        this.saveMeta();

        const username = `noob${idNum}`;
        const userId = `usr_${idNum}_${Math.random().toString(36).substr(2, 6)}`;

        const user = {
            id: userId,
            idNum,
            username,
            displayName: username,
            rating: 1200,
            streak: 0,
            maxStreak: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            matchesPlayed: 0,
            isGuest: true,
            createdAt: Date.now(),
            lastActive: Date.now()
        };

        this.users[userId] = user;
        this.saveUsers();
        return user;
    }

    getUser(userId) {
        if (!userId) return null;
        return this.users[userId] || null;
    }

    getUserByUsername(username) {
        if (!username) return null;
        const lower = username.toLowerCase();
        for (const u of Object.values(this.users)) {
            if (u.username.toLowerCase() === lower) return u;
        }
        return null;
    }

    isUsernameTaken(username, excludeUserId = null) {
        const lower = username.toLowerCase();
        for (const u of Object.values(this.users)) {
            if (u.id !== excludeUserId && u.username.toLowerCase() === lower) {
                return true;
            }
        }
        return false;
    }

    claimCustomUsername(userId, newUsername) {
        const user = this.getUser(userId);
        if (!user) return { success: false, reason: 'User not found' };

        const trimmed = newUsername.trim();
        if (trimmed.length < 3 || trimmed.length > 15) {
            return { success: false, reason: 'Username must be 3-15 characters' };
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            return { success: false, reason: 'Only letters, numbers, hyphens, and underscores allowed' };
        }
        if (this.isUsernameTaken(trimmed, userId)) {
            return { success: false, reason: 'Username is already taken' };
        }

        user.username = trimmed;
        user.displayName = trimmed;
        user.isGuest = false;
        user.lastActive = Date.now();
        this.saveUsers();

        return { success: true, user };
    }

    bindSocialAccount(userId, provider, providerId, email, name) {
        let user = this.getUser(userId);
        if (!user) {
            user = this.createGuestUser();
        }

        user.social = user.social || {};
        user.social[provider] = {
            providerId,
            email,
            name,
            linkedAt: Date.now()
        };
        user.isGuest = false;
        if (name && user.username.startsWith('noob')) {
            const clean = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15);
            if (clean.length >= 3 && !this.isUsernameTaken(clean, user.id)) {
                user.username = clean;
                user.displayName = clean;
            }
        }
        this.saveUsers();
        return user;
    }

    // ==========================================
    // RANKED PROGRESSION (+30 WIN / -30 LOSS)
    // ==========================================
    recordMatchResult(userId, isWinner, isDraw = false) {
        const user = this.getUser(userId);
        if (!user) return null;

        user.matchesPlayed++;
        user.lastActive = Date.now();

        if (isDraw) {
            user.draws = (user.draws || 0) + 1;
            this.saveUsers();
            return { eloChange: 0, newRating: user.rating, streak: user.streak };
        }

        let eloChange = 0;
        if (isWinner) {
            eloChange = 30; // Exactly +30 for Win
            user.wins++;
            user.streak = (user.streak || 0) + 1;
            if (user.streak > (user.maxStreak || 0)) {
                user.maxStreak = user.streak;
            }
        } else {
            eloChange = -30; // Exactly -30 for Loss
            user.losses++;
            user.streak = 0; // Streak resets on loss
        }

        user.rating = Math.max(100, (user.rating || 1200) + eloChange);
        this.saveUsers();

        return {
            eloChange,
            newRating: user.rating,
            streak: user.streak,
            wins: user.wins,
            losses: user.losses
        };
    }

    // ==========================================
    // MATCH AUDIT & FULL REPLAY ARCHIVE
    // ==========================================
    saveMatch(matchData) {
        const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const record = {
            id: matchId,
            timestamp: Date.now(),
            roomCode: matchData.roomCode || null,
            mode: matchData.mode || 'classic',
            gameplayMode: matchData.gameplayMode || 'breaking',
            breakCost: matchData.breakCost || 5,
            isRanked: !!matchData.isRanked,
            players: matchData.players || [], // [{ userId, username, rating, role }]
            winner: matchData.winner, // player role (1, 2, 3, 4)
            winReason: matchData.winReason || 'Victory',
            moveCount: matchData.moveCount || 0,
            durationSec: matchData.durationSec || 0
        };

        this.matches.unshift(record);
        if (this.matches.length > 500) this.matches.pop(); // Retain latest 500 matches
        this.saveMatches();

        // Save serialized replay state snapshots & move logs
        if (matchData.replay) {
            this.replays[matchId] = {
                matchId,
                initialState: matchData.replay.initialState,
                moves: matchData.replay.moves || [],
                history: matchData.replay.history || []
            };
            this.saveReplays();
        }

        return record;
    }

    getReplay(matchId) {
        return this.replays[matchId] || null;
    }

    getRecentMatches(limit = 15) {
        return this.matches.slice(0, limit);
    }

    getUserMatches(username, limit = 15) {
        const lower = username.toLowerCase();
        return this.matches
            .filter(m => (m.players || []).some(p => (p.username || '').toLowerCase() === lower))
            .slice(0, limit);
    }

    getLeaderboard(limit = 20) {
        const allUsers = Object.values(this.users);
        allUsers.sort((a, b) => (b.rating || 1200) - (a.rating || 1200));
        return allUsers.slice(0, limit).map((u, rank) => ({
            rank: rank + 1,
            username: u.username,
            displayName: u.displayName || u.username,
            rating: u.rating || 1200,
            streak: u.streak || 0,
            wins: u.wins || 0,
            losses: u.losses || 0,
            matchesPlayed: u.matchesPlayed || 0
        }));
    }
}

const db = new FortivexDB();

module.exports = db;
