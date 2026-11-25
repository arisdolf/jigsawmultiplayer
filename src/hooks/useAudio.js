import { useEffect, useState } from 'react'
import {
  configureAudio,
  playSound,
  setEffectVolume,
  setMusicVolume,
  startMusic,
  stopMusic,
} from '../services/audioManager'

const AUDIO_KEY = 'jigsawmult-audio-preferences'
const defaults = { musicEnabled: false, effectEnabled: true, musicVolume: 0.22, effectVolume: 0.45 }

function readPreferences() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}') }
  } catch {
    return defaults
  }
}

export function useAudio() {
  const [preferences, setPreferences] = useState(readPreferences)

  useEffect(() => {
    configureAudio(preferences)
    localStorage.setItem(AUDIO_KEY, JSON.stringify(preferences))
  }, [preferences])

  const toggleMusic = () => {
    setPreferences((current) => {
      const musicEnabled = !current.musicEnabled
      if (musicEnabled) startMusic()
      else stopMusic()
      return { ...current, musicEnabled }
    })
  }

  const toggleEffects = () => {
    setPreferences((current) => ({ ...current, effectEnabled: !current.effectEnabled }))
  }

  const changeMusicVolume = (musicVolume) => {
    setMusicVolume(musicVolume)
    setPreferences((current) => ({ ...current, musicVolume: Number(musicVolume) }))
  }

  const changeEffectVolume = (effectVolume) => {
    setEffectVolume(effectVolume)
    setPreferences((current) => ({ ...current, effectVolume: Number(effectVolume) }))
  }

  return { preferences, toggleMusic, toggleEffects, changeMusicVolume, changeEffectVolume, playSound }
}

