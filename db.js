/**
 * FORTIVEX — Data Persistence Layer (db.js)
 * Manages atomic persistence for:
 *   - 100 Persistent AI player profiles (noob10001 - noob10100)
 *   - Sequential user accounts (noob10101+)
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
const META_FILE = path.join(DB_DIR, 'meta.json');

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

const AI_PLAYSTYLES = [
    'Aggressive',
    'Defensive',
    'Balanced',
    'Tactical',
    'Barricade specialist',
    'Route-control specialist',
    'Adaptive',
    'High-risk',
    'Positional'
];

class FortivexDB {
    constructor() {
        this.users = safeReadJson(USERS_FILE, {});
        this.matches = safeReadJson(MATCHES_FILE, []);
        this.replays = safeReadJson(REPLAYS_FILE, {});
        this.meta = safeReadJson(META_FILE, {
            nextUserId: 10101
        });

        // Initialize and persist the 100 AI profiles
        this.initPersistentAiProfiles();
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
        safeWriteJson(META_FILE, this.meta);
    }

    // ==========================================
    // 100 PERSISTENT AI PROFILES (noob10001..noob10100)
    // ==========================================
    initPersistentAiProfiles() {
        let changed = false;

        for (let i = 0; i < 100; i++) {
            const idNum = 10001 + i;
            const username = `noob${idNum}`;
            const id = `ai_${idNum}`;

            // Check if this AI profile already exists in DB
            if (!this.users[id]) {
                // Tier distribution:
                // 10001..10025: Easy (820 - 1180)
                // 10026..10060: Medium (1200 - 1570)
                // 10061..10085: Hard (1600 - 1980)
                // 10086..10100: Impossible (2000 - 2450)
                let difficulty;
                let rating;

                if (i < 25) {
                    difficulty = 'easy';
                    rating = 820 + i * 15;
                } else if (i < 60) {
                    difficulty = 'medium';
                    rating = 1200 + (i - 25) * 11;
                } else if (i < 85) {
                    difficulty = 'hard';
                    rating = 1600 + (i - 60) * 16;
                } else {
                    difficulty = 'impossible';
                    rating = 2000 + (i - 85) * 30;
                }

                const wins = 20 + (i % 15);
                const losses = 15 + ((i * 3) % 18);
                const playstyle = AI_PLAYSTYLES[i % AI_PLAYSTYLES.length];

                this.users[id] = {
                    id,
                    idNum,
                    username,
                    displayName: username, // Strictly noob10001, NO strategy labels as usernames!
                    rating,
                    difficulty,
                    playstyle,
                    streak: (i % 3),
                    maxStreak: 3 + (i % 5),
                    wins,
                    losses,
                    draws: 0,
                    matchesPlayed: wins + losses,
                    isBot: true,
                    status: 'available',
                    createdAt: Date.now() - (100 - i) * 86400000,
                    lastActive: Date.now(),
                    matchHistory: []
                };
                changed = true;
            } else {
                // Ensure existing AI profile has required bot properties
                const existing = this.users[id];
                if (!existing.isBot) {
                    existing.isBot = true;
                    changed = true;
                }
                // Ensure displayName is strictly noobXXXXX
                if (existing.displayName !== existing.username) {
                    existing.displayName = existing.username;
                    changed = true;
                }
                if (!existing.status) {
                    existing.status = 'available';
                    changed = true;
                }
            }
        }

        if (changed) {
            this.saveUsers();
        }
    }

    getAllAiProfiles() {
        return Object.values(this.users).filter(u => u.isBot === true);
    }

    getAiProfileByUsername(username) {
        if (!username) return null;
        const lower = username.toLowerCase();
        for (const u of Object.values(this.users)) {
            if (u.isBot && u.username.toLowerCase() === lower) {
                return u;
            }
        }
        return null;
    }

    getAiProfileById(id) {
        return this.users[id] || null;
    }

    getAiProfileForMatch(userRating, preferredDifficulty = null) {
        const target = userRating || 1200;
        let aiPool = this.getAllAiProfiles();

        if (preferredDifficulty) {
            const diffPool = aiPool.filter(p => p.difficulty === preferredDifficulty);
            if (diffPool.length > 0) aiPool = diffPool;
        }

        // Find bot closest to target rating (within +/- 100 Elo first)
        const closeMatches = aiPool.filter(p => Math.abs(p.rating - target) <= 120);
        if (closeMatches.length > 0) {
            return closeMatches[Math.floor(Math.random() * closeMatches.length)];
        }

        // Fallback: closest bot overall
        let closest = aiPool[0];
        let minDiff = Math.abs(aiPool[0].rating - target);
        for (const p of aiPool) {
            const diff = Math.abs(p.rating - target);
            if (diff < minDiff) {
                minDiff = diff;
                closest = p;
            }
        }
        return closest;
    }

    // ==========================================
    // USER IDENTITY & PROGRESSION
    // ==========================================
    createGuestUser() {
        // Ensure nextUserId is strictly above 10100 (never collides with AI 10001..10100)
        if (this.meta.nextUserId <= 10100) {
            this.meta.nextUserId = 10101;
        }

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
            isBot: false,
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

    // Update AI profile rating after ranked bot match
    recordAiMatchResult(aiUsername, isWin, eloDelta = null) {
        const aiUser = this.getAiProfileByUsername(aiUsername);
        if (!aiUser) return null;

        const delta = eloDelta !== null ? eloDelta : (isWin ? 30 : -30);
        aiUser.rating = Math.max(100, aiUser.rating + delta);
        aiUser.matchesPlayed = (aiUser.matchesPlayed || 0) + 1;
        if (isWin) {
            aiUser.wins = (aiUser.wins || 0) + 1;
            aiUser.streak = (aiUser.streak || 0) + 1;
            if (aiUser.streak > (aiUser.maxStreak || 0)) aiUser.maxStreak = aiUser.streak;
        } else {
            aiUser.losses = (aiUser.losses || 0) + 1;
            aiUser.streak = 0;
        }
        aiUser.lastActive = Date.now();
        this.saveUsers();
        return aiUser;
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
            players: matchData.players || [],
            winner: matchData.winner,
            winReason: matchData.winReason || 'Victory',
            moveCount: matchData.moveCount || 0,
            durationSec: matchData.durationSec || 0
        };

        this.matches.unshift(record);
        if (this.matches.length > 500) this.matches.pop();
        this.saveMatches();

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
            matchesPlayed: u.matchesPlayed || 0,
            isBot: !!u.isBot
        }));
    }
}

const db = new FortivexDB();

module.exports = db;
