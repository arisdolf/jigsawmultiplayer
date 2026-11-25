import { ArrowUpRight, Check, Clock3, LockKeyhole, UsersRound } from 'lucide-react'
import Avatar from './Avatar'
import '../css/components/LevelCard.css'

export function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return 'Not yet'
  const value = Math.floor(Number(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainingSeconds = value % 60
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`
}

export default function LevelCard({ level, completed = false, bestTime, compact = false, onPlay, onManage }) {
  const locked = Boolean(level.isLocked)
  const inactive = !level.isActive
  const imageRotation = ((Number(level.imageRotation) || 0) % 360 + 360) % 360

  return (
    <article className={`level-card ${compact ? 'level-card-compact' : ''} ${locked || inactive ? 'level-card-locked' : ''}`}>
      <button
        type="button"
        className="level-image-button"
        onClick={() => !locked && !inactive && onPlay?.(level)}
        disabled={locked || inactive}
        aria-label={`${level.title}, ${level.pieceCount.toLocaleString()} pieces, ${locked ? 'locked' : inactive ? 'not published' : 'play'}`}
      >
        <img
          className={imageRotation % 180 ? 'is-quarter-turn' : undefined}
          src={level.imageURL}
          alt={level.imageAlt || ''}
          loading="lazy"
          style={{ '--level-image-rotation': `${imageRotation}deg` }}
        />
        <span className="level-number">{String(level.order || 0).padStart(2, '0')}</span>
        {locked ? <span className="level-image-status"><LockKeyhole size={14} /> Locked</span> : completed ? <span className="level-image-status is-complete"><Check size={14} /> Finished</span> : null}
        {inactive && <span className="level-inactive-overlay">Not published</span>}
        {!locked && !inactive && <span className="level-open-icon"><ArrowUpRight size={17} /></span>}
      </button>
      <div className="level-card-body">
        <div className="level-heading-line">
          <div><h3>{level.title}</h3><p>{level.description}</p></div>
          <span className={`difficulty-pill difficulty-${(level.difficulty || 'custom').toLowerCase().replaceAll(' ', '-')}`}>{level.difficulty}</span>
        </div>
        <div className="level-details-row">
          <span className="piece-count"><strong>{level.pieceCount.toLocaleString()}</strong> pieces</span>
          <span className="level-stat"><UsersRound size={14} /> {(level.completionCount || 0).toLocaleString()}</span>
          <span className="level-stat"><Clock3 size={14} /> Best {formatDuration(bestTime ?? level.bestTimeSeconds)}</span>
        </div>
        {onManage && <button type="button" className="text-action" onClick={() => onManage(level)}>Manage level <ArrowUpRight size={14} /></button>}
        {compact && level.players?.length > 0 && <div className="level-card-players">{level.players.slice(0, 3).map((player) => <Avatar key={player.uid} player={player} size="xs" />)}</div>}
      </div>
    </article>
  )
}
