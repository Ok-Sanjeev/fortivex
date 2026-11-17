/**
 * FORTIVEX — PostgreSQL Production Database Adapter & Schema Migrator (db_postgres.js)
 * 
 * Provides production-grade ACID persistence for cloud deployments (Render, Supabase, Neon, AWS RDS):
 *   - Auto-migrates database schemas on boot
 *   - Supports horizontal auto-scaling and stateless ephemeral containers
 *   - Safe parameterization against SQL injection
 *   - Connection pooling with automatic reconnection
 */

const { Pool } = require('pg');

class FortivexPostgres {
    constructor(connectionString = process.env.DATABASE_URL) {
        this.connectionString = connectionString;
        this.pool = null;
        this.isInitialized = false;

        if (this.connectionString) {
            this.pool = new Pool({
                connectionString: this.connectionString,
                ssl: process.env.NODE_ENV === 'production' && !this.connectionString.includes('localhost') 
                    ? { rejectUnauthorized: false } 
                    : false,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000
            });
        }
    }

    isEnabled() {
        return !!this.pool;
    }

    async init() {
        if (!this.pool || this.isInitialized) return;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Users table
            await client.query(`
                CREATE TABLE IF NOT EXISTS fortivex_users (
                    id VARCHAR(64) PRIMARY KEY,
                    username VARCHAR(64) NOT NULL UNIQUE,
                    display_name VARCHAR(64),
                    rating INT NOT NULL DEFAULT 1200,
                    is_guest BOOLEAN NOT NULL DEFAULT true,
                    is_bot BOOLEAN NOT NULL DEFAULT false,
                    data JSONB NOT NULL,
                    created_at BIGINT NOT NULL,
                    last_active BIGINT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_fortivex_users_rating ON fortivex_users(rating DESC);
            `);

            // 2. Matches & Career records
            await client.query(`
                CREATE TABLE IF NOT EXISTS fortivex_matches (
                    id VARCHAR(64) PRIMARY KEY,
                    room_code VARCHAR(32),
                    mode VARCHAR(32) NOT NULL DEFAULT 'classic',
                    gameplay_mode VARCHAR(32) NOT NULL DEFAULT 'normal',
                    is_ranked BOOLEAN NOT NULL DEFAULT true,
                    winner INT,
                    duration_sec INT,
                    data JSONB NOT NULL,
                    created_at BIGINT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_fortivex_matches_created ON fortivex_matches(created_at DESC);
            `);

            // 3. Match Replays
            await client.query(`
                CREATE TABLE IF NOT EXISTS fortivex_replays (
                    match_id VARCHAR(64) PRIMARY KEY,
                    replay JSONB NOT NULL,
                    created_at BIGINT NOT NULL
                );
            `);

            // 4. Session Tokens
            await client.query(`
                CREATE TABLE IF NOT EXISTS fortivex_sessions (
                    token VARCHAR(128) PRIMARY KEY,
                    user_id VARCHAR(64) NOT NULL REFERENCES fortivex_users(id) ON DELETE CASCADE,
                    created_at BIGINT NOT NULL,
                    expires_at BIGINT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_fortivex_sessions_user ON fortivex_sessions(user_id);
            `);

            // 5. Active Rooms (Crash Recovery)
            await client.query(`
                CREATE TABLE IF NOT EXISTS fortivex_active_rooms (
                    code VARCHAR(32) PRIMARY KEY,
                    data JSONB NOT NULL,
                    updated_at BIGINT NOT NULL
                );
            `);

            // 6. Meta / Sequence Counters
            await client.query(`
                CREATE TABLE IF NOT EXISTS fortivex_meta (
                    key VARCHAR(32) PRIMARY KEY,
                    value JSONB NOT NULL
                );
            `);

            await client.query('COMMIT');
            this.isInitialized = true;
            console.log('✅ [PostgreSQL] Fortivex production tables & indexes verified successfully.');
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ [PostgreSQL] Schema migration failed:', err.message);
            throw err;
        } finally {
            client.release();
        }
    }

    async saveUser(user) {
        if (!this.pool || !user) return;
        const query = `
            INSERT INTO fortivex_users (id, username, display_name, rating, is_guest, is_bot, data, created_at, last_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                display_name = EXCLUDED.display_name,
                rating = EXCLUDED.rating,
                is_guest = EXCLUDED.is_guest,
                data = EXCLUDED.data,
                last_active = EXCLUDED.last_active;
        `;
        await this.pool.query(query, [
            user.id,
            user.username,
            user.displayName || user.username,
            user.rating || 1200,
            !!user.isGuest,
            !!user.isBot,
            JSON.stringify(user),
            user.createdAt || Date.now(),
            user.lastActive || Date.now()
        ]);
    }

    async saveMatch(match) {
        if (!this.pool || !match) return;
        const query = `
            INSERT INTO fortivex_matches (id, room_code, mode, gameplay_mode, is_ranked, winner, duration_sec, data, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING;
        `;
        await this.pool.query(query, [
            match.id,
            match.roomCode || null,
            match.mode || 'classic',
            match.gameplayMode || 'normal',
            match.isRanked !== false,
            match.winner || null,
            match.durationSec || 0,
            JSON.stringify(match),
            match.timestamp || Date.now()
        ]);
    }

    async saveReplay(matchId, replay) {
        if (!this.pool || !matchId) return;
        const query = `
            INSERT INTO fortivex_replays (match_id, replay, created_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (match_id) DO UPDATE SET replay = EXCLUDED.replay;
        `;
        await this.pool.query(query, [matchId, JSON.stringify(replay), Date.now()]);
    }

    async saveActiveRoom(code, roomData) {
        if (!this.pool || !code) return;
        const query = `
            INSERT INTO fortivex_active_rooms (code, data, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;
        `;
        await this.pool.query(query, [code, JSON.stringify(roomData), Date.now()]);
    }

    async removeActiveRoom(code) {
        if (!this.pool || !code) return;
        await this.pool.query('DELETE FROM fortivex_active_rooms WHERE code = $1;', [code]);
    }

    async deleteUser(userId) {
        if (!this.pool || !userId) return;
        await this.pool.query('DELETE FROM fortivex_users WHERE id = $1;', [userId]);
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }
}

module.exports = FortivexPostgres;
