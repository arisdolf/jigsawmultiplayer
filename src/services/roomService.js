import {
  get,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from 'firebase/database'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { callFirebaseFunction, database, firebaseReady, firestore } from './firebase'
import {
  canPlayMultiplayer,
  isSharedRoomId as detectSharedRoomId,
  normalizeTableCode,
  sharedLevelRoomId,
  sharedTableCodeFromRoomId,
} from '../utils/sharedTable'

export { canPlayMultiplayer, normalizeTableCode }

const STALE_MS = 60000
const LOCAL_ROOMS_KEY = 'jigsawmult-demo-rooms'
const localCache = new Map()
const channels = new Map()
const localSubscribers = new Map()
export const SHARED_ROOM_ID = import.meta.env.VITE_SHARED_ROOM_ID || 'our-table'
const SHARED_MAX_PLAYERS = 2
const SHARED_HISTORY_KEY = 'jigsawmult-demo-shared-history'
const TABLES_KEY = 'jigsawmult-demo-tables'
const localActiveLevelKey = (code) => `jigsawmult-active-table-level:${code}`

const sharedBase = (code) => `${SHARED_ROOM_ID}-${String(code).toUpperCase()}`
const sharedTableOf = (roomId) => String(roomId).split('-p-')[0]

export const newTableCode = roomCode

function accountTableKey(uid) { return `jigsawmult-table-code:${uid}` }
function accountTableListKey(uid) { return `jigsawmult-joined-tables:${uid}` }

function rememberLocalTable(user, code) {
  try {
    const current = JSON.parse(localStorage.getItem(accountTableListKey(user.uid)) || '[]')
    const codes = new Set(Array.isArray(current) ? current : [])
    codes.add(code)
    localStorage.setItem(accountTableListKey(user.uid), JSON.stringify([...codes]))
  } catch { /* ignore unreadable local membership data */ }
}

// true if the code is now owned by this account (or already was)
export async function saveUserTableCode(value, user) {
  const code = normalizeTableCode(value)
  if (!canPlayMultiplayer(user)) throw new Error('Sign in with an account to create a table.')
  if (!code) return false
  if (!firebaseReady) {
    const list = JSON.parse(localStorage.getItem(TABLES_KEY) || '{}')
    if (list[code] && list[code] !== user.uid) return false
    list[code] = user.uid
    localStorage.setItem(TABLES_KEY, JSON.stringify(list))
    localStorage.setItem(accountTableKey(user.uid), code)
    return true
  }

  const userTableRef = ref(database, `userTables/${user.uid}`)
  const existingTable = await get(userTableRef)
  const existingCode = normalizeTableCode(existingTable.child('ownCode').val())
  if (existingCode && existingCode !== code) return false
  const reservation = await runTransaction(ref(database, `tableCodes/${code}`), (current) => (current == null ? user.uid : undefined))
  if (!reservation.committed && reservation.snapshot.val() !== user.uid) return false
  const ownCodeRef = ref(database, `userTables/${user.uid}/ownCode`)
  await set(ownCodeRef, code)
  return normalizeTableCode((await get(ownCodeRef)).val()) === code
}

export const registerTable = saveUserTableCode

export async function getUserTableCode(user) {
  if (!canPlayMultiplayer(user)) return null
  if (firebaseReady) {
    const stored = normalizeTableCode((await get(ref(database, `userTables/${user.uid}/ownCode`))).val())
    if (stored) return stored
  }
  let legacyCode = null
  try { legacyCode = normalizeTableCode(localStorage.getItem(accountTableKey(user.uid))) } catch { /* local storage may be unavailable */ }
  if (legacyCode && await saveUserTableCode(legacyCode, user)) return legacyCode
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = newTableCode()
    if (await saveUserTableCode(candidate, user)) return candidate
  }
  throw new Error('Could not reserve your table code. Try again.')
}

export async function getUserTableCodes(user) {
  if (!canPlayMultiplayer(user)) return []
  const ownCode = await getUserTableCode(user)
  let joinedCodes = []
if (firebaseReady) {
  const snapshot = await get(ref(database, `userTables/${user.uid}/joinedCodes`))
  const codes = Object.keys(snapshot.val() || {})
  const alive = await Promise.all(codes.map(async (item) => (await get(ref(database, `tableCodes/${item}`))).exists()))
  joinedCodes = codes.filter((_, index) => alive[index])
} else {
  try {
    const saved = JSON.parse(localStorage.getItem(accountTableListKey(user.uid)) || '[]')
    const tables = JSON.parse(localStorage.getItem(TABLES_KEY) || '{}')
    joinedCodes = (Array.isArray(saved) ? saved : []).filter((item) => tables[item])
  } catch { /* ignore unreadable local membership data */ }
}
  return [...new Set([ownCode, ...joinedCodes].map(normalizeTableCode).filter(Boolean))]
}

export async function tableExists(value) {
  const code = normalizeTableCode(value)
  if (!code) return false
  if (!firebaseReady) return Boolean(JSON.parse(localStorage.getItem(TABLES_KEY) || '{}')[code])
  return (await get(ref(database, `tableCodes/${code}`))).exists()
}

export function isSharedRoomId(roomId) { return detectSharedRoomId(roomId, SHARED_ROOM_ID) }
export { sharedTableCodeFromRoomId }

function localRoomId() {
  return `local-${crypto.randomUUID()}`
}



// Reserve an extra table code for this account (you can own several tables)
export async function createNewTable(user) {
  if (!canPlayMultiplayer(user)) throw new Error('Sign in with an account to create a table.')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newTableCode()
    if (!firebaseReady) {
      const list = JSON.parse(localStorage.getItem(TABLES_KEY) || '{}')
      if (list[code]) continue
      list[code] = user.uid
      localStorage.setItem(TABLES_KEY, JSON.stringify(list))
      rememberLocalTable(user, code)
      return code
    }
    const reservation = await runTransaction(ref(database, `tableCodes/${code}`), (current) => (current == null ? user.uid : undefined))
    if (!reservation.committed) continue
    await update(ref(database, `userTables/${user.uid}`), {
      [`ownedCodes/${code}`]: true,
      [`joinedCodes/${code}`]: true,
    })
    return code
  }
  throw new Error('Could not reserve a table code. Try again.')
}

