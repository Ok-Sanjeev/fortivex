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
const crypto = require('crypto');
const { FORTIVEX_RANKS, getRankBadgeSvg, getRankForRating } = require('./ranks.js');

const DB_DIR = path.join(__dirname, 'db');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const MATCHES_FILE = path.join(DB_DIR, 'matches.json');
const REPLAYS_FILE = path.join(DB_DIR, 'replays.json');
const META_FILE = path.join(DB_DIR, 'meta.json');
const SESSIONS_FILE = path.join(DB_DIR, 'sessions.json');

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

const ACHIEVEMENTS_DEF = [
    { id: 'first_win', name: 'First Victory', desc: 'Win your first match in Fortivex', icon: '🏆', max: 1 },
    { id: 'ten_wins', name: 'Tactical Aspirant', desc: 'Win 10 matches against humans or AI', icon: '⚔️', max: 10 },
    { id: 'fifty_wins', name: 'Veteran Strategist', desc: 'Win 50 matches across any mode', icon: '🛡️', max: 50 },
    { id: 'hundred_wins', name: 'Grandmaster Champion', desc: 'Achieve 100 victories', icon: '👑', max: 100 },
    { id: 'streak_3', name: 'On Fire', desc: 'Achieve a winning streak of 3 games', icon: '🔥', max: 3 },
    { id: 'streak_5', name: 'Unstoppable Momentum', desc: 'Achieve a 5-win streak', icon: '⚡', max: 5 },
    { id: 'wall_specialist', name: 'Barricade Specialist', desc: 'Place 50 strategic barricades', icon: '🧱', max: 50 },
    { id: 'breaking_expert', name: 'Breaking Expert', desc: 'Break 10 barricades in Breaking mode', icon: '💥', max: 10 },
    { id: 'ranked_warrior', name: 'Ranked Competitor', desc: 'Complete 5 competitive ranked matches', icon: '💎', max: 5 },
    { id: 'koth_master', name: 'King of the Hill Champion', desc: 'Win a 4-player King of the Hill center race', icon: '🤴', max: 1 },
    { id: 'puzzle_solver', name: 'Daily Challenge Champion', desc: 'Solve 3 daily tactical puzzles', icon: '🧩', max: 3 }
];

