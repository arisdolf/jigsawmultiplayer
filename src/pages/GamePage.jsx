import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Clock3, Clipboard, Image, MessageCircle, Pause, Play, RotateCw, Share2, Sparkles, Trophy, UsersRound, X } from 'lucide-react'
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
  const started = Number(game.resumedAt || game.startedAt) || Date.now()
  return saved + Math.max(0, Math.floor((Date.now() - started) / 1000))
}

export default function GamePage({ roomControl, level, user, audio, onLeave, onBackToRoom, onShare, onNextLevel, onCompletionSaved }) {
  const { room, placedCount, activities, piecesRef } = roomControl
  const host = room.meta?.hostId === user?.uid
  const status = room.game.status || room.meta?.status || 'waiting'
  const [referenceVisible, setReferenceVisible] = useState(false)
  const [boardReady, setBoardReady] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const [elapsed, setElapsed] = useState(() => currentElapsed(room.game))
  const [confirmExit, setConfirmExit] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [savingCompletion, setSavingCompletion] = useState(false)
  const [earnedAchievements, setEarnedAchievements] = useState([])
  const [completionAttempt, setCompletionAttempt] = useState(0)
  const [completionError, setCompletionError] = useState('')
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [trayOpen, setTrayOpen] = useState(false)
  const completionKey = `${room.id || ''}:${room.game.sessionId || ''}`
  const completionHandled = useRef('')
  const isComplete = status === 'completed' || placedCount >= Number(level?.pieceCount || Infinity)
  const progress = level?.pieceCount ? Math.min(100, Math.round((placedCount / level.pieceCount) * 100)) : 0
  const currentLevel = level ? { ...level, roomStatus: status } : null

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

  useEffect(() => {
    setElapsed(currentElapsed(room.game))
    const timer = window.setInterval(() => setElapsed(currentElapsed(room.game)), 1000)
    return () => window.clearInterval(timer)
  }, [room.game.status, room.game.elapsedSeconds, room.game.resumedAt, room.game.startedAt])

  useEffect(() => {
    if (!host || !level || placedCount < level.pieceCount || completionHandled.current === completionKey) return
    completionHandled.current = completionKey
    async function finish() {
      try {
        setSavingCompletion(true)
        setCompletionError('')
        if (status !== 'completed') await roomControl.controlStatus('completed')
        audio.playSound('complete')
        const result = await roomControl.complete({
          uid: user.uid,
          levelId: level.id,
          players: room.players,
          totalTime: elapsed,
          placedCount: level.pieceCount,
          contributionCounts,
        })
        setEarnedAchievements(result?.achievements || [])
        await onCompletionSaved?.()
      } catch (error) {
        setCompletionError(error.message || 'Could not save the completion record.')
      } finally {
        setSavingCompletion(false)
      }
    }
    void finish()
  }, [host, level, placedCount, completionKey, status, roomControl.controlStatus, roomControl.complete, room.players, elapsed, contributionCounts, audio.playSound, onCompletionSaved, completionAttempt, user?.uid])

  const handleGenerated = useCallback(() => {}, [])
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

  async function copyInvite() {
    const shared = await onShare()
    if (!shared) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.meta?.roomCode || '')
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1800)
    } catch {
      setCodeCopied(false)
    }
  }

  const activitiesWithNames = activities.map((activity) => ({
    ...activity,
    player: room.players.find((player) => player.uid === activity.uid),
  }))

  return (
    <main className="game-page">
      <header className="game-heading">
        <div className="game-heading-main"><div className="game-puzzle-thumbnail"><img src={level?.imageURL} alt="" /></div><div><p className="section-eyebrow">LEVEL {String(level?.order || 1).padStart(2, '0')} · {level?.difficulty}</p><h1>{level?.title || 'Shared puzzle'}</h1><div className="game-room-line"><button type="button" className="game-room-code" onClick={copyRoomCode} aria-label={`Copy room code ${room.meta?.roomCode}`}><span className="live-dot" />{codeCopied ? 'COPIED' : `ROOM ${room.meta?.roomCode}`}<Clipboard size={13} /></button><span>·</span><span>{room.players.length} playing</span></div></div></div>
        <div className="game-players-row" aria-label="Players in this room">{room.players.slice(0, 6).map((player) => <Avatar key={player.uid} player={player} size="md" isHost={room.meta.hostId === player.uid} />)}{room.players.length > 6 && <span className="avatar-overflow">+{room.players.length - 6}</span>}<button type="button" className="game-invite-button" onClick={copyInvite}><Share2 size={15} /> {copied ? 'Copied' : 'Invite'}</button></div>
      </header>

      <div className="game-stat-strip">
        <div className="progress-summary"><div><span>Table progress</span><strong>{progress}%</strong></div><div className="progress-track" role="progressbar" aria-label="Puzzle progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div><small>{placedCount.toLocaleString()} of {Number(level?.pieceCount || 0).toLocaleString()} pieces placed</small></div>
        <div className="game-stat"><span className="game-stat-icon"><PuzzleGlyph /></span><div><small>Pieces left</small><strong>{Math.max(0, Number(level?.pieceCount || 0) - placedCount).toLocaleString()}</strong></div></div>
        <div className="game-stat"><span className="game-stat-icon timer-icon"><Clock3 size={17} /></span><div><small>Time together</small><strong className="timer-value">{clockTime(elapsed)}</strong></div></div>
        <div className={`game-state-pill state-${status}`}><span className="live-dot" />{status === 'paused' ? 'On a little break' : status === 'completed' ? 'All together now' : status === 'playing' ? 'In progress' : 'Getting ready'}</div>
      </div>

      <div className="game-content-grid">
        <section className={`board-column ${trayOpen ? 'tray-open' : ''}`} aria-label="Shared puzzle board">
          <div className="board-toolbar"><div className="board-toolbar-note"><span className="board-spark"><Sparkles size={15} /></span><span>{status === 'paused' ? 'The table is paused for a moment.' : 'A little more fits every time you look.'}</span></div><div className="board-toolbar-actions">
            <button type="button" className={`board-tool ${referenceVisible ? 'active' : ''}`} aria-pressed={referenceVisible} onClick={() => setReferenceVisible((value) => !value)}><Image size={16} /> Reference</button>
            <button type="button" className={`board-tool board-chat-toggle ${chatOpen ? 'active' : ''}`} aria-expanded={chatOpen} onClick={() => setChatOpen((open) => !open)}><MessageCircle size={16} /> Chat</button>
            {level?.allowRotation && <span className="rotation-hint"><RotateCw size={14} /> Rotate pieces</span>}
            {host && status !== 'completed' && <button type="button" className="board-tool" onClick={togglePause} disabled={!boardReady}>{status === 'paused' ? <Play size={16} /> : <Pause size={16} />}{status === 'paused' ? 'Resume' : 'Pause'}</button>}
            {host && status === 'completed' && <button type="button" className="board-tool" onClick={() => setConfirmRestart(true)}><RotateCw size={16} /> Start again</button>}
            <button type="button" className="board-tool board-exit" onClick={() => setConfirmExit(true)}><X size={16} /> Leave</button>
          </div></div>
          <div className={`board-frame ${status === 'paused' ? 'board-paused' : ''}`}>
            {currentLevel && <PuzzleBoard
              level={currentLevel}
              roomControl={roomControl}
              user={user}
              isHost={host}
              players={room.players}
              resetToken={resetToken}
              disabled={!boardReady || status !== 'playing' || isComplete}
              referenceVisible={referenceVisible}
              trayOpen={trayOpen}
              onTrayToggle={setTrayOpen}
              onGenerated={handleGenerated}
              onReadyChange={handleReadyChange}
              onSound={audio.playSound}
            />}
            {status === 'paused' && <div className="board-paused-overlay"><div className="pause-mark"><Pause size={21} /></div><strong>Just a little pause</strong><span>{host ? 'Resume when you are ready.' : 'The host will be right back.'}</span>{host && <button type="button" className="button button-primary" onClick={togglePause}><Play size={15} fill="currentColor" /> Keep going</button>}</div>}
          </div>
          <div className="board-hint-row"><span><span className="hint-dot" /> Hold and drag a piece to move it</span><span>Zoom, pan, and find your way around</span><button type="button" onClick={() => setReferenceVisible((value) => !value)}>{referenceVisible ? 'Hide reference image' : 'Show reference image'}</button></div>
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

      {isComplete && <div className="completion-screen" role="dialog" aria-modal="true" aria-labelledby="completion-title">
        <div className="completion-confetti" aria-hidden="true"><Sparkles /><Sparkles /><Sparkles /></div>
        <button type="button" className="completion-close" onClick={onBackToRoom} aria-label="Return to room"><X size={18} /></button>
        <div className="completion-photo"><img src={level?.imageURL} alt={level?.imageAlt || ''} /><span><Check size={16} /> Puzzle complete</span></div>
        <div className="completion-copy"><p className="section-eyebrow">A TABLE FULL OF GOOD WORK</p><h2 id="completion-title">Look what you made <em>together.</em></h2><p>Every piece found its place. Thanks for taking your time with each other.</p></div>
        <div className="completion-stats"><div><Clock3 size={15} /><span><small>Time together</small><strong>{clockTime(elapsed)}</strong></span></div><div><UsersRound size={15} /><span><small>Puzzle pals</small><strong>{contributors.length}</strong></span></div><div><Trophy size={15} /><span><small>Level finished</small><strong>{level?.order} of 10</strong></span></div></div>
        <div className="completion-contributors"><div className="completion-contributors-heading"><Sparkles size={15} /><strong>Everybody brought something</strong></div><div className="contributor-list">{contributors.map((player) => <div key={player.uid}><Avatar player={player} size="sm" /><span>{player.displayName}</span><strong>{player.piecesPlaced.toLocaleString()} pieces</strong></div>)}</div></div>
        {earnedAchievements.length > 0 && <div className="earned-achievement"><Trophy size={16} /><span><small>Achievement earned</small><strong>{earnedAchievements.map((id) => achievementNames[id] || id).join(' · ')}</strong></span></div>}
        {savingCompletion && <p className="completion-saving" role="status">Saving this little win…</p>}
        {completionError && <div><p className="form-error" role="alert">{completionError}</p>{host && <button type="button" className="text-action" disabled={savingCompletion} onClick={() => { completionHandled.current = ''; setCompletionAttempt((value) => value + 1) }}>Try saving again</button>}</div>}
        <div className="completion-actions"><button type="button" className="button button-primary" onClick={onNextLevel} disabled={!host || !onNextLevel}><Sparkles size={16} /> Next level</button><button type="button" className="button button-outline" onClick={onBackToRoom}>Back to room</button></div>
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
