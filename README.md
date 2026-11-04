# Barricade Mobile Strategy Board Game

A faithful, mobile-first Web & PWA application reproducing the Barricade abstract strategy board game (`barricade.gg` / iOS & Android by *o7 Games*).

---

## 📱 Features & Highlights

1. **Exact UI Parity with Barricade App:**
   - **Side-by-Side Player Cards:** Clean design with active turn green border glow (`#22c55e`).
   - **Mini Barricade Indicator:** Wall counts formatted with horizontal miniature bar icons (`▬ 10 /10`).
   - **Sleek Move Banner:** Minimalist move bar displaying standard notation (e.g. `1. e2` or `28. h1`).
   - **Theme & Sound Controls:** Working dark mode, light mode, and Web Audio procedural sound synthesizer.

2. **Clean Pure Tournament Rules (Zero Breaking Clutter):**
   - Standard Quoridor / Barricade tournament rules: move pawn 1 square orthogonally or place a 2-space wall.
   - Jump mechanics: Straight jump over opponent; diagonal jump if straight jump is blocked by a wall or board boundary.
   - Real-time BFS pathfinding guarantees walls never trap either player.
   - No unnecessary break barricade options or broken wall remnants.

3. **User Account & Unique Username System:**
   - New players are automatically assigned a default handle (e.g. `user_098765`) with `1385 💎` Elo rating.
   - Claim your unique, permanent display name (3-15 characters) via the Sign In modal.
   - Name and stats persist automatically in `localStorage`.

4. **Ergonomic Touch Drag & Direct Tap on Phones:**
   - **Default Move Mode:** Move Pawn mode is active by default without needing to touch any button.
   - **50px Finger Offset:** During wall dragging, the floating wall is held 50px above your thumb so your finger never blocks the target groove.
   - **Direct Tap-to-Place:** Tap Horizontal or Vertical, then tap any groove to snap and place immediately.
   - **Haptic Vibration:** Tactile vibration on placement, jumps, and turns (`navigator.vibrate`).
   - **Scroll Lock:** `touch-action: none` prevents mobile pull-to-refresh and rubber-banding.

5. **Complete Game Modes:**
   - **▶ Play Ranked Mode:** Features simulated matchmaking radar, opponent pairing (`anon-1646`), and live Elo rating changes (+16 on victory, -14 on defeat).
   - **👥 Play with Friends:** Generates 4-digit room codes (`BARR-8291`) with link sharing and join code input.
   - **🤖 vs Computer:** Multi-tier AI difficulties (**Novice**, **Tactician**, **Grandmaster**).
   - **🧩 Daily Tactical Puzzles:** 5 tactical Quoridor/Barricade puzzles with completion tracking.
   - **⚔️ Local 2-Player:** Pass & play on the same phone or tablet.
   - **📺 Watch Live Matches:** Spectate grandmaster bot matches in real-time.
   - **👑 King of the Hill Mode:** Center race mode with center crown tile on `(4, 4)`.

6. **PWA Standalone & Offline Support:**
   - `manifest.json` enables standalone installation to your phone's home screen.
   - `sw.js` Service Worker provides instant offline gameplay.

---

## 🚀 How to Launch and Play

### On Your Phone 📱
Make sure your phone and PC are connected to the same Wi-Fi:
- Open Safari (iOS) or Chrome (Android) on your phone:
  👉 **`http://192.168.31.162:3000`**
- Tap **Share > Add to Home Screen** on iPhone or **Install App** on Android to play in full-screen standalone mode.

### On Your PC 💻
- Open in your browser:
  👉 **`http://localhost:3000`**
- Or double-click `start-game.bat`.
