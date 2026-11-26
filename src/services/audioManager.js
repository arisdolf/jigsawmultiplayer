// JigsawMult audio engine
// Everything is synthesized with the Web Audio API, so there are no audio files to ship.
// Same exports as before: configureAudio, startMusic, stopMusic, setMusicVolume,
// setMusicScene, setEffectVolume, playSound.
//
// Sound names: pickup, drop, move, rotate, correct, connect, incorrect,
//              complete, join, leave, unlock, button

const BPM = 70
const BEAT = 60 / BPM
const BAR = BEAT * 4
const MUSIC_TRIM = 2 // overall loudness of the music relative to the volume slider

// MIDI note numbers. bass = root, notes = soft voicing (jazzy 7ths and 9ths)
const CHORDS = {
  Cmaj9: { bass: 48, notes: [55, 59, 62, 64] },
  Am9: { bass: 45, notes: [55, 59, 60, 64] },
  Fmaj9: { bass: 41, notes: [57, 60, 64, 67] },
  Dm9: { bass: 50, notes: [57, 60, 64, 65] },
  G13: { bass: 43, notes: [53, 59, 62, 64] },
  Em7: { bass: 40, notes: [55, 59, 62, 67] },
}
const PROGRESSIONS = [
  [CHORDS.Cmaj9, CHORDS.Am9, CHORDS.Fmaj9, CHORDS.G13],
  [CHORDS.Fmaj9, CHORDS.Em7, CHORDS.Dm9, CHORDS.G13],
  [CHORDS.Cmaj9, CHORDS.Em7, CHORDS.Fmaj9, CHORDS.G13],
  [CHORDS.Am9, CHORDS.Dm9, CHORDS.G13, CHORDS.Cmaj9],
]
const SCALE = [72, 74, 76, 79, 81, 84] // C major pentatonic, so nothing ever clashes

let audioContext = null
let compressor = null
let reverb = null
let masterEffects = null
let masterMusic = null
let musicFilter = null
let musicSend = null
let crackle = null
let noiseBuffer = null
let schedulerTimer = null
let musicRunning = false
let nextBarTime = 0
let barIndex = 0
let progression = PROGRESSIONS[0]
let melodyIndex = 2

let musicEnabled = false
let effectEnabled = true
let musicVolume = 0.22
let effectVolume = 0.45
let musicSceneFactor = 1

const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12)
const rand = (min, max) => min + Math.random() * (max - min)
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/* ---------- audio graph ---------- */

function makeImpulse(seconds = 2.4, decay = 2.6) {
  const rate = audioContext.sampleRate
  const length = Math.floor(rate * seconds)
  const buffer = audioContext.createBuffer(2, length, rate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buffer
}

function buildGraph() {
  compressor = audioContext.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 24
  compressor.ratio.value = 3
  compressor.attack.value = 0.005
  compressor.release.value = 0.25
  compressor.connect(audioContext.destination)

  // shared room reverb gives everything a soft, cozy tail
  reverb = audioContext.createConvolver()
  reverb.buffer = makeImpulse()
  const reverbWet = audioContext.createGain()
  reverbWet.gain.value = 0.7
  reverb.connect(reverbWet)
  reverbWet.connect(compressor)

  masterEffects = audioContext.createGain()
  masterEffects.gain.value = effectEnabled ? effectVolume : 0
  masterEffects.connect(compressor)
  const effectsSend = audioContext.createGain()
  effectsSend.gain.value = 0.28
  masterEffects.connect(effectsSend)
  effectsSend.connect(reverb)
}

function context() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!audioContext && AudioContextClass) {
    audioContext = new AudioContextClass()
    buildGraph()
    // browsers keep audio locked until the first tap or key press
    ;['pointerdown', 'keydown'].forEach((name) => {
      window.addEventListener(name, () => {
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
      }, { passive: true })
    })
  }
  if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {})
  return audioContext
}

