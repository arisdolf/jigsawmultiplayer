import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, firebaseReady } from '../services/firebase'
import {
  hasAdminClaim,
  loginAsGuest,
  loginWithEmail,
  loginWithGoogle,
  logout,
  registerWithEmail,
  renameUser,
} from '../services/authService'

const LOCAL_USER_KEY = 'jigsawmult-local-user'

function localUser() {
  try {
    return JSON.parse(sessionStorage.getItem(LOCAL_USER_KEY) || 'null')
  } catch {
    return null
  }
}

export function useAuth() {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!firebaseReady) {
      setUser(localUser())
      setIsAdmin(Boolean(import.meta.env.DEV))
      setLoading(false)
      return undefined
    }

    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      setLoading(false)
      if (!nextUser) {
        setIsAdmin(false)
        return
      }
      try {
        setIsAdmin(await hasAdminClaim(nextUser))
      } catch {
        setIsAdmin(false)
      }
    })
  }, [])

  const guest = useCallback(async (displayName = 'Puzzle Pal') => {
    if (firebaseReady) {
      return loginAsGuest(displayName)
    }
    const nextUser = {
      uid: `local-${crypto.randomUUID()}`,
      displayName: displayName.trim() || 'Puzzle Pal',
      photoURL: null,
      isGuest: true,
    }
    sessionStorage.setItem(LOCAL_USER_KEY, JSON.stringify(nextUser))
    setUser(nextUser)
    return nextUser
  }, [])

  const register = useCallback(async (values) => {
    if (!firebaseReady) throw new Error('Connect Firebase to create an online account.')
    return registerWithEmail(values)
  }, [])

  const login = useCallback(async (values) => {
    if (!firebaseReady) throw new Error('Connect Firebase to sign in online.')
    return loginWithEmail(values)
  }, [])

  const google = useCallback(async () => {
    if (!firebaseReady) throw new Error('Connect Firebase to use Google sign-in.')
    return loginWithGoogle()
  }, [])

  const signOut = useCallback(async () => {
    await logout()
    setUser(null)
    setIsAdmin(Boolean(import.meta.env.DEV && !firebaseReady))
  }, [])

  const rename = useCallback(async (displayName) => {
    if (!displayName.trim()) throw new Error('Enter a display name.')
    if (firebaseReady) {
      await renameUser(user, displayName.trim())
      setUser(Object.assign(Object.create(Object.getPrototypeOf(user)), user, { displayName: displayName.trim() }))
      return
    }
    const nextUser = { ...user, displayName: displayName.trim() }
    sessionStorage.setItem(LOCAL_USER_KEY, JSON.stringify(nextUser))
    setUser(nextUser)
  }, [user])

  return { user, isAdmin, loading, firebaseReady, guest, register, login, google, signOut, rename }
}

