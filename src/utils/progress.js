export const xpForCompletion = (c) => 50 + Number(c.piecesPlaced || c.placedCount || 0) * 2

export const xpForLevel = (n) => 50 * n * (n - 1) // 0, 100, 300, 600, 1000...

const TITLES = ['Rookie', 'Edge Finder', 'Corner Hunter', 'Piece Pal', 'Table Regular', 'Puzzle Pro', 'Grand Solver', 'Jigsaw Legend']

export function getLevelInfo(xp) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2))
  const start = xpForLevel(level)
  const next = xpForLevel(level + 1)
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)],
    xp,
    into: xp - start,
    needed: next - start,
    percent: Math.round(((xp - start) / (next - start)) * 100),
  }
}

// 3 stars for a fast solve, 2 for decent, 1 for finishing
export function starsFor(totalTime, pieceCount) {
  const par = Number(pieceCount) * 20
  if (!totalTime || !par) return 1
  if (totalTime <= par) return 3
  if (totalTime <= par * 1.75) return 2
  return 1
}

const STREAK_KEY = 'jigsawmult-streak'
const day = (d = new Date()) => d.toISOString().slice(0, 10)

export function readStreak() {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null')
    if (!s) return 0
    const yesterday = day(new Date(Date.now() - 864e5))
    return s.last === day() || s.last === yesterday ? s.count : 0
  } catch { return 0 }
}

export function bumpStreak() {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') || { last: null, count: 0 }
    if (s.last === day()) return s.count
    const yesterday = day(new Date(Date.now() - 864e5))
    const count = s.last === yesterday ? s.count + 1 : 1
    localStorage.setItem(STREAK_KEY, JSON.stringify({ last: day(), count }))
    return count
  } catch { return 1 }
}

export const ACHIEVEMENTS = [
  { id: 'first-table', name: 'First Table', hint: 'Finish your first puzzle', icon: '🧩' },
  { id: 'steady-hands', name: 'Steady Hands', hint: 'Place 100 pieces in one puzzle', icon: '🖐️' },
  { id: 'full-table', name: 'Full House', hint: 'Finish a puzzle with 8 players', icon: '🏠' },
  { id: 'master-table', name: 'Master Table', hint: 'Finish a 5,000-piece puzzle', icon: '👑' },
  { id: 'regular', name: 'Table Regular', hint: 'Finish 5 puzzles', icon: '☕' },
  { id: 'scene-collector', name: 'Scene Collector', hint: 'Complete 5 different puzzles', icon: '🖼️' },
  { id: 'piece-collector', name: 'Piece Collector', hint: 'Place 500 pieces across puzzles', icon: '🧺' },
  { id: 'solo-solver', name: 'Solo Solver', hint: 'Finish a puzzle on your own', icon: '🧑‍🎨' },
  { id: 'team-player', name: 'Good Company', hint: 'Finish a puzzle with another player', icon: '🤝' },
  { id: 'quick-fit', name: 'Quick Fit', hint: 'Finish within 20 seconds per piece', icon: '⚡' },
]

export function getCompletionAchievements({ previousCompletions = [], players = [], placedCount = 0, totalTime = 0, contributionCounts = {}, uid, levelId }) {
  const previousPieces = previousCompletions.reduce((total, completion) => {
    const contribution = completion.piecesPlaced || completion.contributions?.find((player) => player.uid === uid)?.piecesPlaced || 0
    return total + Number(contribution)
  }, 0)
  const personalPieces = Number(contributionCounts[uid] || 0)
  const completedLevels = new Set(previousCompletions.map((completion) => completion.levelId))
  completedLevels.add(levelId)
  const candidates = []

  if (!previousCompletions.length) candidates.push('first-table')
  if (personalPieces >= 100) candidates.push('steady-hands')
  if (players.length >= 8) candidates.push('full-table')
  if (placedCount >= 5000) candidates.push('master-table')
  if (previousCompletions.length + 1 >= 5) candidates.push('regular')
  if (completedLevels.size >= 5) candidates.push('scene-collector')
  if (previousPieces + personalPieces >= 500) candidates.push('piece-collector')
  if (players.length === 1) candidates.push('solo-solver')
  if (players.length >= 2) candidates.push('team-player')
  if (placedCount > 0 && totalTime > 0 && totalTime <= placedCount * 20) candidates.push('quick-fit')

  const alreadyEarned = new Set(previousCompletions.flatMap((completion) => completion.achievements || []))
  return candidates.filter((id) => !alreadyEarned.has(id))
}