// Everything the "Your tables" modal needs: code, owned or joined, current puzzle, last activity
export async function getUserTableDetails(user) {
  const codes = await getUserTableCodes(user)
  const ownCode = await getUserTableCode(user)
  const owned = new Set([ownCode])
  if (firebaseReady) {
    const snapshot = await get(ref(database, `userTables/${user.uid}/ownedCodes`))
    Object.keys(snapshot.val() || {}).forEach((code) => owned.add(code))
  } else {
    const list = JSON.parse(localStorage.getItem(TABLES_KEY) || '{}')
    codes.forEach((code) => { if (list[code] === user.uid) owned.add(code) })
  }
  return Promise.all(codes.map(async (code) => {
    let activeLevelId = null
    let updatedAt = null
    if (firebaseReady) {
      try {
        const state = await get(ref(database, `tableState/${code}`))
        activeLevelId = state.child('activeLevelId').val()
        updatedAt = state.child('updatedAt').val()
      } catch { /* show the table without puzzle info */ }
    } else {
      activeLevelId = localStorage.getItem(localActiveLevelKey(code))
    }
    return { code, owned: owned.has(code), activeLevelId, updatedAt }
  }))
}


function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('')
}

function loadLocalRooms() {
  if (localCache.size) return localCache
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_ROOMS_KEY) || '{}')
    Object.entries(saved).forEach(([id, room]) => localCache.set(id, room))
  } catch {
    localStorage.removeItem(LOCAL_ROOMS_KEY)
  }
  return localCache
}

function persistLocalRooms() {
  localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(Object.fromEntries(localCache)))
}

function localChannel(roomId) {
  if (!channels.has(roomId) && 'BroadcastChannel' in window) {
    channels.set(roomId, new BroadcastChannel(`jigsawmult:${roomId}`))
  }
  return channels.get(roomId)
}

function publishLocal(roomId, event) {
  const localEvent = event.type === 'puzzle-ready'
    ? { type: 'snapshot', room: loadLocalRooms().get(roomId) }
    : event
  localSubscribers.get(roomId)?.forEach((listener) => listener(localEvent))
  localChannel(roomId)?.postMessage(event)
}

function applyLocalEvent(roomId, event) {
  const room = loadLocalRooms().get(roomId)
  if (!room) return
  if (event.type === 'meta') room.meta = event.meta
  if (event.type === 'game') room.game = event.game || {}
  if (event.type === 'player' && event.player?.uid) room.players[event.player.uid] = event.player
  if (event.type === 'player-left') delete room.players[event.uid]
  if (event.type === 'piece' && event.piece?.id) room.pieces[event.piece.id] = event.piece
  if (event.type === 'message' && !room.chat.some((message) => message.id === event.message.id)) room.chat.push(event.message)
}

function latestStoredRoom(roomId) {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_ROOMS_KEY) || '{}')
    return saved[roomId] || null
  } catch {
    return null
  }
}

function makePlayer(user, displayName) {
  return {
    uid: user.uid,
    displayName: displayName || user.displayName || 'Puzzle Pal',
    photoURL: user.photoURL || null,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    color: ['#527FA8', '#D96868', '#8E9F83', '#C69C73'][Math.floor(Math.random() * 4)],
  }
}

export async function deleteTable(user, value, levelIds = []) {
  const code = normalizeTableCode(value)
  if (!code) throw new Error('Invalid table code.')
  if (!canPlayMultiplayer(user)) throw new Error('Sign in with an account to delete a table.')
  const roomIds = levelIds.map((id) => sharedLevelRoomId(code, id, SHARED_ROOM_ID))

  if (!firebaseReady) {
    const list = JSON.parse(localStorage.getItem(TABLES_KEY) || '{}')
    if (list[code] !== user.uid) throw new Error('Only the host can delete this table.')
    delete list[code]
    localStorage.setItem(TABLES_KEY, JSON.stringify(list))
    try {
      const joined = JSON.parse(localStorage.getItem(accountTableListKey(user.uid)) || '[]')
      localStorage.setItem(accountTableListKey(user.uid), JSON.stringify(joined.filter((item) => item !== code)))
      if (localStorage.getItem(accountTableKey(user.uid)) === code) localStorage.removeItem(accountTableKey(user.uid))
    } catch { /* ignore unreadable local data */ }
    localStorage.removeItem(localActiveLevelKey(code))
    localStorage.removeItem(`${SHARED_HISTORY_KEY}-${sharedBase(code)}`)
    const rooms = loadLocalRooms()
    roomIds.forEach((id) => rooms.delete(id))
    persistLocalRooms()
    return
  }

  const owner = (await get(ref(database, `tableCodes/${code}`))).val()
  if (owner !== user.uid) throw new Error('Only the host can delete this table.')
  const patch = {
    [`tableState/${code}`]: null,
    [`tableHistory/${code}`]: null,
    [`userTables/${user.uid}/ownedCodes/${code}`]: null,
    [`userTables/${user.uid}/joinedCodes/${code}`]: null,
  }
  roomIds.forEach((id) => { patch[`rooms/${id}`] = null })
  const own = normalizeTableCode((await get(ref(database, `userTables/${user.uid}/ownCode`))).val())
  if (own === code) patch[`userTables/${user.uid}/ownCode`] = null
  await update(ref(database), patch)
  await remove(ref(database, `tableCodes/${code}`)) // last, so ownership checks pass above
}

