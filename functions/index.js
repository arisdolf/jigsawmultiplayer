import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getDatabase } from 'firebase-admin/database'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onValueDeleted } from 'firebase-functions/v2/database'

const app = getApps()[0] || initializeApp()
const database = getDatabase(app)
const firestore = getFirestore(app)
const ROOM_PLAYER_LIMIT = 8
const PLAYER_COLORS = ['#527FA8', '#D96868', '#8E9F83', '#C69C73']

export const joinRoom = onCall({ region: 'us-central1', cors: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in before joining a room.')

  const roomId = String(request.data?.roomId || '')
  const roomCode = String(request.data?.code || '').trim().toUpperCase()
  const requestedName = request.data?.displayName
  if (!/^[A-Za-z0-9_-]{20}$/.test(roomId) || !/^[A-Z2-9]{6}$/.test(roomCode)) {
    throw new HttpsError('invalid-argument', 'Room or room code is invalid.')
  }

  const metaSnapshot = await database.ref(`rooms/${roomId}/meta`).get()
  const meta = metaSnapshot.val()
  if (!meta || meta.roomCode !== roomCode) {
    throw new HttpsError('not-found', 'No room has that code.')
  }
  const gameRef = database.ref(`rooms/${roomId}/game`)
  const gameSnapshot = await gameRef.get()
  const game = gameSnapshot.val() || {}
  if (meta.status === 'completed' || game.status === 'completed') {
    throw new HttpsError('failed-precondition', 'That room is no longer available.')
  }

  const tokenName = typeof request.auth.token.name === 'string' ? request.auth.token.name : ''
  const displayName = typeof requestedName === 'string'
    ? requestedName.trim().slice(0, 48)
    : ''
  const photoURL = typeof request.auth.token.picture === 'string' ? request.auth.token.picture : null
  const player = {
    uid,
    displayName: displayName || tokenName || 'Puzzle Pal',
    photoURL,
    joinedAt: Date.now(),
    color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
    joinedWithCode: roomCode,
  }

  let roomFull = false
  const result = await database.ref(`rooms/${roomId}/players`).transaction((currentPlayers) => {
    const players = currentPlayers || {}
    if (players[uid]) return players
    if (Object.keys(players).length >= ROOM_PLAYER_LIMIT) {
      roomFull = true
      return
    }
    return { ...players, [uid]: player }
  })

  if (!result.committed) {
    if (roomFull) throw new HttpsError('resource-exhausted', 'This room is full.')
    throw new HttpsError('aborted', 'Could not join the room. Try again.')
  }

  const players = result.snapshot.val() || {}
  const firstPlayer = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt)[0]
  await database.ref(`rooms/${roomId}/meta`).transaction((current) => {
    if (!current) return
    const patch = { ...current }
    if (!players[current.hostId]) patch.hostId = firstPlayer?.uid || uid
    if (current.status === 'closed') patch.status = game.status || 'waiting'
    patch.updatedAt = Date.now()
    return patch
  })

  return { player: players[uid] }
})

