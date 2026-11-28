import { Music2, Volume2, VolumeX } from 'lucide-react'
import Modal from './Modal'
import { Monitor, Moon, Sun } from 'lucide-react'
import '../css/components/AudioPanel.css'

const THEME_CHOICES = [
  { value: 'system', label: 'Follow system theme', title: 'System', Icon: Monitor },
  { value: 'light', label: 'Always use light theme', title: 'Light', Icon: Sun },
  { value: 'dark', label: 'Always use dark theme', title: 'Dark', Icon: Moon },
]

export default function AudioPanel({ open, onClose, audio, themePreference, setThemePreference }) {
  const { preferences, toggleMusic, toggleEffects, changeMusicVolume, changeEffectVolume } = audio

  return (
    <Modal open={open} onClose={onClose} title="Set the room mood" description="Choose an appearance, then tune the sounds." className="audio-modal">
      <div className="audio-setting">
        <div className="audio-setting-icon"><Monitor size={18} /></div>
        <div className="audio-setting-main">
          <div className="audio-setting-head">
            <strong>Appearance</strong>
            <div className="theme-choice-group" role="group" aria-label="Appearance mode">
              {THEME_CHOICES.map(({ value, label, title, Icon }) => (
                <button key={value} type="button" className="theme-choice" title={title} aria-label={label} aria-pressed={themePreference === value} onClick={() => setThemePreference(value)}>
                  <Icon size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <p>Follow your device or choose a fixed theme.</p>
        </div>
      </div>
      <div className="audio-setting">
        <div className="audio-setting-icon"><Music2 size={18} /></div>
        <div className="audio-setting-main">
          <div className="audio-setting-head"><strong>Background music</strong><button type="button" className={`toggle-switch ${preferences.musicEnabled ? 'active' : ''}`} aria-label="Toggle background music" aria-pressed={preferences.musicEnabled} onClick={toggleMusic}><i /></button></div>
          <p>Soft ambient tones for a slower afternoon.</p>
          <label className="range-line"><span className="sr-only">Music volume</span><input type="range" min="0" max="1" step="0.01" value={preferences.musicVolume} onChange={(event) => changeMusicVolume(event.target.value)} /><span>{Math.round(preferences.musicVolume * 100)}%</span></label>
        </div>
      </div>
      <div className="audio-setting">
        <div className="audio-setting-icon"><Volume2 size={18} /></div>
        <div className="audio-setting-main">
          <div className="audio-setting-head"><strong>Sound effects</strong><button type="button" className={`toggle-switch ${preferences.effectEnabled ? 'active' : ''}`} aria-label="Toggle sound effects" aria-pressed={preferences.effectEnabled} onClick={toggleEffects}><i /></button></div>
          <p>Gentle clicks for pieces and room activity.</p>
          <label className="range-line"><span className="sr-only">Sound effect volume</span><input type="range" min="0" max="1" step="0.01" value={preferences.effectVolume} onChange={(event) => changeEffectVolume(event.target.value)} /><span>{Math.round(preferences.effectVolume * 100)}%</span></label>
        </div>
      </div>
      <div className="audio-note"><VolumeX size={15} /> Your choices stay on this device.</div>
    </Modal>
  )
}