async function joinSharedTableClient({ user, player, tableCode, levelId, activateLevel, preferLevel }) {
  let ownerId = (await get(ref(database, `tableCodes/${tableCode}`))).val()
  if (!ownerId) { 
    // repair: a table saved to this account whose code reservation is missing
    const mine = await get(ref(database, `userTables/${user.uid}`))
    const isMine = normalizeTableCode(mine.child('ownCode').val()) === tableCode || mine.child(`ownedCodes/${tableCode}`).exists()
    if (!isMine) throw new Error('No table has that code.')
    const claim = await runTransaction(ref(database, `tableCodes/${tableCode}`), (current) => (current == null ? user.uid : undefined))
    ownerId = claim.snapshot.val() || user.uid
  }
  const activeId = (await get(ref(database, `tableState/${tableCode}/activeLevelId`))).val()
  const chosen = (preferLevel || activateLevel || !activeId) ? levelId : activeId
  const id = sharedLevelRoomId(tableCode, chosen, SHARED_ROOM_ID)
  const now = Date.now()
  const base = `rooms/${id}`
  const meta0 = {
    roomCode: tableCode, tableCode, ownerId, hostId: ownerId, levelId: chosen, status: 'playing',
    isPublic: false, permanent: true, createdAt: now, updatedAt: now, title: 'Our table',
  }
  const game0 = {
    shared: true, levelId: chosen, status: 'playing', progress: 0, elapsedSeconds: 0,
    startedAt: now, resumedAt: now, tickAt: now, pausedAt: null, completedAt: null,
    sessionId: `${now}-${Math.random().toString(36).slice(2, 8)}`, pieceCount: 0,
  }
  let meta = (await runTransaction(ref(database, `${base}/meta`), (c) => c || meta0)).snapshot.val()
  let game = (await runTransaction(ref(database, `${base}/game`), (c) => c || game0)).snapshot.val()
  if (game.status === 'waiting') {
    game = (await runTransaction(ref(database, `${base}/game`), (c) => (c?.status === 'waiting'
      ? { ...c, status: 'playing', startedAt: now, resumedAt: now, tickAt: now, pausedAt: null, completedAt: null, sessionId: game0.sessionId }
      : c))).snapshot.val()
  }
  if (game.status === 'playing' && meta.status === 'waiting') {
    meta = (await runTransaction(ref(database, `${base}/meta`), (c) => (c?.status === 'waiting' ? { ...c, status: 'playing', updatedAt: now } : c))).snapshot.val()
  }

  let full = false
  const seat = await runTransaction(ref(database, `${base}/players`), (cur) => {
    const players = { ...(cur || {}) }
    for (const [uid, p] of Object.entries(players)) {
      if (uid !== user.uid && now - Number(p?.lastSeenAt || p?.joinedAt || 0) >= STALE_MS) delete players[uid]
    }
    if (!players[user.uid] && Object.keys(players).length >= SHARED_MAX_PLAYERS) { full = true; return }
    players[user.uid] = player
    return players
  })
  if (!seat.committed) throw new Error(full ? 'Both seats at this table are already taken.' : 'Could not join the table. Try again.')

  await set(ref(database, `userTables/${user.uid}/joinedCodes/${tableCode}`), true)
  await update(ref(database, `tableState/${tableCode}`), { activeLevelId: chosen, updatedAt: Date.now() })
  return { id, meta, game, player: seat.snapshot.child(user.uid).val() }
}

async function joinRoomClient({ code, user, displayName, resumeOwned }) {
  const roomId = (await get(ref(database, `roomCodes/${code}`))).val()
  if (!roomId) throw new Error('No room has that code.')
  const [metaSnap, gameSnap] = await Promise.all([
    get(ref(database, `rooms/${roomId}/meta`)),
    get(ref(database, `rooms/${roomId}/game`)),
  ])
  const meta = metaSnap.val()
  const game = gameSnap.val() || {}
  if (!meta || meta.roomCode !== code) throw new Error('No room has that code.')
  if (meta.permanent === true) throw new Error('Join this table from the Together page.')
  const ownSolo = resumeOwned && meta.hostId === user.uid
  if (!canPlayMultiplayer(user) && !(ownSolo && meta.multiplayerEnabled === false)) {
    throw new Error('This room needs a signed-in account. Guests can reopen only their own solo room.')
  }
  if (canPlayMultiplayer(user) && meta.multiplayerEnabled === false && !ownSolo) {
    throw new Error('This room is a private solo save.')
  }
  if (meta.status === 'completed' || game.status === 'completed') throw new Error('That room is no longer available.')

  const player = makePlayer(user, displayName)
  let full = false
  const result = await runTransaction(ref(database, `rooms/${roomId}/players`), (cur) => {
    const players = cur || {}
    if (players[user.uid]) return players
    if (Object.keys(players).length >= 8) { full = true; return }
    return { ...players, [user.uid]: player }
  })
  if (!result.committed) throw new Error(full ? 'This room is full.' : 'Could not join the room. Try again.')

  const joined = result.snapshot.val() || {}
  if (!joined[meta.hostId]) await update(ref(database, `rooms/${roomId}/meta`), { hostId: user.uid, updatedAt: Date.now() })
  return { id: roomId, player: joined[user.uid] }
}

function canManageRoom(room, user) {
  return Boolean(room && user?.uid && (room.meta?.hostId === user.uid
    || (room.meta?.permanent === true && room.players?.[user.uid])))
}

export async function heartbeatShared(roomId, user) {
  if (!firebaseReady || !user) return
  await update(ref(database, `rooms/${roomId}/players/${user.uid}`), { lastSeenAt: Date.now() })
}

