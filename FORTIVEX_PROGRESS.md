# FORTIVEX — Master Product Architecture Audit & Development Progress

**Document Version:** 1.0.0  
**Target Product:** FORTIVEX (Production-Ready Online Multiplayer Strategy Game)  
**Date:** November 2026  
**Status:** Phase 1: Audit, Stabilization & Foundation Active  

---

## 1. Project Overview & Audit

### 1.1 Repository State
- **Previous Name:** Barricade
- **New Official Identity:** **FORTIVEX**
- **Git Repository:** Initialized on `main`, working branch `feature/fortivex-transformation`.
- **Backup Verification:**
  - Git Branch: `backup/before-fortivex-transformation` (Commit `f4fc61f`).
  - Standalone Directory Backup: `C:\Users\Asus\.gemini\antigravity\scratch\barricade-game-backup-before-fortivex`.
  - Remote Repository: None configured in local environment; local backup verified.

### 1.2 Technology Stack Analysis
| Layer | Current Implementation | Planned Production Target |
| :--- | :--- | :--- |
| **Frontend** | Vanilla JS (ES6+), HTML5, CSS3, Web Audio API, PWA Service Worker | Vanilla JS / TypeScript modular components, Web Audio API, Web Workers for AI |
| **Backend** | Node.js `http` module, in-memory Maps | Node.js (TypeScript) + Fastify/Express + WebSocket / Socket.IO |
| **Database** | None (ephemeral in-memory RAM) | PostgreSQL + Prisma ORM (Users, Matches, Moves, Ratings, Replays) |
| **Realtime** | HTTP Polling (1.2s intervals) | WebSockets (authoritative event stream, heartbeat, presence) |
| **Auth** | Random client-generated handles in `localStorage` | Centralized `noob10001` sequential allocator, Guest Sessions, Google OAuth 2.0, Facebook Login |
| **Game Engine** | `game.js` (Deterministic turn-based Quoridor + KOTH + Break Wall) | Centralized, pure, headless engine shared by frontend and backend validation |
| **AI System** | `ai.js` (Heuristic + 2-ply Minimax) | 4 Difficulty Tiers: Easy, Medium, Hard (Minimax + $\alpha$-$\beta$), Impossible (Deep Iterative Deepening + Transposition Table) |
| **Hosting** | Local binding `0.0.0.0:3000` | Cloud deployment (Docker / Render / Railway / AWS), HTTPS/WSS |
| **Mobile** | Responsive mobile web, PWA | Responsive Web + Capacitor packaging for Google Play Store Android release |

---

## 2. Core Game Engine Specification

### 2.1 Board Geometry & Coordinates
- **Board Grid:** 9 columns $\times$ 9 rows = 81 squares.
  - Files: $a$ to $i$ ($x = 0 \dots 8$)
  - Ranks: $1$ to $9$ ($y = 8 \dots 0$)
- **Wall Grid:** 8 columns $\times$ 8 rows of grooves.
  - Coordinates: $(gx, gy)$ where $gx \in [0, 7], gy \in [0, 7]$.
  - Orientations:
    - Horizontal (`H`): spans $(gx, gy)$ and $(gx+1, gy)$ between rows $gy$ and $gy+1$.
    - Vertical (`V`): spans $(gx, gy)$ and $(gx, gy+1)$ between columns $gx$ and $gx+1$.

### 2.2 Game Modes
1. **Game Types:**
   - **Classic (2 Players):**
     - Player 1 (Blue): Starts at `(4, 8)` (square $e1$), Goal: any square on Rank 9 (`y === 0`).
     - Player 2 (Red): Starts at `(4, 0)` (square $e9$), Goal: any square on Rank 1 (`y === 8`).
   - **King of the Hill (4 Players):**
     - Player 1 (Blue): Starts at `(4, 8)`.
     - Player 2 (Red): Starts at `(4, 0)`.
     - Player 3 (Green): Starts at `(0, 4)`.
     - Player 4 (Yellow): Starts at `(8, 4)`.
     - **Goal:** Crown center square `(4, 4)` for all 4 players. Turn order: $1 \to 2 \to 3 \to 4 \to 1$.

2. **Gameplay Modes:**
   - **Normal Mode:** Traditional rules. Zero wall-breaking allowed.
   - **Barricade Breaking Mode:** Allows active player to destroy any placed intact wall on the board.
     - **Inventory Cost:** Deducted from player's own wall inventory. Configurable: **3, 5, or 7** barricades (Default: 5).
     - **Rubble Effect:** Broken wall rubble allows pawns to pass through freely (`isEdgeBlocked === false`), but permanently occupies the groove so no new wall can ever be placed over or crossing it (`doesWallCollide === true`).

3. **Movement Rules:**
   - Orthogonal step of 1 square (Up, Down, Left, Right) if no wall blocks the edge.
   - **Straight Jump:** If opponent pawn is adjacent and straight square is unblocked, jump over to that square.
   - **Diagonal Jump:** If straight jump is blocked by a wall or board perimeter, diagonal jump to perpendicular adjacent squares is legal.
   - **Path Rule:** A wall placement cannot completely trap any active player from reaching their designated goal.

---

## 3. Master Feature Matrix & Status Tracker

