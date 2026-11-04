/**
 * UI Controller for Barricade
 * 1:1 Parity with Barricade Mobile App (barricade.gg / iOS & Android by o7 Games)
 * Features:
 * - Real Online Multiplayer Ranked Matchmaking with Live Queue
 * - 4-Player Center Race (King of the Hill) with All 4 Pawns & Clocks
 * - Differentiator "Break Barricade" (-5 Wall Cost) Mechanic with Permanent Rubble
 * - High-Bar Challenging AI Bots: Easy, Medium, Hard, Impossible
 * - Move Pawn Mode by default (Walls unselected until tapped)
 * - Ergonomic Mobile Touch Drag & Direct Tap-to-Place
 * - Individual Win/Play Streak Tracking (🔥)
 * - Direct 3 Free Daily Tactical Puzzles (Rotating by Calendar Date)
 * - Custom Multiplayer Room Builder (Classic & KOTH)
 * - Real Server Online & In-Game Counters via Heartbeat
 */

class BarricadeUI {
    constructor() {
        this.game = new BarricadeGame();
        this.ai = new BarricadeAI('medium');

        // State & Profile
        this.currentView = 'game'; // 'home' or 'game'
        this.playType = 'pve';     // 'pve', 'pvp', 'watch', 'puzzle', 'online_pvp'
        this.isRanked = true;
        this.wallOrientation = null; // Move mode by default (neither active!)
        this.isBreakMode = false;    // Break wall mode
        this.isAiThinking = false;
        this.isWatchMode = false;
        this.timerInterval = null;
        this.selectedBotDiff = 'medium';
        this.isDarkTheme = true;

        // Daily Puzzles State
        this.dailyPuzzles = [];
        this.dailyPuzzleIdx = 0;

        // Touch Drag Tracking
        this.isDraggingTouch = false;
        this.dragOrientation = 'H';
        this.dragTouchOffsetY = 50;

        // Online Matchmaking & Room State
        this.matchmakingPollInterval = null;
        this.matchmakingTimeout = null;

        // User Account & Profile
        this.initUserAccount();

        // DOM & Event Binding
        this.initDom();
        this.bindEvents();
        this.initPwaServiceWorker();
        this.startClock();
        this.startServerHeartbeat();
        this.checkUrlForRoomInvite();
        this.render();
    }