export async function enterSharedRoom({ user, displayName, levelId, code, activateLevel = false, preferLevel = false }) {
  if (!canPlayMultiplayer(user)) throw new Error('Sign in with an account to play together.')
  if (levelId == null || levelId === '') throw new Error('Choose a puzzle for the shared table.')
  const tableCode = normalizeTableCode(code)
  if (!tableCode) throw new Error('Enter a valid 6-character table code.')
  let selectedLevelId = String(levelId)
  if (!firebaseReady) {
    const activeLevelId = localStorage.getItem(localActiveLevelKey(tableCode))
    if (!preferLevel && !activateLevel && activeLevelId) selectedLevelId = activeLevelId
    if (activateLevel || preferLevel || !activeLevelId) localStorage.setItem(localActiveLevelKey(tableCode), selectedLevelId)
  }
  const now = Date.now()
  const player = makePlayer(user, displayName)
  const meta = {
    roomCode: tableCode, tableCode, ownerId: user.uid, hostId: user.uid, levelId: selectedLevelId, status: 'playing',
    isPublic: false, permanent: true, createdAt: now, updatedAt: now, title: 'Our table',
  }
  const game = {
    shared: true, levelId: selectedLevelId, status: 'playing', progress: 0, elapsedSeconds: 0,
    startedAt: now, resumedAt: now, tickAt: now, pausedAt: null, completedAt: null,
    sessionId: `${now}-${Math.random().toString(36).slice(2, 8)}`, pieceCount: 0,
  }

  if (!firebaseReady) {
    const rooms = loadLocalRooms()
    const id = sharedLevelRoomId(tableCode, selectedLevelId, SHARED_ROOM_ID)
    let room = latestStoredRoom(id) || rooms.get(id)
    if (!room) room = { id, meta, players: {}, game, pieces: {}, pieceTargets: {}, chat: [] }
    room.players ||= {}
    if (room.game?.status === 'waiting') {
      room.game = { ...room.game, ...game, progress: Number(room.game.progress) || 0, elapsedSeconds: Number(room.game.elapsedSeconds) || 0 }
    }
    if (room.meta?.status === 'waiting') Object.assign(room.meta, { status: 'playing', updatedAt: now })
    const active = Object.values(room.players || {}).filter((entry) => entry.uid === user.uid || now - Number(entry.lastSeenAt || entry.joinedAt || 0) < STALE_MS)
    if (!room.players[user.uid] && active.length >= SHARED_MAX_PLAYERS) throw new Error('Both seats at this table are already taken.')
    for (const [uid, entry] of Object.entries(room.players || {})) {
      if (uid !== user.uid && now - Number(entry.lastSeenAt || entry.joinedAt || 0) >= STALE_MS) delete room.players[uid]
    }
    room.players[user.uid] = player
    room.meta.permanent = true
    room.meta.tableCode = tableCode
    room.meta.ownerId ||= user.uid
    rooms.set(id, room)
    persistLocalRooms()
    rememberLocalTable(user, tableCode)
    publishLocal(id, { type: 'player', player })
    return room
  }

  const joined = await joinSharedTableClient({ user, player, tableCode, levelId: selectedLevelId, activateLevel, preferLevel })

  const playerRef = ref(database, `rooms/${joined.id}/players/${user.uid}`)
  try {
    await onDisconnect(playerRef).remove()
    return { id: joined.id, meta: joined.meta, players: { [user.uid]: joined.player }, game: joined.game }
  } catch (error) {
    await remove(playerRef).catch(() => { })
    throw error
  }
}

// Counts play time only while someone has the puzzle open. Both clients may call
// this; the transaction only applies it when ~10s have passed since the last tick.
export async function tickSharedClock(roomId) {
  const apply = (game) => {
    const now = Date.now()
    const gap = (now - (Number(game.tickAt) || now)) / 1000
    if (game.status !== 'playing' || gap < 8) return null
    return { ...game, elapsedSeconds: (Number(game.elapsedSeconds) || 0) + Math.round(Math.min(gap, 15)), tickAt: now }
  }
  if (firebaseReady) {
    await runTransaction(ref(database, `rooms/${roomId}/game`), (current) => (current ? (apply(current) || undefined) : current))
    return
  }
  const room = loadLocalRooms().get(roomId)
  const next = room && apply(room.game)
  if (!next) return
  room.game = next
  persistLocalRooms()
  publishLocal(roomId, { type: 'game', game: room.game })
}

export async function recordSharedCompletion({ roomId, sessionId, level, players, totalTime, placedCount, contributionCounts = {}, uid }) {
  const base = sharedTableOf(roomId)
  const localKey = `${SHARED_HISTORY_KEY}-${base}`
  const id = `${roomId}_${sessionId || 'session'}`
  const record = {
    id,
    roomId,
    sessionId: sessionId || null,
    levelId: level.id,
    levelTitle: level.title,
    levelOrder: Number(level.order) || 0,
    difficulty: level.difficulty || '',
    pieceCount: Number(level.pieceCount) || Number(placedCount) || 0,
    description: level.description || '',
    imageURL: level.imageURL,
    imageRotation: level.imageRotation || 0,
    imageAlt: level.imageAlt || '',
    totalTime: Math.max(0, Number(totalTime) || 0),
    completedAt: Date.now(),
    players: (players || []).map((player) => ({
      uid: player.uid,
      displayName: player.displayName || 'Puzzle Pal',
      piecesPlaced: Number(contributionCounts[player.uid]) || 0,
    })),
  }

  if (firebaseReady) {
    const code = sharedTableCodeFromRoomId(roomId, SHARED_ROOM_ID)
    if (code) {
      const key = id.replace(/[.#$/\[\]]/g, '_')
      await runTransaction(ref(database, `tableHistory/${code}/${key}`), (cur) => cur || record)
    }
    return recordCompletion({shared: true, roomId, sessionId, levelId: level.id, players, totalTime, placedCount, contributionCounts, uid })
  }


  const saved = JSON.parse(localStorage.getItem(localKey) || '[]')
  if (!saved.some((r) => r.id === id)) {
    saved.push(record)
    localStorage.setItem(localKey, JSON.stringify(saved.slice(-200)))
  }
  return { saved: true }
}

export async function getSharedHistory(code) {
  const normalizedCode = normalizeTableCode(code)
  if (!normalizedCode) return []
  const base = sharedBase(normalizedCode)
  let list = []
  if (firebaseReady) {
    const snap = await get(ref(database, `tableHistory/${normalizedCode}`))
    list = snap.exists() ? Object.entries(snap.val()).map(([id, record]) => ({ id, ...record })) : []
  } else {
    try { list = JSON.parse(localStorage.getItem(`${SHARED_HISTORY_KEY}-${base}`) || '[]') } catch { /* ignore */ }
  }
  return list.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
}

export async function getSharedHistoryForTables(codes = []) {
  const unique = [...new Set(codes.map(normalizeTableCode).filter(Boolean))]
  const results = await Promise.allSettled(unique.map((code) => getSharedHistory(code)))
  const merged = []
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return // one failing table shouldn't hide the rest
    result.value.forEach((record) => merged.push({ ...record, tableCode: unique[index] }))
  })
  return merged.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
}


