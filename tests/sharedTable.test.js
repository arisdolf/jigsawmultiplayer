import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canPlayMultiplayer,
  copyTextWithFallback,
  isSharedRoomId,
  normalizeTableCode,
  sharedLevelRoomId,
  sharedTableCodeFromRoomId,
} from '../src/utils/sharedTable.js'
import {
  canJoinRoom,
  canManageSharedRoom,
  isAccountAuth,
  reserveSharedSeat,
  resolveSharedLevelId,
  sharedHistoryId,
  sharedRoomId,
  startSharedGame,
} from '../functions/sharedTableLogic.js'

test('normalizes only six-character unambiguous table codes', () => {
  assert.equal(normalizeTableCode(' ab2cd3 '), 'AB2CD3')
  for (const value of ['', 'ABC12', 'ABC1234', 'AB0CD1', 'ABICD2', 'ABOCD2', 'ABC D2']) {
    assert.equal(normalizeTableCode(value), null, value)
  }
})

test('allows multiplayer only for non-guest account users', () => {
  assert.equal(canPlayMultiplayer({ uid: 'account-1' }), true)
  assert.equal(canPlayMultiplayer({ uid: 'account-2', isAnonymous: false }), true)
  assert.equal(canPlayMultiplayer(null), false)
  assert.equal(canPlayMultiplayer({}), false)
  assert.equal(canPlayMultiplayer({ uid: 'guest-1', isAnonymous: true }), false)
  assert.equal(canPlayMultiplayer({ uid: 'guest-2', isGuest: true }), false)
})

test('client and callable create the same stable per-level room ID', () => {
  const clientId = sharedLevelRoomId('ab2cd3', 'level-31')
  assert.equal(clientId, 'our-table-AB2CD3-p-6c-65-76-65-6c-2d-33-31')
  assert.equal(sharedRoomId('AB2CD3', 'level-31'), clientId)
  assert.equal(sharedLevelRoomId('AB2CD3', 'level-31', 'custom-table'), sharedRoomId('AB2CD3', 'level-31', 'custom-table'))
})

test('table-code joins reopen the last active puzzle unless a link names a board', () => {
  assert.equal(resolveSharedLevelId('level-4', 'level-1'), 'level-4')
  assert.equal(resolveSharedLevelId('level-4', 'level-1', true), 'level-1')
  assert.equal(resolveSharedLevelId('', 'level-1'), 'level-1')
})

test('parses registered table codes and detects legacy and coded shared rooms', () => {
  const id = sharedLevelRoomId('AB2CD3', 'puzzle-4')
  assert.equal(sharedTableCodeFromRoomId(id), 'AB2CD3')
  assert.equal(sharedTableCodeFromRoomId('our-table-p-4'), null)
  assert.equal(isSharedRoomId(id), true)
  assert.equal(isSharedRoomId('our-table'), true)
  assert.equal(isSharedRoomId('our-table-p-4'), true)
  assert.equal(isSharedRoomId('other-room'), false)
})

test('accepts only authenticated non-anonymous Firebase accounts', () => {
  assert.equal(isAccountAuth({ uid: 'u1', token: { firebase: { sign_in_provider: 'google.com' } } }), true)
  assert.equal(isAccountAuth({ uid: 'u2', token: { firebase: { sign_in_provider: 'password' } } }), true)
  assert.equal(isAccountAuth({ uid: 'u3', token: { firebase: { sign_in_provider: 'anonymous' } } }), false)
  assert.equal(isAccountAuth(null), false)
  assert.equal(isAccountAuth({ token: { firebase: { sign_in_provider: 'google.com' } } }), false)
})

test('Firebase room listeners can read member-scoped collections', async () => {
  const { readFileSync } = await import('node:fs')
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.rooms.$roomId
  const memberRead = "auth != null && root.child('rooms').child($roomId).child('players').child(auth.uid).exists()"
  assert.ok(rules.players['.read'].includes("child('players').child(auth.uid).exists()"))
  for (const collection of ['pieces', 'pieceTargets', 'chat']) {
    assert.equal(rules[collection]['.read'], memberRead, `${collection} collection read must be member-scoped`)
  }
})

