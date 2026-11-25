import { firebaseReady, getStorageClient } from './firebase'

export async function uploadLevelImage(levelId, file, onProgress = () => {}) {
  if (!firebaseReady) throw new Error('Connect Firebase Storage before uploading images.')
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 12 * 1024 * 1024) throw new Error('Image must be 12 MB or smaller.')

  const [{ ref, getDownloadURL, uploadBytesResumable }, storage] = await Promise.all([
    import('firebase/storage'),
    getStorageClient(),
  ])
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const imageRef = ref(storage, `puzzles/${levelId}/${Date.now()}-${safeName}`)
  const task = uploadBytesResumable(imageRef, file, { contentType: file.type })

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onProgress(snapshot.bytesTransferred / snapshot.totalBytes),
      reject,
      async () => resolve(await getDownloadURL(task.snapshot.ref)),
    )
  })
}