export async function createRoom({ user, displayName, levelId, isPublic = false }) {
  const id = firebaseReady ? push(ref(database, 'rooms')).key : localRoomId()
  const player = makePlayer(user, displayName)
  const code = roomCode()
  const room = {
    id,
    meta: {
      roomCode: code,
      hostId: user.uid,
      multiplayerEnabled: canPlayMultiplayer(user),
      levelId,
      status: 'waiting',
      isPublic,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: 'A little puzzle room',
    },
    players: { [user.uid]: player },
    game: { progress: 0, levelId, startedAt: null, pausedAt: null, completedAt: null },
    pieces: {},
    pieceTargets: {},
    chat: [],
  }

  if (!firebaseReady) {
    loadLocalRooms().set(id, room)
    persistLocalRooms()
    return room
  }

  const codeRef = ref(database, `roomCodes/${code}`)
  const reservation = await runTransaction(codeRef, (current) => (current == null ? id : undefined))
  if (!reservation.committed) throw new Error('Could not reserve a room code. Try again.')

  const metaRef = ref(database, `rooms/${id}/meta`)
  const playerRef = ref(database, `rooms/${id}/players/${user.uid}`)
  const gameRef = ref(database, `rooms/${id}/game`)
  try {
    await set(metaRef, room.meta)
    await set(playerRef, player)
    await set(gameRef, room.game)
    await onDisconnect(playerRef).remove()
    return room
  } catch (error) {
    await Promise.allSettled([remove(playerRef), remove(gameRef)])
    await Promise.allSettled([remove(codeRef)])
    await Promise.allSettled([remove(metaRef)])
    throw error
  }
}

export async function joinRoom({ code, user, displayName, resumeOwned = false }) {
  const normalizedCode = normalizeTableCode(code)
  if (!normalizedCode) throw new Error('Enter a valid 6-character room code.')
  if (!user?.uid) throw new Error('Sign in with an account before joining a room.')

  if (!firebaseReady) {
    const room = [...loadLocalRooms().values()].find((entry) => entry.meta.roomCode === normalizedCode)
    if (!room) throw new Error('No local room has that code.')
    if (!canPlayMultiplayer(user)
      && !(resumeOwned && room.meta.hostId === user.uid && room.meta.multiplayerEnabled === false)) {
      throw new Error('Sign in with an account to join multiplayer. Guests can reopen only their own solo room.')
    }
    if (canPlayMultiplayer(user) && room.meta.multiplayerEnabled === false
      && !(resumeOwned && room.meta.hostId === user.uid)) {
      throw new Error('This room is a private solo save.')
    }
    if (room.meta.status === 'completed' || room.game.status === 'completed') throw new Error('That room is no longer available.')
    room.players[user.uid] = makePlayer(user, displayName)
    if (room.meta.status === 'closed') room.meta.status = room.game.status || 'waiting'
    if (!room.players[room.meta.hostId]) room.meta.hostId = user.uid
    room.meta.updatedAt = Date.now()
    persistLocalRooms()
    publishLocal(room.id, { type: 'meta', meta: room.meta })
    publishLocal(room.id, { type: 'player', player: room.players[user.uid] })
    return room
  }

  const joined = await joinRoomClient({ code: normalizedCode, user, displayName: displayName || user.displayName || 'Puzzle Pal', resumeOwned })

  const playerRef = ref(database, `rooms/${joined.id}/players/${user.uid}`)
  try {
    await onDisconnect(playerRef).remove()
    const [metaSnapshot, gameSnapshot] = await Promise.all([
      get(ref(database, `rooms/${joined.id}/meta`)),
      get(ref(database, `rooms/${joined.id}/game`)),
    ])
    return { id: joined.id, meta: metaSnapshot.val(), players: { [user.uid]: joined.player }, game: gameSnapshot.val() || {} }
  } catch (error) {
    await remove(playerRef).catch(() => { })
    throw error
  }
}

export function subscribeRoom(roomId, onEvent) {
  if (!firebaseReady) {
    const rooms = loadLocalRooms()
    const channel = localChannel(roomId)
    const handleMessage = (channelEvent) => {
      const event = channelEvent.data
      if (event.type === 'puzzle-ready') {
        const latest = latestStoredRoom(roomId)
        if (latest) {
          rooms.set(roomId, latest)
          onEvent({ type: 'snapshot', room: latest })
        }
        return
      }
      applyLocalEvent(roomId, event)
      onEvent(event)
    }
    if (!localSubscribers.has(roomId)) localSubscribers.set(roomId, new Set())
    localSubscribers.get(roomId).add(onEvent)
    const updateRoom = () => {
      const room = rooms.get(roomId)
      if (room) onEvent({ type: 'snapshot', room })
    }
    channel?.addEventListener('message', handleMessage)
    updateRoom()
    return () => {
      channel?.removeEventListener('message', handleMessage)
      channel?.close()
      channels.delete(roomId)
      localSubscribers.get(roomId)?.delete(onEvent)
      if (localSubscribers.get(roomId)?.size === 0) localSubscribers.delete(roomId)
    }
  }

  const roomPath = `rooms/${roomId}`
  const unsubscribers = []
  const base = ref(database, `${roomPath}/meta`)
  const players = ref(database, `${roomPath}/players`)
  const game = ref(database, `${roomPath}/game`)
  const pieces = ref(database, `${roomPath}/pieces`)
  const chat = ref(database, `${roomPath}/chat`)



  unsubscribers.push(onValue(base, (snapshot) => onEvent({ type: 'meta', meta: snapshot.val() })))
  unsubscribers.push(onChildAdded(players, (snapshot) => onEvent({ type: 'player', player: snapshot.val() })))
  unsubscribers.push(onChildChanged(players, (snapshot) => onEvent({ type: 'player', player: snapshot.val() })))
  unsubscribers.push(onChildRemoved(pieces, (snapshot) => onEvent({ type: 'piece-removed', id: snapshot.key })))
  unsubscribers.push(onChildRemoved(players, (snapshot) => onEvent({ type: 'player-left', uid: snapshot.key })))
  unsubscribers.push(onValue(game, (snapshot) => onEvent({ type: 'game', game: snapshot.val() })))
  unsubscribers.push(onChildAdded(pieces, (snapshot) => onEvent({ type: 'piece', piece: { id: snapshot.key, ...snapshot.val() } })))

  unsubscribers.push(onChildChanged(pieces, (snapshot) => onEvent({ type: 'piece', piece: { id: snapshot.key, ...snapshot.val() } })))
  unsubscribers.push(onChildAdded(chat, (snapshot) => onEvent({ type: 'message', message: { id: snapshot.key, ...snapshot.val() } })))
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}

