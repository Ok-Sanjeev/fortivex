# FORTIVEX — Competitive Online Multiplayer Strategy Board Game

A production-grade, mobile-first Web & PWA abstract strategy board game featuring real-time multiplayer, 4-tier AI engine, 4-Player King of the Hill center race, and tactical Barricade Breaking mechanics.

---

## 📱 Features & Highlights

1. **Brand Identity:**
   - Dark modern competitive design with amber-gold accents (`#f59e0b`) and emerald action buttons (`#22c55e`).
   - Side-by-side player HUD with active turn glow, mini wall indicators (`▬ 10 /10`), and move notation banner (`1. e2`).

2. **Core Game Modes:**
   - **Mode A: Normal Mode:** Pure competitive Quoridor tournament rules. Zero breaking clutter.
   - **Mode B: Barricade Breaking Mode:** Spend barricades from your own inventory (cost 3, 5, or 7; default 5) to smash an opponent's placed barricade. Broken rubble allows pawns to pass through freely while permanently blocking any new wall placements.
   - **Classic 2-Player Race:** P1 (Blue) vs P2 (Red) racing across the board.
   - **King of the Hill (4 Players):** Blue, Red, Green, and Yellow pawns racing to claim the glowing center crown tile `(4, 4)`.

3. **Autonomous AI Engine (4 Difficulties):**
   - **Easy (Tactical Novice):** Fast BFS shortest path advance with basic threat blocking.
   - **Medium (Strategist):** Evaluates path differentials and bottleneck chokepoints.
   - **Hard (Grandmaster Minimax):** Multi-ply Minimax search with counter-move evaluation and tactical wall breaks.
   - **Impossible (Apex Engine):** Deep strategic search, corridor traps, jump priorities, and ruthless endgame calculation.

4. **Identity & Username Allocation:**
   - Centralized sequential username generator starting at `noob10001`.
   - Guest accounts, social login, and persistent ratings with +30 win / -30 loss standard ranked scoring.

5. **Multiplayer & Custom Rooms:**
   - Custom multiplayer rooms with instant 4-digit room codes (`FORT-XXXX`).
   - Configurable turn clocks (15s, 20s, 30s, 45s, 1+0, 3+0), barricade counts (Quick 5, Standard 7, Chaos 9, Classic 10), and breaking cost options (3, 5, 7).

---

## 🚀 How to Launch and Play

### On Your Phone 📱
Connect to the same Wi-Fi network:
👉 **`http://192.168.31.162:3000`**

### On Your PC 💻
👉 **`http://localhost:3000`**  
Or run `start-game.bat`.
