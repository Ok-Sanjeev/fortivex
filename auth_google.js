/**
 * FORTIVEX — Production Google OAuth Verification Module (auth_google.js)
 * 
 * Verifies Google ID tokens (JWT) using Google's public JWKS certificates:
 *   - Verifies RS256 signature against Google's public keys (https://www.googleapis.com/oauth2/v3/certs)
 *   - Validates audience matches process.env.GOOGLE_CLIENT_ID
 *   - Validates issuer is https://accounts.google.com or accounts.google.com
 *   - Validates token expiration timestamp
 *   - Extracts verified user identity (sub, email, name, picture)
 */

const https = require('https');
const crypto = require('crypto');

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function fetchGoogleJwks() {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        if (cachedJwks && now < cachedJwksExpiresAt) {
            return resolve(cachedJwks);
        }

        const req = https.get('https://www.googleapis.com/oauth2/v3/certs', { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to fetch Google certs: HTTP ${res.statusCode}`));
            }
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    cachedJwks = data.keys || [];
                    cachedJwksExpiresAt = now + 3600000; // Cache for 1 hour
                    resolve(cachedJwks);
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Google JWKS request timed out'));
        });
    });
}

function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Verifies a Google ID token
 * @param {string} idToken - The JWT credential string
 * @param {string|null} expectedClientId - Expected Google Client ID
 * @returns {Promise<{ valid: boolean, user?: object, error?: string }>}
 */
async function verifyGoogleIdToken(idToken, expectedClientId = process.env.GOOGLE_CLIENT_ID) {
    if (!idToken || typeof idToken !== 'string') {
        return { valid: false, error: 'Missing or invalid token string' };
    }

    const parts = idToken.split('.');
    if (parts.length !== 3) {
        return { valid: false, error: 'Malformed JWT structure' };
    }

    let header, payload;
    try {
        header = JSON.parse(base64UrlDecode(parts[0]));
        payload = JSON.parse(base64UrlDecode(parts[1]));
    } catch (e) {
        return { valid: false, error: 'Failed to decode token segments' };
    }

    // 1. Validate Algorithm
    if (header.alg !== 'RS256') {
        return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
    }

    if (!header.kid) {
        return { valid: false, error: 'Missing kid in token header' };
    }

    // 2. Validate Expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) {
        return { valid: false, error: 'Token has expired' };
    }

    // 3. Validate Issuer
    const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (!validIssuers.includes(payload.iss)) {
        return { valid: false, error: `Invalid issuer: ${payload.iss}` };
    }

    // 4. Validate Audience (if configured)
    if (expectedClientId && payload.aud !== expectedClientId) {
        return { valid: false, error: `Audience mismatch. Expected: ${expectedClientId}, Received: ${payload.aud}` };
    }

    // 5. Verify Cryptographic Signature against Google JWKS
    try {
        const keys = await fetchGoogleJwks();
        const matchingKey = keys.find(k => k.kid === header.kid);
        if (!matchingKey) {
            return { valid: false, error: `No matching public key found for kid: ${header.kid}` };
        }

        const publicKey = crypto.createPublicKey({ key: matchingKey, format: 'jwk' });
        const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const signedContent = `${parts[0]}.${parts[1]}`;

        const isSignatureValid = crypto.verify('RSA-SHA256', Buffer.from(signedContent), publicKey, signature);
        if (!isSignatureValid) {
            return { valid: false, error: 'Cryptographic signature verification failed' };
        }

        return {
            valid: true,
            user: {
                googleId: payload.sub,
                email: payload.email,
                name: payload.name || payload.given_name || 'Player',
                avatar: payload.picture || '💎',
                emailVerified: !!payload.email_verified
            }
        };
    } catch (err) {
        // Fallback for sandboxed or offline test environments where Google JWKS is unreachable
        console.warn('[auth_google] JWKS network check warning:', err.message);
        return { valid: false, error: `Signature verification network error: ${err.message}` };
    }
}

module.exports = {
    verifyGoogleIdToken,
    fetchGoogleJwks
};
