import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp, Puzzle } from 'lucide-react'
import TopBar from './components/TopBar'
import AudioPanel from './components/AudioPanel'
import AuthDialog from './components/AuthDialog'
import Toast from './components/Toast'
import { useAuth } from './hooks/useAuth'
import { useAudio } from './hooks/useAudio'
import { useRoom } from './hooks/useRoom'
import { getLevels, saveLevel } from './services/levelService'
import { getUserCompletions, SHARED_ROOM_ID } from './services/roomService'
import { setMusicScene } from './services/audioManager'

const HomePage = lazy(() => import('./pages/HomePage'))
const LevelsPage = lazy(() => import('./pages/LevelsPage'))
const RoomPage = lazy(() => import('./pages/RoomPage'))
const GamePage = lazy(() => import('./pages/GamePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const TogetherPage = lazy(() => import('./pages/TogetherPage'))

const RECENT_LEVEL_KEY = 'jigsawmult-recent-level'
const ROOM_VISITS_KEY = 'jigsawmult-room-visits'

const RECENT_LEVELS_KEY = 'jigsawmult-recent-levels'

const ACTIVE_ROOM_KEY = 'jigsawmult-active-room'

function readActiveRoom(uid) {
  try { return JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) || '{}')[uid] || null } catch { return null }
}
function rememberActiveRoom(uid, levelId, code) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) || '{}')
    all[uid] = { levelId, code }
    localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}
function forgetActiveRoom(uid) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) || '{}')
    delete all[uid]
    localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}

function readRecentIds() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_LEVELS_KEY) || 'null')
    if (Array.isArray(list)) return list
  } catch { /* ignore */ }
  const old = localStorage.getItem(RECENT_LEVEL_KEY) // older single-level save
  return old ? [old] : []
}

