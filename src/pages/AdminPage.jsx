import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ImagePlus, LockKeyhole, RotateCcw, RotateCw, Save, ShieldCheck, ToggleLeft, ToggleRight, UploadCloud } from 'lucide-react'
import { uploadLevelImage } from '../services/storageService'
import '../css/pages/AdminPage.css'
import '../css/pages/AdminPage.mobile.css'

const difficulties = ['Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard', 'Expert', 'Master']

function newLevel(order) {
  return {
    id: `level-${String(order).padStart(2, '0')}`,
    order,
    title: `Puzzle ${order}`,
    description: '',
    imageURL: '',
    imageRotation: 0,
    imageAlt: '',
    pieceCount: 25,
    difficulty: 'Very Easy',
    isActive: false,
    isLocked: true,
    requiredLevelId: '',
    allowRotation: false,
    completionCount: 0,
  }
}

export default function AdminPage({ levels, isAdmin, firebaseReady, onSave, onReload }) {
  const ordered = useMemo(() => [...levels].sort((a, b) => a.order - b.order), [levels])
  const [selectedId, setSelectedId] = useState(ordered[0]?.id || '')
  const [draft, setDraft] = useState(ordered[0] || null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const imageRotation = ((Number(draft?.imageRotation) || 0) % 360 + 360) % 360

  useEffect(() => {
    const found = ordered.find((level) => level.id === selectedId) || ordered[0]
    if (found) {
      setSelectedId(found.id)
      setDraft({ ...found })
    } else {
      setSelectedId('')
      setDraft(null)
    }
  }, [ordered, selectedId])

  if (!isAdmin) return <main className="page-wrap access-denied"><ShieldCheck size={28} /><h1>Admin access needed</h1><p>This level studio accepts Firebase accounts with the admin custom claim.</p></main>

  function change(key, value) {
    setDraft((current) => ({ ...current, [key]: value }))
    setNotice('')
  }

  function rotateImage(direction) {
    change('imageRotation', (imageRotation + direction + 360) % 360)
  }

  async function saveCurrent(event) {
    event.preventDefault()
    if (!draft) return
    const pieces = Number(draft.pieceCount)
    if (!draft.title.trim()) return setError('Give this level a title.')
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > 5000) return setError('Choose a whole number from 1 to 5,000 pieces.')
    if (!draft.imageURL.trim()) return setError('Add an image URL or upload a puzzle image.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await onSave({ ...draft, pieceCount: pieces, order: Number(draft.order) })
      setNotice('Level saved to the puzzle shelf.')
    } catch (saveError) {
      setError(saveError.message || 'Could not save this level.')
    } finally {
      setBusy(false)
    }
  }

  async function upload(event) {
    const file = event.target.files?.[0]
    if (!file || !draft) return
    setError('')
    setNotice('')
    setUploadProgress(0)
    try {
      const url = await uploadLevelImage(draft.id, file, setUploadProgress)
      change('imageURL', url)
      setNotice('Image uploaded. Save the level to publish it.')
    } catch (uploadError) {
      setError(uploadError.message || 'Image upload failed.')
    } finally {
      event.target.value = ''
      setUploadProgress(0)
    }
  }

  async function addSlot() {
    if (ordered.length >= 10) return
    const next = newLevel(ordered.length + 1)
    setBusy(true)
    setError('')
    try {
      await onSave(next)
      setSelectedId(next.id)
      setDraft(next)
      setNotice('Level slot created. Add its image and details.')
    } catch (saveError) {
      setError(saveError.message || 'Could not create this level.')
    } finally {
      setBusy(false)
    }
  }

  async function reorder(delta) {
    const index = ordered.findIndex((level) => level.id === selectedId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ordered.length) return
    const next = [...ordered]
    ;[next[index], next[target]] = [next[target], next[index]]
    setBusy(true)
    setError('')
    try {
      await Promise.all(next.map((level, position) => onSave({ ...level, order: position + 1 })))
      setNotice('Puzzle shelf order saved.')
    } catch (saveError) {
      setError(saveError.message || 'Could not reorder levels.')
    } finally {
      setBusy(false)
    }
  }

  if (!draft) return (
    <main className="page-wrap admin-page">
      <header className="admin-header"><div><p className="section-eyebrow">THE PUZZLE STUDIO</p><h1>Set the table.</h1><p>Build the ten scenes your players will find on the shelf.</p></div><ShieldCheck size={25} /></header>
      <section className="admin-empty"><ImagePlus size={26} /><h2>Start your puzzle shelf</h2><p>Create first level slot, then add its image and settings.</p><button className="button button-primary" type="button" onClick={addSlot} disabled={busy}>Create level 1</button></section>
    </main>
  )

  return (
    <main className="page-wrap admin-page">
      <header className="admin-header"><div><p className="section-eyebrow">THE PUZZLE STUDIO</p><h1>Set the table.</h1><p>Each level lives in Firebase. Update the picture, piece count, and access any time.</p></div><div className="admin-count"><strong>{ordered.length}<small> / 10</small></strong><span>levels ready</span></div></header>
      <div className="admin-toolbar"><span><ShieldCheck size={16} /> Protected level settings</span><button type="button" className="text-action" onClick={onReload}>Refresh levels</button></div>
      <div className="admin-layout">
        <aside className="admin-level-list" aria-label="Configured levels">
          {ordered.map((level) => <button key={level.id} type="button" className={`admin-level-option ${selectedId === level.id ? 'active' : ''}`} onClick={() => setSelectedId(level.id)}><span className="admin-level-number">{String(level.order).padStart(2, '0')}</span><span className="admin-level-name"><strong>{level.title || 'Untitled level'}</strong><small>{Number(level.pieceCount).toLocaleString()} pieces · {level.difficulty}</small></span><i className={level.isActive ? 'level-on' : ''} /></button>)}
          {ordered.length < 10 && <button className="admin-add-level" type="button" onClick={addSlot} disabled={busy}><ImagePlus size={16} /> Add level slot <small>{ordered.length} of 10</small></button>}
          {ordered.length !== 10 && <p className="admin-warning">Add or seed levels until shelf has exactly 10.</p>}
        </aside>

        <form className="admin-editor" onSubmit={saveCurrent}>
          <div className="admin-editor-heading"><div><p className="section-eyebrow">LEVEL {String(draft.order).padStart(2, '0')}</p><h2>Edit puzzle details</h2></div><div className="admin-order-buttons"><button type="button" aria-label="Move level up" onClick={() => reorder(-1)} disabled={busy || draft.order <= 1}><ArrowUp size={16} /></button><button type="button" aria-label="Move level down" onClick={() => reorder(1)} disabled={busy || draft.order >= ordered.length}><ArrowDown size={16} /></button></div></div>
          <div className="admin-preview"><div className={`admin-preview-image ${imageRotation % 180 ? 'quarter-turn' : ''}`}>{draft.imageURL ? <img src={draft.imageURL} alt={draft.imageAlt || draft.title} style={{ transform: `rotate(${imageRotation}deg)` }} /> : <ImagePlus size={27} />}</div><div><strong>{draft.title}</strong><span>{Number(draft.pieceCount).toLocaleString()} pieces · {draft.difficulty}</span><small>{draft.isActive ? 'Visible in the puzzle shelf' : 'Hidden from players'}</small><div className="admin-rotation-controls"><span>{imageRotation}°</span><button type="button" aria-label="Rotate picture 90 degrees counterclockwise" onClick={() => rotateImage(-90)}><RotateCcw size={15} /></button><button type="button" aria-label="Rotate picture 90 degrees clockwise" onClick={() => rotateImage(90)}><RotateCw size={15} /></button></div></div></div>
          <label className="admin-upload"><input type="file" accept="image/*" onChange={upload} disabled={!firebaseReady || busy} /><span className="admin-upload-icon"><UploadCloud size={19} /></span><span><strong>{firebaseReady ? 'Upload puzzle image' : 'Image upload needs Firebase Storage'}</strong><small>{firebaseReady ? 'JPG, PNG, WebP · up to 12 MB' : 'For local preview, paste a public image URL below.'}</small>{uploadProgress > 0 && <i style={{ width: `${Math.round(uploadProgress * 100)}%` }} />}</span></label>
          <div className="admin-field-grid">
            <label>Level title<input value={draft.title} maxLength={60} onChange={(event) => change('title', event.target.value)} required /></label>
            <label>Difficulty<select value={draft.difficulty} onChange={(event) => change('difficulty', event.target.value)}>{difficulties.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Piece count<input type="number" min="1" max="5000" step="1" value={draft.pieceCount} onChange={(event) => change('pieceCount', event.target.value)} required /></label>
            <label>Completion requirement<select value={draft.requiredLevelId || ''} onChange={(event) => change('requiredLevelId', event.target.value)}><option value="">No completion requirement</option>{ordered.filter((level) => level.id !== draft.id).map((level) => <option value={level.id} key={level.id}>Complete: {level.title}</option>)}</select></label>
          </div>
          <label className="admin-full-field">Description<textarea value={draft.description || ''} maxLength={220} rows="3" onChange={(event) => change('description', event.target.value)} placeholder="A little about this place…" /></label>
          <label className="admin-full-field">Puzzle image URL<input type="url" value={draft.imageURL || ''} onChange={(event) => change('imageURL', event.target.value)} placeholder="https://…" /></label>
          <label className="admin-full-field">Image description<input value={draft.imageAlt || ''} maxLength={140} onChange={(event) => change('imageAlt', event.target.value)} placeholder="Describe the image for screen readers" /></label>
          <div className="admin-toggles">
            <label><span><ToggleRight size={17} /><strong>Show in puzzle shelf</strong></span><input type="checkbox" checked={Boolean(draft.isActive)} onChange={(event) => change('isActive', event.target.checked)} /></label>
            <label><span><LockKeyhole size={17} /><strong>Lock level</strong></span><input type="checkbox" checked={Boolean(draft.isLocked)} onChange={(event) => change('isLocked', event.target.checked)} /></label>
            <label><span><ToggleLeft size={17} /><strong>Allow piece rotation</strong></span><input type="checkbox" checked={Boolean(draft.allowRotation)} onChange={(event) => change('allowRotation', event.target.checked)} /></label>
          </div>
          <div className="admin-save-row"><div>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="admin-success" role="status"><Check size={14} /> {notice}</p>}</div><button type="submit" className="button button-primary" disabled={busy}><Save size={16} /> {busy ? 'Saving…' : 'Save level'}</button></div>
        </form>
      </div>
      {!firebaseReady && <p className="firebase-hint admin-demo-hint">Demo edits stay in this browser. Connect Firebase to publish levels, upload images, and control cloud access.</p>}
    </main>
  )
}
