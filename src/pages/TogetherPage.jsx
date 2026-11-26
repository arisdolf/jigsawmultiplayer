import { useEffect, useState } from 'react'
import { ArrowRight, Clock3, Heart, Puzzle, RefreshCw, Sparkles } from 'lucide-react'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import { formatDuration } from '../components/LevelCard'
import { getSharedHistory } from '../services/roomService'
import '../css/pages/TogetherPage.css'

const turnOf = (value) => ((Number(value) || 0) % 360 + 360) % 360
const dateOf = (value) => (value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '')

function Thumb({ src, rotation, alt = '' }) {
  const turn = turnOf(rotation)
  return <span className="recent-thumb"><img className={turn % 180 ? 'is-quarter-turn' : undefined} src={src} alt={alt} loading="lazy" style={{ '--level-image-rotation': `${turn}deg` }} /></span>
}

export default function TogetherPage({ roomControl, levels, user, onPlay, onSwitchLevel }) {
  const { room, placedCount } = roomControl
  const [history, setHistory] = useState([])
  const [historyState, setHistoryState] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickId, setPickId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const level = levels.find((item) => item.id === room.meta?.levelId)
  const ready = Boolean(room.meta && level)
  const progress = ready ? Math.min(100, Math.round((placedCount / Number(level.pieceCount || 1)) * 100)) : 0
  const others = room.players.filter((player) => player.uid !== user?.uid)
  const status = room.game.status

  useEffect(() => {
    let active = true
    getSharedHistory()
      .then((list) => { if (active) { setHistory(list); setHistoryState('ready') } })
      .catch(() => active && setHistoryState('error'))
    return () => { active = false }
  }, [])

  async function confirmSwitch() {
    setBusy(true)
    setError('')
    try { await onSwitchLevel(pickId); setPickerOpen(false) }
    catch (switchError) { setError(switchError.message || 'Could not switch puzzles.') }
    finally { setBusy(false) }
  }

  return (
    <main className="page-wrap together-page">
      <header className="together-heading">
        <p className="section-eyebrow">OUR TABLE</p>
        <h1>Always set, always yours.</h1>
        <p>One puzzle that's waiting for you both. Every piece you place is saved and synced live, and it never expires.</p>
      </header>

      <section className="together-table" aria-label="Current shared puzzle">
        {ready ? <Thumb src={level.imageURL} rotation={level.imageRotation} alt={level.imageAlt} /> : <div className="together-skeleton" />}
        <div className="together-table-body">
          <p className="section-eyebrow">ON THE TABLE NOW</p>
          <h2>{ready ? level.title : 'Setting the table…'}</h2>
          {ready && <p className="together-meta">{Number(level.pieceCount).toLocaleString()} pieces · {level.difficulty}</p>}
          <div className="together-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
          <div className="together-stats">
            <span><strong>{progress}%</strong> placed</span>
            <span><Clock3 size={14} /> {formatDuration(room.game.elapsedSeconds)} together</span>
          </div>
          <div className="together-here">
            <span className="together-avatars">{room.players.map((player) => <Avatar key={player.uid} player={player} size="sm" />)}</span>
            <span>{others.length ? `${others[0].displayName || 'Your partner'} is here` : 'Just you for now. Everything saves as you go.'}</span>
          </div>
          <p className="together-note">{status === 'completed' ? 'Finished! Open the table to see it and start the next one.' : status === 'paused' ? 'The table is on a little break.' : 'Ready when you are.'}</p>
          <div className="together-actions">
            <button type="button" className="button button-primary button-large" disabled={!ready} onClick={onPlay}><Puzzle size={18} /> Sit down at the table <ArrowRight size={17} /></button>
            <button type="button" className="button button-outline" disabled={!ready} onClick={() => { setPickId(level.id); setError(''); setPickerOpen(true) }}><RefreshCw size={16} /> Switch puzzle</button>
          </div>
        </div>
      </section>

      <section className="together-saves" aria-labelledby="together-saves-title">
        <div className="section-title-row"><div><p className="section-eyebrow">YOUR SHARED SAVES</p><h2 id="together-saves-title">Finished together</h2></div><span className="together-count"><Heart size={14} /> {history.length}</span></div>
        {historyState === 'loading' ? <p className="together-empty">Looking through your saves…</p>
          : historyState === 'error' ? <p className="together-empty">Could not load your saves right now.</p>
          : history.length === 0 ? <p className="together-empty">Your first finished puzzle will be kept here, with its level and who placed what.</p>
          : <div className="together-grid">{history.map((record) => (
              <button type="button" key={record.id} className="recent-card" onClick={() => setSelected(record)}>
                <Thumb src={record.imageURL} rotation={record.imageRotation} />
                <span className="recent-info">
                  <strong>{record.levelTitle}</strong>
                  <small>Level {String(record.levelOrder).padStart(2, '0')} · {record.difficulty} · {record.pieceCount.toLocaleString()} pieces</small>
                  <small>{formatDuration(record.totalTime)} · {dateOf(record.completedAt)}</small>
                  <span className="recent-cta">View details <ArrowRight size={14} /></span>
                </span>
              </button>))}</div>}
      </section>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.levelTitle || ''} description={selected ? `Finished ${dateOf(selected.completedAt)}` : ''} className="together-detail-modal">
        {selected && <>
          <Thumb src={selected.imageURL} rotation={selected.imageRotation} alt={selected.imageAlt} />
          <dl className="together-detail-list">
            <div><dt>Level</dt><dd>{String(selected.levelOrder).padStart(2, '0')}</dd></div>
            <div><dt>Difficulty</dt><dd>{selected.difficulty}</dd></div>
            <div><dt>Pieces</dt><dd>{selected.pieceCount.toLocaleString()}</dd></div>
            <div><dt>Time together</dt><dd>{formatDuration(selected.totalTime)}</dd></div>
          </dl>
          {selected.description && <p className="together-note">{selected.description}</p>}
          <p className="section-eyebrow">WHO PLACED WHAT</p>
          <ul className="together-people">{(selected.players || []).map((player) => (
            <li key={player.uid}><Avatar player={player} size="sm" /><span>{player.displayName}</span><strong>{player.piecesPlaced.toLocaleString()} pieces</strong></li>))}</ul>
        </>}
      </Modal>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Switch the puzzle?" description="This clears the board for both of you and starts a fresh one. Finished saves are kept." className="confirm-modal">
        <label className="together-pick">Choose a puzzle
          <select value={pickId} onChange={(event) => setPickId(event.target.value)}>
            {levels.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.order}. {item.title} · {Number(item.pieceCount).toLocaleString()} pieces</option>)}
          </select>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="together-actions"><button type="button" className="button button-quiet" onClick={() => setPickerOpen(false)}>Keep this one</button><button type="button" className="button button-primary" onClick={confirmSwitch} disabled={busy}><Sparkles size={16} /> {busy ? 'Setting out…' : 'Start fresh'}</button></div>
      </Modal>
    </main>
  )
}