class FortivexDB {
    constructor() {
        this.users = safeReadJson(USERS_FILE, {});
        this.matches = safeReadJson(MATCHES_FILE, []);
        this.replays = safeReadJson(REPLAYS_FILE, {});
        this.sessions = safeReadJson(SESSIONS_FILE, {});
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

    saveSessions() {
        safeWriteJson(SESSIONS_FILE, this.sessions);
    }

    saveMeta() {
        safeWriteJson(META_FILE, this.meta);
    }

    // ==========================================
    // SECURE SESSION TOKEN MANAGEMENT
    // ==========================================
    createSession(userId) {
        if (!userId) return null;
        const token = 'fv_' + crypto.randomBytes(24).toString('hex');
        this.sessions[token] = {
            userId,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 86400000 // 30 days session
        };
        this.saveSessions();
        return token;
    }

    validateSessionToken(token) {
        if (!token || !this.sessions[token]) return null;
        const session = this.sessions[token];
        if (Date.now() > session.expiresAt) {
            delete this.sessions[token];
            this.saveSessions();
            return null;
        }
        return this.getUser(session.userId);
    }

    invalidateSessionToken(token) {
        if (token && this.sessions[token]) {
            delete this.sessions[token];
            this.saveSessions();
            return true;
        }
        return false;
    }

    // ==========================================
    // GOOGLE PLAY DATA SAFETY & ACCOUNT DELETION
    // ==========================================
    deleteUserAccount(userId) {
        const user = this.getUser(userId);
        if (!user) return { success: false, reason: 'User not found' };

        // 1. Invalidate all active sessions for this user
        for (const [token, sess] of Object.entries(this.sessions)) {
            if (sess.userId === userId) {
                delete this.sessions[token];
            }
        }
        this.saveSessions();

        // 2. Anonymize user records in archived matches (Data Minimization)
        for (const match of this.matches) {
            if (match.players) {
                for (const p of match.players) {
                    if (p.userId === userId) {
                        p.username = 'Deleted Player';
                        p.userId = null;
                    }
                }
            }
        }
        this.saveMatches();

        // 3. Delete user profile permanently
        delete this.users[userId];
        this.saveUsers();

        return { success: true, message: 'Account and associated data deleted' };
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
    ensureUserFields(user) {
        if (!user) return;
        user.avatar = user.avatar || '💎';
        user.rating = user.rating || 1200;
        user.peakRating = user.peakRating || Math.max(user.rating, 1200);
        user.streak = user.streak || 0;
        user.maxStreak = user.maxStreak || user.streak || 0;
        user.currentLosingStreak = user.currentLosingStreak || 0;
        user.wins = user.wins || 0;
        user.losses = user.losses || 0;
        user.draws = user.draws || 0;
        user.matchesPlayed = user.matchesPlayed || (user.wins + user.losses + user.draws);
        user.rankedPlayed = user.rankedPlayed !== undefined ? user.rankedPlayed : user.matchesPlayed;
        user.casualPlayed = user.casualPlayed || 0;
        user.aiDefeated = user.aiDefeated !== undefined ? user.aiDefeated : user.wins;
        user.humanDefeated = user.humanDefeated || 0;
        user.totalPlayTimeSec = user.totalPlayTimeSec || (user.matchesPlayed * 145);
        user.wallsPlacedTotal = user.wallsPlacedTotal || (user.matchesPlayed * 8);
        user.wallsBrokenTotal = user.wallsBrokenTotal || (user.matchesPlayed * 2);
        user.kothWins = user.kothWins || 0;
        user.puzzlesSolvedTotal = user.puzzlesSolvedTotal || 0;
        user.createdAt = user.createdAt || Date.now();
        user.lastActive = user.lastActive || Date.now();
        user.achievements = user.achievements || {};
        user.country = user.country || 'India';
        user.processedMatchIds = user.processedMatchIds || [];
        user.categoryStats = user.categoryStats || {
            ranked: { games: user.rankedPlayed || 0, wins: Math.round((user.wins || 0) * 0.8), losses: Math.round((user.losses || 0) * 0.8), draws: user.draws || 0, eloGain: (user.rating || 1200) - 1200 },
            casual: { games: user.casualPlayed || 0, wins: (user.wins || 0) - Math.round((user.wins || 0) * 0.8), losses: (user.losses || 0) - Math.round((user.losses || 0) * 0.8), draws: 0 },
            computer: {
                games: user.aiDefeated || 0,
                wins: user.aiDefeated || 0,
                losses: Math.max(0, (user.losses || 0) - (user.humanDefeated || 0)),
                byDifficulty: {
                    easy: { games: Math.ceil((user.aiDefeated || 0) * 0.4), wins: Math.ceil((user.aiDefeated || 0) * 0.4) },
                    medium: { games: Math.ceil((user.aiDefeated || 0) * 0.35), wins: Math.ceil((user.aiDefeated || 0) * 0.35) },
                    hard: { games: Math.ceil((user.aiDefeated || 0) * 0.2), wins: Math.ceil((user.aiDefeated || 0) * 0.2) },
                    impossible: { games: Math.floor((user.aiDefeated || 0) * 0.05), wins: Math.floor((user.aiDefeated || 0) * 0.05) }
                }
            },
            koth: { games: Math.max(user.kothWins || 0, 0), wins: user.kothWins || 0, losses: 0 },
            breaking: { games: Math.round((user.matchesPlayed || 0) * 0.5), wins: Math.round((user.wins || 0) * 0.5), losses: Math.round((user.losses || 0) * 0.5) }
        };
        if (!user.ratingHistory || user.ratingHistory.length === 0) {
            user.ratingHistory = [
                {
                    timestamp: user.createdAt,
                    rating: 1200,
                    delta: 0,
                    note: 'Account Created'
                }
            ];
            if (user.rating && user.rating !== 1200) {
                user.ratingHistory.push({
                    timestamp: Date.now(),
                    rating: user.rating,
                    delta: user.rating - 1200,
                    note: 'Current Progression'
                });
            }
        }
    }

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
            avatar: '💎',
            rating: 1200,
            peakRating: 1200,
            streak: 0,
            maxStreak: 0,
            currentLosingStreak: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            matchesPlayed: 0,
            rankedPlayed: 0,
            casualPlayed: 0,
            aiDefeated: 0,
            humanDefeated: 0,
            totalPlayTimeSec: 0,
            wallsPlacedTotal: 0,
            wallsBrokenTotal: 0,
            kothWins: 0,
            puzzlesSolvedTotal: 0,
            ratingHistory: [
                {
                    timestamp: Date.now(),
                    rating: 1200,
                    delta: 0,
                    note: 'Account Created'
                }
            ],
            achievements: {},
            isGuest: true,
            isBot: false,
            createdAt: Date.now(),
            lastActive: Date.now()
        };

        this.users[userId] = user;
        const sessionToken = this.createSession(userId);
        user.sessionToken = sessionToken;
        this.saveUsers();
        return user;
    }

