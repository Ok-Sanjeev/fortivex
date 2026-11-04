/**
 * FORTIVEX — 100 Configured Logical AI Player Profiles (ai_profiles.js)
 * Shared with the sequential identity pool (noob10001+)
 * Each profile has a unique handle, distinct Elo rating, difficulty tier, and tactical archetype.
 */

const ARCHETYPES = [
    { title: 'The Rusher', playstyle: 'Aggressive pawn sprinter, focuses on direct paths and rapid jumps' },
    { title: 'Iron Barricade', playstyle: 'Defensive wall builder, constructs deep maze corridors' },
    { title: 'Crown Hunter', playstyle: 'KOTH specialist, prioritizes center crown control' },
    { title: 'Wall Smasher', playstyle: 'Barricade Breaking expert, saves walls to smash chokepoints' },
    { title: 'Tactical Grandmaster', playstyle: 'Balanced positional player with deep calculation' },
    { title: 'Flank Trapper', playstyle: 'Builds side corridor traps to force long detours' }
];

const AI_NAMES = [
    'VexMaster', 'ShadowStep', 'IronGate', 'NovaStrike', 'ApexPawn', 'CorridorKing', 'BlockadePro', 'MazeRunner',
    'ChronoPawn', 'StoneWall', 'GridGhost', 'RubbleCrusher', 'ZenithPawn', 'TitanGate', 'VortexMove', 'SilentStrider',
    'Tactix', 'Overlord', 'CyberWall', 'Vanguard', 'AlphaPawn', 'OmegaVex', 'PulseRunner', 'StormShield',
    'DarkMatter', 'HyperJump', 'Aegis', 'BlitzPawn', 'Fortress', 'RoguePawn', 'Nebula', 'PhantomStep',
    'Labyrinth', 'Bastion', 'Velocity', 'Sentinel', 'Matrix', 'Eclipse', 'Dominator', 'Stratagem',
    'Valiance', 'Horizon', 'Colossus', 'Specter', 'Valkyrie', 'Warden', 'Mirage', 'Paladin',
    'Ironclad', 'Tempest', 'Obsidian', 'Striker', 'Gladiator', 'Sovereign', 'Prowler', 'Ascendant',
    'Juggernaut', 'Monolith', 'Wraith', 'Centurion', 'Drifter', 'Bulwark', 'Predator', 'Archon',
    'Vindicator', 'Chimera', 'Dreadnought', 'Ranger', 'Garrison', 'Phantom', 'Stalker', 'SiegeMaster',
    'Paragon', 'Goliath', 'Nemesis', 'Crusader', 'Outrider', 'Behemoth', 'Harbinger', 'Inquisitor',
    'Nightfall', 'Leviathan', 'Reaper', 'Warmonger', 'Vagabond', 'Rampart', 'GhostWalker', 'Commander',
    'Imperator', 'Titan', 'Enigma', 'Glitch', 'SubZero', 'PathFinder', 'GridMaster', 'ApexPredator',
    'Strategos', 'Nexus', 'Absolute', 'FortivexGrand'
];

function generate100AiProfiles() {
    const profiles = [];
    // Start AI sequential identifiers at noob10001..noob10100
    for (let i = 0; i < 100; i++) {
        const idNum = 10001 + i;
        const baseName = AI_NAMES[i] || `Tactician_${idNum}`;
        const username = `noob${idNum}`;
        const displayName = `${username} [${baseName}]`;

        // Rating distribution:
        // 0..24: Novice (800 - 1180) -> Easy
        // 25..59: Intermediate / Strategist (1200 - 1580) -> Medium
        // 60..84: Expert / Master (1600 - 1980) -> Hard
        // 85..99: Grandmaster / Apex (2000 - 2450) -> Impossible
        let difficulty;
        let baseRating;

        if (i < 25) {
            difficulty = 'easy';
            baseRating = 800 + i * 16;
        } else if (i < 60) {
            difficulty = 'medium';
            baseRating = 1200 + (i - 25) * 11;
        } else if (i < 85) {
            difficulty = 'hard';
            baseRating = 1600 + (i - 60) * 16;
        } else {
            difficulty = 'impossible';
            baseRating = 2000 + (i - 85) * 30;
        }

        const archetype = ARCHETYPES[i % ARCHETYPES.length];

        profiles.push({
            id: `ai_${idNum}`,
            username,
            displayName,
            rating: baseRating,
            difficulty,
            archetype: archetype.title,
            playstyle: archetype.playstyle,
            isBot: true,
            avatarColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'][i % 6]
        });
    }
    return profiles;
}

const AI_PROFILES = generate100AiProfiles();

function getAiProfileForRating(userRating) {
    const target = userRating || 1200;
    // Find closest bot by rating within +/- 80 Elo, with slight random variance
    const candidates = AI_PROFILES.filter(p => Math.abs(p.rating - target) <= 120);
    if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    // Fallback: closest bot
    let closest = AI_PROFILES[0];
    let minDiff = Math.abs(AI_PROFILES[0].rating - target);
    for (const p of AI_PROFILES) {
        const diff = Math.abs(p.rating - target);
        if (diff < minDiff) {
            minDiff = diff;
            closest = p;
        }
    }
    return closest;
}

module.exports = {
    AI_PROFILES,
    getAiProfileForRating
};
