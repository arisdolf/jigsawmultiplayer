import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import TopBar from './components/TopBar'
import PageLoadingSkeleton from './components/PageLoadingSkeleton'
import AudioPanel from './components/AudioPanel'
import AuthDialog from './components/AuthDialog'
import Toast from './components/Toast'
import HomePage from './pages/HomePage'
import LevelsPage from './pages/LevelsPage'
import { useAuth } from './hooks/useAuth'
import { useAudio } from './hooks/useAudio'
import { useRoom } from './hooks/useRoom'
import { useTheme } from './hooks/useTheme'
import { getLevels, saveLevel } from './services/levelService'
import {
  canPlayMultiplayer,
  createNewTable,
  getUserCompletions,
  getUserTableCode,
  getUserTableCodes,
  isSharedRoomId,
  leaveRoom as leaveRoomById,
  normalizeTableCode,
  tableExists,
} from './services/roomService'
import { setMusicScene } from './services/audioManager'

const GamePage = lazy(() => import('./pages/GamePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const TogetherPage = lazy(() => import('./pages/TogetherPage'))

const RECENT_LEVEL_KEY = 'jigsawmult-recent-level'
const ROOM_VISITS_KEY = 'jigsawmult-room-visits'

const RECENT_LEVELS_KEY = 'jigsawmult-recent-levels'

const ACTIVE_ROOM_KEY = 'jigsawmult-active-rooms' // new key: { [uid]: { [levelId]: roomCode } }

const APP_SCREENS = new Set(['home', 'levels', 'game', 'together', 'admin', 'profile'])

function readInitialRoute() {
  if (typeof window === 'undefined') return { screen: 'home', roomCode: null, shouldJoinRoom: false, shared: false, sharedLevelId: null, sharedCode: null }
  const url = new URL(window.location.href)
  const requestedPage = url.searchParams.get('page')
  const requestedScreen = requestedPage === 'room' ? 'game' : requestedPage
  const roomCode = url.searchParams.get('room')
  const shared = url.searchParams.get('shared') === '1'
  const sharedLevelId = url.searchParams.get('sharedLevel')
  const sharedCode = normalizeTableCode(url.searchParams.get('table'))
  const hasValidScreen = APP_SCREENS.has(requestedScreen)
  const screen = hasValidScreen ? requestedScreen : roomCode ? 'game' : 'home'
  return {
    screen,
    roomCode,
    shared,
    sharedLevelId,
    sharedCode,
    shouldJoinRoom: Boolean(roomCode) && !shared && (!hasValidScreen || screen === 'game'),
  }
}

function readActiveRoom(uid, levelId) {
  try { return JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) || '{}')[uid]?.[levelId] || null } catch { return null }
}
function rememberActiveRoom(uid, levelId, code) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) || '{}')
    all[uid] = { ...(all[uid] || {}), [levelId]: code }
    localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}
function forgetActiveRoom(uid, levelId) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIVE_ROOM_KEY) || '{}')
    if (all[uid]) delete all[uid][levelId]
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