    getUser(userId) {
        if (!userId) return null;
        const user = this.users[userId] || null;
        if (user) this.ensureUserFields(user);
        return user;
    }

    getUserByUsername(username) {
        if (!username) return null;
        const lower = username.toLowerCase();
        for (const u of Object.values(this.users)) {
            if (u.username.toLowerCase() === lower) {
                this.ensureUserFields(u);
                return u;
            }
        }
        return null;
    }

    updateAvatar(userId, avatar) {
        const user = this.getUser(userId);
        if (!user) return { success: false, reason: 'User not found' };
        user.avatar = avatar;
        user.lastActive = Date.now();
        this.saveUsers();
        return { success: true, user };
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
        if (!user.sessionToken) {
            user.sessionToken = this.createSession(user.id);
        }
        this.saveUsers();
        return user;
    }

    // ==========================================
    // ACHIEVEMENTS EVALUATOR
    // ==========================================
    evaluateAchievements(user) {
        this.ensureUserFields(user);
        const achievementsList = [];
        let hasNewUnlock = false;

        for (const def of ACHIEVEMENTS_DEF) {
            let progress = 0;
            switch (def.id) {
                case 'first_win': progress = Math.min(1, user.wins); break;
                case 'ten_wins': progress = Math.min(10, user.wins); break;
                case 'fifty_wins': progress = Math.min(50, user.wins); break;
                case 'hundred_wins': progress = Math.min(100, user.wins); break;
                case 'streak_3': progress = Math.min(3, user.maxStreak); break;
                case 'streak_5': progress = Math.min(5, user.maxStreak); break;
                case 'wall_specialist': progress = Math.min(50, user.wallsPlacedTotal); break;
                case 'breaking_expert': progress = Math.min(10, user.wallsBrokenTotal); break;
                case 'ranked_warrior': progress = Math.min(5, user.rankedPlayed); break;
                case 'koth_master': progress = Math.min(1, user.kothWins); break;
                case 'puzzle_solver': progress = Math.min(3, user.puzzlesSolvedTotal); break;
                default: progress = 0; break;
            }

            const isCompleted = progress >= def.max;
            let record = user.achievements[def.id];

            if (isCompleted && (!record || !record.unlocked)) {
                record = {
                    unlocked: true,
                    unlockedAt: Date.now()
                };
                user.achievements[def.id] = record;
                hasNewUnlock = true;
            }

            achievementsList.push({
                id: def.id,
                name: def.name,
                desc: def.desc,
                icon: def.icon,
                max: def.max,
                progress: progress,
                unlocked: !!(record && record.unlocked),
                unlockedAt: record ? record.unlockedAt : null
            });
        }

        if (hasNewUnlock) {
            this.saveUsers();
        }

        return achievementsList;
    }

