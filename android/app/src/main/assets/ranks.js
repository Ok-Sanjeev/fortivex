/**
 * FORTIVEX — Centralized Competitive Rank Configuration (ranks.js)
 * 
 * 9 Competitive Ranks:
 *   - Grandmaster: 2400+      (Crimson)
 *   - Master:      2200-2399  (Purple)
 *   - Diamond:     2000-2199  (Cyan)
 *   - Emerald:     1800-1999  (Green)
 *   - Sapphire:    1600-1799  (Blue)
 *   - Gold:        1400-1599  (Gold)
 *   - Silver:      1200-1399  (Silver) — Default starting rank for new players (1200)
 *   - Bronze:      1000-1199  (Bronze)
 *   - Iron:        0-999      (Steel Gray)
 */

const FORTIVEX_RANKS = [
    {
        id: 'grandmaster',
        name: 'Grandmaster',
        min: 2400,
        max: Infinity,
        nextRank: null,
        nextMin: null,
        color: '#ef4444',
        accentColor: '#dc2626',
        glowColor: 'rgba(239, 68, 68, 0.4)',
        description: 'Elite competitive apex. The master of spatial strategy.'
    },
    {
        id: 'master',
        name: 'Master',
        min: 2200,
        max: 2399,
        nextRank: 'Grandmaster',
        nextMin: 2400,
        color: '#a855f7',
        accentColor: '#9333ea',
        glowColor: 'rgba(168, 85, 247, 0.4)',
        description: 'Grand tactician possessing formidable board vision.'
    },
    {
        id: 'diamond',
        name: 'Diamond',
        min: 2000,
        max: 2199,
        nextRank: 'Master',
        nextMin: 2200,
        color: '#06b6d4',
        accentColor: '#0891b2',
        glowColor: 'rgba(6, 182, 212, 0.4)',
        description: 'Pristine tactical execution and razor-sharp path control.'
    },
    {
        id: 'emerald',
        name: 'Emerald',
        min: 1800,
        max: 1999,
        nextRank: 'Diamond',
        nextMin: 2000,
        color: '#10b981',
        accentColor: '#059669',
        glowColor: 'rgba(16, 185, 129, 0.4)',
        description: 'Advanced strategist with deep barricade placement mastery.'
    },
    {
        id: 'sapphire',
        name: 'Sapphire',
        min: 1600,
        max: 1799,
        nextRank: 'Emerald',
        nextMin: 1800,
        color: '#3b82f6',
        accentColor: '#2563eb',
        glowColor: 'rgba(59, 130, 246, 0.4)',
        description: 'Skilled tactician who controls tempo and creates traps.'
    },
    {
        id: 'gold',
        name: 'Gold',
        min: 1400,
        max: 1599,
        nextRank: 'Sapphire',
        nextMin: 1600,
        color: '#f59e0b',
        accentColor: '#d97706',
        glowColor: 'rgba(245, 158, 11, 0.4)',
        description: 'Accomplished player with consistent counter-offensive play.'
    },
    {
        id: 'silver',
        name: 'Silver',
        min: 1200,
        max: 1399,
        nextRank: 'Gold',
        nextMin: 1400,
        color: '#94a3b8',
        accentColor: '#64748b',
        glowColor: 'rgba(148, 163, 184, 0.4)',
        description: 'Baseline competitive tier. Learning deep route obstruction.'
    },
    {
        id: 'bronze',
        name: 'Bronze',
        min: 1000,
        max: 1199,
        nextRank: 'Silver',
        nextMin: 1200,
        color: '#d97706',
        accentColor: '#b45309',
        glowColor: 'rgba(217, 119, 6, 0.4)',
        description: 'Developing competitor building spatial awareness.'
    },
    {
        id: 'iron',
        name: 'Iron',
        min: 0,
        max: 999,
        nextRank: 'Bronze',
        nextMin: 1000,
        color: '#64748b',
        accentColor: '#475569',
        glowColor: 'rgba(100, 116, 139, 0.4)',
        description: 'Foundational tier. Forging basic movement and wall skills.'
    }
];

/**
 * Generates an original Fortivex vector SVG badge for a rank tier.
 * @param {string} rankId - One of 'grandmaster', 'master', 'diamond', etc.
 * @param {number} size - Desired square pixel dimension (default: 48)
 * @returns {string} SVG markup string
 */
