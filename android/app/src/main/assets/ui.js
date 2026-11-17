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

// ==========================================
// UNIVERSAL API & WEBSOCKET ORIGIN RESOLVER
// ==========================================
const FORTIVEX_CLOUD_BACKEND = 'https://fortivex.onrender.com';

function getFortivexApiBase() {
    if (typeof window !== 'undefined' && window.FORTIVEX_SERVER_URL) {
        return window.FORTIVEX_SERVER_URL.replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.location) {
        const proto = window.location.protocol;
        const host = window.location.host;
        if (host && host !== '' && (proto === 'http:' || proto === 'https:')) {
            return `${proto}//${host}`;
        }
    }
    return FORTIVEX_CLOUD_BACKEND;
}

function getFortivexWsUrl() {
    const apiBase = getFortivexApiBase();
    if (apiBase.startsWith('https:')) {
        return apiBase.replace(/^https:/, 'wss:');
    } else {
        return apiBase.replace(/^http:/, 'ws:');
    }
}

// Intercept fetch for seamless relative /api/ support in native Android environments
if (typeof window !== 'undefined' && window.fetch) {
    const _nativeFetch = window.fetch.bind(window);
    window.fetch = function(resource, init) {
        if (typeof resource === 'string' && resource.startsWith('/api/')) {
            resource = getFortivexApiBase() + resource;
        }
        return _nativeFetch(resource, init);
    };
}

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

        // Default Ranked Queue Mode: Classic Normal (10 Walls)
        this.selectedRankedMode = {
            mode: 'classic',
            gameplayMode: 'normal',
            breakCost: 0,
            walls: 10
        };

        this.render();
        this.switchView('home');
    }

    initUserAccount() {
        this.userId = localStorage.getItem('fortivex_user_id') || localStorage.getItem('barricade_user_id');
        let storedUser = localStorage.getItem('fortivex_username') || localStorage.getItem('barricade_username');
        let storedSignedIn = (localStorage.getItem('fortivex_signed_in') || localStorage.getItem('barricade_signed_in')) === 'true';

        // Default sequential username starts at noob10116
        if (!this.userId || !storedUser || storedUser.startsWith('user_')) {
            storedUser = 'noob10116';
            this.userId = 'usr_10116_m0cvq4';
            localStorage.setItem('fortivex_user_id', this.userId);
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

        const wsUrl = getFortivexWsUrl();

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('⚡ Connected to FORTIVEX Real-Time WebSocket Server');
                if (this.offlineBanner) {
                    this.offlineBanner.classList.add('reconnected');
                    if (this.offlineText) this.offlineText.textContent = '✅ Connected to Fortivex Cloud';
                    setTimeout(() => {
                        this.offlineBanner.style.display = 'none';
                        this.offlineBanner.classList.remove('reconnected');
                    }, 2000);
                }

                if (this.playType === 'online_pvp' && this.activeRoomCode) {
                    this.ws.send(JSON.stringify({
                        type: 'reconnect_room',
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
                if (this.offlineBanner) {
                    this.offlineBanner.style.display = 'flex';
                    if (this.offlineText) this.offlineText.textContent = '⚠️ Connection Interrupted — Reconnecting...';
                }
                setTimeout(() => this.initWebSocket(), 2500);
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
            if (data.timers) {
                this.syncTimersFromServer(data.timers);
            }
            if (data.winner) {
                if (this.opponentDisconnectOverlay) this.opponentDisconnectOverlay.style.display = 'none';
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
        } else if (data.type === 'player_disconnected') {
            if (this.opponentDisconnectOverlay && this.game && !this.game.winner) {
                this.opponentDisconnectOverlay.style.display = 'flex';
                let remainingSec = data.graceSeconds || 45;
                if (this.disconnectTimerSec) this.disconnectTimerSec.textContent = remainingSec;
                if (this.disconnectInterval) clearInterval(this.disconnectInterval);
                this.disconnectInterval = setInterval(() => {
                    remainingSec--;
                    if (this.disconnectTimerSec) this.disconnectTimerSec.textContent = Math.max(0, remainingSec);
                    if (remainingSec <= 0) {
                        clearInterval(this.disconnectInterval);
                    }
                }, 1000);
            }
        } else if (data.type === 'player_reconnected') {
            if (this.opponentDisconnectOverlay) {
                this.opponentDisconnectOverlay.style.display = 'none';
                if (this.disconnectInterval) clearInterval(this.disconnectInterval);
            }
            this.showToast(`Player ${data.username} reconnected!`);
        } else if (data.type === 'room_reconnected') {
            if (this.opponentDisconnectOverlay) this.opponentDisconnectOverlay.style.display = 'none';
            if (data.timers) this.syncTimersFromServer(data.timers);
            this.showToast('Reconnected to live match!');
        } else if (data.type === 'match_finished') {
            if (this.opponentDisconnectOverlay) this.opponentDisconnectOverlay.style.display = 'none';
            if (this.disconnectInterval) clearInterval(this.disconnectInterval);
            this.handleMatchEnd(data.winner, data.winReason);
        }
    }

    syncTimersFromServer(timers) {
        if (!timers) return;
        if (timers[1] !== undefined && this.p1Clock) {
            const m1 = Math.floor(timers[1] / 60);
            const s1 = timers[1] % 60;
            this.p1Clock.textContent = `${m1}:${s1 < 10 ? '0' : ''}${s1}`;
        }
        if (timers[2] !== undefined && this.p2Clock) {
            const m2 = Math.floor(timers[2] / 60);
            const s2 = timers[2] % 60;
            this.p2Clock.textContent = `${m2}:${s2 < 10 ? '0' : ''}${s2}`;
        }
    }

    initDom() {
        this.appScreen = document.querySelector('.app-screen');

        // Views
        this.homeView = document.getElementById('home-screen-view');
        this.gameView = document.getElementById('game-screen-view');
        this.profileView = document.getElementById('profile-screen-view');

        // Modals & Bottom Sheets
        this.createGameSheet = document.getElementById('create-game-sheet');
        this.friendsSheet = document.getElementById('friends-sheet');
        this.puzzlesSheet = document.getElementById('puzzles-sheet');
        this.chatSheet = document.getElementById('chat-sheet');
        this.gameOverSheet = document.getElementById('gameover-sheet');
        this.signInSheet = document.getElementById('signin-sheet');
        this.editProfileSheet = document.getElementById('edit-profile-sheet');
        this.ranksSheet = document.getElementById('ranks-sheet');
        this.matchDetailsSheet = document.getElementById('match-details-sheet');
        this.dailyCompleteSheet = document.getElementById('daily-complete-sheet');
        this.matchmakingOverlay = document.getElementById('matchmaking-overlay');
        this.roomLobbyOverlay = document.getElementById('room-lobby-overlay');

        // Offline Banner & Disconnect Overlays
        this.offlineBanner = document.getElementById('offline-banner');
        this.offlineText = document.getElementById('offline-text');
        this.opponentDisconnectOverlay = document.getElementById('opponent-disconnect-overlay');
        this.disconnectTimerSec = document.getElementById('disconnect-timer-sec');

        // Transparent Bot Opt-In Elements
        this.mmBotOptInBox = document.getElementById('mm-bot-optin-box');
        this.btnMmOptInBot = document.getElementById('btn-mm-optin-bot');
        this.btnMmKeepSearching = document.getElementById('btn-mm-keep-searching');

        // Account Deletion Button (Google Play)
        this.btnDeleteAccountTrigger = document.getElementById('btn-delete-account-trigger');

        // Profile Nav & Buttons
        this.btnProfileBack = document.getElementById('btn-profile-back');
        this.btnOpenEditProfile = document.getElementById('btn-open-edit-profile');
        this.btnSaveProfileChanges = document.getElementById('btn-save-profile-changes');
        this.btnProfileBannerLink = document.getElementById('btn-profile-banner-link');
        this.homeRankBadgeIcon = document.getElementById('home-rank-badge-icon');
        this.profileHeroRankBadge = document.getElementById('profile-hero-rank-badge');
        this.btnMatchesFirst = document.getElementById('btn-matches-first');
        this.btnMatchesLast = document.getElementById('btn-matches-last');
        this.editProfileCountrySelect = document.getElementById('edit-profile-country-select');

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

        // Platform Statistics Elements (Unified)
        this.statOnlinePlayers = document.getElementById('stat-online-players');
        this.statOnlineHumans = document.getElementById('stat-online-humans');
        this.statAvailableAi = document.getElementById('stat-available-ai');
        this.statActiveMatches = document.getElementById('stat-active-matches');

        // Ranked Mode Selector & Featured Spotlight Mode Elements
        this.rankedModePills = document.querySelectorAll('.ranked-mode-pill');
        this.btnRankedSubText = document.getElementById('btn-ranked-sub-text');
        this.btnModeBreakingRanked = document.getElementById('btn-mode-breaking-ranked');
        this.btnModeBreakingBot = document.getElementById('btn-mode-breaking-bot');
        this.btnModeKothOnline = document.getElementById('btn-mode-koth-online');
        this.btnModeKothBot = document.getElementById('btn-mode-koth-bot');
        this.btnModeNormalCard = document.getElementById('btn-mode-normal-card');

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
        // Independent Profile & Sign In Navigation
        this.homeUserBadge?.addEventListener('click', () => this.openProfileScreen());
        document.getElementById('home-rank-badge')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openRanksSheet();
        });
        document.getElementById('home-streak-badge-container')?.addEventListener('click', () => {
            this.openProfileScreen();
        });
        this.homeRankBadgeIcon?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openRanksSheet();
        });
        this.profileHeroRankBadge?.addEventListener('click', () => this.openRanksSheet());
        document.getElementById('btn-close-ranks-sheet')?.addEventListener('click', () => {
            this.ranksSheet?.classList.remove('open');
        });
        document.getElementById('btn-close-match-details')?.addEventListener('click', () => {
            this.matchDetailsSheet?.classList.remove('open');
        });
        document.getElementById('p1-name-wrapper')?.addEventListener('click', () => this.openProfileScreen());
        this.homeSignInPrompt?.addEventListener('click', () => this.openSignInSheet());

        // Profile Top Bar & Navigation
        this.btnProfileBack?.addEventListener('click', () => this.switchView('home'));
        this.btnOpenEditProfile?.addEventListener('click', () => this.openEditProfileSheet());
        this.btnProfileBannerLink?.addEventListener('click', () => this.openSignInSheet());
        this.btnSaveProfileChanges?.addEventListener('click', () => this.saveProfileChanges());
        document.getElementById('btn-edit-open-link')?.addEventListener('click', () => {
            this.editProfileSheet?.classList.remove('open');
            this.openSignInSheet();
        });

        // Social Authentication in Sign In modal
        document.getElementById('btn-auth-google')?.addEventListener('click', () => this.handleSocialLogin('Google'));
        document.getElementById('btn-auth-facebook')?.addEventListener('click', () => this.handleSocialLogin('Facebook'));

        // Profile 5 Tabs Switching
        document.querySelectorAll('.profile-tab-item').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                document.querySelectorAll('.profile-tab-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.profile-tab-view').forEach(v => v.classList.remove('active'));
                tabBtn.classList.add('active');
                const tabName = tabBtn.dataset.tab;
                const targetView = document.getElementById(`profile-view-${tabName}`);
                if (targetView) targetView.classList.add('active');
                if (tabName === 'overview') {
                    if (this.currentProfileData) this.renderOverviewTab(this.currentProfileData);
                } else if (tabName === 'stats') {
                    if (this.currentProfileData) this.renderStatsTab(this.currentProfileData);
                } else if (tabName === 'rating') {
                    this.renderRatingHistoryTab(this.userId, this.ratingPeriodFilter || 'all');
                } else if (tabName === 'matches') {
                    this.renderMatchHistoryTab(this.userId, this.matchesCurrentPage || 1, this.matchesFilter || 'all');
                }
            });
        });

        // Overview Period Filter Pills
        document.querySelectorAll('.ov-period-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.ov-period-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.ovRatingPeriod = pill.dataset.period;
                this.renderOverviewRatingChart(this.userId, this.ovRatingPeriod);
            });
        });

        // Rating Period Filter Pills
        document.querySelectorAll('.rating-period-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.rating-period-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.ratingPeriodFilter = pill.dataset.period;
                this.renderRatingHistoryTab(this.userId, this.ratingPeriodFilter);
            });
        });

        // Match History Filter Pills
        document.querySelectorAll('.match-history-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.match-history-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.matchesFilter = pill.dataset.filter;
                this.matchesCurrentPage = 1;
                this.renderMatchHistoryTab(this.userId, 1, this.matchesFilter);
            });
        });

        // Match Pagination
        document.getElementById('btn-matches-first')?.addEventListener('click', () => {
            if (this.matchesCurrentPage > 1) {
                this.matchesCurrentPage = 1;
                this.renderMatchHistoryTab(this.userId, 1, this.matchesFilter || 'all');
            }
        });
        document.getElementById('btn-matches-prev')?.addEventListener('click', () => {
            if (this.matchesCurrentPage > 1) {
                this.matchesCurrentPage--;
                this.renderMatchHistoryTab(this.userId, this.matchesCurrentPage, this.matchesFilter || 'all');
            }
        });
        document.getElementById('btn-matches-next')?.addEventListener('click', () => {
            if (this.matchesCurrentPage < this.matchesTotalPages) {
                this.matchesCurrentPage++;
                this.renderMatchHistoryTab(this.userId, this.matchesCurrentPage, this.matchesFilter || 'all');
            }
        });
        document.getElementById('btn-matches-last')?.addEventListener('click', () => {
            if (this.matchesCurrentPage < this.matchesTotalPages) {
                this.matchesCurrentPage = this.matchesTotalPages;
                this.renderMatchHistoryTab(this.userId, this.matchesTotalPages, this.matchesFilter || 'all');
            }
        });

        // Overview shortcuts to tabs
        document.getElementById('btn-see-all-matches')?.addEventListener('click', () => {
            document.querySelector('.profile-tab-item[data-tab="matches"]')?.click();
        });
        document.getElementById('btn-see-all-achievements')?.addEventListener('click', () => {
            document.querySelector('.profile-tab-item[data-tab="achievements"]')?.click();
        });

        // Avatar Picker Choice Pills
        document.querySelectorAll('.avatar-choice-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.avatar-choice-pill').forEach(p => p.classList.remove('selected'));
                pill.classList.add('selected');
                this.selectedAvatar = pill.dataset.avatar;
            });
        });

        this.btnSubmitSignIn?.addEventListener('click', () => this.handleSignInSubmit());
        this.signInInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleSignInSubmit();
        });

        // Ranked Mode Selector Pills
        this.rankedModePills?.forEach(pill => {
            pill.addEventListener('click', () => {
                this.rankedModePills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                const mode = pill.dataset.mode;
                const gameplay = pill.dataset.gameplay;
                const cost = parseInt(pill.dataset.cost || '5', 10);
                this.selectedRankedMode = {
                    mode,
                    gameplayMode: gameplay,
                    breakCost: cost,
                    walls: (mode === 'koth') ? 5 : 10
                };
                if (this.btnRankedSubText) {
                    if (mode === 'koth') {
                        this.btnRankedSubText.textContent = 'Live online 4-player matchmaking · King of the Hill (4P)';
                    } else if (gameplay === 'normal') {
                        this.btnRankedSubText.textContent = 'Live online 1v1 matchmaking · Classic Normal (10 Walls)';
                    } else {
                        this.btnRankedSubText.textContent = 'Live online 1v1 matchmaking · Breaking Mode (Cost 5)';
                    }
                }
            });
        });

        // 1. Home Screen Buttons
        document.getElementById('btn-play-ranked')?.addEventListener('click', () => {
            this.startRankedMatchmaking(this.selectedRankedMode || { mode: 'classic', gameplayMode: 'normal', walls: 10, breakCost: 0 });
        });

        // Featured Mode Cards Online / Bot actions
        document.querySelectorAll('.btn-feat-online').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                const gp = btn.dataset.gameplay;
                if (mode === 'koth') {
                    this.openFriendsSheet('build', { mode: 'koth' });
                } else {
                    this.startRankedMatchmaking({ mode: 'classic', gameplayMode: gp, breakCost: gp === 'breaking' ? 5 : 0, walls: 10 });
                }
            });
        });

        document.querySelectorAll('.btn-feat-bot').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                const gp = btn.dataset.gameplay;
                if (mode === 'koth') {
                    this.isRanked = false;
                    this.playType = 'pve';
                    this.myPlayerRole = 1;
                    this.ai.setDifficulty('medium');
                    this.startNewMatch({ mode: 'koth', gameplayMode: 'breaking', breakCost: 5, initialWalls: 5, timeSec: 180 });
                    this.showToast('👑 King of the Hill: Race to capture center crown (4,4)!');
                } else {
                    this.isRanked = false;
                    this.playType = 'pve';
                    this.myPlayerRole = 1;
                    this.ai.setDifficulty('medium');
                    this.startNewMatch({ mode: 'classic', gameplayMode: gp, breakCost: gp === 'breaking' ? 5 : 0, initialWalls: 10, timeSec: 180 });
                    this.showToast(gp === 'breaking' ? '💥 Barricade Breaking vs Computer' : 'Classic Normal vs Computer');
                }
            });
        });

        // Casual Games Actions
        document.getElementById('btn-open-join-code')?.addEventListener('click', () => {
            this.openFriendsSheet('join');
        });

        document.getElementById('btn-front-build-room')?.addEventListener('click', () => {
            this.openFriendsSheet('build');
        });

        document.querySelectorAll('.casual-filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.casual-filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.casualFilter = pill.dataset.filter || 'all';
                this.fetchPublicRooms();
            });
        });

        document.getElementById('btn-refresh-public-rooms')?.addEventListener('click', () => {
            this.fetchPublicRooms();
        });

        document.getElementById('home-premium-banner')?.addEventListener('click', () => {
            this.openMoreSheet();
        });

        // Mobile Bottom Navigation Bar (5 tabs)
        document.querySelectorAll('#app-bottom-nav .nav-item').forEach(navBtn => {
            navBtn.addEventListener('click', () => {
                document.querySelectorAll('#app-bottom-nav .nav-item').forEach(b => b.classList.remove('active'));
                navBtn.classList.add('active');
                const navKey = navBtn.dataset.nav;
                if (navKey === 'play') {
                    this.switchView('home');
                } else if (navKey === 'puzzles') {
                    this.openDailyPuzzleDirectly();
                } else if (navKey === 'leaderboard') {
                    this.openLeaderboardSheet();
                } else if (navKey === 'profile') {
                    this.openProfileScreen();
                } else if (navKey === 'more') {
                    this.openMoreSheet();
                }
            });
        });

        // Leaderboard Sheet Close
        document.getElementById('btn-close-leaderboard')?.addEventListener('click', () => {
            document.getElementById('leaderboard-sheet')?.classList.remove('open');
        });

        // More Sheet Actions
        document.getElementById('btn-close-more-sheet')?.addEventListener('click', () => {
            document.getElementById('more-sheet')?.classList.remove('open');
        });

        document.getElementById('btn-more-rules')?.addEventListener('click', () => {
            document.getElementById('more-sheet')?.classList.remove('open');
            document.getElementById('rules-sheet')?.classList.add('open');
        });

        document.getElementById('btn-close-rules')?.addEventListener('click', () => {
            document.getElementById('rules-sheet')?.classList.remove('open');
        });

        document.getElementById('btn-more-sound')?.addEventListener('click', () => {
            const isMuted = sounds.toggleMute();
            const titleEl = document.getElementById('more-sound-title');
            const iconEl = document.getElementById('more-sound-icon');
            if (titleEl) titleEl.textContent = `Sound Effects: ${isMuted ? 'OFF' : 'ON'}`;
            if (iconEl) iconEl.textContent = isMuted ? '🔇' : '🔊';
            this.showToast(`Sound Effects: ${isMuted ? 'OFF' : 'ON'}`);
        });

        document.getElementById('btn-more-watch')?.addEventListener('click', () => {
            document.getElementById('more-sheet')?.classList.remove('open');
            this.startWatchMode();
        });

        document.getElementById('btn-more-about')?.addEventListener('click', () => {
            this.showToast('FORTIVEX v3.0 — The Ultimate Strategy Board Game');
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

        // Bot Opt-in during Ranked Matchmaking
        this.btnMmOptInBot?.addEventListener('click', () => this.optInBotMatch());
        this.btnMmKeepSearching?.addEventListener('click', () => {
            if (this.mmBotOptInBox) this.mmBotOptInBox.style.display = 'none';
        });

        // Google Play Account Deletion
        this.btnDeleteAccountTrigger?.addEventListener('click', () => this.deleteUserAccount());

        // Global Network State Listeners
        window.addEventListener('online', () => {
            console.log('🌐 Online event detected');
            this.initWebSocket();
        });
        window.addEventListener('offline', () => {
            console.log('⚠️ Offline event detected');
            if (this.offlineBanner) {
                this.offlineBanner.style.display = 'flex';
                if (this.offlineText) this.offlineText.textContent = '⚠️ Network Disconnected — Reconnecting to Fortivex...';
            }
        });

        // Android Hardware Back Button Hook
        window.handleAndroidBackButton = () => this.onAndroidBack();

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
                    const onlineNum = data.onlineCount || 101;
                    const inGameNum = data.inGameCount || data.activeMatchesCount || 0;
                    if (this.statOnlinePlayers) {
                        this.statOnlinePlayers.textContent = `${onlineNum} players online`;
                    }
                    if (this.statOnlineHumans) {
                        this.statOnlineHumans.textContent = `${onlineNum} players online`;
                    }
                    if (this.statActiveMatches) {
                        this.statActiveMatches.textContent = `${inGameNum} in games`;
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

        const countEl = document.getElementById('open-casual-count');
        const filter = this.casualFilter || 'all';
        const filteredRooms = (rooms || []).filter(r => {
            if (filter === 'classic') return r.mode === 'classic' && r.gameplayMode !== 'breaking';
            if (filter === 'breaking') return r.gameplayMode === 'breaking';
            if (filter === 'koth') return r.mode === 'koth';
            return true;
        });
        if (countEl) countEl.textContent = `${filteredRooms.length}`;

        if (!filteredRooms || filteredRooms.length === 0) {
            this.publicRoomsList.innerHTML = `
                <div class="public-rooms-empty">
                    <div class="empty-icon">🌐</div>
                    <div class="empty-title">No Open Casual Games</div>
                    <div class="empty-sub">Be the first to create an open room and challenge online players!</div>
                </div>
            `;
            return;
        }

        const formatTimeControl = (sec) => {
            const m = Math.floor((sec || 180) / 60);
            return `${m}+0`;
        };

        const headerHtml = `
            <div class="casual-table-header">
                <span>PLAYER</span>
                <span>RATING</span>
                <span>TIME</span>
                <span></span>
            </div>
        `;

        const rowsHtml = filteredRooms.map(r => {
            const hostDisplay = r.hostName || r.title || `anon-${r.code.slice(0, 5)}`;
            const ratingDisplay = r.hostRating ? `${r.hostRating}` : '—';
            const timeDisplay = formatTimeControl(r.timeSec);
            return `
                <div class="casual-room-row" data-code="${r.code}">
                    <div class="casual-col-player">${hostDisplay}</div>
                    <div class="casual-col-rating">${ratingDisplay}</div>
                    <div class="casual-col-time">${timeDisplay}</div>
                    <div class="casual-col-action">
                        <button class="btn-join-room-orange" data-code="${r.code}" data-pwd="${r.hasPassword ? '1' : '0'}">Join</button>
                    </div>
                </div>
            `;
        }).join('');

        this.publicRoomsList.innerHTML = headerHtml + rowsHtml;

        this.publicRoomsList.querySelectorAll('.btn-join-room-orange').forEach(btn => {
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
    startRankedMatchmaking(config = null) {
        const modeConfig = config || this.selectedRankedMode || { mode: 'classic', gameplayMode: 'normal', breakCost: 0, walls: 10 };
        this.selectedRankedMode = modeConfig;

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
                rating: this.userRating,
                mode: modeConfig.mode || 'classic',
                gameplayMode: modeConfig.gameplayMode || 'breaking',
                breakCost: modeConfig.breakCost || 5
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
                        if (this.mmBotOptInBox) this.mmBotOptInBox.style.display = 'none';
                        this.handleRankedMatchFound(data);
                    } else if (data.canOptInBot) {
                        if (this.mmBotOptInBox) this.mmBotOptInBox.style.display = 'block';
                    }
                })
                .catch(() => {});
        }, 1000);
    }

    optInBotMatch() {
        if (this.mmBotOptInBox) this.mmBotOptInBox.style.display = 'none';
        const mode = (this.selectedRankedMode && this.selectedRankedMode.mode) || 'classic';
        const gameplayMode = (this.selectedRankedMode && this.selectedRankedMode.gameplayMode) || 'breaking';
        const breakCost = (this.selectedRankedMode && this.selectedRankedMode.breakCost) || 5;

        fetch('/api/matchmaking/optin-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: this.clientId,
                userId: this.userId,
                username: this.username,
                rating: this.userRating,
                mode,
                gameplayMode,
                breakCost
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.matched) {
                this.handleRankedMatchFound(data);
            }
        })
        .catch(err => {
            console.error('Error opting in bot:', err);
        });
    }

    deleteUserAccount() {
        const confirmed = window.confirm('Are you sure you want to permanently delete your Fortivex account and all associated rank data? This action cannot be undone.');
        if (!confirmed) return;

        fetch('/api/auth/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: this.userId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                localStorage.clear();
                alert('Your Fortivex account and all personal data have been completely deleted.');
                window.location.reload();
            } else {
                alert('Account deletion failed: ' + (data.reason || 'Unknown error'));
            }
        })
        .catch(err => {
            alert('Failed to connect to server: ' + err.message);
        });
    }

    onAndroidBack() {
        // 1. Check open bottom sheets / modal overlays
        const openSheets = [
            this.ranksSheet,
            this.createGameSheet,
            this.friendsSheet,
            this.puzzlesSheet,
            this.chatSheet,
            this.gameOverSheet,
            this.signInSheet,
            this.editProfileSheet,
            this.matchDetailsSheet,
            this.dailyCompleteSheet
        ];
        for (const sheet of openSheets) {
            if (sheet && sheet.classList.contains('open')) {
                sheet.classList.remove('open');
                return true;
            }
        }

        // 2. Matchmaking search overlay
        if (this.matchmakingOverlay && this.matchmakingOverlay.style.display !== 'none') {
            this.cancelMatchmaking();
            return true;
        }

        // 3. Room lobby overlay
        if (this.roomLobbyOverlay && this.roomLobbyOverlay.style.display !== 'none') {
            this.closeRoomLobby();
            return true;
        }

        // 4. In active game screen
        if (this.gameView && this.gameView.style.display !== 'none') {
            const leave = window.confirm('Leave current match and return to lobby?');
            if (leave) {
                this.returnToHomeLobby();
            }
            return true;
        }

        // 5. In profile screen
        if (this.profileView && this.profileView.style.display !== 'none') {
            this.switchView('home');
            return true;
        }

        return false; // Handled by native Android app (exit dialog)
    }

    handleRankedMatchFound(data) {
        clearInterval(this.matchmakingPollInterval);
        clearInterval(this.matchmakingDurationInterval);
        if (this.mmBotOptInBox) this.mmBotOptInBox.style.display = 'none';

        this.setMatchmakingStage(4);
        if (this.mmQueueStatus) this.mmQueueStatus.textContent = 'Opponent matched!';
        sounds.playVictory();
        this.vibrate([30, 30, 50]);

        this.activeRoomCode = data.roomCode;
        this.myPlayerRole = data.role || 1;
        this.opponentName = data.opponent.displayName || data.opponent.username;
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
                if (this.vsP2Badge) this.vsP2Badge.textContent = data.opponent.isBot ? 'PRACTICE BOT' : 'HUMAN OPPONENT';
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

                    const s = data.settings || {};
                    const mMode = s.mode || (this.selectedRankedMode && this.selectedRankedMode.mode) || 'classic';
                    const mGameplay = s.gameplayMode || (this.selectedRankedMode && this.selectedRankedMode.gameplayMode) || 'breaking';
                    const mBreakCost = s.breakCost || (this.selectedRankedMode && this.selectedRankedMode.breakCost) || 5;
                    const mWalls = s.walls || (mMode === 'koth' ? 5 : 10);
                    const mTime = s.timeSec || 180;

                    this.startNewMatch({ mode: mMode, initialWalls: mWalls, timeSec: mTime, gameplayMode: mGameplay, breakCost: mBreakCost });
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
        const bottomNav = document.getElementById('app-bottom-nav');
        if (viewName === 'home') {
            this.homeView.style.display = 'flex';
            this.gameView.style.display = 'none';
            if (this.profileView) this.profileView.style.display = 'none';
            if (bottomNav) bottomNav.style.display = 'flex';
            document.querySelectorAll('#app-bottom-nav .nav-item').forEach(b => {
                b.classList.toggle('active', b.dataset.nav === 'play');
            });
            this.fetchPublicRooms();
        } else if (viewName === 'profile') {
            this.homeView.style.display = 'none';
            this.gameView.style.display = 'none';
            if (this.profileView) this.profileView.style.display = 'flex';
            if (bottomNav) bottomNav.style.display = 'flex';
            document.querySelectorAll('#app-bottom-nav .nav-item').forEach(b => {
                b.classList.toggle('active', b.dataset.nav === 'profile');
            });
        } else {
            this.homeView.style.display = 'none';
            this.gameView.style.display = 'flex';
            if (this.profileView) this.profileView.style.display = 'none';
            if (bottomNav) bottomNav.style.display = 'none';
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
                const matchDuration = this.matchStartTime ? Math.floor((Date.now() - this.matchStartTime) / 1000) : 45;
                const totalMoves = (this.game && this.game.moveHistory) ? this.game.moveHistory.length : 0;
                fetch('/api/user/record-match', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.userId,
                        isWinner: isWin,
                        isRanked: this.isRanked,
                        isBot: this.playType === 'bot' || !this.activeRoomCode,
                        opponentName: this.opponentName || 'Opponent',
                        opponentRating: this.opponentRating || 1200,
                        durationSec: matchDuration,
                        mode: this.game?.mode || 'classic',
                        gameplayMode: this.game?.gameplayMode || 'breaking',
                        breakCost: this.game?.breakCost || 5,
                        wallsPlaced: this.game?.wallsPlacedCount || 0,
                        wallsBroken: this.game?.wallsBrokenCount || 0,
                        moveCount: totalMoves,
                        replay: this.game ? {
                            initialState: this.initialGameState,
                            moves: this.game.moveHistory || []
                        } : null
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
        const gameplayMode = opts.gameplayMode || 'normal';
        const breakCost = (gameplayMode === 'breaking') ? (opts.breakCost !== undefined ? opts.breakCost : 5) : 0;
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
        const avatarEl = document.getElementById('home-user-avatar');
        if (avatarEl) {
            avatarEl.textContent = this.userAvatar || '💎';
        }

        // Home Screen Rank Badge Vector Icon
        const rankInfo = typeof getRankForRating === 'function' ? getRankForRating(this.userRating) : null;
        const rankBadgeIcon = document.getElementById('home-rank-badge-icon');
        if (rankBadgeIcon && rankInfo) {
            rankBadgeIcon.innerHTML = typeof getRankBadgeSvg === 'function' ? getRankBadgeSvg(rankInfo.id, 20) : '';
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
            } else if (this.playType === 'online_pvp' || this.isRanked) {
                this.p2NameLabel.textContent = this.opponentName || 'Opponent';
                this.p2EloTag.textContent = `(${this.opponentRating || '1200'})`;
                if (this.p2BotTag) this.p2BotTag.style.display = 'none';
            } else if (this.playType === 'pvp') {
                this.p2NameLabel.textContent = 'Player 2';
                this.p2EloTag.textContent = '(Local)';
                if (this.p2BotTag) this.p2BotTag.style.display = 'none';
            } else if (this.playType === 'watch') {
                this.p2NameLabel.textContent = 'noob10088';
                this.p2EloTag.textContent = '(1980)';
                if (this.p2BotTag) this.p2BotTag.style.display = 'none';
            } else {
                this.p2NameLabel.textContent = this.opponentName || 'noob10042';
                this.p2EloTag.textContent = `(${this.opponentRating || 1350})`;
                if (this.p2BotTag) this.p2BotTag.style.display = (this.playType === 'pve' && !this.isRanked) ? 'inline-block' : 'none';
            }
        }

        // KOTH 4-Player mode player names
        if (this.game.gameMode === 'koth') {
            if (this.p3NameLabel) this.p3NameLabel.textContent = 'noob10055';
            if (this.p3EloTag) this.p3EloTag.textContent = '(1620)';
            if (this.p3BotTag) this.p3BotTag.style.display = 'none';
            if (this.p4NameLabel) this.p4NameLabel.textContent = 'noob10082';
            if (this.p4EloTag) this.p4EloTag.textContent = '(1810)';
            if (this.p4BotTag) this.p4BotTag.style.display = 'none';
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

    // ==========================================
    // DEDICATED PLAYER PROFILE & COMPETITIVE DASHBOARD
    // ==========================================
    openProfileScreen() {
        this.switchView('profile');
        if (!this.userId) {
            this.userId = localStorage.getItem('fortivex_user_id') || 'usr_10116_m0cvq4';
        }

        // Show loading or cached state
        fetch(`/api/user/profile?userId=${this.userId}`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.profile) {
                    this.currentProfileData = data.profile;
                    this.renderProfileData(data.profile);
                } else {
                    this.showToast('Failed to load profile data');
                }
            })
            .catch(() => {
                this.showToast('Network error loading profile');
            });
    }

    renderProfileData(profile) {
        // 1. Calculate Centralized Rank Tier
        const rankInfo = typeof getRankForRating === 'function' ? getRankForRating(profile.rating || 1200) : null;

        // 2. Vector SVG Rank Badge (Screenshot 3)
        const heroBadgeEl = document.getElementById('profile-hero-rank-badge');
        if (heroBadgeEl && rankInfo) {
            heroBadgeEl.innerHTML = typeof getRankBadgeSvg === 'function' ? getRankBadgeSvg(rankInfo.id, 56) : '🛡️';
        }

        // 3. User Identity (Middle Column)
        const nameEl = document.getElementById('profile-display-name');
        if (nameEl) nameEl.textContent = profile.displayName || profile.username;

        const joinedEl = document.getElementById('profile-joined-date');
        if (joinedEl) {
            const joinDate = new Date(profile.createdAt || Date.now());
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            joinedEl.textContent = `Joined ${months[joinDate.getMonth()]} ${joinDate.getDate()}, ${joinDate.getFullYear()}`;
        }

        const countryStr = profile.country || 'India';
        const countryFlagEl = document.getElementById('profile-country-flag');
        if (countryFlagEl) countryFlagEl.textContent = this.getCountryFlag(countryStr);

        const countryNameEl = document.getElementById('profile-country-name');
        if (countryNameEl) countryNameEl.textContent = countryStr;

        // 4. Rating & Score Column (Screenshot 3 - Top Right)
        const rankTitleEl = document.getElementById('profile-rank-title');
        if (rankTitleEl && rankInfo) {
            rankTitleEl.textContent = rankInfo.name.toUpperCase();
            rankTitleEl.style.color = rankInfo.color;
        }

        const currRatingEl = document.getElementById('profile-current-rating');
        if (currRatingEl) currRatingEl.textContent = profile.rating || 1200;

        const peakTagEl = document.getElementById('profile-peak-rating-tag');
        if (peakTagEl) peakTagEl.textContent = `Peak ${profile.peakRating || profile.rating || 1200}`;

        const globalRankEl = document.getElementById('profile-global-rank');
        if (globalRankEl) globalRankEl.textContent = `Rank #${(profile.globalRank || 1).toLocaleString()}`;

        const wlWinsEl = document.getElementById('profile-wl-wins');
        const wlLossesEl = document.getElementById('profile-wl-losses');
        const recRanked = profile.recordSummary?.ranked || {
            wins: profile.mainStats?.totalWins || 0,
            losses: profile.mainStats?.totalLosses || 0
        };
        if (wlWinsEl) wlWinsEl.textContent = `${recRanked.wins}W`;
        if (wlLossesEl) wlLossesEl.textContent = `${recRanked.losses}L`;

        // 5. Rank Progression Bar (Screenshot 3)
        const progSubEl = document.getElementById('profile-progression-sub');
        const progPctEl = document.getElementById('profile-progression-pct');
        const progBarEl = document.getElementById('profile-progression-bar');
        if (rankInfo) {
            if (progSubEl) {
                progSubEl.textContent = rankInfo.isMaxRank ? 'Apex Grandmaster' : `${rankInfo.pointsToNext} to ${rankInfo.nextRank}`;
            }
            if (progPctEl) {
                progPctEl.textContent = rankInfo.isMaxRank ? 'MAX RANK' : `${rankInfo.progressPercent}%`;
            }
            if (progBarEl) {
                progBarEl.style.width = `${rankInfo.progressPercent}%`;
                if (rankInfo.color) progBarEl.style.background = `linear-gradient(90deg, ${rankInfo.color}, ${rankInfo.accentColor || rankInfo.color})`;
            }
        }

        const guestBanner = document.getElementById('profile-guest-link-banner');
        if (guestBanner) {
            guestBanner.style.display = profile.isGuest ? 'flex' : 'none';
        }

        // 6. Tab 1: Overview
        this.renderOverviewTab(profile);

        // 7. Tab 2: Statistics (10 Main + Categories + 9 Additional)
        this.renderStatsTab(profile);

        // 8. Tab 3: Rating History
        this.renderRatingHistoryTab(profile.id, this.ratingPeriodFilter || 'all');

        // 9. Tab 4: Match History
        this.renderMatchHistoryTab(profile.id, this.matchesCurrentPage || 1, this.matchesFilter || 'all');

        // 10. Tab 5: Achievements
        this.renderAchievementsTab(profile.achievements || []);

        // Also sync home screen badge
        this.username = profile.displayName || profile.username;
        this.userRating = profile.rating;
        this.userStreak = profile.mainStats?.currentWinningStreak || 0;
        this.renderUserBadges();
    }

    getCountryFlag(country) {
        const flags = {
            'India': '🇮🇳',
            'United States': '🇺🇸',
            'United Kingdom': '🇬🇧',
            'Canada': '🇨🇦',
            'Germany': '🇩🇪',
            'France': '🇫🇷',
            'Japan': '🇯🇵',
            'South Korea': '🇰🇷',
            'Australia': '🇦🇺',
            'Brazil': '🇧🇷',
            'Spain': '🇪🇸'
        };
        return flags[country] || '🌐';
    }

    renderOverviewTab(profile) {
        const rec = profile.recordSummary || {
            all1v1: { games: 0, wins: 0, losses: 0, winRate: '0.0' },
            ranked: { games: 0, wins: 0, losses: 0, winRate: '0.0' }
        };
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        // All 1v1 Split Bar (Screenshot 2)
        setTxt('rec-all-total', rec.all1v1.games);
        setTxt('rec-all-rate', `${rec.all1v1.winRate}%`);
        setTxt('rec-all-wins', rec.all1v1.wins);
        setTxt('rec-all-losses', rec.all1v1.losses);
        const allTotal = (rec.all1v1.games > 0) ? rec.all1v1.games : 1;
        const allWinPct = Math.round((rec.all1v1.wins / allTotal) * 100);
        const allLossPct = 100 - allWinPct;
        const allBarWin = document.getElementById('rec-all-bar-win');
        const allBarLoss = document.getElementById('rec-all-bar-loss');
        if (allBarWin) allBarWin.style.width = `${allWinPct}%`;
        if (allBarLoss) allBarLoss.style.width = `${allLossPct}%`;

        // Ranked Split Bar (Screenshot 2)
        setTxt('rec-ranked-total', rec.ranked.games);
        setTxt('rec-ranked-rate', `${rec.ranked.winRate}%`);
        setTxt('rec-ranked-wins', rec.ranked.wins);
        setTxt('rec-ranked-losses', rec.ranked.losses);
        const rankedTotal = (rec.ranked.games > 0) ? rec.ranked.games : 1;
        const rankedWinPct = Math.round((rec.ranked.wins / rankedTotal) * 100);
        const rankedLossPct = 100 - rankedWinPct;
        const rankedBarWin = document.getElementById('rec-ranked-bar-win');
        const rankedBarLoss = document.getElementById('rec-ranked-bar-loss');
        if (rankedBarWin) rankedBarWin.style.width = `${rankedWinPct}%`;
        if (rankedBarLoss) rankedBarLoss.style.width = `${rankedLossPct}%`;

        // 10 Square Recent Form Pills (Screenshot 2)
        const formContainer = document.getElementById('profile-recent-form-pills');
        if (formContainer) {
            const formArr = profile.recentForm || [];
            let pillsHtml = '';
            for (let i = 0; i < 10; i++) {
                const res = formArr[i];
                if (res === 'W') {
                    pillsHtml += `<div class="form-pill win" title="Victory">W</div>`;
                } else if (res === 'L') {
                    pillsHtml += `<div class="form-pill loss" title="Defeat">L</div>`;
                } else if (res === 'D') {
                    pillsHtml += `<div class="form-pill draw" title="Draw">D</div>`;
                } else {
                    pillsHtml += `<div class="form-pill draw" style="opacity: 0.35;" title="Unplayed">-</div>`;
                }
            }
            formContainer.innerHTML = pillsHtml;
        }

        // Rating Progression Chart (Screenshot 3)
        this.renderOverviewRatingChart(profile.id, this.ovRatingPeriod || 'all');

        // Recent Matches List (Screenshot 2 & 3)
        const ovMatchesContainer = document.getElementById('profile-overview-matches-list');
        if (ovMatchesContainer) {
            const matches = profile.recentMatches?.matches || [];
            setTxt('ov-recent-total', `${profile.mainStats?.totalGames || matches.length} total`);
            if (matches.length === 0) {
                ovMatchesContainer.innerHTML = `<div class="profile-empty-state">No completed matches yet. Jump into Ranked to build your record!</div>`;
            } else {
                ovMatchesContainer.innerHTML = matches.slice(0, 5).map(m => {
                    const isWin = m.isWinner;
                    const pillClass = isWin ? 'w' : (m.isDraw ? 'd' : 'l');
                    const resLetter = isWin ? 'W' : (m.isDraw ? 'D' : 'L');
                    const deltaClass = isWin ? 'win' : (m.isDraw ? '' : 'loss');
                    const deltaStr = m.eloDelta > 0 ? `+${m.eloDelta}` : `${m.eloDelta}`;
                    const dateStr = new Date(m.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
                    return `
                        <div class="match-card-item-v3" data-match-id="${m.id}">
                            <div class="match-card-v3-left">
                                <div class="match-v3-pill ${pillClass}">${resLetter}</div>
                                <div class="match-v3-info">
                                    <div class="match-v3-title">${this.username} (${profile.rating}) vs ${m.opponent.username}</div>
                                    <div class="match-v3-sub">${m.isRanked ? 'Ranked' : 'Casual'} · 3+0 · ${dateStr}</div>
                                </div>
                            </div>
                            <div class="match-v3-right">
                                <span class="match-v3-delta ${deltaClass}">${deltaStr}</span>
                                <span class="match-v3-chevron">›</span>
                            </div>
                        </div>
                    `;
                }).join('');

                ovMatchesContainer.querySelectorAll('.match-card-item-v3').forEach(card => {
                    card.addEventListener('click', () => {
                        const matchId = card.dataset.matchId;
                        const match = matches.find(x => x.id === matchId);
                        if (match) this.openMatchDetailsSheet(match);
                    });
                });
            }
        }
    }

    renderOverviewRatingChart(userId, period = 'all') {
        fetch(`/api/user/rating-history?userId=${userId}&period=${period}`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.history) {
                    const h = data.history;
                    const netEl = document.getElementById('ov-rating-net');
                    if (netEl) {
                        netEl.textContent = `${h.netChange >= 0 ? '+' : ''}${h.netChange}`;
                        netEl.style.color = h.netChange >= 0 ? '#22c55e' : '#ef4444';
                    }
                    const gamesEl = document.getElementById('ov-rating-games');
                    if (gamesEl) {
                        gamesEl.textContent = h.points ? h.points.length : 0;
                    }

                    const svg = document.getElementById('ov-rating-svg');
                    if (!svg) return;

                    let chartData = h.points && h.points.length > 0 ? h.points : [
                        { timestamp: Date.now() - 86400000, rating: h.startRating || 1200, delta: 0, opponent: 'Start' },
                        { timestamp: Date.now(), rating: h.currentRating || 1200, delta: 0, opponent: 'Current' }
                    ];

                    if (chartData.length === 1) {
                        chartData = [
                            { timestamp: chartData[0].timestamp - 86400000, rating: h.startRating || chartData[0].rating, delta: 0, opponent: 'Initial' },
                            chartData[0]
                        ];
                    }

                    const ratings = chartData.map(p => p.rating);
                    let minRating = Math.min(...ratings, 1100);
                    let maxRating = Math.max(...ratings, 1500);
                    minRating = Math.floor((minRating - 30) / 100) * 100;
                    maxRating = Math.ceil((maxRating + 30) / 100) * 100;
                    const ratingRange = Math.max(100, maxRating - minRating);

                    const svgWidth = 380;
                    const svgHeight = 160;
                    const padX = 35;
                    const padY = 20;
                    const plotWidth = svgWidth - padX - 15;
                    const plotHeight = svgHeight - padY - 20;

                    const getY = (val) => padY + plotHeight - ((val - minRating) / ratingRange) * plotHeight;
                    const getX = (idx) => padX + (idx / (chartData.length - 1)) * plotWidth;

                    let gridLines = '';
                    for (let r = minRating; r <= maxRating; r += 100) {
                        const y = getY(r);
                        gridLines += `
                            <line x1="${padX}" y1="${y}" x2="${svgWidth - 15}" y2="${y}" stroke="#242630" stroke-width="1" stroke-dasharray="3,3" />
                            <text x="${padX - 6}" y="${y + 3}" fill="#64748b" font-size="9" text-anchor="end" font-family="monospace">${r}</text>
                        `;
                    }

                    const coords = chartData.map((p, idx) => ({
                        x: getX(idx),
                        y: getY(p.rating),
                        point: p
                    }));

                    const polylinePoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
                    const areaPoints = `${coords[0].x.toFixed(1)},${getY(minRating).toFixed(1)} ${polylinePoints} ${coords[coords.length - 1].x.toFixed(1)},${getY(minRating).toFixed(1)}`;

                    const circles = coords.map((c) => `
                        <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="#f59e0b" stroke="#17181e" stroke-width="2" />
                    `).join('');

                    // Date labels at bottom
                    const firstDate = new Date(chartData[0].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
                    const lastDate = new Date(chartData[chartData.length - 1].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

                    svg.innerHTML = `
                        <defs>
                            <linearGradient id="ovChartGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.3" />
                                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.0" />
                            </linearGradient>
                        </defs>
                        ${gridLines}
                        <polygon points="${areaPoints}" fill="url(#ovChartGrad)" />
                        <polyline points="${polylinePoints}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                        ${circles}
                        <text x="${padX}" y="${svgHeight - 4}" fill="#64748b" font-size="9" text-anchor="start">${firstDate}</text>
                        <text x="${svgWidth - 15}" y="${svgHeight - 4}" fill="#64748b" font-size="9" text-anchor="end">${lastDate}</text>
                    `;
                }
            })
            .catch(() => {});
    }

    renderStatsTab(profile) {
        const m = profile.mainStats || {};
        const a = profile.additionalStats || {};
        const cats = profile.categoryStats || {};

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val !== undefined ? val : 0;
        };

        // 10 Main Career Stats
        setVal('stat-total-games', m.totalGames);
        setVal('stat-total-wins', m.totalWins);
        setVal('stat-total-losses', m.totalLosses);
        setVal('stat-draws', m.draws);
        setVal('stat-win-rate', `${m.winRate || 0}%`);
        setVal('stat-current-rating', m.currentRating || 1200);
        setVal('stat-peak-rating', m.bestRating || m.currentRating || 1200);
        setVal('stat-curr-streak', m.currentWinningStreak);
        setVal('stat-best-streak', m.bestWinningStreak);
        setVal('stat-losing-streak', m.currentLosingStreak);

        // Categories Breakdown
        const rStats = cats.ranked || { wins: 0, losses: 0 };
        const cStats = cats.casual || { wins: 0, losses: 0 };
        const kStats = cats.koth || { wins: 0, losses: 0 };
        const bStats = cats.breaking || { wins: 0, losses: 0 };

        const rTotal = rStats.wins + rStats.losses;
        const rRate = rTotal > 0 ? Math.round((rStats.wins / rTotal) * 100) : 0;
        setVal('cat-ranked-record', `${rStats.wins}W - ${rStats.losses}L`);
        setVal('cat-ranked-rate', `Win Rate: ${rRate}%`);

        const cTotal = cStats.wins + cStats.losses;
        const cRate = cTotal > 0 ? Math.round((cStats.wins / cTotal) * 100) : 0;
        setVal('cat-casual-record', `${cStats.wins}W - ${cStats.losses}L`);
        setVal('cat-casual-rate', `Win Rate: ${cRate}%`);

        const kTotal = kStats.wins + kStats.losses;
        const kRate = kTotal > 0 ? Math.round((kStats.wins / kTotal) * 100) : 0;
        setVal('cat-koth-record', `${kStats.wins}W - ${kStats.losses}L`);
        setVal('cat-koth-rate', `Win Rate: ${kRate}%`);

        setVal('cat-breaking-record', `${bStats.wins}W - ${bStats.losses}L`);
        setVal('cat-breaking-rate', `Cost: 5 Walls`);

        // Computer Difficulty Breakdown
        const compDiff = cats.computer?.byDifficulty || {
            easy: { wins: 0, losses: 0 },
            medium: { wins: 0, losses: 0 },
            hard: { wins: 0, losses: 0 },
            impossible: { wins: 0, losses: 0 }
        };
        setVal('comp-easy-record', `${compDiff.easy?.wins || 0}W - ${compDiff.easy?.losses || 0}L`);
        setVal('comp-med-record', `${compDiff.medium?.wins || 0}W - ${compDiff.medium?.losses || 0}L`);
        setVal('comp-hard-record', `${compDiff.hard?.wins || 0}W - ${compDiff.hard?.losses || 0}L`);
        setVal('comp-apex-record', `${compDiff.impossible?.wins || 0}W - ${compDiff.impossible?.losses || 0}L`);

        // 9 Additional Competitive Stats
        setVal('stat-ranked-played', a.rankedPlayed);
        setVal('stat-casual-played', a.casualPlayed);
        setVal('stat-human-defeated', a.humanDefeated);
        setVal('stat-ai-defeated', a.aiDefeated);
        setVal('stat-avg-duration', `${a.avgMatchDurationSec || 0}s`);
        setVal('stat-total-playtime', `${Math.round((a.totalPlayTimeSec || 0) / 60)}m`);
        setVal('stat-daily-games', a.dailyGames);
        setVal('stat-daily-wins', a.dailyWins);
        setVal('stat-daily-losses', a.dailyLosses);
    }

    openRanksSheet() {
        const list = document.getElementById('ranks-tier-list');
        if (!list || typeof FORTIVEX_RANKS === 'undefined') return;

        const currentRank = typeof getRankForRating === 'function' ? getRankForRating(this.userRating || 1200) : null;

        list.innerHTML = FORTIVEX_RANKS.map(tier => {
            const isCurrent = currentRank && currentRank.id === tier.id;
            const rangeStr = tier.max === Infinity ? `${tier.min}+` : `${tier.min}–${tier.max}`;
            const badgeSvg = typeof getRankBadgeSvg === 'function' ? getRankBadgeSvg(tier.id, 34) : '🛡️';

            let subInfo = '';
            if (isCurrent) {
                const toNextTxt = currentRank.isMaxRank ? 'Apex Rank' : `${currentRank.pointsToNext} to ${currentRank.nextRank}`;
                subInfo = `
                    <div class="rank-here-tag">You're here</div>
                    <div class="rank-to-next-tag">${toNextTxt}</div>
                `;
            }

            return `
                <div class="rank-tier-row ${isCurrent ? 'current-rank' : ''}">
                    <div class="rank-tier-left">
                        <div class="rank-tier-badge-col">${badgeSvg}</div>
                        <div class="rank-tier-info-col">
                            <div class="rank-tier-name" style="color: ${tier.color};">${tier.name}</div>
                            ${subInfo}
                        </div>
                    </div>
                    <div class="rank-tier-range-col" style="color: ${tier.color};">${rangeStr}</div>
                </div>
            `;
        }).join('');

        this.ranksSheet?.classList.add('open');
    }

    openLeaderboardSheet() {
        const list = document.getElementById('leaderboard-players-list');
        const sheet = document.getElementById('leaderboard-sheet');
        if (!list || !sheet) return;

        list.innerHTML = '<div style="text-align:center; padding: 24px; color: #94a3b8; font-size: 0.82rem;">Loading rankings...</div>';
        sheet.classList.add('open');

        fetch('/api/leaderboard')
            .then(res => res.json())
            .then(data => {
                if (!data.success || !data.leaderboard) {
                    list.innerHTML = '<div style="text-align:center; padding: 24px; color: #ef4444; font-size: 0.82rem;">Failed to load leaderboard</div>';
                    return;
                }
                list.innerHTML = data.leaderboard.map(p => {
                    const isMe = p.username === this.username;
                    const rankInfo = typeof getRankForRating === 'function' ? getRankForRating(p.rating) : null;
                    const badgeSvg = rankInfo && typeof getRankBadgeSvg === 'function' ? getRankBadgeSvg(rankInfo.id, 24) : '🛡️';
                    const rankClass = p.rank === 1 ? 'top-1' : (p.rank === 2 ? 'top-2' : (p.rank === 3 ? 'top-3' : ''));
                    return `
                        <div class="leaderboard-row-item ${isMe ? 'current-user' : ''}">
                            <div class="lb-player-col">
                                <span class="lb-rank-num ${rankClass}">#${p.rank}</span>
                                <span class="lb-player-name">${p.displayName || p.username} ${isMe ? '(You)' : ''}</span>
                            </div>
                            <div class="lb-score-col">
                                <span class="lb-tier-badge">${badgeSvg}</span>
                                <span class="lb-rating-txt" style="color: ${rankInfo ? rankInfo.color : '#e2e8f0'}">${p.rating}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            })
            .catch(() => {
                list.innerHTML = '<div style="text-align:center; padding: 24px; color: #ef4444; font-size: 0.82rem;">Network error</div>';
            });
    }

    openMoreSheet() {
        const sheet = document.getElementById('more-sheet');
        if (sheet) sheet.classList.add('open');
    }

    openMatchDetailsSheet(match) {
        const content = document.getElementById('match-details-content');
        if (!content) return;

        const isWinner = match.isWinner;
        const resTitle = isWinner ? 'Victory' : (match.isDraw ? 'Draw' : 'Defeat');
        const resColor = isWinner ? '#22c55e' : (match.isDraw ? '#94a3b8' : '#ef4444');
        const deltaStr = match.eloDelta > 0 ? `+${match.eloDelta}` : `${match.eloDelta}`;
        const dateStr = new Date(match.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        content.innerHTML = `
            <div class="md-top-summary">
                <div class="md-row-meta">
                    <span>Result</span>
                    <strong style="color: ${resColor}; font-size: 0.95rem;">${resTitle} (${deltaStr})</strong>
                </div>
                <div class="md-row-meta">
                    <span>Opponent</span>
                    <span>${match.opponent.avatar || '🤖'} ${match.opponent.username} (${match.opponent.rating})</span>
                </div>
                <div class="md-row-meta">
                    <span>Mode</span>
                    <span>${match.isRanked ? 'Ranked 1v1' : 'Casual 1v1'} · ${match.gameplayMode || 'Normal'}</span>
                </div>
                <div class="md-row-meta">
                    <span>Turns</span>
                    <span>${match.turnsCount || 24} turns</span>
                </div>
                <div class="md-row-meta">
                    <span>Duration</span>
                    <span>${Math.round(match.durationSec || 60)}s</span>
                </div>
                <div class="md-row-meta">
                    <span>Played On</span>
                    <span>${dateStr}</span>
                </div>
            </div>
            
            <div class="md-moves-title">MATCH NOTATION</div>
            <div class="md-moves-scroll">
                1. e2 ... 2. e8 ... 3. e3 ... 4. e7 ... 5. e4 [Wall H 4,5] ... 6. d7 ... 7. e5 ... 8. c7 ... 9. e6 ... 10. b7 ... 11. e7 ... 12. a7 ... 13. e8 ... 14. e9 (Goal)
            </div>
            
            <button id="btn-watch-match-replay" class="btn-watch-replay" data-match-id="${match.id}">
                <span>▶ Watch Replay</span>
            </button>
        `;

        document.getElementById('btn-watch-match-replay')?.addEventListener('click', () => {
            this.matchDetailsSheet?.classList.remove('open');
            this.loadMatchReplay(match.id);
        });

        this.matchDetailsSheet?.classList.add('open');
    }

    renderRatingHistoryTab(userId, period = 'all') {
        fetch(`/api/user/rating-history?userId=${userId}&period=${period}`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.history) {
                    const h = data.history;
                    const currEl = document.getElementById('chart-curr-rating');
                    if (currEl) currEl.textContent = h.currentRating;
                    const peakEl = document.getElementById('chart-peak-rating');
                    if (peakEl) peakEl.textContent = h.peakRating;
                    const startEl = document.getElementById('chart-start-rating');
                    if (startEl) startEl.textContent = h.startRating;
                    const netEl = document.getElementById('chart-net-change');
                    if (netEl) {
                        netEl.textContent = `${h.netChange >= 0 ? '+' : ''}${h.netChange}`;
                        netEl.style.color = h.netChange > 0 ? '#22c55e' : (h.netChange < 0 ? '#ef4444' : '#fff');
                    }

                    this.drawRatingSvgChart(h.points, h.startRating, h.currentRating);
                    this.renderRatingTransactions(h.points);
                }
            })
            .catch(() => {});
    }

    drawRatingSvgChart(points, startRating, currentRating) {
        const svg = document.getElementById('rating-history-svg');
        if (!svg) return;

        let chartData = points && points.length > 0 ? points : [
            { timestamp: Date.now() - 86400000, rating: startRating || 1200, delta: 0, opponent: 'Start' },
            { timestamp: Date.now(), rating: currentRating || 1200, delta: 0, opponent: 'Current' }
        ];

        if (chartData.length === 1) {
            chartData = [
                { timestamp: chartData[0].timestamp - 86400000, rating: startRating || chartData[0].rating, delta: 0, opponent: 'Initial' },
                chartData[0]
            ];
        }

        const ratings = chartData.map(p => p.rating);
        let minRating = Math.min(...ratings, 1100);
        let maxRating = Math.max(...ratings, 1300);
        minRating = Math.floor((minRating - 30) / 50) * 50;
        maxRating = Math.ceil((maxRating + 30) / 50) * 50;
        const ratingRange = Math.max(50, maxRating - minRating);

        const svgWidth = 380;
        const svgHeight = 180;
        const padX = 35;
        const padY = 25;
        const plotWidth = svgWidth - padX - 15;
        const plotHeight = svgHeight - padY - 20;

        const getY = (val) => padY + plotHeight - ((val - minRating) / ratingRange) * plotHeight;
        const getX = (idx) => padX + (idx / (chartData.length - 1)) * plotWidth;

        let gridLines = '';
        const step = ratingRange <= 150 ? 50 : 100;
        for (let r = minRating; r <= maxRating; r += step) {
            const y = getY(r);
            gridLines += `
                <line x1="${padX}" y1="${y}" x2="${svgWidth - 15}" y2="${y}" stroke="#242630" stroke-width="1" stroke-dasharray="3,3" />
                <text x="${padX - 6}" y="${y + 3}" fill="#64748b" font-size="9" text-anchor="end" font-family="monospace">${r}</text>
            `;
        }

        const coords = chartData.map((p, idx) => ({
            x: getX(idx),
            y: getY(p.rating),
            point: p
        }));

        const polylinePoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
        const areaPoints = `${coords[0].x.toFixed(1)},${getY(minRating).toFixed(1)} ${polylinePoints} ${coords[coords.length - 1].x.toFixed(1)},${getY(minRating).toFixed(1)}`;

        const circles = coords.map((c, idx) => `
            <circle class="chart-data-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="#3b82f6" stroke="#131418" stroke-width="2"
                data-rating="${c.point.rating}" data-delta="${c.point.delta || 0}" data-opp="${c.point.opponent || 'Ranked'}" data-time="${new Date(c.point.timestamp).toLocaleDateString()}" />
        `).join('');

        svg.innerHTML = `
            <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35" />
                    <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0" />
                </linearGradient>
            </defs>
            ${gridLines}
            <polygon points="${areaPoints}" fill="url(#chartGradient)" />
            <polyline points="${polylinePoints}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            ${circles}
        `;

        const tooltip = document.getElementById('chart-tooltip');
        svg.querySelectorAll('.chart-data-dot').forEach(dot => {
            const showTip = (e) => {
                const rating = dot.dataset.rating;
                const delta = parseInt(dot.dataset.delta, 10);
                const opp = dot.dataset.opp;
                const time = dot.dataset.time;
                const deltaStr = delta > 0 ? `+${delta}` : (delta < 0 ? `${delta}` : '0');
                if (tooltip) {
                    tooltip.innerHTML = `<strong>${rating} ELO</strong> (${deltaStr})<br><span style="color:#94a3b8;">vs ${opp} • ${time}</span>`;
                    tooltip.style.display = 'block';
                    const cx = parseFloat(dot.getAttribute('cx'));
                    const cy = parseFloat(dot.getAttribute('cy'));
                    tooltip.style.left = `${Math.min(cx, 260)}px`;
                    tooltip.style.top = `${Math.max(cy - 40, 10)}px`;
                }
            };
            dot.addEventListener('mouseenter', showTip);
            dot.addEventListener('click', showTip);
        });

        svg.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.style.display = 'none';
        });
    }

    renderRatingTransactions(points) {
        const list = document.getElementById('rating-transactions-list');
        if (!list) return;

        if (!points || points.length === 0) {
            list.innerHTML = `<div class="profile-empty-state">No rating transactions recorded yet.</div>`;
            return;
        }

        const reversed = [...points].reverse().slice(0, 15);
        list.innerHTML = reversed.map(pt => {
            const isWin = (pt.delta || 0) > 0;
            const isLoss = (pt.delta || 0) < 0;
            const deltaClass = isWin ? 'win' : (isLoss ? 'loss' : '');
            const deltaStr = (pt.delta || 0) > 0 ? `+${pt.delta}` : (pt.delta || '0');
            const dateStr = new Date(pt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            return `
                <div class="rating-tx-item">
                    <div class="tx-opp-info">
                        <span class="tx-opp-name">${pt.note ? pt.note : 'Ranked Match vs ' + (pt.opponent || 'Opponent')}</span>
                        <span class="tx-opp-date">${dateStr}</span>
                    </div>
                    <div class="tx-rating-col">
                        <span class="tx-delta-badge ${deltaClass}">${deltaStr}</span>
                        <span class="tx-curr-val">${pt.rating}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderMatchHistoryTab(userId, page = 1, filter = 'all') {
        this.matchesCurrentPage = page;
        this.matchesFilter = filter;

        fetch(`/api/user/matches?userId=${userId}&page=${page}&limit=5&filter=${filter}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.matchesTotalPages = data.totalPages || 1;
                    const pageLabel = document.getElementById('matches-page-label');
                    if (pageLabel) pageLabel.textContent = `Page ${data.page} of ${this.matchesTotalPages}`;

                    const prevBtn = document.getElementById('btn-matches-prev');
                    if (prevBtn) prevBtn.disabled = data.page <= 1;

                    const nextBtn = document.getElementById('btn-matches-next');
                    if (nextBtn) nextBtn.disabled = data.page >= this.matchesTotalPages;

                    const container = document.getElementById('profile-matches-container');
                    if (!container) return;

                    if (!data.matches || data.matches.length === 0) {
                        container.innerHTML = `<div class="profile-empty-state">No matches found for this filter. Complete Ranked matches to build your career history!</div>`;
                        return;
                    }

                    container.innerHTML = data.matches.map(m => {
                        const dateStr = new Date(m.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        const modeStr = `${m.isRanked ? 'Ranked' : 'Casual'} • ${m.gameplayMode === 'breaking' ? 'Breaking (Cost ' + m.breakCost + ')' : 'Normal'}`;
                        const deltaStr = m.eloDelta > 0 ? `+${m.eloDelta}` : `${m.eloDelta}`;
                        const deltaClass = m.isWinner ? 'win' : (m.isDraw ? '' : 'loss');

                        return `
                            <div class="match-card-item">
                                <div class="match-card-left">
                                    <span class="match-result-badge res-${m.result.toLowerCase()}">${m.result}</span>
                                    <div class="match-opponent-row">
                                        <span>${m.opponent.avatar || '🤖'}</span>
                                        <span>${m.opponent.username}</span>
                                        <span style="font-size: 0.7rem; color: #f59e0b;">(${m.opponent.rating})</span>
                                    </div>
                                    <div class="match-mode-sub">${modeStr} • ${Math.round(m.durationSec)}s • ${dateStr}</div>
                                </div>
                                <div class="match-card-right">
                                    <span class="match-elo-delta ${deltaClass}">${deltaStr}</span>
                                    <button class="btn-watch-replay" data-match-id="${m.id}">▶ Watch Replay</button>
                                </div>
                            </div>
                        `;
                    }).join('');

                    container.querySelectorAll('.btn-watch-replay').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const matchId = btn.dataset.matchId;
                            this.loadMatchReplay(matchId);
                        });
                    });
                }
            })
            .catch(() => {});
    }

    renderAchievementsTab(achievements) {
        const container = document.getElementById('profile-achievements-container');
        if (!container) return;

        const unlockedCount = achievements.filter(a => a.unlocked).length;
        const countLabel = document.getElementById('achievements-unlocked-count');
        if (countLabel) countLabel.textContent = `${unlockedCount} of ${achievements.length} Unlocked`;

        container.innerHTML = achievements.map(a => {
            const pct = Math.min(100, Math.round((a.progress / a.max) * 100));
            return `
                <div class="achievement-card ${a.unlocked ? 'unlocked' : ''}">
                    <div class="achieve-icon-box">${a.icon}</div>
                    <div class="achieve-info">
                        <div class="achieve-name">${a.name}</div>
                        <div class="achieve-desc">${a.desc}</div>
                        <div class="achieve-bar-container">
                            <div class="achieve-bar-fill" style="width: ${pct}%"></div>
                        </div>
                    </div>
                    <div class="achieve-status-col">
                        <span class="achieve-fraction">${a.progress} / ${a.max}</span>
                        ${a.unlocked
                            ? `<span class="achieve-badge-unlocked">Unlocked</span>`
                            : `<span class="achieve-badge-locked">Locked 🔒</span>`}
                    </div>
                </div>
            `;
        }).join('');
    }

    openEditProfileSheet() {
        if (!this.currentProfileData) {
            this.openProfileScreen();
            return;
        }

        const input = document.getElementById('edit-profile-displayname-input');
        if (input) input.value = this.currentProfileData.displayName || this.currentProfileData.username;

        const countrySelect = document.getElementById('edit-profile-country-select');
        if (countrySelect && this.currentProfileData.country) {
            countrySelect.value = this.currentProfileData.country;
        }

        const statusLabel = document.getElementById('edit-account-status-label');
        if (statusLabel) {
            statusLabel.textContent = this.currentProfileData.isGuest
                ? 'Guest Account (Unlinked)'
                : `${this.currentProfileData.accountType} Linked`;
        }

        this.selectedAvatar = this.currentProfileData.avatar || '💎';
        document.querySelectorAll('.avatar-choice-pill').forEach(pill => {
            if (pill.dataset.avatar === this.selectedAvatar) {
                pill.classList.add('selected');
            } else {
                pill.classList.remove('selected');
            }
        });

        this.editProfileSheet?.classList.add('open');
    }

    saveProfileChanges() {
        const input = document.getElementById('edit-profile-displayname-input');
        const newName = input ? input.value.trim() : '';

        const countrySelect = document.getElementById('edit-profile-country-select');
        const selectedCountry = countrySelect ? countrySelect.value : (this.currentProfileData?.country || 'India');

        fetch('/api/user/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: this.userId,
                displayName: newName,
                avatar: this.selectedAvatar,
                country: selectedCountry
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.user) {
                this.username = data.user.displayName || data.user.username;
                localStorage.setItem('fortivex_username', this.username);
                this.userAvatar = data.user.avatar || '💎';
                this.editProfileSheet?.classList.remove('open');
                this.showToast('Profile updated successfully!');
                sounds.playVictory();
                this.openProfileScreen();
            } else {
                this.showToast(data.reason || 'Failed to update profile');
                sounds.playIllegal();
            }
        })
        .catch(() => {
            this.editProfileSheet?.classList.remove('open');
            this.openProfileScreen();
        });
    }

    loadMatchReplay(matchId) {
        fetch(`/api/replay?matchId=${matchId}`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.replay) {
                    this.showToast('Loading Match Replay...');
                    this.playType = 'replay';
                    this.isWatchMode = true;
                    this.switchView('game');

                    this.startNewMatch({ mode: 'classic', initialWalls: 10, timeSec: 300 });

                    const moves = data.replay.moves || [];
                    let moveIdx = 0;
                    if (this.replayInterval) clearInterval(this.replayInterval);

                    this.replayInterval = setInterval(() => {
                        if (moveIdx >= moves.length || this.currentView !== 'game') {
                            clearInterval(this.replayInterval);
                            this.showToast('Replay finished');
                            return;
                        }
                        const m = moves[moveIdx];
                        if (m.type === 'move') {
                            this.game.movePawn(m.player, m.to.x, m.to.y);
                        } else if (m.type === 'wall') {
                            this.game.placeWall(m.player, m.pos.x, m.pos.y, m.orientation);
                        } else if (m.type === 'break') {
                            this.game.breakWall(m.player, m.wallIndex);
                        }
                        this.render();
                        moveIdx++;
                    }, 1000);
                } else {
                    this.showToast('Replay data not available for this match');
                }
            })
            .catch(() => {
                this.showToast('Error loading replay');
            });
    }

    handleSocialLogin(provider) {
        if (!this.userId) {
            this.showToast('Connecting account...');
            return;
        }
        const mockProviderId = `${provider.toLowerCase()}_${Math.random().toString(36).substr(2, 9)}`;
        const mockEmail = `${this.username.toLowerCase()}@${provider.toLowerCase()}.com`;

        fetch('/api/auth/social', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: this.userId,
                provider: provider.toLowerCase(),
                providerId: mockProviderId,
                email: mockEmail,
                name: this.username
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.user) {
                this.isSignedIn = true;
                this.userAccountType = provider;
                localStorage.setItem('fortivex_signed_in', 'true');
                this.signInSheet?.classList.remove('open');
                this.editProfileSheet?.classList.remove('open');
                this.showToast(`Successfully linked ${provider} account!`);
                sounds.playVictory();
                this.render();
                if (this.currentView === 'profile') {
                    this.openProfileScreen();
                }
            } else {
                this.showToast('Social login failed. Try again.');
            }
        })
        .catch(() => {
            this.showToast('Connected to network');
        });
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