function setGain(node, value, seconds = 0.45) {
  if (!node || !audioContext) return
  const now = audioContext.currentTime
  node.gain.cancelScheduledValues(now)
  node.gain.setTargetAtTime(value, now, seconds)
}

/* ---------- sound building blocks ---------- */

function tone(bus, { freq, type = 'sine', start, dur, gain, attack = 0.008, glideTo, detune = 0 }) {
  const osc = audioContext.createOscillator()
  const env = audioContext.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur)
  osc.detune.value = detune
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(env)
  env.connect(bus)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

function getNoise() {
  if (!noiseBuffer) {
    const length = audioContext.sampleRate
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

function noise(bus, { start, dur, gain, type = 'bandpass', freq = 2000, q = 1, attack = 0.004 }) {
  const source = audioContext.createBufferSource()
  const filter = audioContext.createBiquadFilter()
  const env = audioContext.createGain()
  source.buffer = getNoise()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  source.connect(filter)
  filter.connect(env)
  env.connect(bus)
  source.start(start, Math.random() * 0.4)
  source.stop(start + dur + 0.05)
}

// glassy little bell
function bell(bus, freq, start, gain, dur = 0.9) {
  tone(bus, { freq, start, dur, gain })
  tone(bus, { freq: freq * 2.01, start, dur: dur * 0.5, gain: gain * 0.3 })
  tone(bus, { freq: freq * 3.99, start, dur: dur * 0.25, gain: gain * 0.1 })
}

// punchy FM "ping": bright and metallic at the start, then it mellows out fast
function fmTone(bus, { freq, ratio = 3, index = 2.5, start, dur, gain }) {
  const carrier = audioContext.createOscillator()
  const modulator = audioContext.createOscillator()
  const depth = audioContext.createGain()
  const env = audioContext.createGain()
  carrier.frequency.value = freq
  modulator.frequency.value = freq * ratio
  depth.gain.setValueAtTime(freq * index, start)
  depth.gain.exponentialRampToValueAtTime(freq * 0.05, start + dur * 0.6)
  modulator.connect(depth)
  depth.connect(carrier.frequency)
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  carrier.connect(env)
  env.connect(bus)
  carrier.start(start)
  modulator.start(start)
  carrier.stop(start + dur + 0.05)
  modulator.stop(start + dur + 0.05)
}

// warm electric-piano key
function keys(bus, freq, start, gain, dur = 1.6) {
  tone(bus, { freq, start, dur, gain, attack: 0.012 })
  tone(bus, { freq, start, dur: dur * 0.9, gain: gain * 0.5, attack: 0.012, detune: 7 })
  tone(bus, { freq: freq * 2, start, dur: dur * 0.4, gain: gain * 0.22, attack: 0.008 })
}

/* ---------- sound effects ---------- */

// Streak: placing pieces in quick succession climbs the scale, so a hot streak feels
// like it is building. It only resets after COMBO_WINDOW seconds without a correct placement.
const COMBO_WINDOW = 15 // seconds allowed between placements to keep the streak alive
const COMBO_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] // major pentatonic, in semitones
let combo = 0
let lastCorrectAt = -100

const effects = {
  // pick a piece up: soft wooden lift
  pickup(bus, t) {
    tone(bus, { freq: 420, glideTo: 560, type: 'triangle', start: t, dur: 0.07, gain: 0.09 })
    noise(bus, { start: t, dur: 0.03, gain: 0.05, freq: 2200, q: 1.2 })
  },
  // set a piece down on the table
  drop(bus, t) {
    tone(bus, { freq: 230, glideTo: 140, start: t, dur: 0.11, gain: 0.12 })
    noise(bus, { start: t, dur: 0.05, gain: 0.06, type: 'lowpass', freq: 1100 })
  },
  // dragging: a very quiet paper slide
  move(bus, t) {
    noise(bus, { start: t, dur: 0.05, gain: 0.03, freq: rand(1800, 2800), q: 0.8 })
  },
  // rotate: tok-tik
  rotate(bus, t) {
    tone(bus, { freq: 520, type: 'triangle', start: t, dur: 0.05, gain: 0.07 })
    tone(bus, { freq: 780, type: 'triangle', start: t + 0.055, dur: 0.08, gain: 0.07 })
    noise(bus, { start: t, dur: 0.02, gain: 0.03, freq: 3000, q: 1.5 })
  },
  // piece clicks into its spot: wooden thump plus a happy chime (pitch varies so it stays musical)
  correct(bus, t) {
    // streak: each quick placement is a step higher on the scale
    combo = audioContext.currentTime - lastCorrectAt < COMBO_WINDOW ? Math.min(combo + 1, COMBO_STEPS.length - 1) : 0
    lastCorrectAt = audioContext.currentTime
    const freq = mtof(72) * Math.pow(2, COMBO_STEPS[combo] / 12)
    const heat = combo / (COMBO_STEPS.length - 1) // 0 on the first piece, 1 on a max streak

    // 1. snap: a sharp click as the piece locks in
    noise(bus, { start: t, dur: 0.015, gain: 0.12, type: 'highpass', freq: 3500, attack: 0.001 })
    noise(bus, { start: t, dur: 0.04, gain: 0.07, freq: 1800, q: 2, attack: 0.001 })
    // 2. punch: a weighty thump that gets a little bigger with the streak
    tone(bus, { freq: 240, glideTo: 70, start: t, dur: 0.13, gain: 0.15 + heat * 0.05, attack: 0.002 })
    tone(bus, { freq: 480, glideTo: 280, type: 'triangle', start: t, dur: 0.05, gain: 0.07, attack: 0.002 })
    // 3. woody "tok" that climbs in pitch with the streak
    tone(bus, { freq: freq * 0.5, glideTo: freq * 0.3, type: 'triangle', start: t, dur: 0.08, gain: 0.1, attack: 0.002 })
    // 4. a soft chime that grows sweeter and fuller as the streak builds
    //    streak 0: one quiet chime | 2+: a major third joins | 4+: a fifth | 6+: an octave
    //    5+: a gentle sparkle | 7+: a warm glow underneath
    bell(bus, freq, t + 0.03, 0.035 + heat * 0.045, 0.5 + heat * 0.7)
    if (combo >= 2) bell(bus, freq * 1.25, t + 0.07, 0.03 + heat * 0.035, 0.5 + heat * 0.7)
    if (combo >= 4) bell(bus, freq * 1.5, t + 0.115, 0.03 + heat * 0.035, 0.6 + heat * 0.8)
    if (combo >= 6) bell(bus, freq * 2, t + 0.16, 0.028 + heat * 0.03, 0.7 + heat * 0.9)
    if (combo >= 5) noise(bus, { start: t + 0.1, dur: 0.2 + heat * 0.4, gain: 0.008 + heat * 0.018, type: 'highpass', freq: 7000, attack: 0.03 })
    if (combo >= 7) tone(bus, { freq: freq * 0.5, start: t + 0.03, dur: 0.9, gain: heat * 0.045, attack: 0.04 })
  },
  // two pieces join into a group: softer two-note pluck
  connect(bus, t) {
    const root = pick([392, 440, 493.88])
    keys(bus, root, t, 0.07, 0.7)
    keys(bus, root * 1.25, t + 0.06, 0.06, 0.8)
  },
  // wrong spot: a soft, friendly thud (never harsh)
  incorrect(bus, t) {
    tone(bus, { freq: 190, glideTo: 120, type: 'triangle', start: t, dur: 0.14, gain: 0.09 })
    noise(bus, { start: t, dur: 0.06, gain: 0.04, type: 'lowpass', freq: 800 })
  },
  // puzzle finished: warm rising arpeggio with shimmer
  complete(bus, t) {
    ;[523.25, 659.25, 783.99, 987.77, 1046.5, 1318.5, 1568].forEach((freq, index) => {
      bell(bus, freq, t + index * 0.12, 0.07, 1.6)
    })
    ;[261.63, 329.63, 392, 493.88].forEach((freq) => keys(bus, freq, t, 0.04, 2.4))
    noise(bus, { start: t + 0.3, dur: 1.4, gain: 0.02, type: 'highpass', freq: 6000, attack: 0.4 })
  },
  join(bus, t) {
    keys(bus, 740, t, 0.06, 0.5)
    keys(bus, 988, t + 0.07, 0.05, 0.7)
  },
  leave(bus, t) {
    keys(bus, 440, t, 0.05, 0.5)
    keys(bus, 330, t + 0.08, 0.045, 0.7)
  },
  unlock(bus, t) {
    bell(bus, 784, t, 0.07, 0.8)
    bell(bus, 1046.5, t + 0.09, 0.06, 1.2)
  },
  button(bus, t) {
    tone(bus, { freq: 620, type: 'triangle', start: t, dur: 0.04, gain: 0.04 })
  },
}

export function playSound(name) {
  const audio = context()
  if (!audio || !effectEnabled) return
  const play = effects[name] || effects.button
  play(masterEffects, audio.currentTime + 0.005)
}

/* ---------- background music: generative lo-fi ---------- */

// vinyl hiss and tiny pops
function startCrackle() {
  const rate = audioContext.sampleRate
  const length = rate * 6
  const buffer = audioContext.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.012
  for (let pop = 0; pop < 34; pop += 1) {
    const position = Math.floor(Math.random() * (length - 60))
    const sign = Math.random() < 0.5 ? -1 : 1
    const amount = rand(0.12, 0.45)
    for (let k = 0; k < 40; k += 1) data[position + k] += sign * amount * Math.exp(-k / 6)
  }
  const source = audioContext.createBufferSource()
  const highpass = audioContext.createBiquadFilter()
  const level = audioContext.createGain()
  source.buffer = buffer
  source.loop = true
  highpass.type = 'highpass'
  highpass.frequency.value = 1200
  level.gain.value = 0.5
  source.connect(highpass)
  highpass.connect(level)
  level.connect(masterMusic)
  source.start()
  crackle = source
}

function strum(bus, chord, start, gain, dur) {
  chord.notes.forEach((midi, index) => {
    const lift = index === 3 && Math.random() < 0.3 ? 12 : 0
    keys(bus, mtof(midi + lift), start + index * rand(0.025, 0.05), gain, dur)
  })
}

function playBar(t, index) {
  const bus = masterMusic
  if (!bus) return
  if (index % 4 === 0) progression = pick(PROGRESSIONS)
  const chord = progression[index % 4]
  const human = () => rand(-0.012, 0.012)

  // slow pad
  chord.notes.forEach((midi) => tone(bus, { freq: mtof(midi), start: t, dur: BAR * 1.1, gain: 0.02, attack: 1.1, detune: rand(-6, 6) }))

  // bass
  tone(bus, { freq: mtof(chord.bass), type: 'triangle', start: t, dur: BEAT * 1.7, gain: 0.1, attack: 0.02 })
  if (Math.random() < 0.6) tone(bus, { freq: mtof(chord.bass + 7), type: 'triangle', start: t + BEAT * 2.5, dur: BEAT * 1.1, gain: 0.065, attack: 0.02 })

  // keys
  strum(bus, chord, t + human(), 0.05, BEAT * 3.2)
  if (Math.random() < 0.6) strum(bus, chord, t + BEAT * 2 + human(), 0.032, BEAT * 1.6)

  // sparse melody that wanders up and down the pentatonic scale
  if (Math.random() < 0.8) {
    for (let slot = 0; slot < 8; slot += 1) {
      if (Math.random() > 0.3) continue
      melodyIndex = clamp(melodyIndex + pick([-2, -1, -1, 0, 1, 1, 2]), 0, SCALE.length - 1)
      const swing = slot % 2 ? BEAT * 0.5 * 0.18 : 0
      keys(bus, mtof(SCALE[melodyIndex]), t + slot * BEAT * 0.5 + swing + human(), 0.04, BEAT * 2)
    }
  }

  // very soft lo-fi drums
  tone(bus, { freq: 120, glideTo: 45, start: t, dur: 0.25, gain: 0.16, attack: 0.004 })
  if (Math.random() < 0.85) tone(bus, { freq: 120, glideTo: 45, start: t + BEAT * 2, dur: 0.25, gain: 0.13, attack: 0.004 })
  ;[1, 3].forEach((beat) => {
    noise(bus, { start: t + BEAT * beat, dur: 0.1, gain: 0.03, freq: 1600, q: 0.9 })
    tone(bus, { freq: 330, type: 'triangle', start: t + BEAT * beat, dur: 0.06, gain: 0.02 })
  })
  for (let slot = 0; slot < 8; slot += 1) {
    if (Math.random() > 0.7) continue
    const swing = slot % 2 ? BEAT * 0.5 * 0.18 : 0
    noise(bus, { start: t + slot * BEAT * 0.5 + swing, dur: 0.03, gain: 0.007, type: 'highpass', freq: 7000 })
  }
}

// plans bars a little ahead of time so playback is gap-free
function scheduleMusic() {
  if (!musicRunning || !audioContext) return
  if (nextBarTime < audioContext.currentTime) nextBarTime = audioContext.currentTime + 0.1
  while (nextBarTime < audioContext.currentTime + 2) {
    playBar(nextBarTime, barIndex)
    nextBarTime += BAR
    barIndex += 1
  }
  schedulerTimer = window.setTimeout(scheduleMusic, 500)
}

export function startMusic() {
  const audio = context()
  if (!audio) return
  musicEnabled = true
  if (musicRunning) {
    setGain(masterMusic, musicVolume * musicSceneFactor * MUSIC_TRIM, 1.1)
    return
  }
  musicRunning = true

  masterMusic = audio.createGain()
  masterMusic.gain.value = 0
  // gentle low-pass = that warm, slightly muffled tape sound
  musicFilter = audio.createBiquadFilter()
  musicFilter.type = 'lowpass'
  musicFilter.frequency.value = 2800
  musicFilter.Q.value = 0.6
  musicSend = audio.createGain()
  musicSend.gain.value = 0.55
  masterMusic.connect(musicFilter)
  musicFilter.connect(compressor)
  musicFilter.connect(musicSend)
  musicSend.connect(reverb)
  setGain(masterMusic, musicVolume * musicSceneFactor * MUSIC_TRIM, 1.6)

  startCrackle()
  nextBarTime = audio.currentTime + 0.15
  barIndex = 0
  scheduleMusic()
}

export function stopMusic() {
  musicEnabled = false
  musicRunning = false
  window.clearTimeout(schedulerTimer)
  schedulerTimer = null
  if (!masterMusic) return

  const gain = masterMusic
  const filter = musicFilter
  const send = musicSend
  const hiss = crackle
  masterMusic = null
  musicFilter = null
  musicSend = null
  crackle = null

  setGain(gain, 0, 0.25)
  window.setTimeout(() => {
    try { hiss?.stop() } catch { /* already stopped */ }
    gain.disconnect()
    filter?.disconnect()
    send?.disconnect()
  }, 900)
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

export function setMusicVolume(value) {
  musicVolume = clamp(Number(value), 0, 1)
  setGain(masterMusic, musicEnabled ? musicVolume * musicSceneFactor * MUSIC_TRIM : 0)
}

export function setMusicScene(isGameplay) {
  musicSceneFactor = isGameplay ? 0.78 : 1
  setGain(masterMusic, musicEnabled ? musicVolume * musicSceneFactor * MUSIC_TRIM : 0, 1.25)
}

export function setEffectVolume(value) {
  effectVolume = clamp(Number(value), 0, 1)
  setGain(masterEffects, effectEnabled ? effectVolume : 0)
}