function getRankBadgeSvg(rankId, size = 48) {
    const r = FORTIVEX_RANKS.find(t => t.id === rankId) || FORTIVEX_RANKS[6]; // Silver fallback
    const c1 = r.color;
    const c2 = r.accentColor;

    // Distinct heraldic emblem based on rank tier
    let emblemPath = '';
    if (rankId === 'grandmaster') {
        // Imperial Crown on Fortress Shield
        emblemPath = `
            <path d="M14 18L18 28L24 20L30 28L34 18L36 30H12L14 18Z" fill="${c1}"/>
            <circle cx="14" cy="17" r="1.8" fill="#fff"/>
            <circle cx="24" cy="18" r="2.2" fill="#fff"/>
            <circle cx="34" cy="17" r="1.8" fill="#fff"/>
            <path d="M16 32H32V34H16V32Z" fill="#fff"/>
        `;
    } else if (rankId === 'master') {
        // Arcane Crossed Broadswords with Central Gem
        emblemPath = `
            <path d="M15 17L33 35M33 17L15 35" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M24 18L28 26L24 34L20 26Z" fill="${c1}" stroke="#fff" stroke-width="1.2"/>
            <circle cx="24" cy="26" r="2" fill="#fff"/>
        `;
    } else if (rankId === 'diamond') {
        // Brilliant Prismatic Diamond Gem
        emblemPath = `
            <polygon points="16,21 32,21 37,27 24,37 11,27" fill="${c1}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
            <polyline points="11,27 24,29 37,27" fill="none" stroke="#fff" stroke-width="1.2"/>
            <line x1="24" y1="21" x2="24" y2="37" stroke="#fff" stroke-width="1.2"/>
            <polyline points="16,21 24,29 32,21" fill="none" stroke="#fff" stroke-width="1.2"/>
        `;
    } else if (rankId === 'emerald') {
        // Radiant Emerald Hexagon with Chevron Crest
        emblemPath = `
            <polygon points="24,17 33,22 33,31 24,36 15,31 15,22" fill="${c1}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
            <polyline points="18,25 24,20 30,25" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="24" cy="27" r="2" fill="#fff"/>
        `;
    } else if (rankId === 'sapphire') {
        // Sapphire Shield Core with Star Glint
        emblemPath = `
            <polygon points="24,17 33,25 24,35 15,25" fill="${c1}" stroke="#fff" stroke-width="1.5"/>
            <line x1="24" y1="18" x2="24" y2="34" stroke="#fff" stroke-width="1.2"/>
            <line x1="16" y1="25" x2="32" y2="25" stroke="#fff" stroke-width="1.2"/>
        `;
    } else if (rankId === 'gold') {
        // Golden Fortress Bastion with Laurel Crest
        emblemPath = `
            <path d="M17 32V24H20V27H22V24H26V27H28V24H31V32H17Z" fill="${c1}" stroke="#fff" stroke-width="1.2"/>
            <polygon points="24,17 26,21 30,21 27,24 28,28 24,25 20,28 21,24 18,21 22,21" fill="#fff"/>
        `;
    } else if (rankId === 'silver') {
        // Silver Knight Shield with Fortivex Wall Rampart
        emblemPath = `
            <path d="M18 33V22H30V33L24 36L18 33Z" fill="${c1}" stroke="#fff" stroke-width="1.2"/>
            <line x1="24" y1="22" x2="24" y2="35" stroke="#fff" stroke-width="1.2"/>
            <rect x="21" y="24" width="6" height="4" rx="1" fill="#fff"/>
        `;
    } else if (rankId === 'bronze') {
        // Bronze Dual Chevrons
        emblemPath = `
            <polyline points="17,23 24,28 31,23" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="17,28 24,33 31,28" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        `;
    } else {
        // Iron Riveted Plate
        emblemPath = `
            <rect x="17" y="20" width="14" height="14" rx="2" fill="${c1}" stroke="#fff" stroke-width="1.4"/>
            <circle cx="19.5" cy="22.5" r="1" fill="#fff"/>
            <circle cx="28.5" cy="22.5" r="1" fill="#fff"/>
            <circle cx="19.5" cy="31.5" r="1" fill="#fff"/>
            <circle cx="28.5" cy="31.5" r="1" fill="#fff"/>
            <path d="M21 27H27" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
        `;
    }

    return `
<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="fortivex-rank-badge rank-${rankId}">
    <defs>
        <radialGradient id="grad-bg-${rankId}" cx="50%" cy="30%" r="70%">
            <stop offset="0%" stop-color="${c1}" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
        </radialGradient>
        <linearGradient id="grad-border-${rankId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.8"/>
            <stop offset="50%" stop-color="${c1}"/>
            <stop offset="100%" stop-color="${c2}"/>
        </linearGradient>
    </defs>
    <!-- Outer Shield Crest -->
    <path d="M24 4L39 9.5V23C39 33 24 43 24 43C24 43 9 33 9 23V9.5L24 4Z" fill="url(#grad-bg-${rankId})" stroke="url(#grad-border-${rankId})" stroke-width="2.2" stroke-linejoin="round"/>
    <!-- Inner Inset Shield -->
    <path d="M24 7L36 11.5V22.5C36 30.5 24 38.5 24 38.5C24 38.5 12 30.5 12 22.5V11.5L24 7Z" stroke="${c1}" stroke-width="0.9" stroke-opacity="0.6"/>
    <!-- Tier Specific Emblem Artwork -->
    ${emblemPath}
</svg>`.trim();
}

/**
 * Calculates the player's competitive rank tier and progression details from rating.
 * @param {number} rating - Current numerical Elo rating
 * @returns {object} Full progression & rank tier bundle
 */
function getRankForRating(rating) {
    const val = parseInt(rating, 10) || 1200;
    const tier = FORTIVEX_RANKS.find(r => val >= r.min && val <= r.max) || FORTIVEX_RANKS[FORTIVEX_RANKS.length - 1];

    let pointsToNext = 0;
    let progressPercent = 100;
    let isMaxRank = (tier.nextMin === null);

    if (!isMaxRank) {
        const rangeSpan = tier.nextMin - tier.min;
        const currentPoints = val - tier.min;
        pointsToNext = Math.max(0, tier.nextMin - val);
        progressPercent = Math.min(100, Math.max(0, Math.round((currentPoints / rangeSpan) * 100)));
    }

    return {
        id: tier.id,
        name: tier.name,
        rating: val,
        min: tier.min,
        max: tier.max,
        next: tier.nextMin,
        nextRank: tier.nextRank,
        nextMin: tier.nextMin,
        pointsToNext,
        progressPercent,
        isMaxRank,
        color: tier.color,
        accentColor: tier.accentColor,
        glowColor: tier.glowColor,
        badgeSvg: getRankBadgeSvg(tier.id, 48),
        badgeSvgSmall: getRankBadgeSvg(tier.id, 24),
        badgeSvgLarge: getRankBadgeSvg(tier.id, 64)
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        FORTIVEX_RANKS,
        getRankBadgeSvg,
        getRankForRating
    };
}
