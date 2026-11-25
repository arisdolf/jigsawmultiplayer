let audioContext
let masterMusic
let masterEffects
let musicNodes = []
let musicStopTimer = null
let musicEnabled = false
let effectEnabled = true
let musicVolume = 0.22
let effectVolume = 0.45
let musicSceneFactor = 1

function context() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!audioContext && AudioContextClass) audioContext = new AudioContextClass()
  if (audioContext?.state === 'suspended') audioContext.resume()
  return audioContext
}

function setGain(node, value, seconds = 0.45) {
  if (!node || !audioContext) return
  const now = audioContext.currentTime
  node.gain.cancelScheduledValues(now)
  node.gain.setTargetAtTime(value, now, seconds)
}

export function configureAudio(preferences) {
  musicEnabled = preferences.musicEnabled
  effectEnabled = preferences.effectEnabled
  musicVolume = preferences.musicVolume
  effectVolume = preferences.effectVolume
  if (musicEnabled) startMusic()
  else stopMusic()
  setGain(masterEffects, effectEnabled ? effectVolume : 0)
}

export function startMusic() {
  window.clearTimeout(musicStopTimer)
  musicStopTimer = null
  const audio = context()
  if (!audio) return
  musicEnabled = true
  if (musicNodes.length) {
    setGain(masterMusic, musicVolume * musicSceneFactor, 1.1)
    return
  }
  masterMusic = audio.createGain()
  masterMusic.gain.value = 0
  masterMusic.connect(audio.destination)
  setGain(masterMusic, musicVolume * musicSceneFactor, 1.6)

  const notes = [110, 164.81, 220, 261.63]
  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator()
    const voice = audio.createGain()
    const lfo = audio.createOscillator()
    const lfoGain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    oscillator.detune.value = index % 2 ? -4 : 4
    voice.gain.value = 0.055 / (index + 1)
    lfo.frequency.value = 0.035 + index * 0.008
    lfoGain.gain.value = 0.018
    lfo.connect(lfoGain)
    lfoGain.connect(voice.gain)
    oscillator.connect(voice)
    voice.connect(masterMusic)
    oscillator.start()
    lfo.start()
    musicNodes.push(oscillator, lfo)
  })
}

export function stopMusic() {
  musicEnabled = false
  if (!masterMusic) return
  const gain = masterMusic
  setGain(gain, 0, 0.45)
  musicStopTimer = window.setTimeout(() => {
    musicNodes.forEach((node) => {
      try {
        node.stop()
      } catch {
        // Nodes may already be stopped after a browser audio reset.
      }
    })
    musicNodes = []
    gain.disconnect()
    if (masterMusic === gain) masterMusic = null
    musicStopTimer = null
  }, 700)
}

export function setMusicVolume(value) {
  musicVolume = Math.min(1, Math.max(0, Number(value)))
  setGain(masterMusic, musicEnabled ? musicVolume * musicSceneFactor : 0)
}

export function setMusicScene(isGameplay) {
  musicSceneFactor = isGameplay ? 0.78 : 1
  setGain(masterMusic, musicEnabled ? musicVolume * musicSceneFactor : 0, 1.25)
}

export function setEffectVolume(value) {
  effectVolume = Math.min(1, Math.max(0, Number(value)))
  setGain(masterEffects, effectEnabled ? effectVolume : 0)
}

export function playSound(name) {
  const audio = context()
  if (!audio || !effectEnabled) return
  if (!masterEffects) {
    masterEffects = audio.createGain()
    masterEffects.gain.value = effectVolume
    masterEffects.connect(audio.destination)
  }

  const now = audio.currentTime
  const notes = {
    pickup: [{ frequency: 460, duration: 0.055, gain: 0.08 }],
    move: [{ frequency: 310, duration: 0.025, gain: 0.018 }],
    button: [{ frequency: 540, duration: 0.04, gain: 0.035 }],
    correct: [
      { frequency: 660, duration: 0.09, gain: 0.11 },
      { frequency: 880, duration: 0.13, gain: 0.07, delay: 0.045 },
    ],
    incorrect: [
      { frequency: 210, duration: 0.1, gain: 0.08 },
      { frequency: 165, duration: 0.12, gain: 0.055, delay: 0.035 },
    ],
    complete: [
      { frequency: 523.25, duration: 0.3, gain: 0.09 },
      { frequency: 659.25, duration: 0.36, gain: 0.08, delay: 0.11 },
      { frequency: 783.99, duration: 0.52, gain: 0.075, delay: 0.22 },
    ],
    join: [{ frequency: 740, duration: 0.08, gain: 0.05 }, { frequency: 988, duration: 0.13, gain: 0.04, delay: 0.06 }],
    leave: [{ frequency: 440, duration: 0.12, gain: 0.035 }, { frequency: 330, duration: 0.16, gain: 0.03, delay: 0.06 }],
    unlock: [{ frequency: 784, duration: 0.12, gain: 0.06 }, { frequency: 1046, duration: 0.24, gain: 0.05, delay: 0.08 }],
  }

  ;(notes[name] || notes.button).forEach(({ frequency, duration, gain, delay = 0 }) => {
    const oscillator = audio.createOscillator()
    const envelope = audio.createGain()
    oscillator.type = name === 'incorrect' ? 'triangle' : 'sine'
    oscillator.frequency.setValueAtTime(frequency, now + delay)
    envelope.gain.setValueAtTime(0.0001, now + delay)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + delay + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration)
    oscillator.connect(envelope)
    envelope.connect(masterEffects)
    oscillator.start(now + delay)
    oscillator.stop(now + delay + duration + 0.02)
  })
}