    initUserAccount() {
        this.userId = localStorage.getItem('fortivex_user_id') || localStorage.getItem('barricade_user_id');
        let storedUser = localStorage.getItem('fortivex_username') || localStorage.getItem('barricade_username');
        let storedSignedIn = (localStorage.getItem('fortivex_signed_in') || localStorage.getItem('barricade_signed_in')) === 'true';

        // Default sequential username starts at noob10001
        if (!storedUser || storedUser.startsWith('user_')) {
            storedUser = 'noob10001';
            localStorage.setItem('fortivex_username', storedUser);
            localStorage.setItem('fortivex_signed_in', 'false');
            this.isSignedIn = false;
        } else {
            this.isSignedIn = storedSignedIn;
            localStorage.setItem('fortivex_username', storedUser);
        }

        this.username = storedUser;
        this.userRating = parseInt(localStorage.getItem('fortivex_elo') || localStorage.getItem('barricade_elo') || '1200', 10);

        // Individual streak tracked per user: defaults to 0 for users unless accumulated
        const streakKey = `fortivex_streak_${this.username}`;
        const storedStreak = localStorage.getItem(streakKey) || localStorage.getItem(`barricade_streak_${this.username}`);
        this.userStreak = storedStreak !== null ? parseInt(storedStreak, 10) : 0;

        // Client ID for real server heartbeat and room tracking
        this.clientId = localStorage.getItem('fortivex_client_id') || localStorage.getItem('barricade_client_id') || ('c_' + Math.random().toString(36).substring(2, 10));
        localStorage.setItem('fortivex_client_id', this.clientId);

        // Room and Online Multiplayer state
        this.activeRoomCode = null;
        this.myPlayerRole = 1; // 1 = Blue/Host, 2 = Red/Guest
        this.opponentName = null;
        this.opponentRating = 1200;
        this.roomPollInterval = null;
        this.lastSyncedMoveIndex = 0;
        this.ws = null;

        // Register or sync with centralized server
        if (!this.userId) {
            fetch('/api/auth/guest', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.user) {
                        this.userId = data.user.id;
                        this.username = data.user.username;
                        this.userRating = data.user.rating || 1200;
                        this.userStreak = data.user.streak || 0;
                        localStorage.setItem('fortivex_user_id', this.userId);
                        localStorage.setItem('fortivex_username', this.username);
                        localStorage.setItem('fortivex_elo', this.userRating);
                        this.render();
                    }
                })
                .catch(() => {});
        } else {
            fetch(`/api/user/profile?userId=${this.userId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.user) {
                        this.username = data.user.username;
                        this.userRating = data.user.rating;
                        this.userStreak = data.user.streak;
                        this.isSignedIn = !data.user.isGuest;
                        localStorage.setItem('fortivex_username', this.username);
                        localStorage.setItem('fortivex_elo', this.userRating);
                        this.render();
                    }
                })
                .catch(() => {});
        }

        // Initialize Real-time WebSockets
        this.initWebSocket();
    }

    initWebSocket() {
        if (typeof WebSocket === 'undefined') return;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('⚡ Connected to FORTIVEX Real-Time WebSocket Server');
                if (this.playType === 'online_pvp' && this.activeRoomCode) {
                    this.ws.send(JSON.stringify({
                        type: 'join_room',
                        code: this.activeRoomCode,
                        role: this.myPlayerRole,
                        username: this.username,
                        clientId: this.clientId
                    }));
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('Error parsing WS message:', e);
                }
            };

            this.ws.onclose = () => {
                setTimeout(() => this.initWebSocket(), 3000);
            };
        } catch (e) {
            console.warn('WebSocket init fallback to polling:', e);
        }
    }

    handleWebSocketMessage(data) {
        if (!data) return;

        if (data.type === 'move_broadcast') {
            if (data.player !== this.myPlayerRole) {
                this.applyRemoteMove(data.move);
            }
            if (data.winner) {
                this.handleMatchEnd(data.winner, data.winReason);
            }
        } else if (data.type === 'chat_broadcast') {
            this.showChatBubble(data.role || 2, data.text);
        } else if (data.type === 'player_joined') {
            if (this.roomLobbyOverlay && this.roomLobbyOverlay.style.display !== 'none') {
                this.roomLobbyOverlay.style.display = 'none';
                sounds.playTurnStart();
                this.showToast(`Opponent ${data.username} joined!`);
                this.playType = 'online_pvp';
                this.opponentName = data.username;
                this.startNewMatch({
                    mode: this.selectedRoomMode || 'classic',
                    initialWalls: this.selectedRoomWalls || 10,
                    timeSec: this.selectedRoomTime || 180
                });
            }
        }
    }

    initDom() {
        this.appScreen = document.querySelector('.app-screen');

        // Views
        this.homeView = document.getElementById('home-screen-view');
        this.gameView = document.getElementById('game-screen-view');

        // Modals & Bottom Sheets
        this.createGameSheet = document.getElementById('create-game-sheet');
        this.friendsSheet = document.getElementById('friends-sheet');
        this.puzzlesSheet = document.getElementById('puzzles-sheet');
        this.chatSheet = document.getElementById('chat-sheet');
        this.gameOverSheet = document.getElementById('gameover-sheet');
        this.signInSheet = document.getElementById('signin-sheet');
        this.dailyCompleteSheet = document.getElementById('daily-complete-sheet');
        this.matchmakingOverlay = document.getElementById('matchmaking-overlay');
        this.roomLobbyOverlay = document.getElementById('room-lobby-overlay');

        // Sign In Form Elements
        this.signInInput = document.getElementById('signin-username-input');
        this.btnSubmitSignIn = document.getElementById('btn-submit-signin');
        this.homeUserBadge = document.getElementById('home-user-badge');
        this.homeUsernameText = document.getElementById('home-username-text');
        this.homeSignInPrompt = document.getElementById('home-signin-prompt');
        this.homeEloBadge = document.getElementById('home-elo-badge');
        this.homeStreakBadge = document.getElementById('home-streak-badge');

        // Board & Elements
        this.boardFrame = document.getElementById('board-square-frame');
        this.boardGrid = document.getElementById('board-grid-9x9');
        this.placedWallsLayer = document.getElementById('placed-walls-layer');
        this.ghostWallSnap = document.getElementById('ghost-wall-snap');
        this.touchFloatingWall = document.getElementById('touch-floating-wall');
        this.moveLogText = document.getElementById('move-log-text');

        // Player Cards Header
        this.playersMatchHeader = document.getElementById('players-match-header');

        // P1 Box
        this.p1Box = document.getElementById('p1-match-box');
        this.p1NameLabel = document.getElementById('p1-name-label');
        this.p1EloTag = document.getElementById('p1-elo-tag');
        this.p1Clock = document.getElementById('p1-clock');
        this.p1WallBadge = document.getElementById('p1-wall-count');
        this.p1ChatBubble = document.getElementById('p1-chat-bubble');

        // P2 Box
        this.p2Box = document.getElementById('p2-match-box');
        this.p2NameLabel = document.getElementById('p2-name-label');
        this.p2BotTag = document.getElementById('p2-bot-tag');
        this.p2EloTag = document.getElementById('p2-elo-tag');
        this.p2Clock = document.getElementById('p2-clock');
        this.p2WallBadge = document.getElementById('p2-wall-count');
        this.p2ChatBubble = document.getElementById('p2-chat-bubble');

        // P3 Box (4-Player KOTH)
        this.p3Box = document.getElementById('p3-match-box');
        this.p3NameLabel = document.getElementById('p3-name-label');
        this.p3BotTag = document.getElementById('p3-bot-tag');
        this.p3EloTag = document.getElementById('p3-elo-tag');
        this.p3Clock = document.getElementById('p3-clock');
        this.p3WallBadge = document.getElementById('p3-wall-count');
        this.p3ChatBubble = document.getElementById('p3-chat-bubble');

        // P4 Box (4-Player KOTH)
        this.p4Box = document.getElementById('p4-match-box');
        this.p4NameLabel = document.getElementById('p4-name-label');
        this.p4BotTag = document.getElementById('p4-bot-tag');
        this.p4EloTag = document.getElementById('p4-elo-tag');
        this.p4Clock = document.getElementById('p4-clock');
        this.p4WallBadge = document.getElementById('p4-wall-count');
        this.p4ChatBubble = document.getElementById('p4-chat-bubble');

        // Matchmaking Radar & VS Elements
        this.matchmakingSearchCard = document.getElementById('matchmaking-search-card');
        this.matchmakingVsCard = document.getElementById('matchmaking-vs-card');
        this.mmPlayerRatingChip = document.getElementById('mm-player-rating-chip');
        this.mmSearchTimer = document.getElementById('mm-search-timer');
        this.mmRatingRange = document.getElementById('mm-rating-range');
        this.mmQueueStatus = document.getElementById('mm-queue-status');
        this.vsP1Name = document.getElementById('vs-p1-name');
        this.vsP1Rating = document.getElementById('vs-p1-rating');
        this.vsP2Name = document.getElementById('vs-p2-name');
        this.vsP2Rating = document.getElementById('vs-p2-rating');
        this.vsP2Badge = document.getElementById('vs-p2-badge');
        this.vsCountdownText = document.getElementById('vs-countdown-text');

        // Public Rooms Browser Elements
        this.publicRoomsList = document.getElementById('public-rooms-list');
        this.btnRefreshPublicRooms = document.getElementById('btn-refresh-public-rooms');
        this.activePublicFilter = 'all';

        // Platform Statistics Elements
        this.statOnlineHumans = document.getElementById('stat-online-humans');
        this.statAvailableAi = document.getElementById('stat-available-ai');
        this.statActiveMatches = document.getElementById('stat-active-matches');

        // Room Creator Elements
        this.customRoomTitleInput = document.getElementById('custom-room-title-input');
        this.roomPasswordContainer = document.getElementById('room-password-container');
        this.customRoomPasswordInput = document.getElementById('custom-room-password-input');
        this.roomConfigPreviewText = document.getElementById('room-config-preview-text');

        // Game Over Sheet Elements
        this.goWinnerTitle = document.getElementById('gameover-winner-title');
        this.goReasonSub = document.getElementById('gameover-reason-sub');
        this.goOpponentName = document.getElementById('gameover-opponent-name');
        this.goRatingChange = document.getElementById('gameover-rating-change');
        this.goTurnsCount = document.getElementById('gameover-turns-count');
        this.goDurationVal = document.getElementById('gameover-duration-val');
        this.btnGoRematch = document.getElementById('btn-gameover-rematch');
        this.btnGoLobby = document.getElementById('btn-gameover-lobby');

        // Bottom Controls
        this.btnOrientH = document.getElementById('btn-orient-h');
        this.btnOrientV = document.getElementById('btn-orient-v');
        this.btnBreakWall = document.getElementById('btn-break-wall');
        this.btnRankedBotFallback = document.getElementById('btn-ranked-bot-fallback');
        this.toastEl = document.getElementById('toast-msg-banner');

        // Theme & Sound icons
        this.themeIconMoon = document.getElementById('theme-icon-moon');
        this.themeIconSun = document.getElementById('theme-icon-sun');
        this.soundIconOn = document.getElementById('sound-icon-on');
        this.soundIconOff = document.getElementById('sound-icon-off');

        // Front Page Custom Rooms: Build & Join
        this.btnFrontBuildRoom = document.getElementById('btn-front-build-room');
        this.frontJoinRoomInput = document.getElementById('front-join-room-input');
        this.btnFrontJoinRoomAction = document.getElementById('btn-front-join-room-action');

        // Bot Launcher & Modal
        this.btnPlayBot = document.getElementById('btn-play-bot');
        this.btnKothMode = document.getElementById('btn-koth-mode');
        this.botSheet = document.getElementById('bot-sheet');
        this.btnStartBotMatch = document.getElementById('btn-start-bot-match');
        this.btnCloseBotSheet = document.getElementById('btn-close-bot-sheet');

        // Build 9x9 Grid Tiles
        this.boardGrid.innerHTML = '';
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                const tile = document.createElement('div');
                tile.className = 'grid-tile';
                tile.dataset.x = x;
                tile.dataset.y = y;
                this.boardGrid.appendChild(tile);
            }
        }
    }

    bindEvents() {
        // Sign In Sheet
        this.homeUserBadge?.addEventListener('click', () => this.openSignInSheet());
        this.homeSignInPrompt?.addEventListener('click', () => this.openSignInSheet());
        document.getElementById('p1-name-wrapper')?.addEventListener('click', () => this.openSignInSheet());

        this.btnSubmitSignIn?.addEventListener('click', () => this.handleSignInSubmit());
        this.signInInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleSignInSubmit();
        });

        // 1. Home Screen Buttons
        document.getElementById('btn-play-ranked')?.addEventListener('click', () => {
            this.startRankedMatchmaking();
        });

        // Front Page Custom Rooms: Build & Join
        this.btnFrontBuildRoom?.addEventListener('click', () => {
            this.openFriendsSheet('build');
        });

        this.btnFrontJoinRoomAction?.addEventListener('click', () => {
            const code = this.frontJoinRoomInput?.value.trim();
            this.joinRoomAction(code);
        });

        this.frontJoinRoomInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const code = this.frontJoinRoomInput?.value.trim();
                this.joinRoomAction(code);
            }
        });

        // Bot Launcher & Modal
        this.btnPlayBot?.addEventListener('click', () => {
            document.querySelectorAll('#bot-sheet .bot-mode-box').forEach(b => {
                b.classList.toggle('selected', b.dataset.mode === 'classic');
            });
            this.botSheet?.classList.add('open');
        });

        this.btnKothMode?.addEventListener('click', () => {
            document.querySelectorAll('#bot-sheet .bot-mode-box').forEach(b => {
                b.classList.toggle('selected', b.dataset.mode === 'koth');
            });
            this.botSheet?.classList.add('open');
            this.showToast('👑 King of the Hill: 4 players race to center crown!');
        });

        this.btnStartBotMatch?.addEventListener('click', () => {
            this.launchBotMatch();
        });

        this.btnCloseBotSheet?.addEventListener('click', () => {
            this.botSheet?.classList.remove('open');
        });

        document.getElementById('btn-vs-computer')?.addEventListener('click', () => {
            this.botSheet?.classList.add('open');
        });

        document.getElementById('btn-play-friends')?.addEventListener('click', () => {
            this.openFriendsSheet('build');
        });

        // Direct Daily Puzzles
        document.getElementById('btn-puzzles-mode')?.addEventListener('click', () => {
            this.openDailyPuzzleDirectly();
        });

        document.getElementById('btn-local-play')?.addEventListener('click', () => {
            this.playType = 'pvp';
            this.isRanked = false;
            this.startNewMatch({ mode: 'classic', initialWalls: 10, timeSec: 180 });
            this.showToast('Local 2-Player Pass & Play');
        });

        document.getElementById('btn-watch-mode')?.addEventListener('click', () => {
            this.startWatchMode();
        });

        document.getElementById('btn-cancel-matchmaking')?.addEventListener('click', () => {
            this.cancelRankedMatchmaking();
        });

        this.btnRankedBotFallback?.addEventListener('click', () => {
            this.startRankedBotFallback();
        });

        // Create game modal buttons
        document.getElementById('btn-close-sheet')?.addEventListener('click', () => {
            this.createGameSheet.classList.remove('open');
        });

        document.getElementById('btn-start-custom-game')?.addEventListener('click', () => {
            this.createGameSheet.classList.remove('open');
            this.launchConfiguredGame();
        });

        // Build Room / Join Room Tabbed Modal Actions
        document.getElementById('tab-btn-build-room')?.addEventListener('click', () => {
            this.switchRoomTab('build');
        });

        document.getElementById('tab-btn-join-room')?.addEventListener('click', () => {
            this.switchRoomTab('join');
        });

        document.getElementById('btn-refresh-room-code')?.addEventListener('click', () => {
            const randCode = 'BARR-' + Math.floor(1000 + Math.random() * 9000);
            const codeEl = document.getElementById('display-room-code');
            if (codeEl) codeEl.textContent = randCode;
            sounds.playRotate();
        });

        document.getElementById('btn-build-and-host')?.addEventListener('click', () => {
            this.buildAndHostRoom();
        });

        document.getElementById('btn-join-room-action')?.addEventListener('click', () => {
            this.joinRoomAction();
        });

        document.getElementById('btn-start-local-from-friends')?.addEventListener('click', () => {
            this.friendsSheet.classList.remove('open');
            this.playType = 'pvp';
            this.isRanked = false;
            this.startNewMatch({ mode: 'classic', initialWalls: 10, timeSec: 180 });
            this.showToast('Local 2-Player Pass & Play');
        });

        document.getElementById('btn-copy-live-link')?.addEventListener('click', () => {
            const code = this.activeRoomCode || document.getElementById('display-room-code')?.textContent || 'BARR-8291';
            const link = `${window.location.origin}${window.location.pathname}?room=${code}`;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(link).then(() => {
                    this.showToast('Invite link copied to clipboard!');
                }).catch(() => {
                    this.showToast(`Room Code: ${code}`);
                });
            } else {
                this.showToast(`Room Code: ${code}`);
            }
        });

        document.getElementById('btn-cancel-room-lobby')?.addEventListener('click', () => {
            if (this.roomPollInterval) clearInterval(this.roomPollInterval);
            this.roomLobbyOverlay.style.display = 'none';
            this.activeRoomCode = null;
            this.showToast('Room lobby closed');
        });

        // Daily Complete Sheet Replay Button
        document.getElementById('btn-replay-daily-puzzles')?.addEventListener('click', () => {
            this.dailyCompleteSheet.classList.remove('open');
            this.openDailyPuzzleDirectly(true);
        });

        // In-Game Nav Buttons
        document.getElementById('btn-back-home')?.addEventListener('click', () => {
            this.isWatchMode = false;
            this.isAiThinking = false;
            if (this.roomPollInterval) clearInterval(this.roomPollInterval);
            this.activeRoomCode = null;
            this.switchView('home');
        });

        document.getElementById('btn-resign')?.addEventListener('click', () => {
            if (this.game.winner) return;
            if (confirm('Are you sure you want to resign the game?')) {
                this.game.resign(this.myPlayerRole || 1);
                sounds.playIllegal();
                this.handleMatchEnd(2, 'Resigned');
            }
        });

        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });

        document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
            const isMuted = sounds.toggleMute();
            if (this.soundIconOn && this.soundIconOff) {
                this.soundIconOn.style.display = isMuted ? 'none' : 'block';
                this.soundIconOff.style.display = isMuted ? 'block' : 'none';
            }
            this.showToast(isMuted ? 'Sound muted' : 'Sound enabled');
        });

        document.getElementById('btn-chat-toggle')?.addEventListener('click', () => {
            if (this.playType === 'pve' || this.isOpponentAi || this.playType === 'watch') {
                this.showToast('Chat is disabled against AI opponents');
                return;
            }
            this.chatSheet.classList.add('open');
        });

        // Chat preset buttons (AI opponents NEVER reply)
        document.querySelectorAll('.chat-bubble-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.textContent;
                this.chatSheet.classList.remove('open');
                this.showChatBubble(this.myPlayerRole || 1, text);

                if (this.playType === 'online_pvp' && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'chat',
                        code: this.activeRoomCode,
                        text: text
                    }));
                }
            });
        });

        // Public Rooms Browser: Filter Pills & Refresh
        this.btnRefreshPublicRooms?.addEventListener('click', () => {
            this.fetchPublicRooms(this.activePublicFilter);
            sounds.playRotate();
        });

        document.querySelectorAll('.public-filter-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.public-filter-pill').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                this.activePublicFilter = btn.dataset.filter || 'all';
                this.fetchPublicRooms(this.activePublicFilter);
            });
        });

        // Game Over Sheet Buttons
        document.getElementById('btn-gameover-rematch')?.addEventListener('click', () => {
            this.gameOverSheet?.classList.remove('open');
            if (this.playType === 'pve') {
                this.launchBotMatch();
            } else {
                this.startNewMatch();
            }
        });

        document.getElementById('btn-gameover-lobby')?.addEventListener('click', () => {
            this.gameOverSheet?.classList.remove('open');
            this.switchView('home');
        });

        // 3. Wall Orientation Pills: Click to toggle on / off!
        this.btnOrientH.addEventListener('click', () => this.toggleWallOrientation('H'));
        this.btnOrientV.addEventListener('click', () => this.toggleWallOrientation('V'));

        // Break Wall Pill
        this.btnBreakWall?.addEventListener('click', () => this.toggleBreakMode());

        // 4. TOUCH DRAG & DROP FOR PHONES
        this.bindTouchDragOnElement(this.btnOrientH, 'H');
        this.bindTouchDragOnElement(this.btnOrientV, 'V');

        // Keyboard hotkeys
        window.addEventListener('keydown', (e) => {
            if (e.key === 'r' || e.key === 'R' || e.code === 'Space') {
                if (this.wallOrientation === 'H') this.toggleWallOrientation('V');
                else if (this.wallOrientation === 'V') this.toggleWallOrientation('H');
                else this.toggleWallOrientation('H');
            } else if (e.key === 'b' || e.key === 'B') {
                this.toggleBreakMode();
            }
        });

        // Board Pointer & Touch Events
        this.boardFrame.addEventListener('pointerdown', (e) => this.handleBoardClick(e));
        this.boardFrame.addEventListener('pointermove', (e) => this.handleBoardPointerMove(e));
        this.boardFrame.addEventListener('pointerleave', () => this.hideGhostWall());

        // Dedicated Mobile Touch Dragging directly on Board Frame
        this.boardFrame.addEventListener('touchstart', (e) => this.handleBoardTouchStart(e), { passive: false });
        this.boardFrame.addEventListener('touchmove', (e) => this.handleBoardTouchMove(e), { passive: false });
        this.boardFrame.addEventListener('touchend', (e) => this.handleBoardTouchEnd(e), { passive: false });
        this.boardFrame.addEventListener('touchcancel', (e) => this.handleBoardTouchEnd(e), { passive: false });

        // Close sheets on background click
        document.querySelectorAll('.close-modal-trigger').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.modal-bottom-sheet-overlay').forEach(m => m.classList.remove('open'));
            });
        });

        window.addEventListener('resize', () => this.renderWalls());
    }

    initPwaServiceWorker() {
        if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').catch(() => {});
            });
        }
    }

    // ==========================================
    // REAL SERVER HEARTBEAT & STATS (REAL DATA)
    // ==========================================
    startServerHeartbeat() {
        const sendBeat = () => {
            const status = (this.currentView === 'game' && !this.game.winner) ? 'game' : 'lobby';
            fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: this.clientId,
                    username: this.username,
                    status: status,
                    roomCode: this.activeRoomCode
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data && data.success) {
                    if (this.statOnlineHumans) {
                        this.statOnlineHumans.textContent = `${data.humanOnlineCount || data.onlineCount || 1} Human Online`;
                    }
                    if (this.statAvailableAi) {
                        this.statAvailableAi.textContent = `${data.aiAvailableCount || 100} AI Available`;
                    }
                    if (this.statActiveMatches) {
                        this.statActiveMatches.textContent = `${data.activeMatchesCount || data.inGameCount || 0} Matches Active`;
                    }
                }
            })
            .catch(() => {});
        };

        sendBeat();
        setInterval(sendBeat, 3500);

        // Initial fetch of public rooms + recurring interval
        this.fetchPublicRooms();
        setInterval(() => {
            if (this.currentView === 'home') {
                this.fetchPublicRooms();
            }
        }, 6000);
    }

    fetchPublicRooms(filter = this.activePublicFilter || 'all') {
        fetch(`/api/rooms/public?filter=${filter}`)
            .then(res => res.json())
            .then(data => {
                if (data && data.success) {
                    this.renderPublicRoomsList(data.rooms || []);
                }
            })
            .catch(() => {});
    }

    renderPublicRoomsList(rooms) {
        if (!this.publicRoomsList) return;

        if (!rooms || rooms.length === 0) {
            this.publicRoomsList.innerHTML = `
                <div class="public-rooms-empty">
                    <div class="empty-icon">🌐</div>
                    <div class="empty-title">No Open Public Rooms</div>
                    <div class="empty-sub">Be the first to build a public room and challenge anyone online!</div>
                </div>
            `;
            return;
        }

        this.publicRoomsList.innerHTML = rooms.map(r => {
            const isKoth = r.mode === 'koth';
            const isBreaking = r.gameplayMode === 'breaking';
            return `
                <div class="public-room-card" data-code="${r.code}">
                    <div class="room-card-info">
                        <div class="room-card-title">
                            <span>${r.title || r.code}</span>
                            ${r.hasPassword ? '<span title="Password Protected">🔒</span>' : ''}
                        </div>
                        <div class="room-card-meta">
                            <span class="room-meta-badge ${isKoth ? 'koth' : ''}">${isKoth ? '👑 4P KOTH' : 'Classic 2P'}</span>
                            <span class="room-meta-badge ${isBreaking ? 'breaking' : ''}">${isBreaking ? '💥 Breaking' : 'Normal'}</span>
                            <span>⏱ ${r.timeSec}s</span>
                            <span>👥 ${r.currentPlayers}/${r.maxPlayers}</span>
                        </div>
                    </div>
                    <div class="room-card-actions">
                        <button class="btn-join-room-card" data-code="${r.code}" data-pwd="${r.hasPassword ? '1' : '0'}">Join</button>
                    </div>
                </div>
            `;
        }).join('');

        this.publicRoomsList.querySelectorAll('.btn-join-room-card').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.dataset.code;
                const hasPwd = btn.dataset.pwd === '1';
                if (hasPwd) {
                    const pwd = prompt(`Enter password for room ${code}:`);
                    if (pwd !== null) {
                        this.joinRoomAction(code, pwd);
                    }
                } else {
                    this.joinRoomAction(code);
                }
            });
        });
    }

    checkUrlForRoomInvite() {
        try {
            const params = new URLSearchParams(window.location.search);
            const roomCode = params.get('room');
            if (roomCode) {
                setTimeout(() => {
                    this.openFriendsSheet('join', roomCode.toUpperCase());
                }, 400);
            }
        } catch (e) {}
    }

    toggleTheme() {
        this.isDarkTheme = !this.isDarkTheme;
        this.appScreen.classList.toggle('light-theme', !this.isDarkTheme);
        if (this.themeIconMoon && this.themeIconSun) {
            this.themeIconMoon.style.display = this.isDarkTheme ? 'block' : 'none';
            this.themeIconSun.style.display = this.isDarkTheme ? 'none' : 'block';
        }
        sounds.playRotate();
        this.showToast(this.isDarkTheme ? 'Dark Mode' : 'Light Mode');
    }

    // ==========================================
    // REAL ONLINE RANKED MATCHMAKING FLOW
    // ==========================================
    startRankedMatchmaking() {
        this.matchmakingOverlay.style.display = 'flex';
        if (this.matchmakingSearchCard) this.matchmakingSearchCard.style.display = 'block';
        if (this.matchmakingVsCard) this.matchmakingVsCard.style.display = 'none';

        if (this.mmPlayerRatingChip) {
            this.mmPlayerRatingChip.textContent = `💎 ${this.username} (${this.userRating} ELO)`;
        }

        // Reset stages
        this.setMatchmakingStage(1);
        if (this.mmQueueStatus) this.mmQueueStatus.textContent = 'Connecting to matchmaking server...';
        if (this.mmRatingRange) this.mmRatingRange.textContent = `${Math.max(100, this.userRating - 50)} – ${this.userRating + 50}`;
        if (this.mmSearchTimer) this.mmSearchTimer.textContent = '0:00';

        sounds.playTurnStart();

        let searchSec = 0;
        if (this.matchmakingDurationInterval) clearInterval(this.matchmakingDurationInterval);
        this.matchmakingDurationInterval = setInterval(() => {
            searchSec++;
            if (this.mmSearchTimer) this.mmSearchTimer.textContent = this.formatClock(searchSec);

            if (searchSec === 1) {
                this.setMatchmakingStage(2);
                if (this.mmQueueStatus) this.mmQueueStatus.textContent = 'Searching active player queue...';
            } else if (searchSec === 3) {
                this.setMatchmakingStage(3);
                const spread = 100;
                if (this.mmRatingRange) this.mmRatingRange.textContent = `${Math.max(100, this.userRating - spread)} – ${this.userRating + spread}`;
                if (this.mmQueueStatus) this.mmQueueStatus.textContent = 'Expanding rating window...';
            } else if (searchSec >= 5) {
                const spread = 200;
                if (this.mmRatingRange) this.mmRatingRange.textContent = `${Math.max(100, this.userRating - spread)} – ${this.userRating + spread}`;
                if (this.mmQueueStatus) this.mmQueueStatus.textContent = 'Locating available opponent...';
            }
        }, 1000);

        // 1. Send join matchmaking request to server
        fetch('/api/matchmaking/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: this.clientId,
                userId: this.userId,
                username: this.username,
                rating: this.userRating
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.matched) {
                this.handleRankedMatchFound(data);
            } else {
                this.pollRankedQueue();
            }
        })
        .catch(() => {
            this.showToast('Could not connect to matchmaking queue');
        });
    }

    setMatchmakingStage(stageNum) {
        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`mm-stage-${i}`);
            if (!el) continue;
            if (i < stageNum) {
                el.className = 'mm-stage-row done';
            } else if (i === stageNum) {
                el.className = 'mm-stage-row active';
            } else {
                el.className = 'mm-stage-row';
            }
        }
    }

    pollRankedQueue() {
        if (this.matchmakingPollInterval) clearInterval(this.matchmakingPollInterval);
        this.matchmakingPollInterval = setInterval(() => {
            fetch(`/api/matchmaking/poll?clientId=${this.clientId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.matched) {
                        clearInterval(this.matchmakingPollInterval);
                        clearInterval(this.matchmakingDurationInterval);
                        this.handleRankedMatchFound(data);
                    }
                })
                .catch(() => {});
        }, 1000);
    }

    handleRankedMatchFound(data) {
        clearInterval(this.matchmakingPollInterval);
        clearInterval(this.matchmakingDurationInterval);

        this.setMatchmakingStage(4);
        if (this.mmQueueStatus) this.mmQueueStatus.textContent = 'Opponent matched!';
        sounds.playVictory();
        this.vibrate([30, 30, 50]);

        this.activeRoomCode = data.roomCode;
        this.myPlayerRole = data.role || 1;
        this.opponentName = data.opponent.username; // Strictly noobXXXXX
        this.opponentRating = data.opponent.rating;
        this.isRanked = true;
        this.isOpponentAi = !!data.opponent.isBot;
        this.lastSyncedMoveIndex = 0;

        if (data.opponent.isBot) {
            this.playType = 'pve';
            this.ai.setDifficulty(data.opponent.difficulty || 'hard');
        } else {
            this.playType = 'online_pvp';
        }

        // Show VS Screen Card!
        setTimeout(() => {
            this.setMatchmakingStage(5);
            if (this.matchmakingSearchCard) this.matchmakingSearchCard.style.display = 'none';
            if (this.matchmakingVsCard) {
                this.matchmakingVsCard.style.display = 'block';
                if (this.vsP1Name) this.vsP1Name.textContent = this.username;
                if (this.vsP1Rating) this.vsP1Rating.textContent = `${this.userRating} ELO`;
                if (this.vsP2Name) this.vsP2Name.textContent = this.opponentName;
                if (this.vsP2Rating) this.vsP2Rating.textContent = `${this.opponentRating} ELO`;
                if (this.vsP2Badge) this.vsP2Badge.textContent = data.opponent.isBot ? 'AI OPPONENT' : 'OPPONENT';
            }

            let countdown = 2;
            const vsTimer = setInterval(() => {
                countdown--;
                if (this.vsCountdownText) {
                    this.vsCountdownText.textContent = `Match starting in ${countdown}...`;
                }
                if (countdown <= 0) {
                    clearInterval(vsTimer);
                    this.matchmakingOverlay.style.display = 'none';
                    if (this.matchmakingVsCard) this.matchmakingVsCard.style.display = 'none';

                    this.startNewMatch({ mode: 'classic', initialWalls: 10, timeSec: 180, gameplayMode: 'breaking', breakCost: 5 });
                    if (this.playType === 'online_pvp') {
                        this.startOnlineMovePolling();
                    }
                    if (this.myPlayerRole === 2 && this.game.turn === 1) {
                        this.triggerAiTurnIfNeeded();
                    }
                    this.showToast(`Ranked Match vs ${this.opponentName}!`);
                }
            }, 1000);
        }, 500);
    }

    startRankedBotFallback() {
        clearInterval(this.matchmakingPollInterval);
        clearInterval(this.matchmakingDurationInterval);
        fetch('/api/matchmaking/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: this.clientId })
        }).catch(() => {});

        this.matchmakingOverlay.style.display = 'none';
        if (this.matchmakingVsCard) this.matchmakingVsCard.style.display = 'none';
        this.isRanked = true;
        this.playType = 'pve';
        this.isOpponentAi = true;
        this.opponentName = 'noob10088';
        this.opponentRating = Math.max(100, this.userRating + 30);
        this.ai.setDifficulty('hard');

        this.startNewMatch({ mode: 'classic', initialWalls: 10, timeSec: 180, gameplayMode: 'breaking', breakCost: 5 });
        this.showToast(`Ranked Match vs ${this.opponentName}`);
    }

    cancelRankedMatchmaking() {
        clearInterval(this.matchmakingPollInterval);
        clearInterval(this.matchmakingDurationInterval);

        fetch('/api/matchmaking/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: this.clientId })
        }).catch(() => {});

        this.matchmakingOverlay.style.display = 'none';
        if (this.matchmakingVsCard) this.matchmakingVsCard.style.display = 'none';
        this.showToast('Matchmaking cancelled');
    }

    // ==========================================
    // BUILD ROOM & JOIN ROOM FLOW
    // ==========================================
    openFriendsSheet(activeTab = 'build', prefillCode = '') {
        const randCode = 'FORT-' + Math.floor(1000 + Math.random() * 9000);
        const codeEl = document.getElementById('display-room-code');
        if (codeEl) codeEl.textContent = randCode;

        if (prefillCode) {
            const joinInput = document.getElementById('join-room-input');
            if (joinInput) joinInput.value = prefillCode;
        }

        this.switchRoomTab(activeTab);
        this.friendsSheet.classList.add('open');
    }

    switchRoomTab(tabName) {
        const tabBuildBtn = document.getElementById('tab-btn-build-room');
        const tabJoinBtn = document.getElementById('tab-btn-join-room');
        const contentBuild = document.getElementById('tab-content-build-room');
        const contentJoin = document.getElementById('tab-content-join-room');

        if (tabName === 'build') {
            tabBuildBtn?.classList.add('active');
            tabJoinBtn?.classList.remove('active');
            if (contentBuild) contentBuild.style.display = 'block';
            if (contentJoin) contentJoin.style.display = 'none';
        } else {
            tabBuildBtn?.classList.remove('active');
            tabJoinBtn?.classList.add('active');
            if (contentBuild) contentBuild.style.display = 'none';
            if (contentJoin) contentJoin.style.display = 'block';
        }
    }

    buildAndHostRoom() {
        const code = document.getElementById('display-room-code')?.textContent.trim() || ('FORT-' + Math.floor(1000 + Math.random() * 9000));
        const title = this.customRoomTitleInput?.value.trim() || `${this.username}'s Arena`;
        const isPublic = document.querySelector('.room-vis-pill.selected')?.dataset.visibility !== 'private';
        const password = this.customRoomPasswordInput?.value.trim() || null;
        const mode = document.querySelector('.room-mode-box.selected')?.dataset.mode || 'classic';
        const gameplayMode = document.querySelector('.room-gameplay-pill.selected')?.dataset.gameplay || 'breaking';
        const breakCost = parseInt(document.querySelector('.room-break-cost-pill.selected')?.dataset.cost || '5', 10);
        const timeSec = parseInt(document.querySelector('.room-time-pill.selected')?.dataset.sec || '30', 10);
        const walls = parseInt(document.querySelector('.room-wall-pill.selected')?.dataset.walls || (mode === 'koth' ? '5' : '10'), 10);
        const colorChoice = document.querySelector('.room-color-pill.selected')?.dataset.color || 'blue';
        const hostColor = (colorChoice === 'random') ? (Math.random() < 0.5 ? 'blue' : 'red') : colorChoice;

        fetch('/api/rooms/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                title: title,
                isPublic: isPublic,
                password: password,
                hostName: this.username,
                userId: this.userId,
                settings: { mode, gameplayMode, breakCost, timeSec, walls, hostColor }
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                this.friendsSheet.classList.remove('open');
                this.activeRoomCode = code;
                this.myPlayerRole = (hostColor === 'blue') ? 1 : 2;
                this.showRoomLobbyOverlay(code, { mode, gameplayMode, breakCost, timeSec, walls, hostColor });
                this.fetchPublicRooms();
            } else {
                this.showToast(data.error || 'Failed to create room');
            }
        })
        .catch(() => {
            this.showToast('Network error creating room');
        });
    }

    showRoomLobbyOverlay(roomCode, settings) {
        const codeTitle = document.getElementById('lobby-room-code-title');
        const statusText = document.getElementById('lobby-room-status');

        if (codeTitle) codeTitle.textContent = `Room ${roomCode}`;
        if (statusText) statusText.textContent = (settings.mode === 'koth') ? 'Waiting for players (2 to 4)...' : 'Waiting for opponent to connect...';
        if (this.roomLobbyOverlay) this.roomLobbyOverlay.style.display = 'flex';

        if (this.roomPollInterval) clearInterval(this.roomPollInterval);
        this.roomPollInterval = setInterval(() => {
            fetch(`/api/rooms/poll?code=${roomCode}&since=0`)
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.p2) {
                        clearInterval(this.roomPollInterval);
                        if (this.roomLobbyOverlay) this.roomLobbyOverlay.style.display = 'none';
                        sounds.playTurnStart();
                        this.showToast(`Opponent ${data.p2} joined!`);

                        this.playType = 'online_pvp';
                        this.opponentName = data.p2;
                        this.lastSyncedMoveIndex = 0;
                        this.startNewMatch({
                            mode: settings.mode,
                            initialWalls: settings.walls,
                            timeSec: settings.timeSec,
                            gameplayMode: settings.gameplayMode || 'breaking',
                            breakCost: settings.breakCost || 5
                        });
                        this.startOnlineMovePolling();
                    }
                })
                .catch(() => {});
        }, 1200);
    }

    joinRoomAction(codeParam, passwordParam = null) {
        let code = codeParam;
        if (!code) {
            const frontInput = document.getElementById('front-join-room-input');
            const sheetInput = document.getElementById('join-room-input');
            code = (frontInput && frontInput.value.trim()) || (sheetInput && sheetInput.value.trim()) || '';
        }
        code = code.trim().toUpperCase();
        if (!code) {
            this.showToast('Please enter a room code');
            return;
        }

        const password = passwordParam || this.joinRoomPasswordInput?.value.trim() || null;

        fetch('/api/rooms/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                guestName: this.username,
                userId: this.userId,
                password: password
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                this.friendsSheet?.classList.remove('open');
                this.activeRoomCode = code;
                const room = data.room;
                this.myPlayerRole = data.role || 2;
                this.opponentName = room.hostName || 'Host';

                this.playType = 'online_pvp';
                this.lastSyncedMoveIndex = 0;
                sounds.playTurnStart();
                this.showToast(`Connected to ${this.opponentName}'s room!`);

                this.startNewMatch({
                    mode: room.settings?.mode || 'classic',
                    initialWalls: room.settings?.walls || (room.settings?.mode === 'koth' ? 5 : 10),
                    timeSec: room.settings?.timeSec || 30,
                    gameplayMode: room.settings?.gameplayMode || 'breaking',
                    breakCost: room.settings?.breakCost || 5
                });
                this.startOnlineMovePolling();
            } else {
                this.showToast(data.reason || 'Could not join room');
                sounds.playIllegal();
            }
        })
        .catch(() => {
            this.showToast('Network error joining room');
        });
    }

    startOnlineMovePolling() {
        if (this.roomPollInterval) clearInterval(this.roomPollInterval);
        this.roomPollInterval = setInterval(() => {
            if (this.playType !== 'online_pvp' || !this.activeRoomCode || this.game.winner) {
                return;
            }

            fetch(`/api/rooms/poll?code=${this.activeRoomCode}&since=${this.lastSyncedMoveIndex}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.moves && data.moves.length > 0) {
                        data.moves.forEach(m => {
                            this.lastSyncedMoveIndex++;
                            // Only apply moves sent by opponents
                            if (m.player !== this.myPlayerRole) {
                                this.applyRemoteMove(m.move);
                            }
                        });
                    }
                })
                .catch(() => {});
        }, 750);
    }

    applyRemoteMove(move) {
        if (!move) return;
        if (move.type === 'move') {
            const res = this.game.makePawnMove(move.x, move.y);
            if (res.isJump) sounds.playPawnJump();
            else sounds.playPawnMove();
            this.vibrate(15);
            if (res.winner) {
                this.handleMatchEnd(res.winner, this.game.winReason);
            }
        } else if (move.type === 'wall') {
            const res = this.game.placeWall(move.gx, move.gy, move.orientation);
            if (res.success) {
                sounds.playWallPlace();
                this.vibrate(20);
            }
        } else if (move.type === 'break') {
            const res = this.game.breakWall(move.wallIndex, this.game.turn);
            if (res.success) {
                sounds.playIllegal();
                this.vibrate([40, 40, 60]);
                const cost = this.game.breakCost || 5;
                this.showToast(`💥 Opponent smashed a barricade (-${cost} walls)!`);
            }
        }
        this.render();
    }

    broadcastLocalMove(move) {
        if (this.playType !== 'online_pvp' || !this.activeRoomCode) return;

        // 1. Instant WebSocket broadcast
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'make_move',
                code: this.activeRoomCode,
                player: this.myPlayerRole,
                move: move
            }));
        }

        // 2. HTTP POST fallback guarantee
        fetch('/api/rooms/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: this.activeRoomCode,
                player: this.myPlayerRole,
                move: move
            })
        }).catch(() => {});
    }

    // ==========================================
    // THE DIFFERENTIATOR: BREAK WALL ACTION
    // ==========================================
    toggleBreakMode() {
        if (this.game.winner || this.isAiThinking) return;
        if (this.game.gameplayMode === 'normal') {
            this.showToast("Barricade breaking is disabled in Normal mode");
            sounds.playIllegal();
            return;
        }

        if (this.playType === 'online_pvp' && this.game.turn !== this.myPlayerRole) {
            this.showToast("Waiting for your turn...");
            return;
        }

        const cost = this.game.breakCost || 5;
        const currentWalls = this.game.playerWalls[this.game.turn];
        if (currentWalls < cost) {
            this.showToast(`Breaking a barricade requires ${cost} barricades!`);
            sounds.playIllegal();
            return;
        }

        this.isBreakMode = !this.isBreakMode;
        if (this.isBreakMode) {
            this.wallOrientation = null;
            this.btnOrientH?.classList.remove('active');
            this.btnOrientV?.classList.remove('active');
            this.btnBreakWall?.classList.add('active');
            sounds.playRotate();
            this.showToast(`💥 Tap any placed barricade to smash it (-${cost} walls)!`);
        } else {
            this.btnBreakWall?.classList.remove('active');
            sounds.playRotate();
        }
    }

    executeBreakWall(wallIndex) {
        if (this.game.gameplayMode === 'normal') {
            this.showToast("Barricade breaking is disabled in Normal mode");
            sounds.playIllegal();
            return;
        }

        const cost = this.game.breakCost || 5;
        if (!this.isBreakMode) {
            if (this.game.playerWalls[this.game.turn] < cost) {
                this.showToast(`💥 Breaking a barricade requires ${cost} barricades!`);
                sounds.playIllegal();
                return;
            }
        }
        const res = this.game.breakWall(wallIndex, this.game.turn);
        if (res.success) {
            sounds.playIllegal();
            this.vibrate([40, 40, 60]);
            this.isBreakMode = false;
            this.btnBreakWall?.classList.remove('active');
            this.showToast(`💥 Barricade smashed (-${cost} walls)! Rubble permanently blocks new walls.`);

            if (this.playType === 'online_pvp') {
                this.broadcastLocalMove({ type: 'break', wallIndex });
            }

            this.render();
            this.triggerAiTurnIfNeeded();
        } else {
            sounds.playIllegal();
            this.showToast(res.reason);
        }
    }

    // ==========================================
    // SIGN IN & USERNAME VALIDATION
    // ==========================================
    openSignInSheet() {
        this.signInInput.value = this.isSignedIn ? this.username : '';
        this.signInInput.placeholder = this.username;
        this.signInSheet.classList.add('open');
        setTimeout(() => this.signInInput.focus(), 250);
    }

    handleSignInSubmit() {
        const rawName = this.signInInput.value.trim();

        if (!rawName) {
            this.showToast('Please enter a username');
            return;
        }

        if (rawName.length < 3 || rawName.length > 15) {
            this.showToast('Username must be 3-15 characters');
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(rawName)) {
            this.showToast('Only letters, numbers, and underscores allowed');
            return;
        }

        // Verify and claim username atomically via server
        fetch('/api/auth/custom-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: this.userId, username: rawName })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.user) {
                this.username = data.user.username;
                this.isSignedIn = true;
                localStorage.setItem('fortivex_username', this.username);
                localStorage.setItem('fortivex_signed_in', 'true');

                const streakKey = `fortivex_streak_${this.username}`;
                this.userStreak = data.user.streak || 0;
                localStorage.setItem(streakKey, this.userStreak);

                this.signInSheet.classList.remove('open');
                this.showToast(`Signed in as ${this.username}!`);
                sounds.playVictory();
                this.vibrate([20, 20]);
                this.render();
            } else {
                this.showToast(data.reason || 'Username already taken by another player!');
                sounds.playIllegal();
            }
        })
        .catch(() => {
            // Local fallback
            this.username = rawName;
            this.isSignedIn = true;
            localStorage.setItem('fortivex_username', this.username);
            localStorage.setItem('fortivex_signed_in', 'true');
            this.signInSheet.classList.remove('open');
            this.showToast(`Signed in as ${this.username}!`);
            this.render();
        });
    }

    // ==========================================
    // TOUCH DRAG & DROP ENGINE (PHONE OPTIMIZED)
    // ==========================================
    bindTouchDragOnElement(element, orientation) {
        element.addEventListener('touchstart', (e) => {
            if (this.game.winner || this.isAiThinking) return;
            if (this.playType === 'pve' && this.game.turn !== (this.myPlayerRole || 1)) return;
            if (this.playType === 'online_pvp' && this.game.turn !== this.myPlayerRole) {
                this.showToast("Waiting for opponent's turn...");
                return;
            }

            const currentWalls = this.game.playerWalls[this.game.turn];
            if (currentWalls <= 0) {
                this.showToast('No walls remaining!');
                return;
            }

            this.isBreakMode = false;
            this.btnBreakWall?.classList.remove('active');

            e.preventDefault();
            const touch = e.touches[0];
            this.startTouchDrag(touch.clientX, touch.clientY, orientation);
        }, { passive: false });

        element.addEventListener('touchmove', (e) => {
            if (!this.isDraggingTouch) return;
            e.preventDefault();
            const touch = e.touches[0];
            this.moveTouchDrag(touch.clientX, touch.clientY);
        }, { passive: false });

        element.addEventListener('touchend', (e) => {
            if (!this.isDraggingTouch) return;
            e.preventDefault();
            this.endTouchDrag();
        }, { passive: false });
    }

    startTouchDrag(clientX, clientY, orientation) {
        this.isDraggingTouch = true;
        this.dragOrientation = orientation;
        this.wallOrientation = orientation;
        this.isBreakMode = false;
        this.btnBreakWall?.classList.remove('active');

        this.touchFloatingWall.style.display = 'block';

        const metrics = this.getBoardMetrics();
        const width = orientation === 'H' ? (2 * metrics.cellSize + metrics.gapSize) : metrics.gapSize;
        const height = orientation === 'H' ? metrics.gapSize : (2 * metrics.cellSize + metrics.gapSize);

        this.touchFloatingWall.style.width = `${width}px`;
        this.touchFloatingWall.style.height = `${height}px`;

        this.moveTouchDrag(clientX, clientY);
        sounds.playRotate();
        this.vibrate(15);

        // Global touch tracking during active drag
        const onGlobalTouchMove = (e) => {
            if (!this.isDraggingTouch) return;
            e.preventDefault();
            const touch = e.touches[0];
            this.moveTouchDrag(touch.clientX, touch.clientY);
        };

        const onGlobalTouchEnd = (e) => {
            if (!this.isDraggingTouch) return;
            e.preventDefault();
            window.removeEventListener('touchmove', onGlobalTouchMove);
            window.removeEventListener('touchend', onGlobalTouchEnd);
            window.removeEventListener('touchcancel', onGlobalTouchEnd);
            this.endTouchDrag();
        };

        window.addEventListener('touchmove', onGlobalTouchMove, { passive: false });
        window.addEventListener('touchend', onGlobalTouchEnd, { passive: false });
        window.addEventListener('touchcancel', onGlobalTouchEnd, { passive: false });
    }

    moveTouchDrag(clientX, clientY) {
        if (!this.isDraggingTouch) return;
        const targetY = clientY - this.dragTouchOffsetY;

        this.touchFloatingWall.style.left = `${clientX}px`;
        this.touchFloatingWall.style.top = `${targetY}px`;

        // Check groove at the actual visual target position
        this.checkGrooveAtPoint(clientX, clientY, this.dragOrientation, false);
    }

    endTouchDrag() {
        if (!this.isDraggingTouch) return;
        this.isDraggingTouch = false;
        this.touchFloatingWall.style.display = 'none';

        if (this.hoverGroove) {
            const { gx, gy } = this.hoverGroove;
            const placedOrientation = this.dragOrientation;
            const res = this.game.placeWall(gx, gy, placedOrientation);
            if (res.success) {
                sounds.playWallPlace();
                this.vibrate(20);
                this.hideGhostWall();

                this.wallOrientation = null;
                this.btnOrientH.classList.remove('active');
                this.btnOrientV.classList.remove('active');

                this.render();

                if (this.playType === 'puzzle') {
                    this.verifyPuzzleMove({ type: 'wall', gx, gy, orientation: placedOrientation });
                } else if (this.playType === 'online_pvp') {
                    this.broadcastLocalMove({ type: 'wall', gx, gy, orientation: placedOrientation });
                } else {
                    this.triggerAiTurnIfNeeded();
                }
                return;
            } else {
                sounds.playIllegal();
                this.showToast(res.reason);
            }
        }

        this.hideGhostWall();
    }

    handleBoardTouchStart(e) {
        if (this.isBreakMode) return;
        if (!this.wallOrientation || this.game.winner || this.isAiThinking) return;
        if (this.playType === 'online_pvp' && this.game.turn !== this.myPlayerRole) return;
        const touch = e.touches[0];
        this.startTouchDrag(touch.clientX, touch.clientY, this.wallOrientation);
    }

    handleBoardTouchMove(e) {
        if (!this.isDraggingTouch) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.moveTouchDrag(touch.clientX, touch.clientY);
    }

    handleBoardTouchEnd(e) {
        if (!this.isDraggingTouch) return;
        e.preventDefault();
        this.endTouchDrag();
    }

    checkGrooveAtPoint(clientX, clientY, orientation, isDirectTap = false) {
        const metrics = this.getBoardMetrics();
        if (!metrics) return;

        const targetY = isDirectTap ? clientY : (clientY - this.dragTouchOffsetY);
        const step = metrics.cellSize + metrics.gapSize;

        let bestGroove = null;
        let minScore = Infinity;

        for (let gy = 0; gy < 8; gy++) {
            for (let gx = 0; gx < 8; gx++) {
                const cx = metrics.cellRect00.left + gx * step + metrics.cellSize + (metrics.gapSize / 2);
                const cy = metrics.cellRect00.top + gy * step + metrics.cellSize + (metrics.gapSize / 2);

                const dx = Math.abs(clientX - cx);
                const dy = Math.abs(targetY - cy);

                let score = Infinity;
                if (orientation === 'H') {
                    if (dx <= metrics.cellSize * 1.3 && dy <= (metrics.cellSize + metrics.gapSize) * 0.95) {
                        score = dx * 0.5 + dy * 1.8;
                    }
                } else {
                    if (dy <= metrics.cellSize * 1.3 && dx <= (metrics.cellSize + metrics.gapSize) * 0.95) {
                        score = dy * 0.5 + dx * 1.8;
                    }
                }

                if (score < minScore) {
                    minScore = score;
                    bestGroove = { gx, gy };
                }
            }
        }

        if (bestGroove) {
            this.hoverGroove = bestGroove;
            this.updateGhostWall(bestGroove.gx, bestGroove.gy, orientation);
        } else {
            this.hideGhostWall();
        }
    }

    toggleWallOrientation(orientation) {
        this.isBreakMode = false;
        this.btnBreakWall?.classList.remove('active');

        if (this.wallOrientation === orientation) {
            this.wallOrientation = null;
            this.btnOrientH.classList.remove('active');
            this.btnOrientV.classList.remove('active');
            this.hideGhostWall();
            sounds.playRotate();
            this.vibrate(8);
        } else {
            this.wallOrientation = orientation;
            this.btnOrientH.classList.toggle('active', orientation === 'H');
            this.btnOrientV.classList.toggle('active', orientation === 'V');
            sounds.playRotate();
            this.vibrate(12);
        }
    }

    vibrate(pattern = 15) {
        if (navigator.vibrate) {
            try { navigator.vibrate(pattern); } catch (e) {}
        }
    }

    startClock() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (this.currentView === 'game' && !this.game.winner && !this.isWatchMode) {
                this.game.updateClock();
                this.renderClocks();
                if (this.game.winner) {
                    sounds.playIllegal();
                    this.handleMatchEnd(this.game.winner, this.game.winReason);
                }
            }
        }, 250);
    }

    switchView(viewName) {
        this.currentView = viewName;
        if (viewName === 'home') {
            this.homeView.style.display = 'flex';
            this.gameView.style.display = 'none';
            this.fetchPublicRooms();
        } else {
            this.homeView.style.display = 'none';
            this.gameView.style.display = 'flex';
        }
    }

    showChatBubble(player, text) {
        const bubbles = [null, this.p1ChatBubble, this.p2ChatBubble, this.p3ChatBubble, this.p4ChatBubble];
        const bubble = bubbles[player];
        if (bubble) {
            bubble.textContent = text;
            bubble.style.display = 'block';
            setTimeout(() => { bubble.style.display = 'none'; }, 2400);
        }
    }

    getBoardMetrics() {
        const cell00 = this.boardGrid.querySelector('[data-x="0"][data-y="0"]');
        const cell10 = this.boardGrid.querySelector('[data-x="1"][data-y="0"]');
        if (!cell00 || !cell10) return null;

        const cellRect00 = cell00.getBoundingClientRect();
        const cellRect10 = cell10.getBoundingClientRect();
        const frameRect = this.boardFrame.getBoundingClientRect();

        const cellSize = cellRect00.width;
        const gapSize = cellRect10.left - cellRect00.right;
        const offsetLeft = cellRect00.left - frameRect.left;
        const offsetTop = cellRect00.top - frameRect.top;

        return { cellSize, gapSize, offsetLeft, offsetTop, cellRect00, frameRect };
    }

    handleBoardPointerMove(e) {
        if (this.game.winner || this.isAiThinking || !this.wallOrientation || this.isBreakMode) {
            this.hideGhostWall();
            return;
        }

        if (this.playType === 'pve' && this.game.turn !== (this.myPlayerRole || 1)) return;
        if (this.playType === 'online_pvp' && this.game.turn !== this.myPlayerRole) return;
        this.checkGrooveAtPoint(e.clientX, e.clientY, this.wallOrientation, true);
    }

    updateGhostWall(gx, gy, orientation = this.wallOrientation) {
        if (!orientation || this.isBreakMode) {
            this.hideGhostWall();
            return;
        }

        const metrics = this.getBoardMetrics();
        if (!metrics) return;

        const step = metrics.cellSize + metrics.gapSize;
        const validation = this.game.validateWallPlacement(gx, gy, orientation, this.game.turn);

        this.ghostWallSnap.style.display = 'block';
        this.ghostWallSnap.className = `ghost-wall-snap ${validation.valid ? 'valid' : 'invalid'}`;

        if (orientation === 'H') {
            this.ghostWallSnap.style.left = `${metrics.offsetLeft + gx * step}px`;
            this.ghostWallSnap.style.top = `${metrics.offsetTop + gy * step + metrics.cellSize}px`;
            this.ghostWallSnap.style.width = `${2 * metrics.cellSize + metrics.gapSize}px`;
            this.ghostWallSnap.style.height = `${metrics.gapSize}px`;
        } else {
            this.ghostWallSnap.style.left = `${metrics.offsetLeft + gx * step + metrics.cellSize}px`;
            this.ghostWallSnap.style.top = `${metrics.offsetTop + gy * step}px`;
            this.ghostWallSnap.style.width = `${metrics.gapSize}px`;
            this.ghostWallSnap.style.height = `${2 * metrics.cellSize + metrics.gapSize}px`;
        }
    }

    hideGhostWall() {
        this.hoverGroove = null;
        this.ghostWallSnap.style.display = 'none';
    }

    handleBoardClick(e) {
        if (this.game.winner || this.isAiThinking || this.isWatchMode) return;
        if (this.playType === 'pve' && this.game.turn !== 1) return;
        if (this.playType === 'online_pvp' && this.game.turn !== this.myPlayerRole) {
            this.showToast("Waiting for opponent's turn...");
            return;
        }

        // If in break mode, clicking empty board does nothing (must click a placed wall)
        if (this.isBreakMode) {
            return;
        }

        // 1. WALL PLACEMENT: If wall mode is selected
        if (this.wallOrientation) {
            if (!this.hoverGroove) {
                this.checkGrooveAtPoint(e.clientX, e.clientY, this.wallOrientation, true);
            }

            if (this.hoverGroove) {
                const { gx, gy } = this.hoverGroove;
                const placedOrientation = this.wallOrientation;
                const res = this.game.placeWall(gx, gy, placedOrientation);
                if (res.success) {
                    sounds.playWallPlace();
                    this.vibrate(20);
                    this.hideGhostWall();

                    this.wallOrientation = null;
                    this.btnOrientH.classList.remove('active');
                    this.btnOrientV.classList.remove('active');

                    this.render();

                    if (this.playType === 'puzzle') {
                        this.verifyPuzzleMove({ type: 'wall', gx, gy, orientation: placedOrientation });
                    } else if (this.playType === 'online_pvp') {
                        this.broadcastLocalMove({ type: 'wall', gx, gy, orientation: placedOrientation });
                    } else {
                        this.triggerAiTurnIfNeeded();
                    }
                    return;
                } else {
                    sounds.playIllegal();
                    this.showToast(res.reason);
                    return;
                }
            }
        }

        // 2. PAWN MOVE: Tapping destination tile (Default Mode)
        const tile = e.target.closest('.grid-tile');
        if (tile) {
            const tx = parseInt(tile.dataset.x, 10);
            const ty = parseInt(tile.dataset.y, 10);

            const validMoves = this.game.getValidPawnMoves(this.game.turn);
            const move = validMoves.find(m => m.x === tx && m.y === ty);

            if (move) {
                const res = this.game.makePawnMove(tx, ty);
                if (res.success) {
                    if (res.isJump) {
                        sounds.playPawnJump();
                        this.vibrate([20, 20]);
                    } else {
                        sounds.playPawnMove();
                        this.vibrate(15);
                    }

                    this.render();

                    if (this.playType === 'puzzle') {
                        this.verifyPuzzleMove({ type: 'move', x: tx, y: ty });
                    } else if (this.playType === 'online_pvp') {
                        this.broadcastLocalMove({ type: 'move', x: tx, y: ty });
                        if (res.winner) {
                            this.handleMatchEnd(res.winner, this.game.winReason);
                        }
                    } else if (res.winner) {
                        this.handleMatchEnd(res.winner, this.game.winReason);
                    } else {
                        this.triggerAiTurnIfNeeded();
                    }
                }
            }
        }
    }

    triggerAiTurnIfNeeded() {
        if (this.game.winner || this.playType === 'puzzle' || this.playType === 'pvp' || this.playType === 'online_pvp') return;

        // In PvE mode, if active turn is NOT human player, let AI play!
        const humanRole = this.myPlayerRole || 1;
        if (this.playType === 'pve' && this.game.turn !== humanRole) {
            const activeBotTurn = this.game.turn;
            this.isAiThinking = true;

            const botBox = (activeBotTurn === 2) ? this.p2Box : (activeBotTurn === 3 ? this.p3Box : this.p4Box);
            if (botBox) botBox.classList.add('ai-thinking');

            const diffDelays = {
                easy: 260,
                medium: 400,
                hard: 550,
                impossible: 720
            };
            const thinkingDelay = diffDelays[this.selectedBotDiff || 'medium'] || 400;

            setTimeout(() => {
                const aiMove = this.ai.chooseMove(this.game, activeBotTurn);
                if (aiMove) {
                    if (aiMove.type === 'move') {
                        const res = this.game.makePawnMove(aiMove.x, aiMove.y);
                        if (res.isJump) sounds.playPawnJump();
                        else sounds.playPawnMove();
                        if (res.winner) this.handleMatchEnd(res.winner, this.game.winReason);
                    } else if (aiMove.type === 'wall') {
                        this.game.placeWall(aiMove.gx, aiMove.gy, aiMove.orientation);
                        sounds.playWallPlace();
                    } else if (aiMove.type === 'break') {
                        const cost = this.game.breakCost || 5;
                        this.game.breakWall(aiMove.wallIndex, activeBotTurn);
                        sounds.playIllegal();
                        this.showToast(`💥 Bot smashed barricade (-${cost} walls)!`);
                    }
                }
                if (botBox) botBox.classList.remove('ai-thinking');
                this.isAiThinking = false;
                this.render();
                sounds.playTurnStart();

                // If next turn is also a bot (e.g. KOTH 4P turns 2, 3, 4), continue!
                if (!this.game.winner && this.playType === 'pve' && this.game.turn !== humanRole) {
                    setTimeout(() => this.triggerAiTurnIfNeeded(), 450);
                }
            }, thinkingDelay);
        }
    }

    // ==========================================
    // DIRECT DAILY TACTICAL PUZZLES (3 FREE/DAY)
    // ==========================================
    openDailyPuzzleDirectly(isReplay = false) {
        const todayStr = new Date().toISOString().slice(0, 10);
        this.dailyPuzzles = BarricadeGame.getDailyPuzzles(todayStr);

        let solvedToday = JSON.parse(localStorage.getItem('barricade_daily_' + todayStr) || '[]');
        if (isReplay) {
            this.dailyPuzzleIdx = 0;
        } else {
            if (solvedToday.length >= 3) {
                if (this.dailyCompleteSheet) this.dailyCompleteSheet.classList.add('open');
                return;
            }
            let nextIdx = 0;
            for (let i = 0; i < 3; i++) {
                if (!solvedToday.includes(i)) {
                    nextIdx = i;
                    break;
                }
            }
            this.dailyPuzzleIdx = nextIdx;
        }

        const puzzle = this.dailyPuzzles[this.dailyPuzzleIdx];
        this.playType = 'puzzle';
        this.isRanked = false;
        this.game.loadPuzzle(puzzle);
        this.switchView('game');
        this.showToast(`Daily Puzzle ${this.dailyPuzzleIdx + 1}/3: ${puzzle.title}`);
        this.render();
    }

    verifyPuzzleMove(move) {
        if (!this.game.currentPuzzle) return;
        const sol = this.game.currentPuzzle.solution;
        let isCorrect = false;

        if (sol.type === 'move' && move.type === 'move') {
            isCorrect = (move.x === sol.x && move.y === sol.y);
        } else if (sol.type === 'wall' && move.type === 'wall') {
            isCorrect = (move.gx === sol.gx && move.gy === sol.gy && move.orientation === sol.orientation);
        }

        if (isCorrect) {
            sounds.playVictory();
            this.vibrate([30, 30]);

            const todayStr = new Date().toISOString().slice(0, 10);
            let solvedToday = JSON.parse(localStorage.getItem('barricade_daily_' + todayStr) || '[]');
            if (!solvedToday.includes(this.dailyPuzzleIdx)) {
                solvedToday.push(this.dailyPuzzleIdx);
                localStorage.setItem('barricade_daily_' + todayStr, JSON.stringify(solvedToday));
            }

            if (this.dailyPuzzleIdx < 2 && solvedToday.length < 3) {
                this.showToast(`🎉 Puzzle ${this.dailyPuzzleIdx + 1}/3 Solved! Next puzzle...`);
                setTimeout(() => {
                    this.dailyPuzzleIdx++;
                    const nextPuzzle = this.dailyPuzzles[this.dailyPuzzleIdx];
                    this.game.loadPuzzle(nextPuzzle);
                    this.render();
                    this.showToast(`Daily Puzzle ${this.dailyPuzzleIdx + 1}/3: ${nextPuzzle.title}`);
                }, 1200);
            } else {
                this.showToast("🏆 All 3 Daily Puzzles Solved! Excellent tactical mastery!");
                setTimeout(() => {
                    if (this.dailyCompleteSheet) this.dailyCompleteSheet.classList.add('open');
                }, 1400);
            }
        } else {
            this.showToast("Incorrect move. Try another approach!");
            this.vibrate([50, 50, 50]);
            setTimeout(() => {
                this.game.undo();
                this.render();
            }, 600);
        }
    }

    handleMatchEnd(winner, reason) {
        sounds.playVictory();
        const isWin = (winner === this.myPlayerRole);
        const delta = isWin ? 30 : -30;
        const beforeElo = this.userRating;

        if (this.isRanked) {
            this.userRating = Math.max(100, this.userRating + delta);
            if (isWin) {
                this.userStreak++;
            } else {
                this.userStreak = 0; // Personal streak resets on ranked loss
            }

            localStorage.setItem('fortivex_elo', this.userRating);
            localStorage.setItem(`fortivex_streak_${this.username}`, this.userStreak);

            if (this.userId) {
                fetch('/api/user/ranked-result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.userId,
                        isWin: isWin,
                        opponentName: this.opponentName
                    })
                }).catch(() => {});
            }
        }

        // Open Game Over Sheet
        if (this.goWinnerTitle) this.goWinnerTitle.textContent = isWin ? 'Victory!' : 'Defeat!';
        if (this.goReasonSub) this.goReasonSub.textContent = reason || (isWin ? 'Reached the goal line' : 'Opponent reached the goal line');
        if (this.goOpponentName) this.goOpponentName.textContent = this.opponentName || 'Opponent';

        if (this.goRatingChange) {
            if (this.isRanked) {
                this.goRatingChange.textContent = `${beforeElo} → ${this.userRating} (${delta > 0 ? '+' + delta : delta})`;
                this.goRatingChange.className = `gameover-rating-chip ${isWin ? 'rating-win' : 'rating-loss'}`;
            } else {
                this.goRatingChange.textContent = 'Unranked Match';
                this.goRatingChange.className = 'gameover-rating-chip';
            }
        }

        const totalMoves = (this.game && this.game.moveHistory) ? this.game.moveHistory.length : 0;
        if (this.goTurnsCount) this.goTurnsCount.textContent = `${totalMoves} moves`;

        const matchDuration = this.matchStartTime ? Math.floor((Date.now() - this.matchStartTime) / 1000) : 45;
        if (this.goDurationVal) this.goDurationVal.textContent = this.formatClock(matchDuration);

        setTimeout(() => {
            this.gameOverSheet?.classList.add('open');
        }, 600);
    }

    startWatchMode() {
        this.playType = 'watch';
        this.isWatchMode = true;
        this.startNewMatch({ mode: 'classic', initialWalls: 10, timeSec: 300 });
        this.showToast('Spectating Live Bot Match');

        const runBotStep = () => {
            if (!this.isWatchMode || this.game.winner) return;
            const mover = this.game.turn;
            const move = this.ai.chooseMove(this.game, mover);
            if (move) {
                if (move.type === 'move') {
                    const res = this.game.makePawnMove(move.x, move.y);
                    if (res.isJump) sounds.playPawnJump();
                    else sounds.playPawnMove();
                } else if (move.type === 'wall') {
                    this.game.placeWall(move.gx, move.gy, move.orientation);
                    sounds.playWallPlace();
                } else if (move.type === 'break') {
                    this.game.breakWall(move.wallIndex, mover);
                    sounds.playIllegal();
                }
            }
            this.render();
            if (!this.game.winner && this.isWatchMode) {
                setTimeout(runBotStep, 800);
            }
        };

        setTimeout(runBotStep, 900);
    }

    launchConfiguredGame() {
        const modeChoice = document.querySelector('.sheet-mode-box.selected')?.dataset.mode || 'classic';
        const timeChoice = parseInt(document.querySelector('.time-pill.selected')?.dataset.sec || '180', 10);
        const wallChoice = parseInt(document.querySelector('.wall-pill.selected')?.dataset.walls || (modeChoice === 'koth' ? '5' : '10'), 10);
        const diffChoice = document.querySelector('.diff-pill.selected')?.dataset.diff || 'medium';

        this.selectedBotDiff = diffChoice;
        this.ai.setDifficulty(diffChoice);

        this.startNewMatch({
            mode: modeChoice,
            initialWalls: wallChoice,
            timeSec: timeChoice
        });
    }

    launchBotMatch() {
        this.botSheet?.classList.remove('open');
        const gameplayMode = document.querySelector('#bot-sheet .bot-gameplay-pill.selected')?.dataset.gameplay || 'breaking';
        const diff = document.querySelector('#bot-sheet .diff-pill.selected')?.dataset.diff || 'medium';
        const mode = document.querySelector('#bot-sheet .bot-mode-box.selected')?.dataset.mode || 'classic';
        const breakCost = parseInt(document.querySelector('#bot-sheet .bot-break-cost-pill.selected')?.dataset.cost || '5', 10);
        const walls = parseInt(document.querySelector('#bot-sheet .bot-wall-pill.selected')?.dataset.walls || (mode === 'koth' ? '5' : '10'), 10);
        const timeSec = parseInt(document.querySelector('#bot-sheet .bot-time-pill.selected')?.dataset.sec || '180', 10);
        const colorChoice = document.querySelector('#bot-sheet .bot-color-pill.selected')?.dataset.color || 'blue';
        const myColor = (colorChoice === 'random') ? (Math.random() < 0.5 ? 'blue' : 'red') : colorChoice;

        this.selectedBotDiff = diff;
        this.ai.setDifficulty(diff);
        this.playType = 'pve';
        this.isRanked = false;
        this.isOpponentAi = true;
        this.myPlayerRole = (myColor === 'blue') ? 1 : 2;

        // Persistent 100-AI pool matching selected difficulty
        const botPool = {
            easy: [
                { username: 'noob10005', rating: 920 },
                { username: 'noob10012', rating: 1040 },
                { username: 'noob10018', rating: 1150 },
                { username: 'noob10024', rating: 1220 }
            ],
            medium: [
                { username: 'noob10031', rating: 1350 },
                { username: 'noob10042', rating: 1480 },
                { username: 'noob10050', rating: 1560 },
                { username: 'noob10058', rating: 1620 }
            ],
            hard: [
                { username: 'noob10065', rating: 1720 },
                { username: 'noob10072', rating: 1840 },
                { username: 'noob10079', rating: 1950 },
                { username: 'noob10084', rating: 2020 }
            ],
            impossible: [
                { username: 'noob10088', rating: 2150 },
                { username: 'noob10092', rating: 2280 },
                { username: 'noob10096', rating: 2390 },
                { username: 'noob10100', rating: 2450 }
            ]
        };

        const list = botPool[diff] || botPool.medium;
        const pickedBot = list[Math.floor(Math.random() * list.length)];

        this.opponentName = pickedBot.username; // Strictly noobXXXXX
        this.opponentRating = pickedBot.rating;

        this.startNewMatch({
            mode: mode,
            gameplayMode: gameplayMode,
            breakCost: breakCost,
            initialWalls: walls,
            timeSec: timeSec
        });

        this.showToast(`Starting match vs ${this.opponentName}!`);

        if (this.myPlayerRole === 2 && this.game.turn === 1) {
            this.triggerAiTurnIfNeeded();
        }
    }

    startNewMatch(opts = {}) {
        const mode = opts.mode || 'classic';
        const gameplayMode = opts.gameplayMode || 'breaking';
        const breakCost = opts.breakCost !== undefined ? opts.breakCost : 5;
        const initialWalls = opts.initialWalls !== undefined ? opts.initialWalls : (mode === 'koth' ? 5 : 10);

        this.matchStartTime = Date.now();
        this.game = new BarricadeGame({
            gameMode: mode,
            gameplayMode: gameplayMode,
            breakCost: breakCost,
            initialWalls: initialWalls,
            timeControl: { initialSec: opts.timeSec || 180, incrementSec: 0 }
        });

        this.isAiThinking = false;
        this.wallOrientation = null;
        this.isBreakMode = false;

        this.btnOrientH?.classList.remove('active');
        this.btnOrientV?.classList.remove('active');
        this.btnBreakWall?.classList.remove('active');
        this.hideGhostWall();

        // Update Break Wall Button visibility & label based on gameplayMode
        if (this.btnBreakWall) {
            if (this.game.gameplayMode === 'normal') {
                this.btnBreakWall.style.display = 'none';
            } else {
                this.btnBreakWall.style.display = 'inline-flex';
                const textSpan = this.btnBreakWall.querySelector('span:not(.pill-icon-break)');
                if (textSpan) textSpan.textContent = `Break (-${this.game.breakCost})`;
            }
        }

        this.switchView('game');
        sounds.playTurnStart();
        this.render();
    }

    showToast(msg) {
        const textSpan = this.toastEl.querySelector('.toast-text');
        if (textSpan) textSpan.textContent = msg;
        this.toastEl.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toastEl.classList.remove('show');
        }, 2400);
    }

    formatClock(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    render() {
        this.renderUserBadges();
        this.renderBoard();
        this.renderPawns();
        this.renderWalls();
        this.renderPlayerCards();
        this.renderClocks();
        this.renderMoveLog();
    }

    renderUserBadges() {
        // Home Screen Profile Badge
        if (this.homeUsernameText) {
            this.homeUsernameText.textContent = this.username;
        }
        if (this.homeEloBadge) {
            this.homeEloBadge.textContent = `${this.userRating}`;
        }
        if (this.homeStreakBadge) {
            this.homeStreakBadge.textContent = `${this.userStreak}`;
        }

        // Show Sign In CTA if user has default name
        if (this.homeSignInPrompt) {
            this.homeSignInPrompt.style.display = this.isSignedIn ? 'none' : 'inline-block';
        }

        // In-Game Player Card Names
        if (this.p1NameLabel) {
            this.p1NameLabel.textContent = (this.playType === 'watch') ? 'noob10015' : this.username;
        }
        if (this.p1EloTag) {
            this.p1EloTag.textContent = (this.playType === 'watch') ? '(1520)' : `(${this.userRating})`;
        }

        if (this.p2NameLabel && this.p2EloTag) {
            if (this.playType === 'puzzle') {
                this.p2NameLabel.textContent = `Daily #${(this.dailyPuzzleIdx || 0) + 1}/3`;
                this.p2EloTag.textContent = '(Tactics)';
                if (this.p2BotTag) this.p2BotTag.style.display = 'none';
            } else if (this.playType === 'online_pvp') {
                this.p2NameLabel.textContent = this.opponentName || 'Opponent';
                this.p2EloTag.textContent = `(${this.opponentRating || 'Online'})`;
                if (this.p2BotTag) this.p2BotTag.style.display = this.isOpponentAi ? 'inline-block' : 'none';
            } else if (this.playType === 'pvp') {
                this.p2NameLabel.textContent = 'Player 2';
                this.p2EloTag.textContent = '(Local)';
                if (this.p2BotTag) this.p2BotTag.style.display = 'none';
            } else if (this.playType === 'watch') {
                this.p2NameLabel.textContent = 'noob10088';
                this.p2EloTag.textContent = '(1980)';
                if (this.p2BotTag) this.p2BotTag.style.display = 'inline-block';
            } else {
                this.p2NameLabel.textContent = this.opponentName || 'noob10042';
                this.p2EloTag.textContent = `(${this.opponentRating || 1350})`;
                if (this.p2BotTag) this.p2BotTag.style.display = 'inline-block';
            }
        }

        // KOTH 4-Player mode player names
        if (this.game.gameMode === 'koth') {
            if (this.p3NameLabel) this.p3NameLabel.textContent = 'noob10055';
            if (this.p3EloTag) this.p3EloTag.textContent = '(1620)';
            if (this.p3BotTag) this.p3BotTag.style.display = 'inline-block';
            if (this.p4NameLabel) this.p4NameLabel.textContent = 'noob10082';
            if (this.p4EloTag) this.p4EloTag.textContent = '(1810)';
            if (this.p4BotTag) this.p4BotTag.style.display = 'inline-block';
        }
    }

    renderBoard() {
        const humanRole = this.myPlayerRole || 1;
        const isMyTurn = (this.playType !== 'online_pvp' || this.game.turn === humanRole);
        const validMoves = (this.isAiThinking || (this.playType === 'pve' && this.game.turn !== humanRole) || !isMyTurn || this.isBreakMode)
            ? [] 
            : this.game.getValidPawnMoves(this.game.turn);

        const isKoth = (this.game.gameMode === 'koth');
        const tiles = this.boardGrid.querySelectorAll('.grid-tile');

        tiles.forEach(tile => {
            tile.classList.remove('valid-dest', 'valid-jump');
            const x = parseInt(tile.dataset.x, 10);
            const y = parseInt(tile.dataset.y, 10);

            // King of the Hill center crown ONLY in KOTH mode
            if (x === 4 && y === 4) {
                tile.classList.toggle('koth-center-tile', isKoth);
            }

            const move = validMoves.find(m => m.x === x && m.y === y);
            if (move) {
                tile.classList.add('valid-dest');
                if (move.isJump) tile.classList.add('valid-jump');
            }
        });
    }

    renderPawns() {
        this.boardGrid.querySelectorAll('.board-pawn').forEach(p => p.remove());

        // P1: Blue
        const p1 = this.game.pawns[1];
        if (p1) {
            const tile = this.boardGrid.querySelector(`[data-x="${p1.x}"][data-y="${p1.y}"]`);
            if (tile) {
                const pawn = document.createElement('div');
                pawn.className = 'board-pawn blue-pawn';
                tile.appendChild(pawn);
            }
        }

        // P2: Red
        const p2 = this.game.pawns[2];
        if (p2) {
            const tile = this.boardGrid.querySelector(`[data-x="${p2.x}"][data-y="${p2.y}"]`);
            if (tile) {
                const pawn = document.createElement('div');
                pawn.className = 'board-pawn red-pawn';
                tile.appendChild(pawn);
            }
        }

        // P3: Green (KOTH 4-Player Mode)
        const p3 = this.game.pawns[3];
        if (this.game.numPlayers >= 3 && p3) {
            const tile = this.boardGrid.querySelector(`[data-x="${p3.x}"][data-y="${p3.y}"]`);
            if (tile) {
                const pawn = document.createElement('div');
                pawn.className = 'board-pawn green-pawn';
                tile.appendChild(pawn);
            }
        }

        // P4: Yellow (KOTH 4-Player Mode)
        const p4 = this.game.pawns[4];
        if (this.game.numPlayers >= 4 && p4) {
            const tile = this.boardGrid.querySelector(`[data-x="${p4.x}"][data-y="${p4.y}"]`);
            if (tile) {
                const pawn = document.createElement('div');
                pawn.className = 'board-pawn yellow-pawn';
                tile.appendChild(pawn);
            }
        }
    }

    renderWalls() {
        this.placedWallsLayer.innerHTML = '';
        const metrics = this.getBoardMetrics();
        if (!metrics) return;

        const step = metrics.cellSize + metrics.gapSize;

        this.game.walls.forEach((w, idx) => {
            const wallDiv = document.createElement('div');
            wallDiv.dataset.wallIndex = idx;

            const playerColors = ['', 'wall-blue', 'wall-red', 'wall-green', 'wall-yellow'];
            const wallClass = playerColors[w.player] || 'wall-blue';

            if (w.isBroken) {
                const dirClass = (w.orientation === 'H') ? 'broken-wall-h' : 'broken-wall-v';
                wallDiv.className = `barricade-wall broken-wall ${dirClass}`;
                const crackSymbol = (w.orientation === 'H') ? '\\ \\' : '/ /';
                wallDiv.innerHTML = `<span class="broken-bar-seg"></span><span class="broken-gap-symbol">${crackSymbol}</span><span class="broken-bar-seg"></span>`;
            } else {
                wallDiv.className = `barricade-wall ${wallClass}`;
            }

            if (w.orientation === 'H') {
                wallDiv.style.left = `${metrics.offsetLeft + w.gx * step}px`;
                wallDiv.style.top = `${metrics.offsetTop + w.gy * step + metrics.cellSize}px`;
                wallDiv.style.width = `${2 * metrics.cellSize + metrics.gapSize}px`;
                wallDiv.style.height = `${metrics.gapSize}px`;
            } else {
                wallDiv.style.left = `${metrics.offsetLeft + w.gx * step + metrics.cellSize}px`;
                wallDiv.style.top = `${metrics.offsetTop + w.gy * step}px`;
                wallDiv.style.width = `${metrics.gapSize}px`;
                wallDiv.style.height = `${2 * metrics.cellSize + metrics.gapSize}px`;
            }

            // Click wall to break it when in Break Wall mode or direct tap!
            wallDiv.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                if (w.isBroken) {
                    this.showToast('🧱 Rubble permanently blocks new barricades');
                    return;
                }
                if (this.game.gameplayMode === 'normal') {
                    this.showToast('Barricade breaking is disabled in Normal mode');
                    return;
                }
                const cost = this.game.breakCost || 5;
                if (this.isBreakMode) {
                    this.executeBreakWall(idx);
                } else if (this.game.playerWalls[this.game.turn] >= cost) {
                    this.executeBreakWall(idx);
                } else {
                    this.showToast(`💥 Smasher: Breaking a barricade costs ${cost} walls!`);
                    sounds.playIllegal();
                }
            });

            this.placedWallsLayer.appendChild(wallDiv);
        });
    }

    renderPlayerCards() {
        const isKoth = (this.game.gameMode === 'koth');

        if (this.playersMatchHeader) {
            this.playersMatchHeader.classList.toggle('koth-4p', isKoth);
        }

        // Toggle visibility of P3 and P4 boxes
        if (this.p3Box) this.p3Box.style.display = isKoth ? 'flex' : 'none';
        if (this.p4Box) this.p4Box.style.display = isKoth ? 'flex' : 'none';

        // Active turn glowing border
        this.p1Box?.classList.toggle('turn-active', this.game.turn === 1 && !this.game.winner);
        this.p2Box?.classList.toggle('turn-active', this.game.turn === 2 && !this.game.winner);
        this.p3Box?.classList.toggle('turn-active', this.game.turn === 3 && !this.game.winner);
        this.p4Box?.classList.toggle('turn-active', this.game.turn === 4 && !this.game.winner);

        // Wall counts with denom styling
        if (this.p1WallBadge) this.p1WallBadge.innerHTML = `${this.game.playerWalls[1]} <span class="denom">/${this.game.initialWalls}</span>`;
        if (this.p2WallBadge) this.p2WallBadge.innerHTML = `${this.game.playerWalls[2]} <span class="denom">/${this.game.initialWalls}</span>`;
        if (this.p3WallBadge && isKoth) this.p3WallBadge.innerHTML = `${this.game.playerWalls[3]} <span class="denom">/${this.game.initialWalls}</span>`;
        if (this.p4WallBadge && isKoth) this.p4WallBadge.innerHTML = `${this.game.playerWalls[4]} <span class="denom">/${this.game.initialWalls}</span>`;
    }

    renderClocks() {
        if (this.p1Clock) this.p1Clock.textContent = this.formatClock(this.game.playerTimeLeft[1]);
        if (this.p2Clock) this.p2Clock.textContent = this.formatClock(this.game.playerTimeLeft[2]);
        if (this.p3Clock && this.game.numPlayers >= 3) this.p3Clock.textContent = this.formatClock(this.game.playerTimeLeft[3]);
        if (this.p4Clock && this.game.numPlayers >= 4) this.p4Clock.textContent = this.formatClock(this.game.playerTimeLeft[4]);
    }

    renderMoveLog() {
        if (this.game.moveLog.length === 0) {
            this.moveLogText.textContent = 'No moves yet';
            this.moveLogText.style.color = 'var(--text-dim)';
        } else {
            const lastMove = this.game.moveLog[this.game.moveLog.length - 1];
            const moveNum = this.game.moveLog.length;
            const colors = ['', 'var(--blue-pawn)', 'var(--red-pawn)', '#22c55e', '#f59e0b'];
            const color = colors[lastMove.turn] || 'var(--text-white)';
            this.moveLogText.innerHTML = `<span style="color:var(--text-dim);">${moveNum}.</span> <span style="color:${color};">${lastMove.desc}</span>`;
        }
    }
}