export default function App() {
  const auth = useAuth()
  const [tableCode, setTableCode] = useState('')
  const [ownedTableCode, setOwnedTableCode] = useState('')
  const [tableCodes, setTableCodes] = useState([])
  const [tableCodeState, setTableCodeState] = useState('loading')
  const [tableCodeError, setTableCodeError] = useState('')
  const [tableLoadAttempt, setTableLoadAttempt] = useState(0)
  const canTogether = canPlayMultiplayer(auth.user)
  const [authMode, setAuthMode] = useState('guest')
  const audio = useAudio()
  const { themePreference, setThemePreference } = useTheme()
  const initialRoute = useRef(readInitialRoute())
  const toastTimer = useRef(null)
  const [screen, setScreen] = useState(() => readInitialRoute().screen)
  const screenRef = useRef(screen)
  useEffect(() => { screenRef.current = screen }, [screen])
  const [roomId, setRoomId] = useState(null)
  const roomControl = useRoom(roomId, auth.user)
  const [levelRecords, setLevelRecords] = useState([])
  const [completions, setCompletions] = useState([])
  const [completionsLoading, setCompletionsLoading] = useState(true)
  const [levelsLoading, setLevelsLoading] = useState(true)
  const [levelsError, setLevelsError] = useState('')
  const [toast, setToast] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [audioOpen, setAudioOpen] = useState(false)
  const inShared = isSharedRoomId(roomId)
  const enteringTogether = useRef(false)
  const autoStarted = useRef(null)
  const pendingTogether = useRef(false)
  const roomLinkJoinStarted = useRef(false)
  const pendingRoomLink = useRef(false)
  const roomLinkPrompted = useRef(false)
  const [visits, setVisits] = useState(0)
  const [recentIds, setRecentIds] = useState(readRecentIds)

  const selectedLevel = levelRecords.find((level) => level.id === roomControl.room.meta?.levelId)


  useEffect(() => {
    const { id, meta } = roomControl.room
    if (!roomId || isSharedRoomId(roomId) || id !== roomId || !auth.user || !meta?.roomCode || !meta.levelId) return
    if (meta.status === 'completed') forgetActiveRoom(auth.user.uid, meta.levelId)
    else rememberActiveRoom(auth.user.uid, meta.levelId, meta.roomCode)
  }, [roomId, roomControl.room.id, roomControl.room.meta?.roomCode, roomControl.room.meta?.levelId, roomControl.room.meta?.status, auth.user?.uid])

  const tell = useCallback((message, type = 'info') => {
    setToast({ message, type })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const requestAccount = useCallback((message = 'Sign in with an account to play together. Guests can still play solo.') => {
    tell(message, 'info')
    setAuthMode('login')
    setAuthOpen(true)
  }, [tell])

  const navigate = useCallback((next) => {
  if (next === 'together' && !canTogether) {
    pendingTogether.current = true
    requestAccount()
    return
  }
  pendingTogether.current = false
  setScreen(next)
}, [canTogether, requestAccount])

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
    setCompletionsLoading(true)
    try {
      setCompletions(await getUserCompletions(auth.user.uid))
    } finally {
      setCompletionsLoading(false)
    }
  }, [auth.user?.uid])

  useEffect(() => { void refreshLevels() }, [refreshLevels])
  useEffect(() => { setMusicScene(screen === 'game') }, [screen])

  useEffect(() => {
  if (canTogether && pendingTogether.current) {
    pendingTogether.current = false
    setScreen('together')
  }
}, [canTogether])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (screen === 'home') url.searchParams.delete('page')
    else url.searchParams.set('page', screen)
    if (screen !== 'game') url.searchParams.delete('room')
    else if (roomControl.room.meta?.roomCode) url.searchParams.set('room', roomControl.room.meta.roomCode)
    if (screen === 'game' && inShared) {
      url.searchParams.set('shared', '1')
      if (roomControl.room.meta?.levelId) url.searchParams.set('sharedLevel', roomControl.room.meta.levelId)
      if (roomControl.room.meta?.tableCode) url.searchParams.set('table', roomControl.room.meta.tableCode)
    } else {
      url.searchParams.delete('shared')
      url.searchParams.delete('sharedLevel')
      url.searchParams.delete('table')
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [screen, inShared, roomControl.room.meta?.levelId, roomControl.room.meta?.roomCode])

  useEffect(() => {
    if (auth.loading) return
    if ((screen === 'profile' && !auth.user) || (screen === 'admin' && !auth.isAdmin)) {
      setScreen('home')
      return
    }
    const roomRouteCanRestore = initialRoute.current.shouldJoinRoom || (screen === 'game' && initialRoute.current.shared)
    if (screen === 'game' && !roomId && !roomRouteCanRestore) setScreen('home')
  }, [auth.loading, auth.user, auth.isAdmin, roomId, screen])



  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) {
      setCompletions([])
      setVisits(0)
      setCompletionsLoading(false)
      return
    }
    let active = true
    setCompletionsLoading(true)
    getUserCompletions(auth.user.uid)
      .then((records) => active && setCompletions(records))
      .catch(() => active && setCompletions([]))
      .finally(() => active && setCompletionsLoading(false))
    try {
      const all = JSON.parse(localStorage.getItem(ROOM_VISITS_KEY) || '{}')
      setVisits((all[auth.user.uid] || []).length)
    } catch { setVisits(0) }
    return () => { active = false }
  }, [auth.loading, auth.user?.uid])

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
    if (!canTogether) {
      requestAccount()
      return false
    }
    const meta = roomControl.room.meta
    if (!inShared && meta?.multiplayerEnabled === false) {
      tell('This is a solo save. Sign in before creating a multiplayer room.', 'error')
      return false
    }
    const code = inShared ? normalizeTableCode(meta?.tableCode || tableCode) : meta?.roomCode
    if (!code) throw new Error('Room code is still loading.')
    const url = new URL(window.location.href)
    if (inShared) {
      url.searchParams.delete('room')
      url.searchParams.set('page', 'game')
      url.searchParams.set('shared', '1')
      url.searchParams.set('sharedLevel', meta.levelId)
      url.searchParams.set('table', code)
    } else {
      url.searchParams.delete('shared')
      url.searchParams.delete('sharedLevel')
      url.searchParams.delete('table')
      url.searchParams.set('room', code)
    }
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
  }, [canTogether, inShared, roomControl.room.meta, tableCode, tell, requestAccount])

  const openRoom = useCallback((room, user) => {
    setRoomId(room.id)
    setRoomAddress(room.meta?.roomCode)
    setVisits(storeVisit(user?.uid || 'local', room.id))
    setScreen('game')
  }, [setRoomAddress])

  useEffect(() => {
    const route = initialRoute.current
    if (!route.shouldJoinRoom || !route.roomCode || auth.loading || roomId || roomLinkJoinStarted.current) return
    if (!canTogether) {
      pendingRoomLink.current = true
      roomLinkJoinStarted.current = false
      setScreen('home')
      if (!roomLinkPrompted.current) {
        roomLinkPrompted.current = true
        requestAccount('Sign in with an account to join this room. Guests can still play solo.')
      }
      return
    }
    roomLinkJoinStarted.current = true
    async function restoreRoom() {
      try {
        const user = auth.user
        const room = await roomControl.join({ code: route.roomCode, user })
        if (screenRef.current === route.screen || pendingRoomLink.current) {
          openRoom(room, user)
          if (route.screen === 'game') setScreen('game')
          route.shouldJoinRoom = false
          pendingRoomLink.current = false
          roomLinkPrompted.current = false
        }
      } catch (error) {
        if (screenRef.current !== route.screen && !pendingRoomLink.current) return
        tell(error.message || 'Could not reopen this puzzle.', 'error')
        setRoomAddress(null)
        setScreen('home')
        route.shouldJoinRoom = false
        pendingRoomLink.current = false
      } finally {
        roomLinkJoinStarted.current = false
      }
    }
    void restoreRoom()
  }, [auth.loading, auth.user, canTogether, roomId, roomControl.join, openRoom, setRoomAddress, requestAccount, tell])


  const retryTableSetup = useCallback(() => setTableLoadAttempt((attempt) => attempt + 1), [])

  useEffect(() => {
    if (!canTogether) {
      setTableCode('')
      setOwnedTableCode('')
      setTableCodes([])
      setTableCodeState('idle')
      return undefined
    }
    let active = true
    setTableCodeState('loading')
    setTableCodeError('')
    ;(async () => {
      const ownedCode = await getUserTableCode(auth.user)
      const savedCodes = await getUserTableCodes(auth.user)
      if (!active) return
      setOwnedTableCode(ownedCode)
      setTableCodes(savedCodes)
      setTableCode((current) => savedCodes.includes(current) ? current : ownedCode)
      setTableCodeState('ready')
    })().catch((error) => {
      if (!active) return
      setTableCodeError(error.message || 'Could not load your table code.')
      setTableCodeState('error')
    })
    return () => { active = false }
  }, [canTogether, auth.user?.uid, tableLoadAttempt])

  const enterTogether = useCallback(async (requestedCode, { activateLevel = false, preferLevel = false } = {}) => {
    if (!canTogether) {
      requestAccount()
      return
    }
    const code = normalizeTableCode(requestedCode || initialRoute.current.sharedCode || tableCode)
    if (!code) return
    if (enteringTogether.current) {
      if (requestedCode) throw new Error('A table is still opening. Try again in a moment.')
      return
    }

    const restoredLevel = screenRef.current === 'game' && initialRoute.current.shared
      ? levelRecords.find((item) => item.id === initialRoute.current.sharedLevelId)
      : null
    const first = restoredLevel || levelRecords.find((item) => item.isActive) || levelRecords[0]
    if (!first) { tell('No puzzle is ready yet.', 'error'); setScreen('home'); return }
    enteringTogether.current = true
    try {
      const user = await ensureUser()
      const previousRoomId = roomId
      const room = await roomControl.enterShared({
        user,
        displayName: user.displayName,
        levelId: first.id,
        code,
        activateLevel,
        preferLevel: preferLevel || Boolean(restoredLevel),
      })
      if (previousRoomId && previousRoomId !== room.id) {
        try {
          await roomControl.leave()
        } catch (error) {
          try { await leaveRoomById(room.id, user) } catch { /* clean up the new seat if the old one could not be left */ }
          throw error
        }
      }
      setRoomId(room.id)
      setRoomAddress(null)
      setTableCode(code)
      initialRoute.current.shared && (initialRoute.current.shared = false)
      getUserTableCodes(user).then(setTableCodes).catch(() => { })
    } catch (error) {
      if (requestedCode) throw error
      tell(error.message || 'Could not open the shared table.', 'error')
    } finally {
      enteringTogether.current = false
    }
  }, [canTogether, levelRecords, tableCode, ensureUser, roomId, roomControl.enterShared, roomControl.leave, setRoomAddress, requestAccount, tell])

  const joinTable = useCallback(async (raw) => {
    if (!canTogether) {
      requestAccount()
      throw new Error('Sign in with an account to join a table.')
    }
    const code = normalizeTableCode(raw)
    if (!code) throw new Error('Enter a valid 6-character table code.')
    if (!(await tableExists(code))) throw new Error('No table has that code.')
    await enterTogether(code)
  }, [canTogether, requestAccount, enterTogether])

    const createTable = useCallback(async () => {
    if (!canTogether) {
      requestAccount()
      throw new Error('Sign in with an account to create a table.')
    }
    const code = await createNewTable(auth.user)
    setTableCodes(await getUserTableCodes(auth.user))
    return code
  }, [canTogether, auth.user, requestAccount])

   const startSharedPuzzle = useCallback(async (levelId, codeOverride) => {
    if (!canTogether) throw new Error('Sign in with an account to play together.')
    const code = normalizeTableCode(codeOverride) || tableCode
    const isCurrentPuzzle = isSharedRoomId(roomId) && roomControl.room.meta?.levelId === levelId
    const level = levelRecords.find((item) => item.id === levelId && (item.isActive || isCurrentPuzzle))
    if (!level) throw new Error('That puzzle is no longer available.')
    const user = await ensureUser()
    const previousRoomId = roomId
    const room = await roomControl.enterShared({ user, displayName: user.displayName, levelId: level.id, code, activateLevel: true })
    if (previousRoomId && previousRoomId !== room.id) {
      try {
        await roomControl.leave()
      } catch (error) {
        try { await leaveRoomById(room.id, user) } catch { /* remove the new seat if the old one could not be left */ }
        throw error
      }
    }
    setRoomId(room.id)
    setTableCode(code)
    setRoomAddress(null)
    setScreen('game')
    getUserTableCodes(user).then(setTableCodes).catch(() => { })
  }, [canTogether, levelRecords, ensureUser, tableCode, roomId, roomControl.room.meta?.levelId, roomControl.enterShared, roomControl.leave, setRoomAddress])


  const handleSignOut = useCallback(async () => {
    if (roomId) { try { await roomControl.leave() } catch { /* ignore */ } setRoomId(null) }
    await auth.signOut()
  }, [roomId, roomControl.leave, auth.signOut])

  useEffect(() => {
    if (auth.loading) return
    if (canTogether) {
      if (initialRoute.current.shared && screen === 'home' && !roomId) setScreen('game')
      return
    }
    const sharedGame = screen === 'game' && (inShared || initialRoute.current.shared)
    if (screen === 'together' || sharedGame) {
      if (screen !== 'home') setScreen('home')
      if (!roomLinkPrompted.current) {
        roomLinkPrompted.current = true
        requestAccount('Sign in with an account to play together. Guests can still play solo.')
      }
    }
  }, [auth.loading, canTogether, screen, inShared, roomId, requestAccount])


  useEffect(() => {
    if (screen !== 'together' || inShared || levelsLoading || auth.loading || !canTogether) return
    void enterTogether()
  }, [screen, inShared, levelsLoading, auth.loading, canTogether, enterTogether])

  useEffect(() => {
    if (screen !== 'game' || !initialRoute.current.shared || inShared || levelsLoading || auth.loading || !canTogether) return
    void enterTogether()
  }, [screen, inShared, levelsLoading, auth.loading, canTogether, enterTogether])

  // leaving the Together / game screens frees your seat
  useEffect(() => {
    if (!inShared || screen === 'together' || screen === 'game') return
    roomControl.leave().catch(() => { })
    setRoomId(null)
  }, [inShared, screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start solo rooms after their subscription attaches.
  useEffect(() => {
    const { id, meta, game } = roomControl.room
    if (screen !== 'game' || !roomId || inShared || id !== roomId || !meta || !game.levelId) return
    if (['playing', 'paused', 'completed'].includes(game.status) || autoStarted.current === roomId) return
    autoStarted.current = roomId
    roomControl.controlStatus('playing').catch(() => { })
  }, [screen, roomId, inShared, roomControl.room.id, roomControl.room.meta, roomControl.room.game.levelId, roomControl.room.game.status, roomControl.controlStatus])


  const createRoom = useCallback(async (level = levels.find((item) => item.isActive && !item.isLocked)) => {
    if (!level) { tell('No open puzzle is ready yet.', 'error'); return }
    try {
      const user = await ensureUser()
      if (roomId) { try { await roomControl.leave() } catch { /* ignore */ } }
      const room = await roomControl.create({ user, displayName: user.displayName, levelId: level.id })
      openRoom(room, user)
    } catch (error) {
      tell(error.message || 'Could not make this room.', 'error')
    }
  }, [levels, ensureUser, roomControl.create, openRoom, tell])

  const createInviteRoom = useCallback(() => {
    if (!canTogether) {
      requestAccount('Sign in with an account to make a multiplayer room. Guests can still play solo.')
      return
    }
    void createRoom()
  }, [canTogether, createRoom, requestAccount])

  const resumeRoom = useCallback(async (level) => {
    const user = auth.user
    const code = user ? readActiveRoom(user.uid, level.id) : null
    if (!code) return false
    if (roomId && !isSharedRoomId(roomId) && roomControl.room.meta?.roomCode === code && roomControl.room.meta?.levelId === level.id) {
      setScreen('game')
      return true
    }
    try {
      if (roomId) { try { await roomControl.leave() } catch { /* ignore */ } }
      const room = await roomControl.join({ code, user, resumeOwned: true })
      if (room.meta?.levelId !== level.id || room.meta?.status === 'completed') {
        // that room moved on to another puzzle or finished
        forgetActiveRoom(user.uid, level.id)
        try { await leaveRoomById(room.id, user) } catch { /* ignore */ }
        return false
      }
      openRoom(room, user)
      return true
    } catch (error) {
      if (/no (local )?room|no longer available/i.test(error?.message || '')) {
        forgetActiveRoom(user.uid, level.id) // room is really gone
        return false
      }
      // temporary problem: keep the saved room instead of replacing it with an empty one
      tell('Could not reopen your saved puzzle. Please try again.', 'error')
      return true
    }
  }, [auth.user, roomId, roomControl.room.meta?.roomCode, roomControl.room.meta?.levelId, roomControl.leave, roomControl.join, openRoom, tell])

  const playLevel = useCallback(async (level) => {
    if (level.isLocked) { tell('Finish its required level to open this puzzle.', 'info'); return }
    setRecentIds(rememberLevel(level.id))
    if (await resumeRoom(level)) return
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
    if (!next) { setScreen(inShared ? 'together' : 'levels'); tell('You reached the end of the puzzle shelf.', 'success'); return }
    try {
      if (inShared) {
        await startSharedPuzzle(next.id)
        tell(`${next.title} is ready at the table.`, 'success')
        return
      }
      if (!inShared) autoStarted.current = null
      await roomControl.reset(next.id)
      setRecentIds(rememberLevel(next.id))
      setScreen('game')
      tell(`${next.title} is ready at the table.`, 'success')
    } catch (error) {
      tell(error.message || 'Could not open the next level.', 'error')
    }
  }, [levels, inShared, selectedLevel?.id, roomControl.reset, startSharedPuzzle, tell])


  const showGame = screen === 'game' && roomId && selectedLevel
  const saveAdminLevel = async (level) => {
    await saveLevel(level, auth.isAdmin)
    await refreshLevels()
  }
  const libraryLoading = levelsLoading || (Boolean(auth.user) && completionsLoading)
  const homePage = <HomePage levels={levels} loading={libraryLoading} statsLoading={Boolean(auth.user) && completionsLoading} error={levelsError} user={auth.user} authLoading={auth.loading} stats={stats} recentLevels={recentLevels} recentLevelCount={recentIds.length} onPlay={playLevel} onCreateRoom={createInviteRoom} onTogether={() => navigate('together')} onBrowse={() => setScreen('levels')} onRetry={refreshLevels} />
  const levelsPage = <LevelsPage levels={levels} loading={libraryLoading} error={levelsError} completions={completions} onPlay={playLevel} onRetry={refreshLevels} onBack={() => setScreen('home')} interactionDisabled={auth.loading} />
  let page
  if (auth.loading) {
    page = screen === 'home' ? homePage : screen === 'levels' ? levelsPage : <PageLoadingSkeleton screen={screen} />
  } else if (screen === 'game' && !showGame) {
    page = <PageLoadingSkeleton screen={screen} />
  } else if (showGame) {
    page = <GamePage shared={inShared} roomControl={roomControl} level={selectedLevel} user={auth.user} audio={audio} onLeave={leaveRoom} onReturnFromGame={() => setScreen(inShared ? 'together' : 'levels')} onShare={shareRoom} onNextLevel={nextLevel} onCompletionSaved={refreshCompletions} />
  } else if (screen === 'levels') {
    page = levelsPage
  } else if (screen === 'together') {
    page = <TogetherPage
      roomControl={roomControl}
      levels={levelRecords}
      user={auth.user}
      onPlay={() => setScreen('game')}
      onStartPuzzle={startSharedPuzzle}
      tableCode={tableCode}
      ownedTableCode={ownedTableCode}
      tableCodes={tableCodes}
      tableCodeState={tableCodeState}
      tableCodeError={tableCodeError}
      onRetryTableSetup={retryTableSetup}
      onSelectTable={enterTogether}
      onJoinTable={joinTable}
      onCreateTable={createTable}
    />
  } else if (screen === 'admin') {
    page = <AdminPage levels={levelRecords} loading={levelsLoading} isAdmin={auth.isAdmin} firebaseReady={auth.firebaseReady} onSave={saveAdminLevel} onReload={refreshLevels} />
  } else if (screen === 'profile' && auth.user) {
    page = <ProfilePage onSignOut={handleSignOut} user={auth.user} completions={completions} completionsLoading={completionsLoading} levels={levels} onBack={() => setScreen('home')} onRename={auth.rename} isAdmin={auth.isAdmin} onAdmin={() => setScreen('admin')} />
  } else {
    page = homePage
  }

  return <div className={`app-shell ${screen === 'game' ? 'is-game' : ''}`}>
    <TopBar screen={screen} onNavigate={navigate} user={auth.user} authLoading={auth.loading} isAdmin={auth.isAdmin} onSignIn={() => setAuthOpen(true)} onSignOut={handleSignOut} onProfile={() => auth.user ? setScreen('profile') : setAuthOpen(true)} audio={audio} backLabel={inShared ? 'Back to our table' : 'Back to puzzle shelf'} onBack={() => setScreen(inShared ? 'together' : 'levels')} onAudioSettings={() => setAudioOpen(true)} />
    <Suspense fallback={<PageLoadingSkeleton screen={screen} />}>
      {page}
    </Suspense>
    <div className="app-footnote"><CircleHelp size={13} /> Cozy games work best with friends. Keep your room code close.</div>
    <AuthDialog open={authOpen} initialMode={authMode} onClose={() => { setAuthOpen(false); pendingTogether.current = false }} auth={auth} onAuthenticated={() => { setAuthOpen(false); tell('Welcome to the puzzle table.', 'success') }} />
    <AudioPanel open={audioOpen} onClose={() => setAudioOpen(false)} audio={audio} themePreference={themePreference} setThemePreference={setThemePreference} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </div>
}
