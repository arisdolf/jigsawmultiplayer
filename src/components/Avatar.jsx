import { UserRound } from 'lucide-react'
import '../css/components/Avatar.css'

export default function Avatar({ player, size = 'md', showName = false, isHost = false }) {
  const initials = (player?.displayName || 'P')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <span className={`avatar-wrap avatar-${size}`} title={player?.displayName || 'Puzzle Pal'}>
      {player?.photoURL ? (
        <img src={player.photoURL} alt="" className="avatar-image" />
      ) : player ? (
        <span className="avatar-initials" style={{ '--avatar-color': player.color || '#527fa8' }}>{initials}</span>
      ) : (
        <span className="avatar-guest"><UserRound size={size === 'sm' ? 12 : 15} /></span>
      )}
      {isHost && <i className="avatar-host-dot" aria-label="Host" />}
      {showName && <span className="avatar-name">{player?.displayName || 'Puzzle Pal'}</span>}
    </span>
  )
}