// Start app
document.addEventListener('DOMContentLoaded', () => {
    window.barricadeApp = new BarricadeUI();
    window.fortivexApp = window.barricadeApp;

    // Casual Create Game Pills
    document.querySelectorAll('.sheet-mode-box').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.sheet-mode-box').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
        });
    });

    document.querySelectorAll('.time-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.time-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.wall-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.wall-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.color-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.color-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.diff-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.diff-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    // Custom Room Builder Pills
    document.querySelectorAll('.room-mode-box').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.room-mode-box').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
        });
    });

    document.querySelectorAll('.room-time-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.room-time-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.room-wall-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.room-wall-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.room-color-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.room-color-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    // Bot Sheet Pills
    document.querySelectorAll('.bot-mode-box').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.bot-mode-box').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
        });
    });

    document.querySelectorAll('.bot-color-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.bot-color-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    // Gameplay Mode (Normal vs Barricade Breaking) Pills
    document.querySelectorAll('.room-gameplay-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.room-gameplay-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
            const costSec = document.getElementById('room-break-cost-section');
            if (costSec) costSec.style.display = (p.dataset.gameplay === 'normal') ? 'none' : 'block';
        });
    });

    document.querySelectorAll('.room-break-cost-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.room-break-cost-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.bot-gameplay-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.bot-gameplay-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
            const costSec = document.getElementById('bot-break-cost-section');
            if (costSec) costSec.style.display = (p.dataset.gameplay === 'normal') ? 'none' : 'block';
        });
    });

    // Custom Room Visibility & Password Toggle
    function updateRoomConfigSummary() {
        const mode = document.querySelector('.room-mode-box.selected')?.dataset.mode || 'classic';
        const gameplay = document.querySelector('.room-gameplay-pill.selected')?.dataset.gameplay || 'breaking';
        const cost = document.querySelector('.room-break-cost-pill.selected')?.dataset.cost || '5';
        const time = document.querySelector('.room-time-pill.selected')?.dataset.sec || '30';
        const walls = document.querySelector('.room-wall-pill.selected')?.dataset.walls || '10';
        const vis = document.querySelector('.room-vis-pill.selected')?.dataset.visibility || 'public';

        const modeStr = (mode === 'koth') ? 'King of the Hill (4P)' : 'Classic (2P)';
        const gameStr = (gameplay === 'breaking') ? `Breaking (Cost ${cost})` : 'Normal Mode';
        const visStr = (vis === 'public') ? 'Public Room' : 'Private (Code Only)';

        const previewEl = document.getElementById('room-config-preview-text');
        if (previewEl) {
            previewEl.textContent = `${modeStr} · ${gameStr} · ${time}s Turn · ${walls} Barricades · ${visStr}`;
        }
    }

    document.querySelectorAll('.room-vis-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.room-vis-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
            const pwdSec = document.getElementById('room-password-container');
            if (pwdSec) pwdSec.style.display = (p.dataset.visibility === 'private') ? 'block' : 'none';
            updateRoomConfigSummary();
        });
    });

    document.querySelectorAll('.room-mode-box, .room-gameplay-pill, .room-break-cost-pill, .room-time-pill, .room-wall-pill').forEach(el => {
        el.addEventListener('click', () => updateRoomConfigSummary());
    });

    // Bot Sheet Wall & Time Pills
    document.querySelectorAll('.bot-wall-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.bot-wall-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });

    document.querySelectorAll('.bot-time-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.bot-time-pill').forEach(x => x.classList.remove('selected'));
            p.classList.add('selected');
        });
    });
});
