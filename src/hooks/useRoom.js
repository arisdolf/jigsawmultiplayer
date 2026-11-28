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
  const [room, setRoom] = useState(emptyRoom)
  const [placedCount, setPlacedCount] = useState(0)
  const [activities, setActivities] = useState([])
  const piecesRef = useRef({})
  const pieceListeners = useRef(new Set())
const enterShared = useCallback((options) => enterSharedRoom({ ...options, user: options.user || user }), [user])
const completeShared = useCallback((details) => recordSharedCompletion({ ...details, uid: user?.uid }), [user?.uid])
const tickClock = useCallback(() => tickSharedClock(roomId), [roomId])
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
  const beat = () => heartbeatShared(roomId, user).catch(() => {})
  beat()
  const timer = setInterval(beat, 20000)
  return () => clearInterval(timer)
}, [roomId, user?.uid])
  
  const create = useCallback((options) => createRoom({ ...options, user: options.user || user }), [user])
  const join = useCallback((options) => joinRoom({ ...options, user: options.user || user }), [user])
  const leave = useCallback(() => leaveRoom(roomId, user), [roomId, user])
  const controlStatus = useCallback((status) => setRoomStatus(roomId, status, user), [roomId, user])
  const prepare = useCallback((pieces) => initializePuzzle(roomId, pieces, user), [roomId, user])
  const reset = useCallback((levelId) => resetRoomPuzzle(roomId, levelId, user), [roomId, user])
  const acquirePiece = useCallback((piece) => lockPiece(roomId, piece, user), [roomId, user])
  const move = useCallback((pieceId, x, y) => movePiece(roomId, pieceId, x, y, user), [roomId, user])
  const release = useCallback((pieceId, placement) => releasePiece(roomId, pieceId, placement, user), [roomId, user])
  const moveMany = useCallback((items, options) => movePieces(roomId, items, user, options), [roomId, user])
  const releaseMany = useCallback((items) => releasePieces(roomId, items, user), [roomId, user])
  const message = useCallback((text) => sendRoomMessage(roomId, user, text), [roomId, user])
  const complete = useCallback((details) => recordCompletion({ ...details, roomId }), [roomId])

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


