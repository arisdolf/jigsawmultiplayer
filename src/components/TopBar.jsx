import { ArrowLeft, AudioLines, Home, Heart, LogOut, Music2, Puzzle, Settings2, ShieldCheck, Sparkles, UserRound, UsersRound, Volume2, VolumeX } from 'lucide-react'
import Avatar from './Avatar'
import '../css/components/TopBar.css'
import '../css/components/TopBar.mobile.css'

const links = [
  { id: 'home', label: 'Home', icon: Sparkles },
  { id: 'levels', label: 'Puzzle library', icon: Puzzle },
    { id: 'together', label: 'Together', icon: Heart },
]
const mobileLinks = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'levels', label: 'Play', icon: Puzzle },
  { id: 'together', label: 'Together', icon: UsersRound },
  { id: 'profile', label: 'Profile', icon: UserRound },
]

export default function TopBar({ screen, onNavigate, user, isAdmin, onSignIn, onSignOut, onProfile, audio, onBack, onAudioSettings }) {
  const inGame = screen === 'game'

  return (
    <>
      <header className={`topbar ${inGame ? 'topbar-game' : ''}`}>
        <div className="topbar-main">
          <div className="topbar-left">
            {inGame && <button className="icon-button back-button" type="button" onClick={onBack} aria-label="Back to room"><ArrowLeft size={18} /></button>}
            <button className="brand" type="button" onClick={() => onNavigate('home')} aria-label="JigsawMult home">
              <span className="brand-mark"><Puzzle size={18} strokeWidth={2.4} /></span>
              <span className="brand-word">Jigsaw<span>Mult</span></span>
            </button>
          </div>

          {!inGame && (
            <nav className="desktop-nav" aria-label="Main navigation">
              {links.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" className={`nav-link ${screen === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
                  <Icon size={16} aria-hidden="true" /> {label}
                </button>
              ))}
              {isAdmin && <button type="button" className={`nav-link ${screen === 'admin' ? 'active' : ''}`} onClick={() => onNavigate('admin')}><Settings2 size={16} /> Studio</button>}
            </nav>
          )}

          <div className="topbar-actions">
            <div className="sound-quick-controls">
              <button type="button" className={`sound-quick ${audio.preferences.musicEnabled ? 'is-on' : ''}`} aria-label={audio.preferences.musicEnabled ? 'Pause background music' : 'Play background music'} aria-pressed={audio.preferences.musicEnabled} onClick={audio.toggleMusic}>
                <Music2 size={16} />
              </button>
              <button type="button" className={`sound-quick sound-effect-quick ${audio.preferences.effectEnabled ? 'is-on' : ''}`} aria-label={audio.preferences.effectEnabled ? 'Mute sound effects' : 'Enable sound effects'} aria-pressed={audio.preferences.effectEnabled} onClick={audio.toggleEffects}>
                {audio.preferences.effectEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button type="button" className="sound-settings-button" onClick={onAudioSettings} aria-label="Audio settings"><Settings2 size={15} /></button>
            </div>
            {user ? (
              <div className="account-menu">
                <button type="button" className="account-trigger" onClick={onProfile} aria-label={`Open profile for ${user.displayName || 'Puzzle Pal'}`}>
                  <Avatar player={user} size="sm" />
                  <span className="account-name">{user.displayName || 'Puzzle Pal'}</span>
                </button>
                <button type="button" className="icon-button account-logout" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button>
              </div>
            ) : (
              <button type="button" className="button button-quiet sign-in-button" onClick={onSignIn}><UserRound size={16} /> Sign in</button>
            )}
          </div>
        </div>
        {!inGame && <nav className="mobile-nav" aria-label="Main navigation">
          {mobileLinks.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`mobile-nav-link ${screen === id ? 'active' : ''}`} aria-current={screen === id ? 'page' : undefined} onClick={() => id === 'profile' ? onProfile() : onNavigate(id)}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
          {isAdmin && <button type="button" className={`mobile-nav-link ${screen === 'admin' ? 'active' : ''}`} onClick={() => onNavigate('admin')}><ShieldCheck size={18} /><span>Studio</span></button>}
        </nav>}
      </header>
    </>
  )
}
