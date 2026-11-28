import { useState } from 'react'
import { ArrowLeft, BookOpen, Clock3, LogOut, Puzzle, Save, Settings2, Sparkles, UserRound, UsersRound } from 'lucide-react'
import Avatar from '../components/Avatar'
import '../css/pages/ProfilePage.css'
import '../css/pages/ProfilePage.mobile.css'
import { ACHIEVEMENTS } from '../utils/progress'

function displayTime(total) {
  const seconds = Math.max(0, Math.floor(Number(total) || 0))
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'
}

function displayTotalTime(total) {
  const seconds = Math.max(0, Math.floor(Number(total) || 0))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours) return hours + 'h ' + minutes + 'm'
  if (minutes) return minutes + 'm'
  return seconds + 's'
}

export default function ProfilePage({ user, completions, completionsLoading = false, roomsVisited = 0, levels, onBack, onRename, onSignOut, isAdmin, onAdmin }) {
  const [name, setName] = useState(user?.displayName || '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const pieces = completions.reduce((total, item) => {
    const personalContribution = item.contributions?.find((entry) => entry.uid === user?.uid)?.piecesPlaced
    return total + Number(item.piecesPlaced || personalContribution || 0)
  }, 0)
  const completedLevels = new Set(completions.map((item) => item.levelId)).size
  const totalTime = completions.reduce((total, item) => total + Number(item.totalTime || item.bestTimeSeconds || 0), 0)
  const earnedAchievements = new Set(completions.flatMap((item) => item.achievements || []))
  const profileStats = [
    { label: 'Puzzles finished', value: completions.length.toLocaleString(), Icon: Puzzle },
    { label: 'Scenes completed', value: completedLevels.toLocaleString(), Icon: BookOpen },
    { label: 'Pieces placed', value: pieces.toLocaleString(), Icon: Sparkles },
    { label: 'Time puzzling', value: displayTotalTime(totalTime), Icon: Clock3 },
    { label: 'Rooms joined', value: Number(roomsVisited || 0).toLocaleString(), Icon: UsersRound },
  ]

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
      <div className="page-back-row">
        <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to the puzzle shelf</button>
        {isAdmin && <button type="button" className="profile-studio-button" onClick={onAdmin}><Settings2 size={16} /> Open Studio</button>}
      </div>

      <header className="profile-heading">
        <div className="profile-avatar-large"><Avatar player={user} size="xl" /><span><Sparkles size={14} /></span></div>
        <div><p className="section-eyebrow">YOUR LITTLE CORNER</p><h1>{user?.displayName || 'Puzzle Pal'}</h1><p>{user?.email || (user?.isAnonymous ? 'Playing as a guest' : 'Local puzzle profile')}</p></div>
      </header>

      <div className="profile-layout">
        <section className="profile-card">
          <p className="section-eyebrow">A FEW DETAILS</p>
          <h2>Make yourself at home.</h2>
          <form className="auth-form" onSubmit={save}>
            <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {saved && <p className="admin-success" role="status">Profile saved.</p>}
            <button className="button button-primary" type="submit" disabled={busy || !name.trim()}><Save size={16} /> Save name</button>
          </form>
          <button type="button" className="profile-signout" onClick={onSignOut}><LogOut size={16} /> Sign out</button>
        </section>

        <section className={'profile-card profile-records' + (completionsLoading ? ' is-loading' : '')} aria-busy={completionsLoading}>
          {completionsLoading && (
            <div className="profile-record-loading">
              <div className="section-title-row">
                <div><p className="section-eyebrow">YOUR PUZZLE NOTES</p><span className="data-skeleton profile-loading-title" /></div>
                <span className="data-skeleton profile-loading-count" />
              </div>
              <p className="puzzles-loading-status" role="status"><span className="live-dot" aria-hidden="true" /> Puzzle notes are loading…</p>
              <div className="profile-loading-stat-skeleton"><span className="data-skeleton" /><span className="data-skeleton" /><span className="data-skeleton" /><span className="data-skeleton" /><span className="data-skeleton" /></div>
              <div className="profile-loading-list"><span className="data-skeleton" /><span className="data-skeleton" /><span className="data-skeleton" /></div>
            </div>
          )}

          <div className="section-title-row">
            <div><p className="section-eyebrow">YOUR PUZZLE NOTES</p><h2>Little wins</h2></div>
            <span className="profile-win-count"><Sparkles size={15} /> {completions.length} finishes</span>
          </div>

          <div className="profile-stat-grid" role="group" aria-label="Puzzle statistics">
            {profileStats.map(({ label, value, Icon }) => (
              <div className="profile-stat-card" key={label}>
                <span className="profile-stat-icon" aria-hidden="true"><Icon size={16} /></span>
                <strong>{value}</strong>
                <small>{label}</small>
              </div>
            ))}
          </div>

          <section className="profile-achievements" aria-labelledby="profile-achievements-title">
            <div className="profile-achievements-heading">
              <div><p className="section-eyebrow">PUZZLE MILESTONES</p><h3 id="profile-achievements-title">Achievements</h3></div>
              <span>{earnedAchievements.size} / {ACHIEVEMENTS.length} earned</span>
            </div>
            <ul className="profile-achievements-grid">
              {ACHIEVEMENTS.map((achievement) => {
                const earned = earnedAchievements.has(achievement.id)
                return (
                  <li className={'profile-achievement-card ' + (earned ? 'is-earned' : 'is-locked')} key={achievement.id}>
                    <span className="profile-achievement-icon" aria-hidden="true">{achievement.icon}</span>
                    <span className="profile-achievement-copy"><strong>{achievement.name}</strong><small>{achievement.hint}</small></span>
                    <span className="profile-achievement-status">{earned ? 'Earned' : 'Locked'}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {completions.length ? (
            <ul className="profile-completion-list">
              {completions.slice().sort((a, b) => (b.completedAt?.seconds || b.completedAt || 0) - (a.completedAt?.seconds || a.completedAt || 0)).map((item, index) => {
                const level = levels.find((entry) => entry.id === item.levelId)
                return (
                  <li key={item.levelId + '-' + (item.roomId || index)}>
                    <span className="profile-completion-image">{level?.imageURL && <img src={level.imageURL} alt="" />}</span>
                    <span><strong>{level?.title || 'Level ' + item.levelId}</strong><small>{level?.pieceCount?.toLocaleString() || item.placedCount || 0} pieces · {displayTime(item.totalTime || item.bestTimeSeconds)}</small></span>
                    <Sparkles size={16} />
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="profile-empty"><UserRound size={21} /><span>Your first completed puzzle will be waiting here.</span></div>
          )}
        </section>
      </div>
    </main>
  )
}
