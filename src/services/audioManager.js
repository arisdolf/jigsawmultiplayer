// JigsawMult audio engine
// Everything is synthesized with the Web Audio API, so there are no audio files to ship.
// Same exports as before: configureAudio, startMusic, stopMusic, setMusicVolume,
// setMusicScene, setEffectVolume, playSound.
//
// Sound names: pickup, drop, move, rotate, correct, connect, incorrect,
//              complete, join, leave, unlock, button


// File name	When it plays
// pickup	picking up a piece
// drop	dropping a piece on the table
// move	dragging (plays often, so keep it very short and quiet)
// rotate	rotating a piece
// correct	piece snaps into place
// connect	two pieces join
// incorrect	wrong spot
// complete	puzzle finished
// join / leave	player joins or leaves
// unlock	unused for now
// button	fallback for any sound without its own file
// tab	tab or UI click
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
void preloadSounds()
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



const soundFiles = import.meta.glob('../assets/sounds/*.{mp3,wav,ogg,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
})
const soundUrls = {}
Object.entries(soundFiles).forEach(([path, url]) => {
  soundUrls[path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()] = url
})

const soundBuffers = new Map()
const SOUND_VOLUME = { move: 0.5 } // optional per-sound level, 1 = full

async function preloadSounds() {
  await Promise.all(Object.entries(soundUrls).map(async ([name, url]) => {
    if (soundBuffers.has(name)) return
    try {
      const data = await (await fetch(url)).arrayBuffer()
      soundBuffers.set(name, await audioContext.decodeAudioData(data))
    } catch (error) {
      console.warn(`Could not load sound "${name}"`, error)
    }
  }))
}

export function playSound(name) {
  const audio = context()
  if (!audio || !effectEnabled) return
  const buffer = soundBuffers.get(name) || soundBuffers.get('button')
  if (!buffer) return

  const source = audio.createBufferSource()
  source.buffer = buffer

 

  const level = audio.createGain()
  level.gain.value = SOUND_VOLUME[name] ?? 1
  source.connect(level)
  level.connect(masterEffects)
  source.start(audio.currentTime + 0.005)
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


  // soft drums, no noise
tone(bus, { freq: 120, glideTo: 45, start: t, dur: 0.25, gain: 0.16, attack: 0.004 })
if (Math.random() < 0.85) tone(bus, { freq: 120, glideTo: 45, start: t + BEAT * 2, dur: 0.25, gain: 0.13, attack: 0.004 })
;[1, 3].forEach((beat) => {
  tone(bus, { freq: 330, type: 'triangle', start: t + BEAT * beat, dur: 0.08, gain: 0.025 })
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