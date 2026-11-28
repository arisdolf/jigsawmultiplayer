import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Clock3, Clipboard, Image, MessageCircle, Move, Pause, Play, RotateCw, Share2, Sparkles, Trophy, UsersRound, X, Maximize2, Minimize2 } from 'lucide-react'
import Avatar from '../components/Avatar'
import ChatPanel from '../components/ChatPanel'
import Modal from '../components/Modal'
import PuzzleBoard from '../components/PuzzleBoard'
import '../css/pages/GamePage.css'
import '../css/pages/GamePage.mobile.css'
import '../css/pages/GamePage.landscape.css'

const achievementNames = {
  'first-table': 'First Table',
  'full-table': 'Full House',
  'master-table': 'Master Table',
  'steady-hands': 'Steady Hands',
}

function clockTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(hours ? 2 : 1, '0')}:${String(remaining).padStart(2, '0')}`
}

function currentElapsed(game) {
  const saved = Number(game.elapsedSeconds) || 0
  if (game.status !== 'playing') return saved
  if (game.shared) return saved + Math.min(15, Math.max(0, Math.floor((Date.now() - (Number(game.tickAt) || Date.now())) / 1000)))
  const started = Number(game.resumedAt || game.startedAt) || Date.now()
  return saved + Math.max(0, Math.floor((Date.now() - started) / 1000))
}
export default function GamePage({ roomControl, level, user, audio, onLeave, onReturnFromGame, onShare, onNextLevel, onCompletionSaved, shared = false }) {
  const { room, placedCount, activities, piecesRef } = roomControl
  const host = shared || room.meta?.hostId === user?.uid
  const status = room.game.status || room.meta?.status || 'waiting'
  const [referenceVisible, setReferenceVisible] = useState(false)
  const [referenceOpacity, setReferenceOpacity] = useState(16)
  const [referenceWindowOpen, setReferenceWindowOpen] = useState(false)
  const [referencePosition, setReferencePosition] = useState({ x: 12, y: 12 })
  const [referenceSize, setReferenceSize] = useState({ width: 256, height: 220 })
  const [boardReady, setBoardReady] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const [elapsed, setElapsed] = useState(() => currentElapsed(room.game))
  const [confirmExit, setConfirmExit] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [savingCompletion, setSavingCompletion] = useState(false)
  const [earnedAchievements, setEarnedAchievements] = useState([])
  const [completionAttempt, setCompletionAttempt] = useState(0)
  const [completionError, setCompletionError] = useState('')

  const [actualPieces, setActualPieces] = useState(0)
  const totalPieces = actualPieces || Number(level?.pieceCount || 0)
  const [chatOpen, setChatOpen] = useState(false)
  const [trayOpen, setTrayOpen] = useState(false)
  const pageRef = useRef(null)
  const boardFrameRef = useRef(null)
  const referenceWindowRef = useRef(null)
  const referenceDragRef = useRef(null)
  const referenceResizeRef = useRef(null)
  const nativeFsRef = useRef(false)
  const [fullscreen, setFullscreen] = useState(false)
  const completionKey = `${room.id || ''}:${room.game.sessionId || ''}`
  const completionHandled = useRef('')
  const handleGenerated = useCallback((grid, count) => setActualPieces(count), [])
  const currentLevel = level ? { ...level, roomStatus: status } : null
  const isComplete = status === 'completed' || (totalPieces > 0 && placedCount >= totalPieces)
  const progress = totalPieces ? Math.min(100, Math.round((placedCount / totalPieces) * 100)) : 0
  const [skipCelebration, setSkipCelebration] = useState(isComplete) // already finished when the page opened
  const [celebrationDone, setCelebrationDone] = useState(false)
  const clampReferencePosition = useCallback((x, y) => {
    const board = boardFrameRef.current
    const panel = referenceWindowRef.current
    const maxX = Math.max(8, (board?.clientWidth || 0) - (panel?.offsetWidth || 256) - 8)
    const maxY = Math.max(8, (board?.clientHeight || 0) - (panel?.offsetHeight || 220) - 8)
    return {
      x: Math.max(8, Math.min(x, maxX)),
      y: Math.max(8, Math.min(y, maxY)),
    }
  }, [])

  function startReferenceDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target.closest?.('button')) return
    const bounds = referenceWindowRef.current?.getBoundingClientRect()
    const boardBounds = boardFrameRef.current?.getBoundingClientRect()
    const board = boardFrameRef.current
    if (!bounds || !boardBounds || !board) return
    referenceDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: bounds.left - boardBounds.left - board.clientLeft,
      top: bounds.top - boardBounds.top - board.clientTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveReferenceDrag(event) {
    const drag = referenceDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setReferencePosition(clampReferencePosition(
      drag.left + event.clientX - drag.startX,
      drag.top + event.clientY - drag.startY,
    ))
  }

  function stopReferenceDrag(event) {
    if (referenceDragRef.current?.pointerId === event.pointerId) referenceDragRef.current = null
  }

  function startReferenceResize(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const bounds = referenceWindowRef.current?.getBoundingClientRect()
    if (!bounds) return
    referenceResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveReferenceResize(event) {
    const resize = referenceResizeRef.current
    const board = boardFrameRef.current
    if (!resize || resize.pointerId !== event.pointerId || !board) return
    const maxWidth = Math.max(176, board.clientWidth - referencePosition.x - 8)
    const maxHeight = Math.max(164, board.clientHeight - referencePosition.y - 8)
    setReferenceSize({
      width: Math.min(maxWidth, Math.max(176, resize.width + event.clientX - resize.startX)),
      height: Math.min(maxHeight, Math.max(164, resize.height + event.clientY - resize.startY)),
    })
  }

  function stopReferenceResize(event) {
    if (referenceResizeRef.current?.pointerId === event.pointerId) referenceResizeRef.current = null
  }

  function resizeReferenceByKeyboard(event) {
    const step = event.shiftKey ? 32 : 16
    const offset = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key]
    const board = boardFrameRef.current
    if (!offset || !board) return
    event.preventDefault()
    const maxWidth = Math.max(176, board.clientWidth - referencePosition.x - 8)
    const maxHeight = Math.max(164, board.clientHeight - referencePosition.y - 8)
    setReferenceSize((size) => ({
      width: Math.min(maxWidth, Math.max(176, size.width + offset[0])),
      height: Math.min(maxHeight, Math.max(164, size.height + offset[1])),
    }))
  }

  function moveReferenceByKeyboard(event) {
    const step = event.shiftKey ? 32 : 16
    const offset = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key]
    if (!offset) return
    event.preventDefault()
    setReferencePosition((position) => clampReferencePosition(position.x + offset[0], position.y + offset[1]))
  }

  useEffect(() => {
    if (!referenceWindowOpen) return undefined
    const keepReferenceInView = () => setReferencePosition((position) => clampReferencePosition(position.x, position.y))
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepReferenceInView)
    if (boardFrameRef.current) observer?.observe(boardFrameRef.current)
    if (referenceWindowRef.current) observer?.observe(referenceWindowRef.current)
    window.addEventListener('resize', keepReferenceInView)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', keepReferenceInView)
    }
  }, [clampReferencePosition, referenceWindowOpen])

  function toggleReferenceWindow() {
    if (!referenceWindowOpen) {
      const board = boardFrameRef.current
      setReferencePosition(clampReferencePosition(
        Math.max(8, (board?.clientWidth || 284) - 272),
        Math.max(8, (board?.clientHeight || 240) - 232),
      ))
    }
    setReferenceWindowOpen((open) => !open)
  }
  useEffect(() => {
    if (!isComplete) { setSkipCelebration(false); setCelebrationDone(false) }
  }, [isComplete])
  const celebrate = isComplete && !skipCelebration
  const showCompletion = isComplete && (skipCelebration || celebrationDone)
  useEffect(() => {
    if (!shared || status !== 'playing' || isComplete) return undefined
    const timer = window.setInterval(() => roomControl.tickClock().catch(() => { }), 5000)
    return () => window.clearInterval(timer)
  }, [shared, status, isComplete, roomControl.tickClock])
  const contributionCounts = useMemo(() => {
    const counts = {}
    Object.values(piecesRef.current).forEach((piece) => {
      if (piece.placed && piece.placedBy) counts[piece.placedBy] = (counts[piece.placedBy] || 0) + 1
    })
    return counts
  }, [piecesRef, placedCount])

  const contributors = useMemo(() => {
    const rows = new Map(room.players.map((player) => [player.uid, {
      uid: player.uid,
      displayName: player.displayName || 'Puzzle Pal',
      photoURL: player.photoURL,
      color: player.color,
      piecesPlaced: contributionCounts[player.uid] || 0,
    }]))
    Object.values(piecesRef.current).forEach((piece) => {
      if (!piece.placed || !piece.placedBy) return
      const previous = rows.get(piece.placedBy) || {
        uid: piece.placedBy,
        displayName: piece.placedByName || 'Puzzle Pal',
        photoURL: null,
        piecesPlaced: 0,
      }
      previous.piecesPlaced = contributionCounts[piece.placedBy] || 0
      if (piece.placedByName) previous.displayName = piece.placedByName
      rows.set(piece.placedBy, previous)
    })
    return [...rows.values()].sort((a, b) => b.piecesPlaced - a.piecesPlaced)
  }, [room.players, piecesRef, contributionCounts])

  useEffect(() => { setActualPieces(0) }, [level?.id])

  useEffect(() => {
    setElapsed(currentElapsed(room.game))
    const timer = window.setInterval(() => setElapsed(currentElapsed(room.game)), 1000)
    return () => window.clearInterval(timer)
  }, [room.game.status, room.game.elapsedSeconds, room.game.resumedAt, room.game.startedAt])

  async function enterFullscreen() {
    setFullscreen(true)
    const el = pageRef.current
    try {
      const request = el?.requestFullscreen || el?.webkitRequestFullscreen
      if (request) { await request.call(el); nativeFsRef.current = true }
      await window.screen.orientation?.lock?.('landscape') // ignored where unsupported (iOS)
    } catch { /* CSS full screen still works */ }
  }

  function exitFullscreen() {
    setFullscreen(false)
    nativeFsRef.current = false
    try { window.screen.orientation?.unlock?.() } catch { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { })
  }

  // user leaves native full screen with the system gesture / back button
  useEffect(() => {
    const onChange = () => {
      if (nativeFsRef.current && !document.fullscreenElement && !document.webkitFullscreenElement) {
        nativeFsRef.current = false
        setFullscreen(false)
        try { window.screen.orientation?.unlock?.() } catch { /* ignore */ }
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('puzzle-fullscreen', fullscreen)
    return () => document.body.classList.remove('puzzle-fullscreen')
  }, [fullscreen])

  useEffect(() => () => {
    try { window.screen.orientation?.unlock?.() } catch { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { })
  }, [])

  useEffect(() => {
    if (!level || !totalPieces || placedCount < totalPieces || completionHandled.current === completionKey) return
    if (!host && status !== 'completed') return // wait for the host to lock in the final time
    completionHandled.current = completionKey
    async function finish() {
      try {
        setSavingCompletion(true)
        setCompletionError('')
        if (host && status !== 'completed') await roomControl.controlStatus('completed')
        audio.playSound('complete')
        const result = shared
          ? await roomControl.completeShared({ sessionId: room.game.sessionId, level, players: contributors, totalTime: elapsed, placedCount: totalPieces, contributionCounts })
          : await roomControl.complete({ uid: user.uid, sessionId: room.game.sessionId, levelId: level.id, players: room.players, totalTime: elapsed, placedCount: totalPieces, contributionCounts })
        setEarnedAchievements(result?.achievements || [])
        if (!shared) await onCompletionSaved?.()
      } catch (error) {
        setCompletionError(error.message || 'Could not save the completion record.')
      } finally {
        setSavingCompletion(false)
      }
    }
    void finish()
  }, [host, level, shared, contributors, placedCount, completionKey, status, roomControl.controlStatus, roomControl.complete, room.players, room.game.sessionId, elapsed, contributionCounts, audio.playSound, onCompletionSaved, completionAttempt, user?.uid, totalPieces])

  const handleReadyChange = useCallback((ready) => setBoardReady(ready), [])

  async function togglePause() {
    try {
      await roomControl.controlStatus(status === 'paused' ? 'playing' : 'paused')
    } catch (error) {
      setCompletionError(error.message)
    }
  }

  async function restartPuzzle() {
    try {
      setConfirmRestart(false)
      await roomControl.reset(level.id)
      await roomControl.controlStatus('playing')
      setResetToken((value) => value + 1)
      setReferenceVisible(false)
      completionHandled.current = ''
      setCompletionError('')
    } catch (error) {
      setCompletionError(error.message)
    }
  }





  const activitiesWithNames = activities.map((activity) => ({
    ...activity,
    player: room.players.find((player) => player.uid === activity.uid),
  }))

  return (
    <main className={`game-page ${fullscreen ? 'is-fullscreen' : ''}`} ref={pageRef}>
      <header className="game-heading">
        <div className="game-heading-main"><div className="game-puzzle-thumbnail"><img src={level?.imageURL} alt="" /></div><div><p className="section-eyebrow">LEVEL {String(level?.order || 1).padStart(2, '0')} · {level?.difficulty}</p><h1>{level?.title || 'Shared puzzle'}</h1><div className="game-room-line"><span className="live-dot" /><span>{shared ? 'Our table' : 'Solo table'} · {room.players.length} playing</span></div></div></div>
        <div className="game-players-row" aria-label="Players in this room">{room.players.slice(0, 6).map((player) => <Avatar key={player.uid} player={player} size="md" isHost={room.meta.hostId === player.uid} />)}{room.players.length > 6 && <span className="avatar-overflow">+{room.players.length - 6}</span>}</div>
      </header>

      <div className="game-stat-strip">
        <div className="progress-summary"><div><span>Table progress</span><strong>{progress}%</strong></div><div className="progress-track" role="progressbar" aria-label="Puzzle progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div><strong>{Math.max(0, totalPieces - placedCount).toLocaleString()}</strong></div>
        <div className="game-stat"><span className="game-stat-icon"><PuzzleGlyph /></span><div><small>Pieces left</small><strong>{Math.max(0, Number(level?.pieceCount || 0) - placedCount).toLocaleString()}</strong></div></div>
        <div className="game-stat"><span className="game-stat-icon timer-icon"><Clock3 size={17} /></span><div><small>Time together</small><strong className="timer-value">{clockTime(elapsed)}</strong></div></div>
        <div className={`game-state-pill state-${status}`}><span className="live-dot" />{status === 'paused' ? 'On a little break' : status === 'completed' ? 'All together now' : status === 'playing' ? 'In progress' : 'Getting ready'}</div>
      </div>

      <div className="game-content-grid">
        <section className={`board-column ${trayOpen ? 'tray-open' : ''}`} aria-label="Shared puzzle board">
          <div className="board-toolbar"><div className="board-toolbar-note"><span className="board-spark"><Sparkles size={15} /></span><span>{status === 'paused' ? 'The table is paused for a moment.' : 'A little more fits every time you look.'}</span></div><div className="board-toolbar-actions">
            <button type="button" className={`board-tool ${referenceVisible ? 'active' : ''}`} aria-pressed={referenceVisible} onClick={() => setReferenceVisible((value) => !value)}><Image size={16} /> Reference</button>
            {referenceVisible && <label className="reference-opacity-control"><span>Opacity</span><input aria-label="Board reference opacity" type="range" min="5" max="70" value={referenceOpacity} onChange={(event) => setReferenceOpacity(Number(event.target.value))} /><output>{referenceOpacity}%</output></label>}
            <button type="button" className={`board-tool ${referenceWindowOpen ? 'active' : ''}`} aria-expanded={referenceWindowOpen} aria-controls="floating-reference-image" onClick={toggleReferenceWindow}><Move size={16} /> Picture</button>
            <button type="button" className={`board-tool board-chat-toggle ${chatOpen ? 'active' : ''}`} aria-expanded={chatOpen} onClick={() => setChatOpen((open) => !open)}><MessageCircle size={16} /> Chat</button>
            <button type="button" className="board-tool" onClick={fullscreen ? exitFullscreen : enterFullscreen}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {fullscreen ? 'Exit full screen' : 'Full screen'}</button>
            {level?.allowRotation && <span className="rotation-hint"><RotateCw size={14} /> Rotate pieces</span>}
            {host && status !== 'completed' && <button type="button" className="board-tool" onClick={togglePause} disabled={!boardReady}>{status === 'paused' ? <Play size={16} /> : <Pause size={16} />}{status === 'paused' ? 'Resume' : 'Pause'}</button>}
            {host && status === 'completed' && <button type="button" className="board-tool" onClick={() => setConfirmRestart(true)}><RotateCw size={16} /> Start again</button>}
            <button type="button" className="board-tool board-exit" onClick={() => setConfirmExit(true)}><X size={16} /> Leave</button>
          </div></div>
          <div className={`board-frame ${status === 'paused' ? 'board-paused' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} ref={boardFrameRef}>
            {currentLevel && <PuzzleBoard
              fullscreen={fullscreen}
              level={currentLevel}
              celebrate={celebrate}
              onCelebrationEnd={() => setCelebrationDone(true)}
              roomControl={roomControl}
              user={user}
              isHost={host}
              players={room.players}
              resetToken={resetToken}
              disabled={!boardReady || status !== 'playing' || isComplete}
              referenceVisible={referenceVisible}
              referenceOpacity={referenceOpacity / 100}
              trayOpen={trayOpen}
              onTrayToggle={setTrayOpen}
              onGenerated={handleGenerated}
              onReadyChange={handleReadyChange}
              onSound={audio.playSound}
            />}
            {fullscreen && <div className="fs-hud">
              <button type="button" className="fs-btn" onClick={exitFullscreen} aria-label="Exit full screen"><Minimize2 size={18} /></button>
              <div className="fs-pill"><strong>{progress}%</strong><span>{clockTime(elapsed)}</span></div>
              <button type="button" className={`fs-btn ${referenceVisible ? 'is-on' : ''}`} onClick={() => setReferenceVisible((v) => !v)} aria-label="Toggle reference image"><Image size={18} /></button>
              <button type="button" className={`fs-btn ${referenceWindowOpen ? 'is-on' : ''}`} onClick={toggleReferenceWindow} aria-label="Toggle draggable reference picture" aria-pressed={referenceWindowOpen}><Move size={18} /></button>
              <button type="button" className={`fs-btn fs-chat ${chatOpen ? 'is-on' : ''}`} onClick={() => setChatOpen((o) => !o)} aria-label="Toggle chat"><MessageCircle size={18} /></button>
              {host && status !== 'completed' && <button type="button" className="fs-btn" onClick={togglePause} disabled={!boardReady} aria-label={status === 'paused' ? 'Resume' : 'Pause'}>{status === 'paused' ? <Play size={18} /> : <Pause size={18} />}</button>}
            </div>}
            {status === 'paused' && <div className="board-paused-overlay"><div className="pause-mark"><Pause size={21} /></div><strong>Just a little pause</strong><span>{host ? 'Resume when you are ready.' : 'The host will be right back.'}</span>{host && <button type="button" className="button button-primary" onClick={togglePause}><Play size={15} fill="currentColor" /> Keep going</button>}</div>}
            {referenceWindowOpen && <section id="floating-reference-image" className="floating-reference" ref={referenceWindowRef} style={{ left: `${referencePosition.x}px`, top: `${referencePosition.y}px`, width: `${referenceSize.width}px`, height: `${referenceSize.height}px` }} aria-labelledby="floating-reference-title">
              <header className="floating-reference-header">
                <div className="reference-drag-handle" role="group" tabIndex={0} aria-label="Move reference picture with pointer or arrow keys" onPointerDown={startReferenceDrag} onPointerMove={moveReferenceDrag} onPointerUp={stopReferenceDrag} onPointerCancel={stopReferenceDrag} onKeyDown={moveReferenceByKeyboard}>
                  <Move size={15} aria-hidden="true" /><strong id="floating-reference-title">Reference picture</strong><span>Drag to move</span>
                </div>
                <button type="button" className="floating-reference-close" aria-label="Close reference picture" onClick={() => setReferenceWindowOpen(false)}><X size={17} /></button>
              </header>
              <div className="floating-reference-image"><img src={level?.imageURL} alt={level?.imageAlt || `${level?.title || 'Puzzle'} reference`} draggable="false" /><button type="button" className="floating-reference-resize" aria-label="Resize reference picture with drag or arrow keys" title="Drag to resize; use arrow keys when focused" onPointerDown={startReferenceResize} onPointerMove={moveReferenceResize} onPointerUp={stopReferenceResize} onPointerCancel={stopReferenceResize} onKeyDown={resizeReferenceByKeyboard} /></div>
            </section>}
          </div>
          <div className="board-hint-row"><span><span className="hint-dot" /> Tap a piece to pick it up, tap again to drop it{level?.allowRotation ? ', double-tap to rotate' : ''}</span><span>Zoom, pan, and find your way around</span><button type="button" onClick={() => setReferenceVisible((value) => !value)}>{referenceVisible ? 'Hide reference image' : 'Show reference image'}</button></div>
          {completionError && !isComplete && <p className="form-error game-error" role="alert">{completionError}</p>}
        </section>

        <aside className="game-side-panel">
          <div className="table-friends"><div className="side-section-heading"><div><p className="section-eyebrow">AT THE TABLE</p><h2>Good company</h2></div><span className="table-online"><i /> {room.players.length} here</span></div><div className="game-member-list">{room.players.map((player) => <div className="game-member-row" key={player.uid}><Avatar player={player} size="sm" isHost={room.meta.hostId === player.uid} /><span><strong>{player.displayName || 'Puzzle Pal'}</strong><small>{player.uid === user?.uid ? 'You are here' : room.meta.hostId === player.uid ? 'Keeping the room' : 'Finding a fit'}</small></span><i className="member-online-dot" /></div>)}</div></div>
          <div className="recent-activity"><div className="side-section-heading"><div><p className="section-eyebrow">LITTLE WINS</p><h2>Just placed</h2></div><Sparkles size={16} /></div>{activitiesWithNames.length ? <ul>{activitiesWithNames.slice(0, 4).map((activity) => <li key={`${activity.id}-${activity.at}`}><span className="activity-piece"><Check size={12} /></span><span><strong>{activity.player?.displayName || 'A puzzle pal'}</strong><small>found a place for a piece</small></span><time>{clockTime(Math.max(0, Math.floor((Date.now() - Number(activity.at || Date.now())) / 1000)))}</time></li>)}</ul> : <p className="activity-empty">The first piece is waiting for someone to spot it.</p>}</div>
          <div className={`game-chat-area ${chatOpen ? 'is-open' : ''}`}>
            <div className="game-chat-drawer-heading"><strong>Table chat</strong><button type="button" onClick={() => setChatOpen(false)} aria-label="Close chat"><X size={19} /></button></div>
            <ChatPanel messages={room.chat} onSend={roomControl.message} currentUser={user} compact />
          </div>
        </aside>
      </div>

      {showCompletion && <div className="completion-screen" role="dialog" aria-modal="true" aria-labelledby="completion-title">
        <div className="completion-confetti" aria-hidden="true"><Sparkles /><Sparkles /><Sparkles /></div>
        <button type="button" className="completion-close" onClick={onReturnFromGame} aria-label={shared ? 'Return to our table' : 'Return to puzzle shelf'}><X size={18} /></button>
        <div className="completion-photo"><img src={level?.imageURL} alt={level?.imageAlt || ''} /><span><Check size={16} /> Puzzle complete</span></div>
        <div className="completion-copy"><p className="section-eyebrow">A TABLE FULL OF GOOD WORK</p><h2 id="completion-title">Look what you made <em>together.</em></h2><p>Every piece found its place. Thanks for taking your time with each other.</p></div>
        <div className="completion-stats"><div><Clock3 size={15} /><span><small>Time together</small><strong>{clockTime(elapsed)}</strong></span></div><div><UsersRound size={15} /><span><small>Puzzle pals</small><strong>{contributors.length}</strong></span></div><div><Trophy size={15} /><span><small>Level finished</small><strong>{level?.order} of 10</strong></span></div></div>
        <div className="completion-contributors"><div className="completion-contributors-heading"><Sparkles size={15} /><strong>Everybody brought something</strong></div><div className="contributor-list">{contributors.map((player) => <div key={player.uid}><Avatar player={player} size="sm" /><span>{player.displayName}</span><strong>{player.piecesPlaced.toLocaleString()} pieces</strong></div>)}</div></div>
        {earnedAchievements.length > 0 && <div className="earned-achievement"><Trophy size={16} /><span><small>Achievement earned</small><strong>{earnedAchievements.map((id) => achievementNames[id] || id).join(' · ')}</strong></span></div>}
        {savingCompletion && <p className="completion-saving" role="status">Saving this little win…</p>}
        {completionError && <div><p className="form-error" role="alert">{completionError}</p>{<button type="button" className="text-action" disabled={savingCompletion} onClick={() => { completionHandled.current = ''; setCompletionAttempt((value) => value + 1) }}>Try saving again</button>}</div>}
        <div className="completion-actions">
          <button type="button" className="button button-primary" onClick={onNextLevel} disabled={!host || !onNextLevel}><Sparkles size={16} /> Next level</button>
          <button type="button" className="button button-outline" onClick={restartPuzzle} disabled={!host} title={host ? undefined : 'Only the host can restart'}><RotateCw size={16} /> Play again</button>
          <button type="button" className="button button-outline" onClick={onReturnFromGame}>{shared ? 'Back to our table' : 'Back to puzzle shelf'}</button>
        </div>
      </div>}

      <Modal open={confirmExit} onClose={() => setConfirmExit(false)} title="Step away from the table?" description="Your puzzle will stay here for everyone else." className="confirm-modal">
        <div className="confirm-actions"><button type="button" className="button button-quiet" onClick={() => setConfirmExit(false)}>Stay here</button><button type="button" className="button button-primary" onClick={onLeave}><ArrowLeft size={16} /> Leave room</button></div>
      </Modal>
      <Modal open={confirmRestart} onClose={() => setConfirmRestart(false)} title="Start this puzzle over?" description="The board will clear for everyone in the room." className="confirm-modal">
        <div className="confirm-actions"><button type="button" className="button button-quiet" onClick={() => setConfirmRestart(false)}>Keep the finished puzzle</button><button type="button" className="button button-primary" onClick={restartPuzzle}><RotateCw size={16} /> Start over</button></div>
      </Modal>
    </main>
  )
}

function PuzzleGlyph() {
  return <span className="pieces-glyph" aria-hidden="true"><span /><span /><span /><span /></span>
}
