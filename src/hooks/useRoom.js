import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createRoom,
  initializePuzzle,
  joinRoom,
  leaveRoom,
  lockPiece,
  movePiece,
  recordCompletion,
  resetRoomPuzzle,
  releasePiece,
  sendRoomMessage,
  setRoomStatus,
  subscribeRoom,
  movePieces,
  releasePieces,
  enterSharedRoom,
  heartbeatShared,
  isSharedRoomId,
  recordSharedCompletion,
  tickSharedClock
} from '../services/roomService'
import { playSound } from '../services/audioManager'

const emptyRoom = { id: null, meta: null, players: [], game: {}, chat: [] }




export function useRoom(roomId, user) {
  const userRef = useRef(user)
userRef.current = user
const uid = user?.uid

const enterShared = useCallback((options) => enterSharedRoom({ ...options, user: options.user || userRef.current }), [])
const completeShared = useCallback((details) => recordSharedCompletion({ ...details, roomId, uid }), [roomId, uid])
const tickClock = useCallback(() => tickSharedClock(roomId), [roomId])
const create = useCallback((options) => createRoom({ ...options, user: options.user || userRef.current }), [])
const join = useCallback((options) => joinRoom({ ...options, user: options.user || userRef.current }), [])
const leave = useCallback(() => leaveRoom(roomId, userRef.current), [roomId])
const controlStatus = useCallback((status) => setRoomStatus(roomId, status, userRef.current), [roomId])
const prepare = useCallback((pieces) => initializePuzzle(roomId, pieces, userRef.current), [roomId])
const reset = useCallback((levelId) => resetRoomPuzzle(roomId, levelId, userRef.current), [roomId])
const acquirePiece = useCallback((piece) => lockPiece(roomId, piece, userRef.current), [roomId])
const move = useCallback((pieceId, x, y) => movePiece(roomId, pieceId, x, y, userRef.current), [roomId])
const release = useCallback((pieceId, placement) => releasePiece(roomId, pieceId, placement, userRef.current), [roomId])
const moveMany = useCallback((items, options) => movePieces(roomId, items, userRef.current, options), [roomId])
const releaseMany = useCallback((items) => releasePieces(roomId, items, userRef.current), [roomId])
const message = useCallback((text) => sendRoomMessage(roomId, userRef.current, text), [roomId])
const complete = useCallback((details) => recordCompletion({ ...details, roomId }), [roomId])

  const [room, setRoom] = useState(emptyRoom)
  const [placedCount, setPlacedCount] = useState(0)
  const [activities, setActivities] = useState([])
  const piecesRef = useRef({})
  const pieceListeners = useRef(new Set())
  useEffect(() => {
    // always wipe the previous room's data first
    setRoom(emptyRoom)
    piecesRef.current = {}
    setPlacedCount(0)
    setActivities([])

    if (!roomId) return undefined

    let previousPlayerIds = new Set()
    const unsubscribe = subscribeRoom(roomId, (event) => {
      if (event.type === 'snapshot') {
        const snapshot = event.room
        piecesRef.current = snapshot.pieces || {}
        const players = Object.values(snapshot.players || {})
        previousPlayerIds = new Set(players.map((player) => player.uid))
        setPlacedCount(Object.values(piecesRef.current).filter((piece) => piece.placed).length)
        setActivities(Object.values(piecesRef.current)
          .filter((piece) => piece.placed)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, 6)
          .map((piece) => ({ id: piece.id, uid: piece.placedBy, at: piece.updatedAt })))
        setRoom({
          id: snapshot.id,
          meta: snapshot.meta,
          players,
          game: snapshot.game || {},
          chat: snapshot.chat || [],
        })
        pieceListeners.current.forEach((listener) => listener({ type: 'reset', pieces: piecesRef.current }))
        return
      }

      if (event.type === 'meta') {
        setRoom((current) => ({ ...current, id: roomId, meta: event.meta }))
      } else if (event.type === 'game') {
        setRoom((current) => ({ ...current, game: event.game || {} }))
      } else if (event.type === 'player') {
        const player = event.player
        if (player?.uid && !previousPlayerIds.has(player.uid)) {
          if (previousPlayerIds.size > 0) playSound('join')
          previousPlayerIds.add(player.uid)
        }
        setRoom((current) => ({
          ...current,
          players: [...current.players.filter((member) => member.uid !== player?.uid), player].filter(Boolean),
        }))
      } else if (event.type === 'player-left') {
        previousPlayerIds.delete(event.uid)
        playSound('leave')
        setRoom((current) => ({ ...current, players: current.players.filter((player) => player.uid !== event.uid) }))
      } else if (event.type === 'piece') {
        const previous = piecesRef.current[event.piece.id]
        piecesRef.current[event.piece.id] = event.piece
        if (previous && previous.placed !== event.piece.placed) {
          setPlacedCount((count) => Math.max(0, count + (event.piece.placed ? 1 : -1)))
        } else if (!previous && event.piece.placed) {
          setPlacedCount((count) => count + 1)
        }
        if (event.piece.placed && !previous?.placed) {
          setActivities((current) => [{ id: event.piece.id, uid: event.piece.placedBy, at: event.piece.updatedAt }, ...current].slice(0, 6))
        }
        pieceListeners.current.forEach((listener) => listener({ type: 'piece', piece: event.piece }))
      } else if (event.type === 'piece-removed') {
        const removed = piecesRef.current[event.id]
        delete piecesRef.current[event.id]
        if (removed?.placed) setPlacedCount((count) => Math.max(0, count - 1))
        setActivities((current) => current.filter((item) => item.id !== event.id))
        pieceListeners.current.forEach((listener) => listener({ type: 'reset', pieces: piecesRef.current }))
      } else if (event.type === 'message') {
        setRoom((current) => current.chat.some((message) => message.id === event.message.id)
          ? current
          : { ...current, chat: [...current.chat, event.message].slice(-60) })
      }
    })

    return unsubscribe
  }, [roomId])

  const subscribePieces = useCallback((listener) => {
    pieceListeners.current.add(listener)
    listener({ type: 'reset', pieces: piecesRef.current })
    return () => pieceListeners.current.delete(listener)
  }, [])

  useEffect(() => {
    if (!roomId || !user || !isSharedRoomId(roomId)) return undefined
    const beat = () => heartbeatShared(roomId, user).catch(() => { })
    beat()
    const timer = setInterval(beat, 20000)
    return () => clearInterval(timer)
  }, [roomId, user?.uid])

 

  return {
    room,
    piecesRef,
    placedCount,
    activities,
    subscribePieces,
    create,
    join,
    leave,
    controlStatus,
    prepare,
    reset,
    acquirePiece,
    move,
    release,
    message,
    complete,
    moveMany,
    releaseMany,
    enterShared, completeShared, tickClock,
  }
}


