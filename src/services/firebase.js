import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

export const firebaseReady = Boolean(
  config.apiKey &&
    config.authDomain &&
    config.projectId &&
    config.storageBucket &&
    config.appId &&
    config.databaseURL,
)

const app = firebaseReady ? (getApps().length ? getApp() : initializeApp(config)) : null

export const auth = app ? getAuth(app) : null
export const database = app ? getDatabase(app) : null
export const firestore = app ? getFirestore(app) : null

export async function getStorageClient() {
  if (!app) return null
  const { getStorage } = await import('firebase/storage')
  return getStorage(app)
}

export async function callFirebaseFunction(name, payload) {
  if (!app) throw new Error('Connect Firebase before saving game progress.')
  const { getFunctions, httpsCallable } = await import('firebase/functions')
  const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1')
  const result = await httpsCallable(functions, name)(payload)
  return result.data
}