| Area | Feature | Status | Priority | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Brand** | Rename to FORTIVEX & UI identity | 🟡 In Progress | Phase 1 | Update title, logo, room codes, meta, documentation |
| **Engine** | Centralized Headless Game Engine | 🟢 Stabilized | Phase 1 | Added Normal/Breaking modes, breakCost (3,5,7), state serialize/deserialize |
| **Engine** | Quoridor Jump & BFS Path Trapping | 🟢 Completed | Phase 1 | Full tournament jump mechanics & path validation verified |
| **Engine** | Barricade Breaking (-3/-5/-7) | 🟢 Completed | Phase 1 | Rubble blocks placement permanently, pawns traverse, cost deducted |
| **AI** | Easy Level (Novice) | 🟢 Completed | Phase 2 | Shortest path, basic tactical blocks |
| **AI** | Medium Level (Strategist) | 🟢 Completed | Phase 2 | Path difference evaluation, bottleneck chokepoints |
| **AI** | Hard Level (Grandmaster Minimax) | 🟡 Refactoring | Phase 2 | 2-ply Minimax; upgrading to full $\alpha$-$\beta$ pruning |
| **AI** | Impossible Level (Apex Engine) | 🟡 Refactoring | Phase 2 | Upgrading with Transposition Table, Zobrist hashing, deep search |
| **AI** | 100 Configured Logical AI Profiles | ⚪ Pending | Phase 5 | `noob10001`+ shared username sequence, distinct Elo & playstyles |
| **Multiplayer** | Real-Time WebSockets Engine | ⚪ Pending | Phase 4 | Replace polling with authoritative WebSocket server |
| **Multiplayer** | Server-Authoritative Validation | ⚪ Pending | Phase 4 | Server validates every move before broadcasting state |
| **Multiplayer** | Private Rooms (`FORT-XXXX`) | 🟢 Functional | Phase 4 | Custom settings (2P/4P, timer, walls, break cost) |
| **Multiplayer** | Ranked Matchmaking (+30 / -30) | 🟡 In Progress | Phase 5 | Live queue with auto AI fallback |
| **Identity** | Centralized `noob10001` sequence | ⚪ Pending | Phase 5 | Atomic sequence for guests & AI profiles |
| **Identity** | Google OAuth 2.0 & Facebook Login | ⚪ Pending | Phase 5 | Social authentication with guest migration |
| **Social** | In-Game Real-Time Chat | 🟢 Functional | Phase 6 | Presets & custom text chat in rooms |
| **Progression**| Player Profiles & Elo Ratings | 🟡 In Progress | Phase 6 | Ratings, win rate, streak counters |
| **Progression**| Daily Tactical Challenges (3/day) | 🟢 Functional | Phase 6 | 15 curated puzzles rotating by calendar date |
| **Features** | Match Replays & Move History | ⚪ Pending | Phase 7 | Full move snapshot reconstruction |
| **Features** | Live Spectator Mode | 🟡 Basic | Phase 7 | Read-only board spectator mode |
| **Cosmetics** | Board Themes & Piece Skins | ⚪ Pending | Phase 7 | Visual customization |
| **Production** | Cloud Deployment Setup | ⚪ Pending | Phase 8 | Environment variables, Docker, cloud configuration |
| **Mobile** | Responsive Mobile Layout & Touch Drag| 🟢 Completed | Phase 8 | 40px finger offset, touch-action: none, global drag tracking |
| **Mobile** | Google Play Android Release Prep | ⚪ Pending | Phase 8 | Capacitor packaging, icons, privacy policy |

---

## 4. Phase-by-Phase Execution Plan

- **Phase 1: Audit and Stabilization (Current)**
  - [x] Verify Git baseline and filesystem backup.
  - [x] Create comprehensive architecture audit document.
  - [ ] Enhance `game.js` with explicit `gameplayMode` ('normal' vs 'breaking'), configurable `breakCost` (3, 5, 7), and comprehensive serialization.
  - [ ] Update product identity to **FORTIVEX** throughout UI, room codes (`FORT-XXXX`), titles, and manifests.
  - [ ] Create automated engine test suite (`tests/engine.test.js`) and ensure 100% pass rate.
- **Phase 2: Advanced Game AI**
  - Implement full Alpha-Beta Minimax with Zobrist Transposition Table for Hard & Impossible.
  - Benchmark all 4 AI levels across 100+ match simulations.
- **Phase 3: Gameplay Modes & Customization**
  - Wire Normal mode vs Barricade Breaking mode (costs 3, 5, 7) into all sheets and UI selectors.
- **Phase 4: Real Cloud Multiplayer & WebSocket Server**
  - Authoritative WebSocket server with match states and reconnection.
- **Phase 5: Player Identity, `noob10001` Sequencer & Ranked**
  - Centralized sequencer, persistent guest auth, social logins, and AI fallback pool.
- **Phase 6: Social & Progression**
  - Profiles, stats, leaderboards, sanitized chat.
- **Phase 7: Advanced Features**
  - Replays, spectator mode, board skins.
- **Phase 8: Production Release & Mobile Packaging**
  - Security audit, cloud deployment, and Android Play Store preparation.
