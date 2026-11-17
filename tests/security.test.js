/**
 * FORTIVEX — Security, Session Tokens & Account Deletion Tests (tests/security.test.js)
 */

const assert = require('assert');
const db = require('../db.js');

console.log('====================================================');
console.log('🛡️ FORTIVEX SECURITY & GOOGLE PLAY COMPLIANCE TESTS');
console.log('====================================================');

let passed = 0;
let failed = 0;

function it(desc, fn) {
    try {
        fn();
        console.log(`  ✅ [PASS] ${desc}`);
        passed++;
    } catch (e) {
        console.error(`  ❌ [FAIL] ${desc}: ${e.message}`);
        failed++;
    }
}

// 1. Session Token Lifecycle
it('Session token is generated on guest creation and validated', () => {
    const guest = db.createGuestUser();
    assert(guest.sessionToken, 'Guest must receive a sessionToken');
    assert(guest.sessionToken.startsWith('fv_'), 'Session token must have fv_ prefix');

    const validatedUser = db.validateSessionToken(guest.sessionToken);
    assert(validatedUser !== null, 'Session token must validate to user');
    assert.strictEqual(validatedUser.id, guest.id, 'Validated user ID must match guest');
});

it('Invalid and expired session tokens are strictly rejected', () => {
    assert.strictEqual(db.validateSessionToken('fv_invalid_token_123'), null, 'Bogus token must return null');
    assert.strictEqual(db.validateSessionToken(''), null, 'Empty token must return null');
    assert.strictEqual(db.validateSessionToken(null), null, 'Null token must return null');
});

it('Session token can be explicitly invalidated on logout', () => {
    const guest = db.createGuestUser();
    const token = guest.sessionToken;
    assert.strictEqual(db.invalidateSessionToken(token), true, 'Invalidating token must return true');
    assert.strictEqual(db.validateSessionToken(token), null, 'Invalidated token must no longer be valid');
});

// 2. Google Play Account Deletion Compliance
it('Account deletion permanently purges user and active sessions', () => {
    const user = db.createGuestUser();
    const userId = user.id;
    const token = user.sessionToken;

    // Verify user exists and token works
    assert(db.getUser(userId) !== null, 'User must exist prior to deletion');
    assert(db.validateSessionToken(token) !== null, 'Session must exist prior to deletion');

    // Execute account deletion
    const delResult = db.deleteUserAccount(userId);
    assert.strictEqual(delResult.success, true, 'deleteUserAccount must return success: true');

    // Verify user profile is gone
    assert.strictEqual(db.getUser(userId), null, 'User profile must be completely erased from DB');

    // Verify all sessions for this user are invalidated
    assert.strictEqual(db.validateSessionToken(token), null, 'User sessions must be invalidated');
});

// 3. Username Claim Security
it('Username claim strictly forbids illegal characters and duplicates', () => {
    const user = db.createGuestUser();
    
    // Empty / short
    const shortRes = db.claimCustomUsername(user.id, 'ab');
    assert.strictEqual(shortRes.success, false, 'Short username must be rejected');

    // Illegal chars
    const illegalRes = db.claimCustomUsername(user.id, 'hack<script>');
    assert.strictEqual(illegalRes.success, false, 'Special/script characters must be rejected');

    // Valid claim
    const validName = 'Alpha_' + Math.floor(Math.random() * 10000);
    const validRes = db.claimCustomUsername(user.id, validName);
    assert.strictEqual(validRes.success, true, 'Valid username claim must succeed');

    // Duplicate claim by another user
    const otherUser = db.createGuestUser();
    const dupRes = db.claimCustomUsername(otherUser.id, validName);
    assert.strictEqual(dupRes.success, false, 'Duplicate username must be rejected');
});

// 4. Google OAuth Token Verification & Security
it('Google OAuth token verification rejects malformed and unsigned tokens', async () => {
    const { verifyGoogleIdToken } = require('../auth_google.js');
    
    // Malformed token
    const malformed = await verifyGoogleIdToken('not.a.valid.jwt');
    assert.strictEqual(malformed.valid, false);

    // Empty token
    const empty = await verifyGoogleIdToken('');
    assert.strictEqual(empty.valid, false);

    // Forged unsigned token
    const fakePayload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'fake_aud' })).toString('base64');
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fake_kid' })).toString('base64');
    const forged = await verifyGoogleIdToken(`${fakeHeader}.${fakePayload}.fakesig`);
    assert.strictEqual(forged.valid, false, 'Forged token without verified JWKS signature must be rejected');
});

// 5. Active Match Persistence & Crash Recovery
it('Active match can be persisted and restored from crash recovery store', () => {
    const testCode = 'FORT-TEST-' + Math.floor(Math.random() * 10000);
    const roomData = {
        code: testCode,
        status: 'playing',
        moves: [{ type: 'move', x: 4, y: 7 }],
        turn: 2
    };

    db.persistActiveRoom(testCode, roomData);
    const loaded = db.loadActiveRooms();
    assert(loaded[testCode], 'Room must exist in loaded active rooms');
    assert.strictEqual(loaded[testCode].moves.length, 1);
    assert.strictEqual(loaded[testCode].turn, 2);

    db.removeActiveRoom(testCode);
    const afterRemove = db.loadActiveRooms();
    assert.strictEqual(afterRemove[testCode], undefined, 'Room must be removed from store after match finalization');
});

console.log('====================================================');
console.log(`Security tests completed. Passed: ${passed}, Failed: ${failed}`);
console.log('====================================================\n');

if (failed > 0) {
    process.exit(1);
}
