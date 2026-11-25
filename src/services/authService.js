import {
  createUserWithEmailAndPassword,
  getIdTokenResult,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, firebaseReady, firestore } from './firebase'

const googleProvider = new GoogleAuthProvider()

async function saveProfile(user, displayName = user.displayName || 'Puzzle Pal') {
  if (!firestore) return
  await setDoc(
    doc(firestore, 'users', user.uid),
    {
      uid: user.uid,
      displayName,
      email: user.email || null,
      photoURL: user.photoURL || null,
      lastSeenAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function registerWithEmail({ email, password, displayName }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(credential.user, { displayName })
  await saveProfile(credential.user, displayName)
  return credential.user
}

export async function loginWithEmail({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  await saveProfile(credential.user)
  return credential.user
}

export async function loginWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider)
  await saveProfile(credential.user)
  return credential.user
}

export async function loginAsGuest(displayName = 'Puzzle Pal') {
  if (!firebaseReady) return null
  const credential = await signInAnonymously(auth)
  await updateProfile(credential.user, { displayName })
  await saveProfile(credential.user, displayName)
  return credential.user
}

export async function renameUser(user, displayName) {
  await updateProfile(user, { displayName })
  await saveProfile(user, displayName)
  return { ...user, displayName }
}

export async function hasAdminClaim(user) {
  if (!firebaseReady || !user) return false
  const token = await getIdTokenResult(user, true)
  return token.claims.admin === true
}

export async function logout() {
  if (firebaseReady) await signOut(auth)
  sessionStorage.removeItem('jigsawmult-local-user')
}

