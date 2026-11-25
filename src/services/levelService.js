import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { firebaseReady, firestore } from './firebase'
import { getLocalLevels } from '../data/localLevels'
const DEMO_LEVELS_KEY = 'jigsawmult-demo-levels'

async function loadDemoLevels() {
  const saved = localStorage.getItem(DEMO_LEVELS_KEY)
  if (saved) return JSON.parse(saved)
  const response = await fetch('/__demo/levels')
  if (!response.ok) throw new Error('Demo level library is unavailable.')
  return response.json()
}

export async function getLevels() {
  const local = getLocalLevels()
  if (local.length) return local          // use the folder if it has images

  if (!firebaseReady) {
    if (!import.meta.env.DEV) return []
    return loadDemoLevels()
  }

  const snapshot = await getDocs(query(collection(firestore, 'levels'), orderBy('order', 'asc')))
  return snapshot.docs.map((level) => ({ id: level.id, ...level.data() }))
}

export async function saveLevel(level, isAdmin) {
  if (!isAdmin) throw new Error('Only an administrator can edit levels.')
  if (firebaseReady) {
    await setDoc(doc(firestore, 'levels', level.id), { ...level, updatedAt: Date.now() }, { merge: true })
    return level
  }

  if (!import.meta.env.DEV) throw new Error('Connect Firebase to publish levels.')
  const levels = await loadDemoLevels()
  const next = levels.some((item) => item.id === level.id)
    ? levels.map((item) => (item.id === level.id ? { ...item, ...level } : item))
    : [...levels, level]
  localStorage.setItem(DEMO_LEVELS_KEY, JSON.stringify(next))
  return level
}

export async function toggleLevel(level, isAdmin) {
  if (!isAdmin) throw new Error('Only an administrator can edit levels.')
  const next = { ...level, isActive: !level.isActive }
  if (firebaseReady) {
    await updateDoc(doc(firestore, 'levels', level.id), { isActive: next.isActive })
    return next
  }
  return saveLevel(next, isAdmin)
}