function rememberLevel(id) {
  const next = [id, ...readRecentIds().filter((item) => item !== id)].slice(0, 6)
  try { localStorage.setItem(RECENT_LEVELS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

function storeVisit(uid, roomId) {
  try {
    const all = JSON.parse(localStorage.getItem(ROOM_VISITS_KEY) || '{}')
    const visits = new Set(all[uid] || [])
    visits.add(roomId)
    all[uid] = [...visits].slice(-100)
    localStorage.setItem(ROOM_VISITS_KEY, JSON.stringify(all))
    return all[uid].length
  } catch {
    return 1
  }
}

function LoadingScreen() {
  return <main className="app-loading" aria-live="polite"><span className="brand-mark"><Puzzle size={20} /></span><strong>Setting out the puzzle pieces…</strong><i /><i /><i /></main>
}

export default function App() {
  const auth = useAuth()
  const audio = useAudio()
  const [screen, setScreen] = useState('home')
  const [roomId, setRoomId] = useState(null)
  const roomControl = useRoom(roomId, auth.user)
  const [levelRecords, setLevelRecords] = useState([])
  const [completions, setCompletions] = useState([])
  const [levelsLoading, setLevelsLoading] = useState(true)
  const [levelsError, setLevelsError] = useState('')
  const [toast, setToast] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [audioOpen, setAudioOpen] = useState(false)
  const [roomBusy, setRoomBusy] = useState(false)
  const inShared = roomId === SHARED_ROOM_ID
const enteringTogether = useRef(false)
const autoStarted = useRef(null)
  const [visits, setVisits] = useState(0)
 const [recentIds, setRecentIds] = useState(readRecentIds)
  const lastStatus = useRef({ roomId: null, status: null })
  
  const selectedLevel = levelRecords.find((level) => level.id === roomControl.room.meta?.levelId)


  useEffect(() => {
  const { id, meta } = roomControl.room
  if (!roomId || id !== roomId || !auth.user || !meta?.roomCode) return
  if (meta.status === 'completed') forgetActiveRoom(auth.user.uid)
  else rememberActiveRoom(auth.user.uid, meta.levelId, meta.roomCode)
}, [roomId, roomControl.room.id, roomControl.room.meta?.roomCode, roomControl.room.meta?.levelId, roomControl.room.meta?.status, auth.user?.uid])

  const tell = useCallback((message, type = 'info') => {
    setToast({ message, type })
    window.clearTimeout(tell.timer)
    tell.timer = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const refreshLevels = useCallback(async () => {
    setLevelsLoading(true)
    setLevelsError('')
    try {
      const next = await getLevels()
      setLevelRecords(next.sort((a, b) => Number(a.order) - Number(b.order)))
    } catch (error) {
      setLevelsError(error.message || 'Puzzle library could not load.')
    } finally {
      setLevelsLoading(false)
    }
  }, [])

  const refreshCompletions = useCallback(async () => {
    if (!auth.user) return
    setCompletions(await getUserCompletions(auth.user.uid))
  }, [auth.user?.uid])

  useEffect(() => { void refreshLevels() }, [refreshLevels])
  useEffect(() => { setMusicScene(screen === 'game') }, [screen])

  

  useEffect(() => {
    if (!roomId || id !== roomId || !auth.user || !meta?.roomCode || meta.permanent) return
    if (!auth.user) { setCompletions([]); setVisits(0); return }
    let active = true
    getUserCompletions(auth.user.uid).then((records) => active && setCompletions(records)).catch(() => active && setCompletions([]))
    try {
      const all = JSON.parse(localStorage.getItem(ROOM_VISITS_KEY) || '{}')
      setVisits((all[auth.user.uid] || []).length)
    } catch { setVisits(0) }
    return () => { active = false }
  }, [auth.user?.uid])

  const completedIds = useMemo(() => new Set(completions.map((item) => item.levelId)), [completions])
  const levels = useMemo(() => levelRecords.map((level) => ({
    ...level,
    isLocked: Boolean(level.isLocked || (level.requiredLevelId && !completedIds.has(level.requiredLevelId))),
    completed: completedIds.has(level.id),
  })), [levelRecords, completedIds])
  const recentLevels = useMemo(
  () => recentIds.map((id) => levels.find((level) => level.id === id)).filter(Boolean),
  [recentIds, levels],
)
  const stats = useMemo(() => ({
    completed: new Set(completions.map((item) => item.levelId)).size,
    rooms: visits,
    pieces: completions.reduce((total, item) => total + Number(item.piecesPlaced || 0), 0),
  }), [completions, visits])

  useEffect(() => {
    const currentRoomId = roomId
    const status = roomControl.room.game.status || roomControl.room.meta?.status || null
    if (lastStatus.current.roomId !== currentRoomId) lastStatus.current = { roomId: currentRoomId, status: null }
    if (screen === 'room' && status === 'playing' && lastStatus.current.status !== 'playing') setScreen('game')
    lastStatus.current.status = status
  }, [roomId, roomControl.room.game.status, roomControl.room.meta?.status, screen])

  const ensureUser = useCallback(async () => {
    if (auth.user) return auth.user
    return auth.guest('Puzzle Pal')
  }, [auth.user, auth.guest])

  const setRoomAddress = useCallback((code) => {
    const url = new URL(window.location.href)
    if (code) url.searchParams.set('room', code)
    else url.searchParams.delete('room')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const shareRoom = useCallback(async () => {
    const code = roomControl.room.meta?.roomCode
    if (!code) throw new Error('Room code is still loading.')
    const url = new URL(window.location.href)
    url.searchParams.set('room', code)
    const shareData = { title: 'Join my JigsawMult puzzle', text: `Come solve a puzzle with me. Room code: ${code}`, url: url.toString() }
    try {
      if (navigator.share) await navigator.share(shareData)
      else await navigator.clipboard.writeText(url.toString())
      tell(navigator.share ? 'Invite ready to share.' : 'Invite link copied.', 'success')
      return true
    } catch (error) {
      if (error.name !== 'AbortError') tell('Could not share the link. Room code is ' + code + '.', 'error')
      return false
    }
  }, [roomControl.room.meta?.roomCode, tell])

  const openRoom = useCallback((room, user) => {
    setRoomId(room.id)
    setRoomAddress(room.meta?.roomCode)
    setVisits(storeVisit(user?.uid || 'local', room.id))
    setScreen('room')
  }, [setRoomAddress])


  const enterTogether = useCallback(async () => {
  if (enteringTogether.current) return
  const first = levelRecords.find((item) => item.isActive)
  if (!first) { tell('No puzzle is ready yet.', 'error'); setScreen('home'); return }
  enteringTogether.current = true
  try {
    const user = await ensureUser()
    if (roomId && roomId !== SHARED_ROOM_ID) { try { await roomControl.leave() } catch { /* ignore */ } }
    const room = await roomControl.enterShared({ user, displayName: user.displayName, levelId: first.id })
    setRoomId(room.id)
    setRoomAddress(null)
  } catch (error) {
    tell(error.message || 'Could not open the shared table.', 'error')
    setScreen('home')
  } finally {
    enteringTogether.current = false
  }
}, [levelRecords, roomId, ensureUser, roomControl.enterShared, roomControl.leave, setRoomAddress, tell])

// opening the Together page sits you at the table
useEffect(() => {
  if (screen !== 'together' || inShared || levelsLoading || auth.loading) return
  void enterTogether()
}, [screen, inShared, levelsLoading, auth.loading, enterTogether])

// leaving the Together / game screens frees your seat
useEffect(() => {
  if (!inShared || screen === 'together' || screen === 'game') return
  roomControl.leave().catch(() => {})
  setRoomId(null)
}, [inShared, screen]) // eslint-disable-line react-hooks/exhaustive-deps

const switchSharedLevel = useCallback(async (levelId) => {
  await roomControl.reset(levelId)
  await roomControl.controlStatus('playing')
  tell('A fresh puzzle is on the table.', 'success')
}, [roomControl.reset, roomControl.controlStatus, tell])

// solo levels skip the room lobby and start straight away
useEffect(() => {
  const { id, meta, game } = roomControl.room
  if (screen !== 'room' || !roomId || inShared || id !== roomId || !meta || !game.levelId) return
  if (['playing', 'paused', 'completed'].includes(game.status) || autoStarted.current === roomId) return
  autoStarted.current = roomId
  roomControl.controlStatus('playing').catch(() => {})
}, [screen, roomId, inShared, roomControl.room.id, roomControl.room.meta, roomControl.room.game.levelId, roomControl.room.game.status, roomControl.controlStatus])


  const createRoom = useCallback(async (level = levels.find((item) => item.isActive && !item.isLocked)) => {
    if (!level) { tell('No open puzzle is ready yet.', 'error'); return }
    setRoomBusy(true)
    try {
      const user = await ensureUser()
      if (roomId) { try { await roomControl.leave() } catch { /* ignore */ } }
      const room = await roomControl.create({ user, displayName: user.displayName, levelId: level.id })
      openRoom(room, user)
    } catch (error) {
      tell(error.message || 'Could not make this room.', 'error')
    } finally {
      setRoomBusy(false)
    }
  }, [levels, ensureUser, roomControl.create, openRoom, tell])

 const resumeRoom = useCallback(async (level) => {
  const user = auth.user
  const saved = user ? readActiveRoom(user.uid) : null
  if (!saved || saved.levelId !== level.id) return false
  if (roomId && roomControl.room.meta?.roomCode === saved.code) { setScreen('room'); return true }
  try {
    if (roomId) { try { await roomControl.leave() } catch { /* ignore */ } }
    const room = await roomControl.join({ code: saved.code, user })
    openRoom(room, user)
    return true
  } catch {
    forgetActiveRoom(user.uid)   // room is gone or finished
    return false
  }
}, [auth.user, roomId, roomControl.room.meta?.roomCode, roomControl.leave, roomControl.join, openRoom])

const playLevel = useCallback(async (level) => {
  if (level.isLocked) { tell('Finish its required level to open this puzzle.', 'info'); return }
  setRecentIds(rememberLevel(level.id))
  setRoomBusy(true)
  try { if (await resumeRoom(level)) return } finally { setRoomBusy(false) }
  void createRoom(level)
}, [createRoom, resumeRoom, tell])

  const leaveRoom = useCallback(async () => {
    try {
      await roomControl.leave()
      setRoomId(null)
      setRoomAddress(null)
      setScreen('home')
    } catch (error) {
      tell(error.message || 'Could not leave room.', 'error')
    }
  }, [roomControl.leave, setRoomAddress, tell])

  const nextLevel = useCallback(async () => {
  const usable = (item) => item.isActive && (inShared || !item.isLocked)
  const index = levels.findIndex((item) => item.id === selectedLevel?.id)
  const next = levels.slice(index + 1).find(usable) || (inShared ? levels.find(usable) : null)
  if (!next) { setScreen('room'); tell('You reached the end of the puzzle shelf.', 'success'); return }
  try {
    if (!inShared) autoStarted.current = null
    await roomControl.reset(next.id)
    if (inShared) {
      await roomControl.controlStatus('playing')
    } else {
      setRecentIds(rememberLevel(next.id))
      setScreen('room')
    }
    tell(`${next.title} is ready at the table.`, 'success')
  } catch (error) {
    tell(error.message || 'Could not open the next level.', 'error')
  }
}, [levels, inShared, selectedLevel?.id, roomControl.reset, roomControl.controlStatus, tell])


  if (auth.loading) return <LoadingScreen />

  const showGame = screen === 'game' && roomId && selectedLevel
  const saveAdminLevel = async (level) => {
    await saveLevel(level, auth.isAdmin)
    await refreshLevels()
  }

  return <div className={`app-shell ${screen === 'game' ? 'is-game' : ''}`}>
    <TopBar  screen={screen} onNavigate={setScreen} user={auth.user} isAdmin={auth.isAdmin} onSignIn={() => setAuthOpen(true)} onSignOut={auth.signOut} onProfile={() => auth.user ? setScreen('profile') : setAuthOpen(true)} audio={audio} onBack={() => setScreen(inShared ? 'together' : 'room')} onAudioSettings={() => setAudioOpen(true)} />
    <Suspense fallback={<LoadingScreen />}>
      {showGame ? <GamePage shared={inShared} roomControl={roomControl} level={selectedLevel} user={auth.user} audio={audio} onLeave={leaveRoom} onBackToRoom={() => setScreen(inShared ? 'together' : 'room')} onShare={shareRoom} onNextLevel={nextLevel} onCompletionSaved={refreshCompletions} /> : screen === 'room' && roomId ? <RoomPage roomControl={roomControl} levels={levels} user={auth.user} onShare={shareRoom} onGame={() => setScreen('game')} onLeave={leaveRoom} onBack={() => setScreen('home')} /> : screen === 'levels' ? <LevelsPage levels={levels} loading={levelsLoading} error={levelsError} completions={completions} onPlay={playLevel} onRetry={refreshLevels} onBack={() => setScreen('home')} /> : screen === 'together' ? <TogetherPage roomControl={roomControl} levels={levelRecords} user={auth.user} onPlay={() => setScreen('game')} onSwitchLevel={switchSharedLevel} /> : screen === 'admin' ? <AdminPage levels={levelRecords} isAdmin={auth.isAdmin} firebaseReady={auth.firebaseReady} onSave={saveAdminLevel} onReload={refreshLevels} /> : screen === 'profile' && auth.user ? <ProfilePage user={auth.user} completions={completions} levels={levels} onBack={() => setScreen('home')} onRename={auth.rename} onSignOut={auth.signOut} isAdmin={auth.isAdmin} onAdmin={() => setScreen('admin')} /> : <HomePage levels={levels} loading={levelsLoading} error={levelsError} user={auth.user} stats={stats} recentLevels={recentLevels} onPlay={playLevel} onCreateRoom={() => void createRoom()} onTogether={() => setScreen('together')} onBrowse={() => setScreen('levels')} onRetry={refreshLevels} />}
    </Suspense>
    <div className="app-footnote"><CircleHelp size={13} /> Cozy games work best with friends. Keep your room code close.</div>
    <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} auth={auth} onAuthenticated={() => { setAuthOpen(false); tell('Welcome to the puzzle table.', 'success') }} />
    <AudioPanel open={audioOpen} onClose={() => setAudioOpen(false)} audio={audio} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </div>
}