    // ==========================================
    // RATING HISTORY & DAILY STATS
    // ==========================================
    getRatingHistory(userId, period = 'all') {
        const user = this.getUser(userId);
        if (!user) return { currentRating: 1200, peakRating: 1200, startRating: 1200, netChange: 0, points: [] };

        this.ensureUserFields(user);
        let cutoff = 0;
        const now = Date.now();
        if (period === '7d') cutoff = now - 7 * 86400000;
        else if (period === '30d') cutoff = now - 30 * 86400000;

        const points = user.ratingHistory.filter(p => !cutoff || p.timestamp >= cutoff);
        const startRating = (points.length > 0) ? points[0].rating - (points[0].delta || 0) : user.rating;
        const currentRating = user.rating;
        const netChange = currentRating - startRating;

        return {
            currentRating,
            peakRating: user.peakRating,
            startRating,
            netChange,
            points
        };
    }

    getUserDailyStats(userId) {
        const user = this.getUser(userId);
        if (!user) return { dailyGames: 0, dailyWins: 0, dailyLosses: 0 };

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startTs = startOfDay.getTime();

        const todayMatches = this.matches.filter(m => {
            if (m.timestamp < startTs) return false;
            return (m.players || []).some(p => p.userId === userId || (p.username || '').toLowerCase() === user.username.toLowerCase());
        });

        let dailyGames = todayMatches.length;
        let dailyWins = 0;
        let dailyLosses = 0;

        for (const m of todayMatches) {
            const p = m.players.find(pl => pl.userId === userId || (pl.username || '').toLowerCase() === user.username.toLowerCase());
            if (p) {
                if (m.winner === p.role) dailyWins++;
                else if (m.winner && m.winner !== p.role) dailyLosses++;
            }
        }

        return { dailyGames, dailyWins, dailyLosses };
    }

