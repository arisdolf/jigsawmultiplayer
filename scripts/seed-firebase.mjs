import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
const adminUid = process.env.FIREBASE_ADMIN_UID
const credential = serviceAccountPath
  ? cert(JSON.parse(await readFile(path.resolve(serviceAccountPath), 'utf8')))
  : applicationDefault()

initializeApp({ credential })
const firestore = getFirestore()
const levels = JSON.parse(await readFile(path.join(scriptDirectory, 'levels.seed.json'), 'utf8'))
const achievements = [
  { id: 'first-table', name: 'First Table', description: 'Finish your first shared puzzle.', icon: 'sparkles' },
  { id: 'full-table', name: 'Full House', description: 'Solve a puzzle with eight puzzle pals.', icon: 'users' },
  { id: 'master-table', name: 'Master Table', description: 'Complete the 5,000-piece level.', icon: 'trophy' },
  { id: 'steady-hands', name: 'Steady Hands', description: 'Place 100 pieces in one shared puzzle.', icon: 'check' },
]
const batch = firestore.batch()

for (const level of levels) {
  batch.set(firestore.collection('levels').doc(level.id), {
    ...level,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

for (const achievement of achievements) {
  batch.set(firestore.collection('achievements').doc(achievement.id), achievement, { merge: true })
}

await batch.commit()

if (adminUid) {
  const user = await getAuth().getUser(adminUid)
  await getAuth().setCustomUserClaims(adminUid, { ...user.customClaims, admin: true })
}

console.log(`Seeded ${levels.length} levels and ${achievements.length} achievements${adminUid ? ` and granted admin to ${adminUid}` : ''}.`)