export async function setRoomStatus(roomId, status, user) {
  const now = Date.now()
  if (firebaseReady) {
    const metaSnapshot = await get(ref(database, `rooms/${roomId}/meta`))

    const gameRef = ref(database, `rooms/${roomId}/game`)
    const currentSnapshot = await get(gameRef)
    const current = currentSnapshot.val() || {}
    if (status === 'completed' && current.status === 'completed') return   // both players may call this
    const elapsedBefore = Number(current.elapsedSeconds) || 0
    const activeSince = Number(current.resumedAt || current.startedAt) || now
    const elapsedSeconds = current.shared ? elapsedBefore
      : status === 'paused' || status === 'completed'
        ? elapsedBefore + Math.max(0, Math.floor((now - activeSince) / 1000))
        : current.status === 'paused' ? elapsedBefore : 0
    const patch = {
      status,
      updatedAt: now,
      elapsedSeconds,
      ...(status === 'playing' ? {
        startedAt: current.status === 'paused' ? current.startedAt : now,
        sessionId: current.status === 'paused' ? current.sessionId : `${now}-${Math.random().toString(36).slice(2, 8)}`,
        resumedAt: now,
        tickAt: now,
        pausedAt: null,
        completedAt: null,
      } : {}),
      ...(status === 'paused' ? { pausedAt: now, resumedAt: null } : {}),
      ...(status === 'completed' ? { completedAt: now, resumedAt: null } : {}),
    }
    await update(ref(database, `rooms/${roomId}/meta`), patch)
    await update(gameRef, patch)
    return
  }

  const room = loadLocalRooms().get(roomId)
  if (!canManageRoom(room, user)) throw new Error('Only a table member can control the game.')
  const current = room.game || {}
  const elapsedBefore = Number(current.elapsedSeconds) || 0
  const activeSince = Number(current.resumedAt || current.startedAt) || now
  const elapsedSeconds = status === 'paused' || status === 'completed'
    ? elapsedBefore + Math.max(0, Math.floor((now - activeSince) / 1000))
    : current.status === 'paused' ? elapsedBefore : 0
  const patch = {
    status,
    updatedAt: now,
    elapsedSeconds,
    ...(status === 'playing' ? {
      startedAt: current.status === 'paused' ? current.startedAt : now,
      sessionId: current.status === 'paused' ? current.sessionId : `${now}-${Math.random().toString(36).slice(2, 8)}`,
      resumedAt: now,
      pausedAt: null,
      completedAt: null,
    } : {}),
    ...(status === 'paused' ? { pausedAt: now, resumedAt: null } : {}),
    ...(status === 'completed' ? { completedAt: now, resumedAt: null } : {}),
  }
  Object.assign(room.meta, patch)
  Object.assign(room.game, patch)
  persistLocalRooms()
  publishLocal(roomId, { type: 'meta', meta: room.meta })
  publishLocal(roomId, { type: 'game', game: room.game })
}

export async function initializePuzzle(roomId, pieces, user) {
  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    if (!canManageRoom(room, user)) throw new Error('Join this table before preparing its puzzle.')
    if (Object.keys(existingPieces).length || Object.keys(existingTargetMap).length) {
      if (meta?.permanent !== true && meta?.hostId !== user.uid) throw new Error('Only the room host can prepare the puzzle.')
      const removePatch = {}
      Object.keys(existingPieces).forEach((id) => { removePatch[`rooms/${roomId}/pieces/${id}`] = null })
      Object.keys(existingTargetMap).forEach((id) => { removePatch[`rooms/${roomId}/pieceTargets/${id}`] = null })
      await update(ref(database), removePatch)
    }
    room.pieces = Object.fromEntries(pieces.map((piece) => [piece.id, { ...piece, movingBy: null, placedBy: null }]))
    room.pieceTargets = Object.fromEntries(pieces.map((piece) => [piece.id, { x: piece.targetX, y: piece.targetY }]))
    room.game.pieceCount = pieces.length
    persistLocalRooms()
    publishLocal(roomId, { type: 'game', game: room.game })
    publishLocal(roomId, { type: 'puzzle-ready' })
    return
  }

  // already seeded? keep the saved progress
  const [metaSnapshot, existing, existingTargets] = await Promise.all([
    get(ref(database, `rooms/${roomId}/meta`)),
    get(ref(database, `rooms/${roomId}/pieces`)),
    get(ref(database, `rooms/${roomId}/pieceTargets`)),
  ])
  const meta = metaSnapshot.val()
  const existingPieces = existing.val() || {}
  const existingTargetMap = existingTargets.val() || {}
  const existingCount = Object.keys(existingPieces).length
  if (existingCount === pieces.length && Object.keys(existingTargetMap).length === pieces.length) return
  if (existingCount && meta?.permanent === true) return // never wipe a saved shared board
  if (existingCount || Object.keys(existingTargetMap).length) {
    if (meta?.permanent !== true && meta?.hostId !== user.uid) throw new Error('Only the room host can prepare the puzzle.')
    const removePatch = {}
    Object.keys(existingPieces).forEach((id) => { removePatch[`rooms/${roomId}/pieces/${id}`] = null })
    Object.keys(existingTargetMap).forEach((id) => { removePatch[`rooms/${roomId}/pieceTargets/${id}`] = null })
    await update(ref(database), removePatch)
  }

  const patch = {}
  for (const piece of pieces) {
    patch[`rooms/${roomId}/pieces/${piece.id}`] = {
      x: piece.x,
      y: piece.y,
      placed: false,
      rotation: piece.rotation || 0,
      movingBy: null,
      lockUntil: 0,
      placedBy: null,
      updatedAt: Date.now(),
    }
    patch[`rooms/${roomId}/pieceTargets/${piece.id}`] = {
      x: piece.targetX,
      y: piece.targetY,
    }
  }
  if (meta?.permanent !== true) patch[`rooms/${roomId}/game/pieceCount`] = pieces.length
  await update(ref(database), patch)
}

