export const TABLE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/

export function normalizeTableCode(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return TABLE_CODE_PATTERN.test(code) ? code : null
}

export function canPlayMultiplayer(user) {
  return Boolean(user?.uid && !user.isAnonymous && !user.isGuest)
}

export function sharedLevelRoomId(value, levelId, prefix = 'our-table') {
  const code = normalizeTableCode(value)
  if (!code) throw new TypeError('A valid table code is required.')
  if (levelId == null || levelId === '') throw new TypeError('A puzzle level is required.')
  const roomPrefix = String(prefix || 'our-table')
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(roomPrefix)) throw new TypeError('A valid table prefix is required.')
  const encodedLevelId = Array.from(String(levelId), (character) => character.codePointAt(0).toString(16)).join('-')
  return `${roomPrefix}-${code}-p-${encodedLevelId || 'empty'}`
}

export function sharedTableCodeFromRoomId(roomId, prefix = 'our-table') {
  const id = String(roomId || '')
  const base = `${String(prefix || 'our-table')}-`
  if (!id.startsWith(base)) return null
  const match = /^([A-HJ-NP-Z2-9]{6})-p-.+$/.exec(id.slice(base.length))
  return match?.[1] || null
}

export function isSharedRoomId(roomId, prefix = 'our-table') {
  const id = String(roomId || '')
  const base = String(prefix || 'our-table')
  return id === base || id.startsWith(`${base}-p-`) || Boolean(sharedTableCodeFromRoomId(id, base))
}

export async function copyTextWithFallback(text, { clipboard = globalThis.navigator?.clipboard, documentObject = globalThis.document } = {}) {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(String(text))
      return 'copied'
    } catch { /* use the selectable fallback below */ }
  }
  if (!documentObject?.createElement || !documentObject.body) return 'select'
  const field = documentObject.createElement('textarea')
  field.value = String(text)
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  documentObject.body.appendChild(field)
  field.focus()
  field.select()
  let copied = false
  try { copied = documentObject.execCommand?.('copy') === true } catch { /* keep visible code selected in the UI */ }
  field.remove()
  return copied ? 'copied' : 'select'
}