test('permits account joins and owner-only guest solo restores', () => {
  const account = { uid: 'account', token: { firebase: { sign_in_provider: 'google.com' } } }
  const guest = { uid: 'guest', token: { firebase: { sign_in_provider: 'anonymous' } } }
  const inviteRoom = { hostId: 'owner', multiplayerEnabled: true }
  const soloRoom = { hostId: 'guest', multiplayerEnabled: false }
  const accountSoloRoom = { hostId: 'account', multiplayerEnabled: false }
  assert.equal(canJoinRoom({ auth: account, meta: inviteRoom, hostIsAccount: true }), true)
  assert.equal(canJoinRoom({ auth: account, meta: inviteRoom, hostIsAccount: false }), false)
  assert.equal(canJoinRoom({ auth: guest, meta: inviteRoom, resumeOwned: true }), false)
  assert.equal(canJoinRoom({ auth: guest, meta: soloRoom, resumeOwned: true, players: { guest: {} } }), true)
  assert.equal(canJoinRoom({ auth: guest, meta: soloRoom, resumeOwned: true, players: { guest: {}, other: {} } }), false)
  assert.equal(canJoinRoom({ auth: account, meta: soloRoom }), false)
  assert.equal(canJoinRoom({ auth: account, meta: soloRoom, resumeOwned: true }), false)
  assert.equal(canJoinRoom({ auth: account, meta: accountSoloRoom, resumeOwned: true }), true)
  assert.equal(canJoinRoom({ auth: account, meta: { hostId: 'owner' }, hostIsAccount: false }), false)
  assert.equal(canJoinRoom({ auth: account, meta: { hostId: 'owner' }, hostIsAccount: true }), true)
})

test('only an account that joined a permanent board can manage it', () => {
  const member = { uid: 'member', token: { firebase: { sign_in_provider: 'password' } } }
  const guest = { uid: 'guest', token: { firebase: { sign_in_provider: 'anonymous' } } }
  const meta = { permanent: true, hostId: 'owner' }
  assert.equal(canManageSharedRoom({ auth: member, meta, players: { member: {} } }), true)
  assert.equal(canManageSharedRoom({ auth: member, meta, players: {} }), false)
  assert.equal(canManageSharedRoom({ auth: guest, meta, players: { guest: {} } }), false)
  assert.equal(canManageSharedRoom({ auth: member, meta: { permanent: false }, players: { member: {} } }), false)
})

test('seat reservation rejects a third active player and frees stale seats', () => {
  const now = 200_000
  const players = {
    one: { uid: 'one', lastSeenAt: now - 1000 },
    two: { uid: 'two', lastSeenAt: now - 2000 },
  }
  assert.equal(reserveSharedSeat(players, { uid: 'three', lastSeenAt: now }, now, 2, 60_000), null)

  const recovered = reserveSharedSeat({
    one: { uid: 'one', lastSeenAt: now - 100_000 },
    two: { uid: 'two', lastSeenAt: now - 1000 },
  }, { uid: 'three', lastSeenAt: now }, now, 2, 60_000)
  assert.deepEqual(recovered.removedUids, ['one'])
  assert.deepEqual(Object.keys(recovered.players).sort(), ['three', 'two'])
})

test('seat reservation refreshes existing member without consuming another seat', () => {
  const now = 200_000
  const result = reserveSharedSeat({
    one: { uid: 'one' },
    two: { uid: 'two', lastSeenAt: now - 1000 },
  }, { uid: 'one', lastSeenAt: now }, now, 2, 60_000)
  assert.ok(result)
  assert.equal(result.players.one.lastSeenAt, now)
  assert.equal(Object.keys(result.players).length, 2)
})

test('starting a shared board creates one session and preserves active or finished boards', () => {
  const waiting = startSharedGame({ status: 'waiting', elapsedSeconds: 12 }, 50_000, '50-session')
  assert.deepEqual(waiting, {
    status: 'playing',
    elapsedSeconds: 12,
    startedAt: 50_000,
    resumedAt: 50_000,
    tickAt: 50_000,
    pausedAt: null,
    completedAt: null,
    sessionId: '50-session',
  })
  const paused = { status: 'paused', sessionId: 'old-session' }
  assert.equal(startSharedGame(paused, 60_000, 'new-session'), paused)
  const completed = { status: 'completed', sessionId: 'done-session' }
  assert.equal(startSharedGame(completed, 60_000, 'new-session'), completed)
})

test('history IDs remain stable and safe for Realtime Database keys', () => {
  const first = sharedHistoryId('our-table-AB2CD3-p-31', 'session/one')
  assert.equal(first, sharedHistoryId('our-table-AB2CD3-p-31', 'session/one'))
  for (const character of ['.', '#', '$', '[', ']', '/']) assert.equal(first.includes(character), false)
})

test('copy helper reports copied state or requests visible code selection', async () => {
  let copiedText = ''
  assert.equal(await copyTextWithFallback('AB2CD3', {
    clipboard: { writeText: async (value) => { copiedText = value } },
  }), 'copied')
  assert.equal(copiedText, 'AB2CD3')

  let selected = false
  const documentObject = {
    body: { appendChild: () => {} },
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => { selected = true },
      remove: () => {},
    }),
    execCommand: () => false,
  }
  assert.equal(await copyTextWithFallback('AB2CD3', {
    clipboard: { writeText: async () => { throw new Error('denied') } },
    documentObject,
  }), 'select')
  assert.equal(selected, true)
})