export async function resetRoomPuzzle(roomId, levelId, user) {
  if (firebaseReady) {
    const metaSnapshot = await get(ref(database, `rooms/${roomId}/meta`))
    const meta = metaSnapshot.val()
    if (meta?.permanent !== true && meta?.hostId !== user.uid) throw new Error('Only the room host can reset the puzzle.')

    const [piecesSnapshot, targetsSnapshot] = await Promise.all([
      get(ref(database, `rooms/${roomId}/pieces`)),
      get(ref(database, `rooms/${roomId}/pieceTargets`)),
    ])
    const resetPatch = {}
    Object.keys(piecesSnapshot.val() || {}).forEach((id) => { resetPatch[`rooms/${roomId}/pieces/${id}`] = null })
    Object.keys(targetsSnapshot.val() || {}).forEach((id) => { resetPatch[`rooms/${roomId}/pieceTargets/${id}`] = null })
    const updatedAt = Date.now()
    Object.assign(resetPatch, {
      [`rooms/${roomId}/meta/levelId`]: levelId,
      [`rooms/${roomId}/meta/status`]: 'waiting',
      [`rooms/${roomId}/meta/updatedAt`]: updatedAt,
      [`rooms/${roomId}/game/levelId`]: levelId,
      [`rooms/${roomId}/game/status`]: 'waiting',
      [`rooms/${roomId}/game/progress`]: 0,
      [`rooms/${roomId}/game/pieceCount`]: 0,
      [`rooms/${roomId}/game/elapsedSeconds`]: 0,
      [`rooms/${roomId}/game/startedAt`]: null,
      [`rooms/${roomId}/game/resumedAt`]: null,
      [`rooms/${roomId}/game/pausedAt`]: null,
      [`rooms/${roomId}/game/completedAt`]: null,
      [`rooms/${roomId}/game/sessionId`]: null,
      [`rooms/${roomId}/game/updatedAt`]: updatedAt,
    })
    await update(ref(database), resetPatch)
    if (meta?.permanent === true && meta.tableCode) {
      await update(ref(database, `tableState/${meta.tableCode}`), { activeLevelId: levelId, updatedAt })
    }
    return
  }

  const room = loadLocalRooms().get(roomId)
  if (!canManageRoom(room, user)) throw new Error('Join this table before restarting its puzzle.')
  room.pieces = {}
  room.pieceTargets = {}
  const updatedAt = Date.now()
  Object.assign(room.meta, { levelId, status: 'waiting', updatedAt })
  Object.assign(room.game, {
    levelId, status: 'waiting', progress: 0, pieceCount: 0, elapsedSeconds: 0,
    startedAt: null, resumedAt: null, pausedAt: null, completedAt: null, sessionId: null, updatedAt,
  })
  persistLocalRooms()
  publishLocal(roomId, { type: 'meta', meta: room.meta })
  publishLocal(roomId, { type: 'game', game: room.game })
  publishLocal(roomId, { type: 'puzzle-ready' })
}

export async function lockPiece(roomId, piece, user) {
  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    const current = room?.pieces[piece.id]
    if (!current || current.placed || (current.movingBy && current.lockUntil > Date.now() && current.movingBy !== user.uid)) return false
    current.movingBy = user.uid
    current.lockUntil = Date.now() + 12000
    publishLocal(roomId, { type: 'piece', piece: { id: piece.id, ...current } })
    return true
  }

  const result = await runTransaction(ref(database, `rooms/${roomId}/pieces/${piece.id}`), (current) => {
    if (!current || current.placed) return
    if (current.movingBy && current.lockUntil > Date.now() && current.movingBy !== user.uid) return
    return { ...current, movingBy: user.uid, lockUntil: Date.now() + 12000 }
  })
  return result.committed
}

export async function movePiece(roomId, pieceId, x, y, user) {

  const patch = { x, y, lockUntil: Date.now() + 12000, updatedAt: Date.now() }
  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    const current = room?.pieces[pieceId]
    if (!current || current.movingBy !== user.uid) return
    Object.assign(current, patch)
    publishLocal(roomId, { type: 'piece', piece: { id: pieceId, ...current } })
    return
  }
  await update(ref(database, `rooms/${roomId}/pieces/${pieceId}`), patch)
}

export async function releasePiece(roomId, pieceId, { x, y, placed, rotation = 0 }, user) {
  const patch = {
    x,
    y,
    placed,
    rotation: Number(rotation) || 0,
    placedBy: placed ? user.uid : null,
    placedByName: placed ? (user.displayName || 'Puzzle Pal') : null,
    movingBy: null,
    lockUntil: 0,
    updatedAt: Date.now(),
  }

  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    const current = room?.pieces[pieceId]
    if (!current || current.movingBy !== user.uid) return
    Object.assign(current, patch)
    if (placed) room.game.progress = Object.values(room.pieces).filter((piece) => piece.placed).length
    persistLocalRooms()
    publishLocal(roomId, { type: 'piece', piece: { id: pieceId, ...current } })
    publishLocal(roomId, { type: 'game', game: room.game })
    return
  }

  await update(ref(database, `rooms/${roomId}/pieces/${pieceId}`), patch)
}

export async function sendRoomMessage(roomId, user, text) {
  const body = text.trim().slice(0, 240)
  if (!body) return
  const message = {
    uid: user.uid,
    displayName: user.displayName || 'Puzzle Pal',
    photoURL: user.photoURL || null,
    text: body,
    createdAt: Date.now(),
  }

  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    if (!room) return
    const localMessage = { id: crypto.randomUUID(), ...message }
    room.chat.push(localMessage)
    room.chat = room.chat.slice(-60)
    persistLocalRooms()
    publishLocal(roomId, { type: 'message', message: localMessage })
    return
  }
  await set(push(ref(database, `rooms/${roomId}/chat`)), message)
}

