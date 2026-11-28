import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Clock3, Copy, Heart, KeyRound, List, Plus, Puzzle, RotateCw, Sparkles } from 'lucide-react'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import { formatDuration } from '../components/LevelCard'
import { getSharedHistory, getUserTableDetails } from '../services/roomService'
import { copyTextWithFallback } from '../utils/sharedTable'
import '../css/pages/TogetherPage.css'

const turnOf = (value) => ((Number(value) || 0) % 360 + 360) % 360
const dateOf = (value) => (value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '')

function Thumb({ src, rotation, alt = '' }) {
  const turn = turnOf(rotation)
  return <span className="recent-thumb"><img className={turn % 180 ? 'is-quarter-turn' : undefined} src={src} alt={alt} loading="lazy" style={{ '--level-image-rotation': `${turn}deg` }} /></span>
}

export default function TogetherPage({
  roomControl,
  levels,
  user,
  onPlay,
  onStartPuzzle,
  tableCode,
  ownedTableCode,
  tableCodes,
  tableCodeState,
  tableCodeError,
  onRetryTableSetup,
  onSelectTable,
  onJoinTable,
  onCreateTable,
}) {
  const { room, placedCount } = roomControl
  const [history, setHistory] = useState([])
  const [historyState, setHistoryState] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickId, setPickId] = useState('')
  const [pendingCode, setPendingCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)
  const [selectingCode, setSelectingCode] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const [tablesOpen, setTablesOpen] = useState(false)
  const [tableDetails, setTableDetails] = useState([])
  const [detailsState, setDetailsState] = useState('idle')
  const [creatingTable, setCreatingTable] = useState(false)
  const [tablesNote, setTablesNote] = useState('')
  const [rowCopied, setRowCopied] = useState('')
  const codeInputRef = useRef(null)
  const activeCodeInputRef = useRef(null)
  const level = levels.find((item) => item.id === room.meta?.levelId)
  const ready = Boolean(room.meta && level)
  const progress = ready ? Math.min(100, Math.round((placedCount / Number(level.pieceCount || 1)) * 100)) : 0
  const others = room.players.filter((player) => player.uid !== user?.uid)
  const status = room.game.status
  const levelFor = (id) => levels.find((item) => String(item.id) === String(id))

  async function submitJoin(event) {
    event.preventDefault()
    setJoinError('')
    setJoining(true)
    try {
      await onJoinTable(joinCode)
      setJoinCode('')
    } catch (e) {
      setJoinError(e.message || 'Could not join that table.')
    } finally {
      setJoining(false)
    }
  }

  async function copyCode(code = ownedTableCode, inputRef = codeInputRef) {
    const result = await copyTextWithFallback(code)
    if (result === 'copied') {
      setCopyFeedback('Table code copied.')
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
    setCopyFeedback('Code selected. Press Ctrl/Cmd+C or copy it.')
  }

  async function copyRowCode(code) {
    const result = await copyTextWithFallback(code)
    setTablesNote(result === 'copied' ? '' : `Could not copy automatically. The code is ${code}.`)
    setRowCopied(result === 'copied' ? code : '')
    if (result === 'copied') window.setTimeout(() => setRowCopied(''), 1800)
  }

  async function openSavedTable(code) {
    setSelectingCode(code)
    setJoinError('')
    setTablesNote('')
    try {
      await onSelectTable(code)
      setTablesOpen(false)
    } catch (e) {
      setTablesNote(e.message || 'Could not open that table.')
    } finally {
      setSelectingCode('')
    }
  }

  async function createTable() {
    setCreatingTable(true)
    setTablesNote('')
    setJoinError('')
    try {
      const code = await onCreateTable()
      setTablesOpen(false)
      openPuzzlePicker(code)
    } catch (e) {
      setTablesNote(e.message || 'Could not create a table.')
    } finally {
      setCreatingTable(false)
    }
  }

  useEffect(() => {
    if (!tableCode) return undefined
    let active = true
    setHistoryState('loading')
    getSharedHistory(tableCode)
      .then((list) => { if (active) { setHistory(list); setHistoryState('ready') } })
      .catch(() => active && setHistoryState('error'))
    return () => { active = false }
  }, [tableCode])

  useEffect(() => {
    if (!tablesOpen || !user) return undefined
    let active = true
    setDetailsState('loading')
    getUserTableDetails(user)
      .then((list) => { if (active) { setTableDetails(list); setDetailsState('ready') } })
      .catch(() => active && setDetailsState('error'))
    return () => { active = false }
  }, [tablesOpen, user?.uid, tableCodes.length, tableCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // open table first, then your own tables, then newest activity
  const tableRows = [...tableDetails].sort((a, b) => {
    if ((b.code === tableCode) !== (a.code === tableCode)) return b.code === tableCode ? 1 : -1
    if (a.owned !== b.owned) return a.owned ? -1 : 1
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })

  function openPuzzlePicker(newTableCode = '') {
    setPendingCode(newTableCode)
    const nextLevel = newTableCode
      ? levels.find((item) => item.isActive)
      : levels.find((item) => item.isActive && item.id !== level?.id)
    setPickId(nextLevel?.id || level?.id || '')
    setError('')
    setPickerOpen(true)
  }

  function closePicker() {
    setPickerOpen(false)
    setPendingCode('')
  }

  async function startSelectedPuzzle() {
    if (!pickId) return
    setBusy(true)
    setError('')
    try {
      await onStartPuzzle(pickId, pendingCode || undefined)
      closePicker()
    } catch (startError) {
      setError(startError.message || 'Could not open that puzzle.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-wrap together-page">
      <header className="together-heading">
        <p className="section-eyebrow">OUR TABLE</p>
        <h1>Always set, always yours.</h1>
        <p>Every puzzle keeps its own shared progress. Start another whenever you like, then return to any board right where you left it.</p>
      </header>

      <section className="together-code" aria-label="Your table and join code">
        <div className="together-code-mine">
          <p className="section-eyebrow">YOUR TABLE CODE</p>
          {tableCodeState === 'loading' ? (
            <p className="together-code-status" role="status">Loading your account table...</p>
          ) : tableCodeState === 'error' ? (
            <div className="together-code-status is-error" role="alert">
              <span>{tableCodeError || 'Could not load your table code.'}</span>
              <button type="button" className="button button-outline" onClick={onRetryTableSetup}><RotateCw size={15} /> Retry</button>
            </div>
          ) : (
            <>
              <div className="together-code-row">
                <input ref={codeInputRef} aria-label="Your table code" className="together-code-value" readOnly value={ownedTableCode || '------'} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" className="button button-outline" onClick={() => copyCode()} disabled={!ownedTableCode}><Copy size={15} /> Copy</button>
              </div>
              <small>Share this code. Your table and puzzle boards stay available when you leave.</small>
              {tableCode && tableCode !== ownedTableCode && <div className="together-active-code">
                <span className="section-eyebrow">OPEN TABLE CODE</span>
                <div className="together-code-row">
                  <input ref={activeCodeInputRef} aria-label="Open table code" className="together-code-value" readOnly value={tableCode} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="button button-outline" onClick={() => void copyCode(tableCode, activeCodeInputRef)}><Copy size={15} /> Copy</button>
                </div>
              </div>}
              {copyFeedback && <p className="together-copy-status" role="status">{copyFeedback}</p>}
            </>
          )}
        </div>
        <form className="together-code-join" onSubmit={submitJoin}>
          <label htmlFor="join-table-code" className="section-eyebrow">JOIN A TABLE</label>
          <p>Enter a friend's six-character code. You can return to this table from your account later.</p>
          <div className="together-code-row">
            <input id="join-table-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} maxLength={6} placeholder="ENTER CODE" autoComplete="off" aria-describedby={joinError ? 'join-table-error' : undefined} />
            <button type="submit" className="button button-primary" disabled={joining || joinCode.length !== 6}><KeyRound size={15} /> {joining ? 'Joining...' : 'Join'}</button>
          </div>
          {joinError && <p id="join-table-error" className="form-error" role="alert">{joinError}</p>}
        </form>
        <div className="together-saved-tables" aria-label="Tables saved to your account">
          <p className="section-eyebrow">SAVED TABLES</p>
          {tableCodeState === 'loading' ? <p className="together-code-status" role="status">Loading saved tables...</p> : (
            <>
              <p className="together-code-status">{tableCodes.length} {tableCodes.length === 1 ? 'table' : 'tables'} saved. Each table keeps its own puzzles.</p>
              <div className="together-saved-actions">
                <button type="button" className="button button-outline" onClick={() => setTablesOpen(true)} disabled={!tableCodes.length}><List size={15} /> View all tables</button>
                <button type="button" className="button button-primary" onClick={createTable} disabled={creatingTable || tableCodeState !== 'ready'}><Plus size={15} /> {creatingTable ? 'Creating...' : 'New table'}</button>
              </div>
              {!tablesOpen && tablesNote && <p className="form-error" role="alert">{tablesNote}</p>}
            </>
          )}
        </div>
      </section>

      <section className={ready ? "together-table is-ready" : "together-table"} aria-label="Current shared puzzle" aria-busy={!ready}>
        {ready ? <Thumb src={level.imageURL} rotation={level.imageRotation} alt={level.imageAlt} /> : <div className="together-skeleton" />}
        <div className="together-table-body">
          {!ready && <div className="together-loading-details"><p className="section-eyebrow">ON THE TABLE NOW</p><p className="puzzles-loading-status" role="status">Puzzles are loading.</p><span className="data-skeleton together-loading-title" /><span className="data-skeleton together-loading-meta" /><span className="data-skeleton together-loading-progress" /><div className="together-loading-stats" aria-hidden="true"><span className="data-skeleton" /><span className="data-skeleton" /></div><div className="together-loading-avatars" aria-hidden="true"><span className="data-skeleton" /><span className="data-skeleton" /><span className="data-skeleton" /></div><div className="together-loading-actions" aria-hidden="true"><span className="data-skeleton" /><span className="data-skeleton" /></div></div>}<p className="section-eyebrow">ON THE TABLE NOW</p>
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
            <button type="button" className="button button-outline" disabled={!ready} onClick={() => openPuzzlePicker()}><Plus size={16} /> Start another puzzle</button>
          </div>
        </div>
      </section>

      <section className="together-saves" aria-labelledby="together-saves-title">
        <div className="section-title-row"><div><p className="section-eyebrow">YOUR SHARED SAVES</p><h2 id="together-saves-title">Finished together</h2></div><span className="together-count"><Heart size={14} /> {history.length}</span></div>
        {historyState === 'loading' ? <><p className="puzzles-loading-status" role="status">Shared puzzle saves are loading.</p><div className="together-grid together-loading-grid" aria-hidden="true">{[1, 2, 3].map((item) => <div className="together-loading-save" key={item}><span className="data-skeleton together-loading-save-photo" /><span className="together-loading-save-copy"><i className="data-skeleton" /><i className="data-skeleton" /><i className="data-skeleton" /></span></div>)}</div></>
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

      <Modal open={tablesOpen} onClose={() => setTablesOpen(false)} title="Your tables" description="Every table has its own code and its own puzzles. Open one to pick up where you left off." className="tables-modal">
        <div className="tables-modal-toolbar">
          <span>{tableRows.length} saved</span>
          <button type="button" className="button button-primary" onClick={createTable} disabled={creatingTable}><Plus size={15} /> {creatingTable ? 'Creating...' : 'New table'}</button>
        </div>
        {tablesNote && <p className="form-error" role="alert">{tablesNote}</p>}
        {detailsState === 'loading' ? <p className="together-code-status" role="status">Loading your tables...</p>
          : detailsState === 'error' ? <p className="form-error" role="alert">Could not load your tables right now.</p>
            : <ul className="tables-list">
              {tableRows.map((row) => {
                const rowLevel = levelFor(row.activeLevelId)
                const isOpen = row.code === tableCode
                return (
                  <li key={row.code} className={`tables-row${isOpen ? ' is-active' : ''}`}>
                    <span className="tables-row-thumb">
                      {rowLevel?.imageURL
                        ? <img src={rowLevel.imageURL} alt="" loading="lazy" style={{ transform: `rotate(${turnOf(rowLevel.imageRotation)}deg)` }} />
                        : <Puzzle size={20} aria-hidden="true" />}
                    </span>
                    <div className="tables-row-body">
                      <div className="tables-row-top">
                        <strong className="tables-row-code">{row.code}</strong>
                        <span className="tables-badge">{row.owned ? 'Your table' : 'Joined table'}</span>
                        {isOpen && <span className="tables-badge is-open"><Check size={12} /> Open now</span>}
                      </div>
                      <p className="tables-row-puzzle">{rowLevel ? rowLevel.title : 'No puzzle started yet'}</p>
                      {rowLevel && <small>{Number(rowLevel.pieceCount).toLocaleString()} pieces · {rowLevel.difficulty}</small>}
                      {row.updatedAt && <small>Last played {dateOf(row.updatedAt)}</small>}
                    </div>
                    <div className="tables-row-actions">
                      <button type="button" className="button button-primary" disabled={isOpen || Boolean(selectingCode)} onClick={() => void openSavedTable(row.code)}>
                        {selectingCode === row.code ? 'Opening...' : isOpen ? 'Current' : 'Open'}
                      </button>
                      <button type="button" className="button button-outline" onClick={() => void copyRowCode(row.code)}>
                        {rowCopied === row.code ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>}
      </Modal>

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

      <Modal open={pickerOpen} onClose={closePicker} title={pendingCode ? 'Pick a puzzle for your new table' : 'Start another puzzle?'} description={pendingCode ? `Table ${pendingCode} is reserved. Choose the first puzzle to play on it.` : 'Each puzzle keeps its own progress. Choose a level to start or continue; this board stays saved.'} className="confirm-modal">
        <label className="together-pick">Choose a puzzle
          <select value={pickId} onChange={(event) => setPickId(event.target.value)}>
            {levels.filter((item) => item.isActive || (!pendingCode && item.id === level?.id)).map((item) => <option key={item.id} value={item.id}>{item.order}. {item.title} · {Number(item.pieceCount).toLocaleString()} pieces{!pendingCode && item.id === level?.id ? ' · current puzzle' : ''}</option>)}
          </select>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="together-actions"><button type="button" className="button button-quiet" onClick={closePicker}>{pendingCode ? 'Not now' : 'Keep this one'}</button><button type="button" className="button button-primary" onClick={startSelectedPuzzle} disabled={busy || !pickId}><Sparkles size={16} /> {busy ? 'Setting out…' : !pendingCode && pickId === level?.id ? 'Continue this puzzle' : 'Open puzzle'}</button></div>
      </Modal>
    </main>
  )
}