    // ==========================================
    // COMPLETE ATOMIC MATCH RECORDING
    // ==========================================
    recordCompletedMatch(userId, matchData) {
        const user = this.getUser(userId);
        if (!user) return null;
        this.ensureUserFields(user);

        // Transaction safeguard: Deduplicate by unique matchId
        if (matchData.matchId && user.processedMatchIds.includes(matchData.matchId)) {
            return {
                user,
                alreadyProcessed: true,
                eloDelta: 0,
                eloChange: 0,
                newRating: user.rating,
                streak: user.streak,
                wins: user.wins,
                losses: user.losses
            };
        }
        if (matchData.matchId) {
            user.processedMatchIds.push(matchData.matchId);
        }

        const isWinner = !!matchData.isWinner;
        const isDraw = !!matchData.isDraw;
        const isRanked = matchData.isRanked !== false;
        const isBot = !!matchData.isBot;
        const durationSec = matchData.durationSec || 60;
        const mode = matchData.mode || 'classic';
        const gameplayMode = matchData.gameplayMode || 'breaking';
        const opponentName = matchData.opponentName || 'Opponent';
        const opponentRating = matchData.opponentRating || 1200;

        user.matchesPlayed++;
        user.totalPlayTimeSec += durationSec;
        user.wallsPlacedTotal += (matchData.wallsPlaced || 0);
        user.wallsBrokenTotal += (matchData.wallsBroken || 0);
        user.lastActive = Date.now();

        let eloDelta = 0;
        if (isRanked) {
            user.rankedPlayed++;
            if (isWinner) {
                eloDelta = 30; // Strictly +30 for Win
                user.wins++;
                user.streak = (user.streak || 0) + 1;
                user.currentLosingStreak = 0;
                if (user.streak > user.maxStreak) user.maxStreak = user.streak;
                if (isBot) user.aiDefeated = (user.aiDefeated || 0) + 1;
                else user.humanDefeated = (user.humanDefeated || 0) + 1;
            } else if (isDraw) {
                eloDelta = 0;
                user.draws = (user.draws || 0) + 1;
            } else {
                eloDelta = -30; // Strictly -30 for Loss
                user.losses++;
                user.currentLosingStreak = (user.currentLosingStreak || 0) + 1;
                user.streak = 0;
            }

            user.rating = Math.max(100, user.rating + eloDelta);
            if (user.rating > user.peakRating) user.peakRating = user.rating;
        } else {
            user.casualPlayed = (user.casualPlayed || 0) + 1;
            if (isWinner) {
                user.wins++;
                if (isBot) user.aiDefeated = (user.aiDefeated || 0) + 1;
                else user.humanDefeated = (user.humanDefeated || 0) + 1;
            } else if (isDraw) {
                user.draws = (user.draws || 0) + 1;
            } else {
                user.losses++;
            }
        }

        // Category Statistics Updating
        user.categoryStats = user.categoryStats || {
            ranked: { games: 0, wins: 0, losses: 0, draws: 0, eloGain: 0 },
            casual: { games: 0, wins: 0, losses: 0, draws: 0 },
            computer: { games: 0, wins: 0, losses: 0, byDifficulty: { easy: { games: 0, wins: 0 }, medium: { games: 0, wins: 0 }, hard: { games: 0, wins: 0 }, impossible: { games: 0, wins: 0 } } },
            koth: { games: 0, wins: 0, losses: 0 },
            breaking: { games: 0, wins: 0, losses: 0 }
        };

        if (isRanked) {
            user.categoryStats.ranked.games++;
            if (isWinner) user.categoryStats.ranked.wins++;
            else if (isDraw) user.categoryStats.ranked.draws++;
            else user.categoryStats.ranked.losses++;
            user.categoryStats.ranked.eloGain += eloDelta;
        } else {
            user.categoryStats.casual.games++;
            if (isWinner) user.categoryStats.casual.wins++;
            else if (isDraw) user.categoryStats.casual.draws++;
            else user.categoryStats.casual.losses++;
        }

        if (isBot) {
            user.categoryStats.computer.games++;
            if (isWinner) user.categoryStats.computer.wins++;
            else if (!isDraw) user.categoryStats.computer.losses++;
            const diff = matchData.difficulty || 'medium';
            if (user.categoryStats.computer.byDifficulty && user.categoryStats.computer.byDifficulty[diff]) {
                user.categoryStats.computer.byDifficulty[diff].games++;
                if (isWinner) user.categoryStats.computer.byDifficulty[diff].wins++;
            }
        }

        if (mode === 'koth') {
            user.categoryStats.koth.games++;
            if (isWinner) user.categoryStats.koth.wins++;
            else if (!isDraw) user.categoryStats.koth.losses++;
        }

        if (gameplayMode === 'breaking') {
            user.categoryStats.breaking.games++;
            if (isWinner) user.categoryStats.breaking.wins++;
            else if (!isDraw) user.categoryStats.breaking.losses++;
        }

        if (mode === 'koth' && isWinner) {
            user.kothWins = (user.kothWins || 0) + 1;
        }

        const myRole = matchData.myPlayerRole || 1;
        const oppRole = myRole === 1 ? 2 : 1;

        // Save match record in matches archive with permanent player ID
        const matchRecord = this.saveMatch({
            roomCode: matchData.roomCode || null,
            mode: mode,
            gameplayMode: gameplayMode,
            breakCost: matchData.breakCost || 5,
            isRanked: isRanked,
            players: [
                {
                    userId: user.id,
                    username: user.username,
                    role: myRole,
                    rating: user.rating,
                    eloDelta: eloDelta,
                    isWinner: isWinner
                },
                {
                    userId: matchData.opponentUserId || null,
                    username: opponentName,
                    role: oppRole,
                    rating: opponentRating,
                    eloDelta: -eloDelta,
                    isBot: isBot
                }
            ],
            winner: isWinner ? myRole : oppRole,
            winReason: matchData.winReason || (isWinner ? 'Victory' : 'Defeat'),
            moveCount: matchData.moveCount || 0,
            durationSec: durationSec,
            replay: matchData.replay || null
        });

        // Add to rating transaction history
        user.ratingHistory.push({
            timestamp: Date.now(),
            rating: user.rating,
            delta: eloDelta,
            opponent: opponentName,
            opponentRating: opponentRating,
            matchId: matchRecord.id
        });

        // Re-evaluate achievements
        this.evaluateAchievements(user);

        // Update AI profile if bot opponent
        if (isBot) {
            this.recordAiMatchResult(opponentName, !isWinner, -eloDelta);
        }

        this.saveUsers();

        return {
            user,
            matchRecord,
            eloDelta,
            eloChange: eloDelta,
            newRating: user.rating,
            streak: user.streak,
            wins: user.wins,
            losses: user.losses
        };
    }