export async function leaveRoom(roomId, user) {
  if (firebaseReady) {
    const metaRef = ref(database, `rooms/${roomId}/meta`)
    const metaSnapshot = await get(metaRef)
    const meta = metaSnapshot.val()
    if (meta?.hostId === user.uid && meta?.permanent !== true) {
      const playersSnapshot = await get(ref(database, `rooms/${roomId}/players`))
      const remaining = Object.values(playersSnapshot.val() || {})
        .filter((player) => player.uid !== user.uid)
        .sort((a, b) => a.joinedAt - b.joinedAt)
      await update(metaRef, {
        hostId: remaining[0]?.uid || user.uid,
        updatedAt: Date.now(),
      })
    }
    await remove(ref(database, `rooms/${roomId}/players/${user.uid}`))
    return
  }

  const room = loadLocalRooms().get(roomId)
  if (!room) return
  delete room.players[user.uid]
  const remaining = Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt)
  if (room.meta.hostId === user.uid && room.meta.permanent !== true) room.meta.hostId = remaining[0]?.uid || user.uid
  room.meta.updatedAt = Date.now()
  persistLocalRooms()
  publishLocal(roomId, { type: 'player-left', uid: user.uid })
}

export async function recordCompletion({ shared = false, roomId, sessionId, levelId, players, totalTime, placedCount, contributionCounts = {}, uid }) {
  const completion = {
    roomId,
    levelId,
    participants: players.map((player) => player.uid),
    contributions: players.map(({ uid, displayName }) => ({ uid, displayName, piecesPlaced: contributionCounts[uid] || 0 })),
    totalTime,
    placedCount,
    completedAt: Date.now(),
  }

  if (firestore) {
    try {
      const docId = `${roomId}_${sessionId || 'session'}`
      const previous = await getDocs(collection(firestore, 'users', uid, 'completions'))
      const existing = previous.docs.find((entry) => entry.id === docId)
      if (existing) return { saved: true, achievements: existing.data().achievements || [] } // already saved

      const earned = new Set(previous.docs.flatMap((entry) => entry.data().achievements || []))
      const candidates = []
      if (previous.empty) candidates.push('first-table')
      if (players.length >= 8) candidates.push('full-table')
      if (placedCount === 5000) candidates.push('master-table')
      if ((contributionCounts[uid] || 0) >= 100) candidates.push('steady-hands')
      const achievements = candidates.filter((id) => !earned.has(id))

      await setDoc(doc(firestore, 'users', uid, 'completions', docId), {
        ...completion,
        sessionId: sessionId || null,
        piecesPlaced: contributionCounts[uid] || 0,
        achievements,
      })
      return { saved: true, achievements }
    } catch (error) {
      console.warn('Cloud completion save failed, saving on this device instead:', error)
    }
  }


  const saved = JSON.parse(localStorage.getItem('jigsawmult-demo-completions') || '[]')
  const previousForUser = saved.filter((record) => record.participants.includes(uid))
  const alreadyEarned = new Set(previousForUser.flatMap((record) => record.achievements || []))
  const candidates = []
  if (!previousForUser.length) candidates.push('first-table')
  if (players.length >= 8) candidates.push('full-table')
  if (placedCount === 5000) candidates.push('master-table')
  if ((contributionCounts[uid] || 0) >= 100) candidates.push('steady-hands')
  const achievements = candidates.filter((id) => !alreadyEarned.has(id))
  completion.achievements = achievements
  saved.push({ id: crypto.randomUUID(), ...completion })
  localStorage.setItem('jigsawmult-demo-completions', JSON.stringify(saved.slice(-200)))
  return { saved: true, achievements }
}

export async function getUserCompletions(uid) {
  if (!uid) return []
  let cloud = []
  if (firestore) {
    try {
      const snapshot = await getDocs(collection(firestore, 'users', uid, 'completions'))
      cloud = snapshot.docs.map((completion) => ({ id: completion.id, ...completion.data() }))
    } catch {
      // fall back to the records saved on this device
    }
  }
  let local = []
  try {
    const saved = JSON.parse(localStorage.getItem('jigsawmult-demo-completions') || '[]')
    local = saved.filter((completion) => completion.participants?.includes(uid))
  } catch {
    // ignore unreadable local data
  }
  return [...cloud, ...local]
}


export async function movePieces(roomId, items, user, { keepAlive = false } = {}) {
  const now = Date.now()
  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    if (!room) return
    items.forEach(({ id, x, y, rotation }) => {
      const current = room.pieces[id]
      if (!current) return
      Object.assign(current, { x, y, rotation: Number(rotation) || 0, movingBy: user.uid, lockUntil: now + 12000, updatedAt: now })
      publishLocal(roomId, { type: 'piece', piece: { id, ...current } })
    })
    return
  }
  const patch = {}
  items.forEach(({ id, x, y, rotation }) => {
    const base = `rooms/${roomId}/pieces/${id}`
    patch[`${base}/x`] = Math.round(x)
    patch[`${base}/y`] = Math.round(y)
    patch[`${base}/rotation`] = Number(rotation) || 0
    if (keepAlive) {
      patch[`${base}/movingBy`] = user.uid
      patch[`${base}/lockUntil`] = now + 12000
    }
  })
  await update(ref(database), patch)
}

export async function releasePieces(roomId, items, user) {
  const now = Date.now()
  const build = ({ x, y, placed, rotation = 0, group }) => ({
    x,
    y,
    placed: Boolean(placed),
    rotation: Number(rotation) || 0,
    placedBy: placed ? user.uid : null,
    placedByName: placed ? (user.displayName || 'Puzzle Pal') : null,
    movingBy: null,
    lockUntil: 0,
    updatedAt: now,
    ...(group ? { group } : {}),
  })

  if (!firebaseReady) {
    const room = loadLocalRooms().get(roomId)
    if (!room) return
    items.forEach((item) => {
      const current = room.pieces[item.id]
      if (!current) return
      Object.assign(current, build(item))
      publishLocal(roomId, { type: 'piece', piece: { id: item.id, ...current } })
    })
    room.game.progress = Object.values(room.pieces).filter((piece) => piece.placed).length
    persistLocalRooms()
    publishLocal(roomId, { type: 'game', game: room.game })
    return
  }

  const patch = {}
  items.forEach((item) => {
    Object.entries(build(item)).forEach(([key, value]) => {
      patch[`rooms/${roomId}/pieces/${item.id}/${key}`] = value
    })
  })
  await update(ref(database), patch)
}
