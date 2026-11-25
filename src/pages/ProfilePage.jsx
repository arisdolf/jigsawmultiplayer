import { useState } from 'react'
import { ArrowLeft, Clock3, LogOut, Puzzle, Save, Settings2, Sparkles, UserRound } from 'lucide-react'
import Avatar from '../components/Avatar'
import '../css/pages/ProfilePage.css'
import '../css/pages/ProfilePage.mobile.css'

function displayTime(total) {
  const seconds = Math.max(0, Math.floor(Number(total) || 0))
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export default function ProfilePage({ user, completions, levels, onBack, onRename, onSignOut, isAdmin, onAdmin }) {
  const [name, setName] = useState(user?.displayName || '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const pieces = completions.reduce((total, item) => total + Number(item.piecesPlaced || 0), 0)
  const earnedAchievements = [...new Set(completions.flatMap((item) => item.achievements || []))]
  const achievementNames = {
    'first-table': 'First Table',
    'full-table': 'Full House',
    'master-table': 'Master Table',
    'steady-hands': 'Steady Hands',
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await onRename(name.trim())
      setSaved(true)
    } catch (renameError) {
      setError(renameError.message || 'Could not update your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-wrap profile-page">
      <div className="page-back-row"><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to the puzzle shelf</button>{isAdmin && <button type="button" className="profile-studio-button" onClick={onAdmin}><Settings2 size={16} /> Open Studio</button>}</div>
      <header className="profile-heading"><div className="profile-avatar-large"><Avatar player={user} size="xl" /><span><Sparkles size={14} /></span></div><div><p className="section-eyebrow">YOUR LITTLE CORNER</p><h1>{user?.displayName || 'Puzzle Pal'}</h1><p>{user?.email || (user?.isAnonymous ? 'Playing as a guest' : 'Local puzzle profile')}</p></div></header>
      <div className="profile-layout">
        <section className="profile-card"><p className="section-eyebrow">A FEW DETAILS</p><h2>Make yourself at home.</h2><form className="auth-form" onSubmit={save}><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="admin-success" role="status">Profile saved.</p>}<button className="button button-primary" type="submit" disabled={busy || !name.trim()}><Save size={16} /> Save name</button></form><button type="button" className="profile-signout" onClick={onSignOut}><LogOut size={16} /> Sign out</button></section>
        <section className="profile-card profile-records"><div className="section-title-row"><div><p className="section-eyebrow">YOUR PUZZLE NOTES</p><h2>Little wins</h2></div><span className="profile-win-count"><Sparkles size={15} /> {completions.length}</span></div><div className="profile-stat-row"><span><Puzzle size={15} /> Pieces placed</span><strong>{pieces.toLocaleString()}</strong><span><Clock3 size={15} /> Levels completed</span><strong>{new Set(completions.map((item) => item.levelId)).size}</strong></div>{earnedAchievements.length > 0 && <div className="profile-achievements"><p>Achievements earned</p><div>{earnedAchievements.map((id) => <span key={id}><Sparkles size={12} /> {achievementNames[id] || id}</span>)}</div></div>}{completions.length ? <ul className="profile-completion-list">{completions.slice().sort((a, b) => (b.completedAt?.seconds || b.completedAt || 0) - (a.completedAt?.seconds || a.completedAt || 0)).map((item, index) => { const level = levels.find((entry) => entry.id === item.levelId); return <li key={`${item.levelId}-${item.roomId || index}`}><span className="profile-completion-image">{level?.imageURL && <img src={level.imageURL} alt="" />}</span><span><strong>{level?.title || `Level ${item.levelId}`}</strong><small>{level?.pieceCount?.toLocaleString() || item.placedCount || 0} pieces · {displayTime(item.totalTime || item.bestTimeSeconds)}</small></span><Sparkles size={16} /></li> })}</ul> : <div className="profile-empty"><UserRound size={21} /><span>Your first completed puzzle will be waiting here.</span></div>}</section>
      </div>
    </main>
  )
}