    // ==========================================
    // RANKED PROGRESSION (+30 WIN / -30 LOSS) [COMPATIBILITY]
    // ==========================================
    recordMatchResult(userId, isWinner, isDraw = false) {
        return this.recordCompletedMatch(userId, {
            isWinner,
            isDraw,
            isRanked: true,
            isBot: true,
            opponentName: 'Bot'
        });
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

    getRankTier(rating) {
        return getRankForRating(rating);
    }

    getUserMatchHistory(userId, page = 1, limit = 10, filter = 'all') {
        const user = this.getUser(userId) || this.getUserByUsername(userId);
        if (!user) return { matches: [], totalMatches: 0, page: 1, totalPages: 1 };

        const userLower = (user.username || '').toLowerCase();
        let filtered = this.matches.filter(m => {
            const hasUser = (m.players || []).some(p => p.userId === user.id || (p.username || '').toLowerCase() === userLower);
            if (!hasUser) return false;
            if (filter === 'ranked') return m.isRanked === true;
            if (filter === 'casual') return m.isRanked === false;
            return true;
        });

        const totalMatches = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalMatches / limit));
        const safePage = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);
        const startIndex = (safePage - 1) * limit;
        const paged = filtered.slice(startIndex, startIndex + limit);

        const formatted = paged.map(m => {
            const myPlayer = (m.players || []).find(p => p.userId === user.id || (p.username || '').toLowerCase() === userLower) || {};
            const opponent = (m.players || []).find(p => p !== myPlayer) || { username: 'Tactical Opponent', rating: 1200, avatar: '🤖', isBot: true };
            const myRole = myPlayer.role || 1;
            const isWinner = m.winner === myRole;
            const isDraw = !m.winner;

            return {
                id: m.id,
                timestamp: m.timestamp || Date.now(),
                roomCode: m.roomCode,
                mode: m.mode || 'classic',
                gameplayMode: m.gameplayMode || 'breaking',
                breakCost: m.breakCost || 5,
                isRanked: !!m.isRanked,
                isWinner,
                isDraw,
                result: isWinner ? 'VICTORY' : (isDraw ? 'DRAW' : 'DEFEAT'),
                eloDelta: myPlayer.eloDelta !== undefined ? myPlayer.eloDelta : (isWinner ? 30 : (isDraw ? 0 : -30)),
                myRating: myPlayer.rating || user.rating,
                moveCount: m.moveCount || 0,
                durationSec: m.durationSec || 60,
                opponent: {
                    userId: opponent.userId || null,
                    username: opponent.username || 'Opponent',
                    rating: opponent.rating || 1200,
                    avatar: opponent.avatar || (opponent.isBot ? '🤖' : '👤'),
                    isBot: !!opponent.isBot
                },
                hasReplay: !!(this.replays && this.replays[m.id])
            };
        });

        return {
            matches: formatted,
            totalMatches,
            page: safePage,
            totalPages
        };
    }

    getUserProfileData(userId) {
        let user = this.getUser(userId);
        if (!user) {
            user = this.getUserByUsername(userId);
        }
        if (!user) return null;

        this.ensureUserFields(user);
        const rankTier = this.getRankTier(user.rating);
        const dailyStats = this.getUserDailyStats(user.id);
        const achievements = this.evaluateAchievements(user);
        const ratingHistory = this.getRatingHistory(user.id, 'all');
        const recentMatches = this.getUserMatchHistory(user.id, 1, 10, 'all');

        const winRate = user.matchesPlayed > 0 ? Math.round((user.wins / user.matchesPlayed) * 100) : 0;
        const avgMatchDurationSec = user.matchesPlayed > 0 ? Math.round(user.totalPlayTimeSec / user.matchesPlayed) : 0;

        // Global Leaderboard Rank position
        const allUsersSorted = Object.values(this.users).sort((a, b) => (b.rating || 1200) - (a.rating || 1200));
        const globalRank = Math.max(1, allUsersSorted.findIndex(u => u.id === user.id) + 1);

        // Recent Form (last 10 completed matches: 'W', 'L', 'D')
        const userLower = (user.username || '').toLowerCase();
        const userRecentMatches = this.matches
            .filter(m => (m.players || []).some(p => p.userId === user.id || (p.username || '').toLowerCase() === userLower))
            .slice(0, 10);
        const recentForm = userRecentMatches.map(m => {
            const myPlayer = (m.players || []).find(p => p.userId === user.id || (p.username || '').toLowerCase() === userLower) || {};
            if (!m.winner) return 'D';
            return m.winner === myPlayer.role ? 'W' : 'L';
        });

        // Record Summary (from Screenshot 2)
        const all1v1Wins = user.wins;
        const all1v1Losses = user.losses;
        const all1v1Total = all1v1Wins + all1v1Losses;
        const all1v1WinRate = all1v1Total > 0 ? ((all1v1Wins / all1v1Total) * 100).toFixed(1) : '0.0';

        const rankedWins = user.categoryStats?.ranked?.wins || (user.rankedPlayed > 0 ? Math.round(user.wins * 0.8) : 0);
        const rankedLosses = user.categoryStats?.ranked?.losses || (user.rankedPlayed > 0 ? Math.round(user.losses * 0.8) : 0);
        const rankedTotal = rankedWins + rankedLosses;
        const rankedWinRate = rankedTotal > 0 ? ((rankedWins / rankedTotal) * 100).toFixed(1) : '0.0';

        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            avatar: user.avatar || '💎',
            country: user.country || 'India',
            globalRank,
            isGuest: !!user.isGuest,
            accountType: user.isGuest ? 'Guest Account' : (user.social ? Object.keys(user.social)[0] : 'Registered Account'),
            createdAt: user.createdAt,
            lastActive: user.lastActive,
            rankTier,
            rating: user.rating,
            peakRating: user.peakRating,
            categoryStats: user.categoryStats,
            recentForm,
            recordSummary: {
                all1v1: {
                    games: all1v1Total,
                    wins: all1v1Wins,
                    losses: all1v1Losses,
                    winRate: all1v1WinRate
                },
                ranked: {
                    games: rankedTotal,
                    wins: rankedWins,
                    losses: rankedLosses,
                    winRate: rankedWinRate
                }
            },
            mainStats: {
                totalGames: user.matchesPlayed,
                totalWins: user.wins,
                totalLosses: user.losses,
                draws: user.draws,
                winRate,
                currentRating: user.rating,
                bestRating: user.peakRating,
                currentWinningStreak: user.streak,
                bestWinningStreak: user.maxStreak,
                currentLosingStreak: user.currentLosingStreak
            },
            additionalStats: {
                rankedPlayed: user.rankedPlayed,
                casualPlayed: user.casualPlayed,
                humanDefeated: user.humanDefeated,
                aiDefeated: user.aiDefeated,
                avgMatchDurationSec,
                totalPlayTimeSec: user.totalPlayTimeSec,
                dailyGames: dailyStats.dailyGames,
                dailyWins: dailyStats.dailyWins,
                dailyLosses: dailyStats.dailyLosses
            },
            achievements,
            ratingHistory,
            recentMatches
        };
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
