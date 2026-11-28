import { LEVEL_CATALOG, DEFAULT_RULES } from './levelCatalog'

const images = import.meta.glob('../assets/puzzles/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
})

// "Level 1.JPG" -> "level-01"
export function normalizeName(fileName) {
  return fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/\d+/g, (n) => n.padStart(2, '0'))
}

// If the image name matches a catalog key, return that level's rules
export function matchCatalog(fileName) {
  return LEVEL_CATALOG[normalizeName(fileName)] || null
}

export function getLocalLevels() {
  return Object.entries(images)
    .map(([path, url]) => {
      const id = normalizeName(path)
      const match = matchCatalog(path)
      const rules = { ...DEFAULT_RULES, ...(match || {}) }
      const numberInName = Number((id.match(/\d+/) || [])[0])
      return {
        id,
        order: numberInName || 999,
        title: rules.title || `Puzzle ${numberInName || id}`,
        description: rules.description,
        imageURL: url,
        imageAlt: rules.imageAlt || '',
        imageRotation: rules.imageRotation || 0,
        imageShiftUp: Number(rules.imageShiftUp) || 0,
        pieceCount: rules.pieceCount,
        difficulty: rules.difficulty,
        allowRotation: rules.allowRotation,
        requiredLevelId: rules.requires || '',
        isActive: true,
        isLocked: false,
        completionCount: 0,
      }
    })
    .sort((a, b) => a.order - b.order)
}