export const recordPuzzleCompletion = onCall({ region: 'us-central1', cors: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in before saving a completion.')

  const roomId = String(request.data?.roomId || '')
  const levelId = String(request.data?.levelId || '')
  if (!roomId || !levelId || roomId.length > 128 || levelId.length > 64) {
    throw new HttpsError('invalid-argument', 'Room or level is missing.')
  }

  const roomSnapshot = await database.ref(`rooms/${roomId}`).get()
  const room = roomSnapshot.val()
  const game = room?.game
  const levelSnapshot = await firestore.collection('levels').doc(levelId).get()
  const level = levelSnapshot.data()
  const pieces = Object.entries(room?.pieces || {}).map(([id, piece]) => ({ id, ...piece }))
  const pieceCount = Number(game?.pieceCount)

  if (!room || !level || !room.players?.[uid]) {
    throw new HttpsError('permission-denied', 'Only a room member can save this completion.')
  }
  if (room.meta?.status !== 'completed' || game?.status !== 'completed' || game?.levelId !== levelId) {
    throw new HttpsError('failed-precondition', 'Finish the shared puzzle before saving it.')
  }
  const targets = room?.pieceTargets || {}
  const invalidPiece = pieces.some((piece) => {
    const target = targets[piece.id]
    return piece.placed !== true
      || Number(piece.rotation) !== 0
      || typeof piece.placedBy !== 'string'
      || !target
      || Math.abs(Number(piece.x) - Number(target.x)) > 2
      || Math.abs(Number(piece.y) - Number(target.y)) > 2
  })
  if (!Number.isInteger(pieceCount) || pieceCount !== Number(level.pieceCount) || pieces.length !== pieceCount || invalidPiece) {
    throw new HttpsError('failed-precondition', 'Puzzle pieces are not all placed.')
  }

  const contributions = {}
  for (const piece of pieces) {
    if (piece.placedBy) contributions[piece.placedBy] = (contributions[piece.placedBy] || 0) + 1
  }
  const participantIds = [...new Set([...Object.keys(room.players), ...Object.keys(contributions)])]
  if (participantIds.length > 150) {
    throw new HttpsError('failed-precondition', 'This room had too many participants to save as one session.')
  }
  if (!participantIds.includes(uid)) throw new HttpsError('permission-denied', 'You did not take part in this room.')

  const names = Object.fromEntries(Object.values(room.players).map((player) => [player.uid, player.displayName || 'Puzzle Pal']))
  const missingNames = participantIds.filter((participantId) => !names[participantId])
  await Promise.all(missingNames.map(async (participantId) => {
    try {
      const participant = await getAuth(app).getUser(participantId)
      names[participantId] = participant.displayName || 'Puzzle Pal'
    } catch {
      names[participantId] = 'Puzzle Pal'
    }
  }))

  const sessionId = String(game.sessionId || '')
  if (!sessionId) throw new HttpsError('failed-precondition', 'This room has no active game session.')
  const completionRef = firestore.collection('completions').doc(`${roomId}_${sessionId}`)
  const levelRef = firestore.collection('levels').doc(levelId)
  const userRefs = participantIds.map((participantId) => ({
    uid: participantId,
    profile: firestore.collection('users').doc(participantId),
    completion: firestore.collection('users').doc(participantId).collection('completions').doc(levelId),
  }))

  return firestore.runTransaction(async (transaction) => {
    const [existing, currentLevel, ...userSnapshots] = await Promise.all([
      transaction.get(completionRef),
      transaction.get(levelRef),
      ...userRefs.flatMap(({ profile, completion }) => [transaction.get(profile), transaction.get(completion)]),
    ])
    if (existing.exists) return { saved: true, duplicate: true, achievements: [] }
    if (!currentLevel.exists) throw new HttpsError('not-found', 'Level no longer exists.')

    const totalTime = Math.max(0, Math.floor(Number(game.elapsedSeconds) || 0))
    const completedAt = FieldValue.serverTimestamp()
    const profileData = new Map()
    const completionData = new Map()
    userRefs.forEach(({ uid: participantId }, index) => {
      profileData.set(participantId, userSnapshots[index * 2].data() || {})
      completionData.set(participantId, userSnapshots[index * 2 + 1].data() || null)
    })

    const contributionRows = participantIds.map((participantId) => ({
      uid: participantId,
      displayName: names[participantId],
      piecesPlaced: contributions[participantId] || 0,
    }))
    transaction.create(completionRef, {
      roomId,
      sessionId,
      levelId,
      participants: participantIds,
      contributions: contributionRows,
      totalTime,
      placedCount: pieceCount,
      completedAt,
    })

    let newPlayers = 0
    const awardsByUid = {}
    for (const { uid: participantId, profile, completion } of userRefs) {
      const previousCompletion = completionData.get(participantId)
      const previousProfile = profileData.get(participantId)
      const statistics = previousProfile.statistics || {}
      const previousBest = Number(previousCompletion?.bestTimeSeconds)
      const improved = !Number.isFinite(previousBest) || totalTime < previousBest
      if (!previousCompletion) newPlayers += 1
      const earned = []
      if ((Number(statistics.gamesCompleted) || 0) === 0) earned.push('first-table')
      if (participantIds.length >= 8) earned.push('full-table')
      if (pieceCount === 5000) earned.push('master-table')
      if ((contributions[participantId] || 0) >= 100) earned.push('steady-hands')
      const savedAchievements = Array.isArray(previousProfile.achievements) ? previousProfile.achievements : []
      const newAchievements = earned.filter((achievementId) => !savedAchievements.includes(achievementId))
      awardsByUid[participantId] = newAchievements
      const completionAchievements = Array.isArray(previousCompletion?.achievements) ? previousCompletion.achievements : []

      transaction.set(completion, {
        uid: participantId,
        levelId,
        bestTimeSeconds: improved ? totalTime : previousBest,
        sessionCount: (Number(previousCompletion?.sessionCount) || 0) + 1,
        piecesPlaced: (Number(previousCompletion?.piecesPlaced) || 0) + (contributions[participantId] || 0),
        achievements: [...new Set([...completionAchievements, ...newAchievements])],
        roomId,
        completedAt,
      }, { merge: true })
      transaction.set(profile, {
        uid: participantId,
        statistics: {
          completedLevels: (Number(statistics.completedLevels) || 0) + (previousCompletion ? 0 : 1),
          gamesCompleted: (Number(statistics.gamesCompleted) || 0) + 1,
          piecesPlaced: (Number(statistics.piecesPlaced) || 0) + (contributions[participantId] || 0),
        },
        achievements: [...new Set([...savedAchievements, ...earned])],
        updatedAt: completedAt,
      }, { merge: true })
    }

    const currentLevelData = currentLevel.data()
    const previousLevelBest = Number(currentLevelData.bestTimeSeconds)
    transaction.set(levelRef, {
      completionCount: (Number(currentLevelData.completionCount) || 0) + newPlayers,
      bestTimeSeconds: Number.isFinite(previousLevelBest) && previousLevelBest > 0
        ? Math.min(previousLevelBest, totalTime)
        : totalTime,
      updatedAt: completedAt,
    }, { merge: true })

    return { saved: true, duplicate: false, achievements: awardsByUid[uid] || [] }
  })
})

export const recoverRoomHost = onValueDeleted('/rooms/{roomId}/players/{uid}', async (event) => {
  const { roomId, uid } = event.params
  const metaRef = database.ref(`rooms/${roomId}/meta`)
  const metaSnapshot = await metaRef.get()
  const meta = metaSnapshot.val()
  if (!meta || meta.hostId !== uid) return

  const playersSnapshot = await database.ref(`rooms/${roomId}/players`).get()
  const remaining = Object.values(playersSnapshot.val() || {}).sort((a, b) => a.joinedAt - b.joinedAt)
  await metaRef.update({
    hostId: remaining[0]?.uid || uid,
    updatedAt: Date.now(),
  })
})
