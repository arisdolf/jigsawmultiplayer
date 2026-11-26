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

const LOCAL_ROOMS_KEY = 'jigsawmult-demo-rooms'
const localCache = new Map()
const channels = new Map()
const localSubscribers = new Map()
export const SHARED_ROOM_ID = import.meta.env.VITE_SHARED_ROOM_ID || 'our-table'
const SHARED_MAX_PLAYERS = 2
const SHARED_HISTORY_KEY = 'jigsawmult-demo-shared-history'
function localRoomId() {
  return `local-${crypto.randomUUID()}`
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
    color: ['#527FA8', '#D96868', '#8E9F83', '#C69C73'][Math.floor(Math.random() * 4)],
  }
}

export async function enterSharedRoom({ user, displayName, levelId }) {
  const id = SHARED_ROOM_ID
  const now = Date.now()
  const player = makePlayer(user, displayName)
  const meta = {
    roomCode: 'TOGETHER', hostId: user.uid, levelId, status: 'playing',
    isPublic: false, permanent: true, createdAt: now, updatedAt: now, title: 'Our table',
  }
  const game = {
    shared: true, levelId, status: 'playing', progress: 0, elapsedSeconds: 0,
    startedAt: now, resumedAt: now, tickAt: now, pausedAt: null, completedAt: null,
    sessionId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
  }
  const live = ['playing', 'paused', 'completed']

  if (!firebaseReady) {
    const rooms = loadLocalRooms()
    let room = latestStoredRoom(id) || rooms.get(id)
    if (!room) room = { id, meta, players: {}, game, pieces: {}, pieceTargets: {}, chat: [] }
    if (!live.includes(room.game?.status)) room.game = { ...game, levelId: room.meta?.levelId || levelId }
    room.players[user.uid] = player
    rooms.set(id, room)
    persistLocalRooms()
    publishLocal(id, { type: 'player', player })
    return room
  }

  const metaRef = ref(database, `rooms/${id}/meta`)
  const gameRef = ref(database, `rooms/${id}/game`)
  const playerRef = ref(database, `rooms/${id}/players/${user.uid}`)
  const [metaSnap, gameSnap, playersSnap] = await Promise.all([
    get(metaRef), get(gameRef), get(ref(database, `rooms/${id}/players`)),
  ])
  const present = playersSnap.val() || {}
  if (!present[user.uid] && Object.keys(present).length >= SHARED_MAX_PLAYERS) {
    throw new Error('Both seats at this table are already taken.')
  }
  const existingMeta = metaSnap.val()
  if (!existingMeta) await set(metaRef, meta)
  if (!live.includes(gameSnap.val()?.status)) {
    await update(gameRef, { ...game, levelId: existingMeta?.levelId || levelId })
    await update(metaRef, { status: 'playing', updatedAt: now })
  }
  await set(playerRef, player)
  await onDisconnect(playerRef).remove()
  return { id, meta: existingMeta || meta, players: { [user.uid]: player }, game: {} }
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

export async function recordSharedCompletion({ sessionId, level, players, totalTime, placedCount, contributionCounts = {} }) {
  const id = sessionId || `s-${Date.now()}`
  const record = {
    id,
    levelId: level.id,
    levelTitle: level.title || '',
    levelOrder: Number(level.order) || 0,
    difficulty: level.difficulty || '',
    description: level.description || '',
    imageURL: level.imageURL || '',
    imageAlt: level.imageAlt || '',
    imageRotation: Number(level.imageRotation) || 0,
    pieceCount: placedCount,
    totalTime: Math.max(0, Math.floor(totalTime || 0)),
    completedAt: Date.now(),
    players: players.map((p) => ({
      uid: p.uid, displayName: p.displayName || 'Puzzle Pal', color: p.color || null,
      photoURL: p.photoURL || null, piecesPlaced: contributionCounts[p.uid] || 0,
    })),
  }
  if (firebaseReady) {
    // first writer wins, so both players saving the same finish is harmless
    await runTransaction(ref(database, `rooms/${SHARED_ROOM_ID}/history/${id}`), (cur) => (cur == null ? record : undefined))
    return { saved: true }
  }
  const saved = JSON.parse(localStorage.getItem(SHARED_HISTORY_KEY) || '[]')
  if (!saved.some((r) => r.id === id)) {
    saved.push(record)
    localStorage.setItem(SHARED_HISTORY_KEY, JSON.stringify(saved.slice(-200)))
  }
  return { saved: true }
}

export async function getSharedHistory() {
  let list = []
  if (firebaseReady) {
    const snap = await get(ref(database, `rooms/${SHARED_ROOM_ID}/history`))
    list = snap.exists() ? Object.values(snap.val()) : []
  } else {
    try { list = JSON.parse(localStorage.getItem(SHARED_HISTORY_KEY) || '[]') } catch { /* ignore */ }
  }
  return list.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
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

export async function joinRoom({ code, user, displayName }) {
  const normalizedCode = code.trim().toUpperCase()
  if (!normalizedCode) throw new Error('Enter a room code.')

  if (!firebaseReady) {
    const room = [...loadLocalRooms().values()].find((entry) => entry.meta.roomCode === normalizedCode)
    if (!room) throw new Error('No local room has that code.')
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

    const codeSnapshot = await get(ref(database, `roomCodes/${normalizedCode}`))
  const id = codeSnapshot.val()
  if (!id) throw new Error('No room has that code.')

  // check the room exists, isn't finished, and has space (limit of 8 players)
  const [metaSnapshot, playersSnapshot] = await Promise.all([
    get(ref(database, `rooms/${id}/meta`)),
    get(ref(database, `rooms/${id}/players`)),
  ])
  const meta = metaSnapshot.val()
  if (!meta) throw new Error('That room is no longer available.')
  if (meta.status === 'completed') throw new Error('That room is no longer available.')
  const current = playersSnapshot.val() || {}
  if (!current[user.uid] && Object.keys(current).length >= 8) throw new Error('This room is full.')

  const player = makePlayer(user, displayName)
  const playerRef = ref(database, `rooms/${id}/players/${user.uid}`)
  await set(playerRef, player)
  await onDisconnect(playerRef).remove()
  return { id, meta, players: { [user.uid]: player }, game: {} }
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

export async function updateRoomSettings(roomId, changes, user) {
  const allowed = {
    levelId: changes.levelId,
    isPublic: changes.isPublic,
    title: changes.title,
    updatedAt: Date.now(),
  }
  Object.keys(allowed).forEach((key) => allowed[key] === undefined && delete allowed[key])

  if (firebaseReady) {
    await update(ref(database, `rooms/${roomId}/meta`), allowed)
    if (allowed.levelId) await update(ref(database, `rooms/${roomId}/game`), { levelId: allowed.levelId })
    return
  }

  const room = loadLocalRooms().get(roomId)
  if (!room || room.meta.hostId !== user.uid) throw new Error('Only the room host can change room settings.')
  Object.assign(room.meta, allowed)
  if (allowed.levelId) room.game.levelId = allowed.levelId
  persistLocalRooms()
  publishLocal(roomId, { type: 'meta', meta: room.meta })
  if (allowed.levelId) publishLocal(roomId, { type: 'game', game: room.game })
}

export async function setRoomStatus(roomId, status, user) {
  const now = Date.now()
  if (firebaseReady) {
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
  if (!room || room.meta.hostId !== user.uid) throw new Error('Only the room host can control the game.')
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
    if (!room || room.meta.hostId !== user.uid) throw new Error('Only the room host can prepare the puzzle.')
    if (Object.keys(room.pieces || {}).length === pieces.length) return // already seeded, keep progress
    room.pieces = Object.fromEntries(pieces.map((piece) => [piece.id, { ...piece, movingBy: null, placedBy: null }]))
    room.pieceTargets = Object.fromEntries(pieces.map((piece) => [piece.id, { x: piece.targetX, y: piece.targetY }]))
    room.game.pieceCount = pieces.length
    persistLocalRooms()
    publishLocal(roomId, { type: 'game', game: room.game })
    publishLocal(roomId, { type: 'puzzle-ready' })
    return
  }

  // already seeded? keep the saved progress
  const existing = await get(ref(database, `rooms/${roomId}/pieces`))
  const existingCount = existing.exists() ? Object.keys(existing.val()).length : 0
  if (existingCount === pieces.length) return
  if (existingCount > 0) await remove(ref(database, `rooms/${roomId}/pieces`)) // wrong size, start clean
  
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
  patch[`rooms/${roomId}/game/pieceCount`] = pieces.length
  await update(ref(database), patch)
}

export async function resetRoomPuzzle(roomId, levelId, user) {
  if (firebaseReady) {
    const metaSnapshot = await get(ref(database, `rooms/${roomId}/meta`))
    if (metaSnapshot.val()?.hostId !== user.uid) throw new Error('Only the room host can reset the puzzle.')
      const meta = metaSnapshot.val()
if (!meta?.permanent && meta?.hostId !== user.uid) throw new Error('Only the room host can reset the puzzle.')
    await Promise.all([
      remove(ref(database, `rooms/${roomId}/pieces`)),
      remove(ref(database, `rooms/${roomId}/pieceTargets`)),
    ])
    const updatedAt = Date.now()
    await update(ref(database, `rooms/${roomId}/meta`), { levelId, status: 'waiting', updatedAt })
    await update(ref(database, `rooms/${roomId}/game`), {
      levelId, status: 'waiting', progress: 0, pieceCount: 0, elapsedSeconds: 0,
      startedAt: null, resumedAt: null, pausedAt: null, completedAt: null, sessionId: null, updatedAt,
    })
    return
  }

  const room = loadLocalRooms().get(roomId)
  if (!room || room.meta.hostId !== user.uid) throw new Error('Only the room host can reset the puzzle.')
  if (!room || (!room.meta.permanent && room.meta.hostId !== user.uid)) throw new Error('Only the room host can reset the puzzle.')
  room.pieces = {}
  room.pieceTargets = {}
  Object.assign(room.meta, { levelId, status: 'waiting', updatedAt: Date.now() })
  Object.assign(room.game, {
    levelId, status: 'waiting', progress: 0, pieceCount: 0, elapsedSeconds: 0,
    startedAt: null, resumedAt: null, pausedAt: null, completedAt: null, sessionId: null,
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
    if (meta?.hostId === user.uid) {
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
  if (room.meta.hostId === user.uid) room.meta.hostId = remaining[0]?.uid || user.uid
  room.meta.updatedAt = Date.now()
  persistLocalRooms()
  publishLocal(roomId, { type: 'player-left', uid: user.uid })
}

export async function recordCompletion({ roomId, sessionId, levelId, players, totalTime, placedCount, contributionCounts = {}, uid }) {
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


export async function movePieces(roomId, items, user) {
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
    patch[`${base}/x`] = x
    patch[`${base}/y`] = y
        patch[`${base}/rotation`] = Number(rotation) || 0
    patch[`${base}/movingBy`] = user.uid
    patch[`${base}/lockUntil`] = now + 12000
    patch[`${base}/updatedAt`] = now
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