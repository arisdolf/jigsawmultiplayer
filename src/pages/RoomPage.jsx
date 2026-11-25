import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Clipboard, Crown, Globe2, LockKeyhole, MessageCircle, Play, Settings2, Sparkles, UsersRound } from 'lucide-react'
import Avatar from '../components/Avatar'
import ChatPanel from '../components/ChatPanel'
import '../css/pages/RoomPage.css'
import '../css/pages/RoomPage.mobile.css'

export default function RoomPage({ roomControl, levels, user, onShare, onGame, onLeave, onBack }) {
  const { room } = roomControl
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [roomTitle, setRoomTitle] = useState(room.meta?.title || '')
  const host = room.meta?.hostId === user?.uid
  const selectedLevel = levels.find((level) => level.id === room.meta?.levelId)
  const imageRotation = ((Number(selectedLevel?.imageRotation) || 0) % 360 + 360) % 360
  const activePlayers = room.players.length

  useEffect(() => setRoomTitle(room.meta?.title || ''), [room.meta?.title])

  async function changeLevel(event) {
    setError('')
    try {
      await roomControl.updateSettings({ levelId: event.target.value })
    } catch (roomError) {
      setError(roomError.message)
    }
  }

  async function togglePrivacy() {
    setError('')
    try {
      await roomControl.updateSettings({ isPublic: !room.meta.isPublic })
    } catch (roomError) {
      setError(roomError.message)
    }
  }

  async function saveTitle() {
    const title = roomTitle.trim().slice(0, 48)
    if (!title || title === room.meta.title) return
    try {
      await roomControl.updateSettings({ title })
    } catch (roomError) {
      setError(roomError.message)
    }
  }

  async function start() {
    setBusy(true)
    setError('')
    try {
      if (!['playing', 'paused', 'completed'].includes(room.game.status)) await roomControl.controlStatus('playing')
      onGame()
    } catch (roomError) {
      setError(roomError.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyInvite() {
    const shared = await onShare()
    if (!shared) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (!room.meta) {
    return <main className="room-loading page-wrap"><div className="room-skeleton"><div className="skeleton-line" /><div className="skeleton-line short" /><div className="skeleton-block" /></div></main>
  }

  return (
    <main className="room-page page-wrap">
      <div className="page-back-row"><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to the puzzle shelf</button><span className="room-status-pill"><span className="live-dot" /> {room.meta.status === 'playing' ? 'Puzzle in progress' : 'Room is open'}</span></div>
      <div className="room-heading"><div><p className="section-eyebrow">A SHARED TABLE, JUST FOR YOU</p><h1>Come on in.</h1><p>Gather a few people, then choose a picture to put together.</p></div><div className="room-code-box"><span>ROOM CODE</span><strong>{room.meta.roomCode}</strong><button type="button" onClick={copyInvite}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? 'Invite copied' : 'Copy invite link'}</button></div></div>

      <div className="room-layout">
        <section className="room-main-column">
          <div className="room-scene">
            {selectedLevel && <div className="room-scene-image" aria-hidden="true"><img className={imageRotation % 180 ? 'is-quarter-turn' : undefined} src={selectedLevel.imageURL} alt="" style={{ '--room-image-rotation': `${imageRotation}deg` }} /></div>}
            <div className="room-scene-wash" />
            <div className="room-scene-content"><span className="room-scene-tag"><Sparkles size={14} /> YOUR PUZZLE TABLE</span><h2>{room.meta.title || 'A little puzzle room'}</h2><p>{selectedLevel ? `${selectedLevel.title} · ${selectedLevel.pieceCount.toLocaleString()} pieces` : 'Choose a puzzle to get started'}</p></div>
            <div className="room-scene-avatars">{room.players.slice(0, 5).map((player) => <Avatar key={player.uid} player={player} size="md" isHost={room.meta.hostId === player.uid} />)}{activePlayers > 5 && <span className="avatar-overflow">+{activePlayers - 5}</span>}</div>
          </div>

          <div className="room-setup">
            <div className="room-setup-heading"><div><p className="section-eyebrow">ROOM SETUP</p><h2>Set out the pieces</h2></div><span className="room-player-count"><UsersRound size={15} /> {activePlayers} / 8 here</span></div>
            {host ? (
              <div className="room-settings-form">
                <label className="room-name-select"><span>Room name</span><input value={roomTitle} maxLength={48} onChange={(event) => setRoomTitle(event.target.value)} onBlur={saveTitle} aria-label="Room name" /></label>
                <label className="room-level-select"><span>Choose a puzzle</span><select value={room.meta.levelId || ''} onChange={changeLevel} disabled={room.game.status && room.game.status !== 'waiting'}>
                  {levels.filter((level) => level.isActive && (!level.isLocked || level.id === room.meta.levelId)).map((level) => <option key={level.id} value={level.id}>{level.order}. {level.title} · {level.pieceCount.toLocaleString()} pieces</option>)}
                </select></label>
                <button type="button" className="privacy-button" onClick={togglePrivacy} aria-pressed={!room.meta.isPublic}>
                  {room.meta.isPublic ? <Globe2 size={17} /> : <LockKeyhole size={17} />}
                  <span><strong>{room.meta.isPublic ? 'Public room' : 'Private room'}</strong><small>{room.meta.isPublic ? 'Anyone with the link can join' : 'Friends join with your room code'}</small></span>
                  <i className={`switch-dot ${room.meta.isPublic ? 'is-on' : ''}`} />
                </button>
              </div>
            ) : (
              <div className="room-waiting-message"><div className="waiting-pulse" /><div><strong>Waiting for the host to choose a puzzle</strong><span>You can look around, chat, and get comfortable.</span></div></div>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="room-action-row">
              {host ? <button type="button" className="button button-primary button-large" onClick={start} disabled={!selectedLevel || busy}><Play size={18} fill="currentColor" /> {busy ? 'Opening the board…' : ['playing', 'paused', 'completed'].includes(room.game.status) ? 'Return to the puzzle' : 'Start the puzzle'}</button> : <div className="room-host-note"><Crown size={16} /> {room.players.find((player) => player.uid === room.meta.hostId)?.displayName || 'Your host'} will start when everyone is ready.</div>}
              <button type="button" className="button button-quiet" onClick={copyInvite}><MessageCircle size={16} /> Invite a puzzle pal</button>
              <button type="button" className="button button-quiet leave-room-button" onClick={onLeave}>Leave room</button>
            </div>
          </div>

          <div className="room-people-section"><div className="section-title-row"><div><p className="section-eyebrow">THE PEOPLE AT THIS TABLE</p><h2>Puzzle pals <span>{activePlayers}</span></h2></div><span className="room-capacity-note">Up to 8 friends</span></div>
            <div className="room-member-list">{room.players.map((player) => <div className="room-member" key={player.uid}><Avatar player={player} size="lg" isHost={room.meta.hostId === player.uid} /><div><strong>{player.displayName || 'Puzzle Pal'} {player.uid === user?.uid && <small>(you)</small>}</strong><span>{room.meta.hostId === player.uid ? 'Room host' : 'Puzzle pal'}</span></div>{room.meta.hostId === player.uid && <span className="host-badge"><Crown size={13} /> HOST</span>}</div>)}</div>
          </div>
          <div className="room-cozy-note"><span><Settings2 size={15} /></span><p>Your puzzle saves as pieces move. Share the room code to pick up where everyone left off.</p></div>
        </section>
        <aside className="room-chat-column"><ChatPanel messages={room.chat} onSend={roomControl.message} currentUser={user} /><div className="chat-privacy-note">A little kindness goes a long way <Sparkles size={13} /></div></aside>
      </div>
    </main>
  )
}
