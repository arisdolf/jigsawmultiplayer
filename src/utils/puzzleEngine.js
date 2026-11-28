
// Mushroom knob: round head on a narrow neck. Position and waviness vary per edge
const SHAPE = { neck: 0.055, head: 0.14, rise: 0.045, flare: 0.04 }

const MAX_PIECES = 5000
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round2 = (value) => Math.round(value * 100) / 100
const unit = (hash, shift) => ((hash >>> shift) & 255) / 255

function hash32(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash += hash << 13
  hash ^= hash >>> 7
  hash += hash << 3
  hash ^= hash >>> 17
  hash += hash << 5
  return hash >>> 0
}

function getGrid(pieceCount, imageAspect = 1.5) {
  const target = clamp(Number(imageAspect) || 1.5, 0.55, 2.4)
  const accept = Math.log(1.6) // accept a grid up to 60% off the picture's shape (the picture is cropped to fit)
  const maxTotal = Math.ceil(pieceCount * 1.15) + 2
  let best = null
  for (let total = pieceCount; total <= maxTotal; total += 1) {
    for (let columns = 1; columns <= total; columns += 1) {
      if (total % columns) continue
      const rows = total / columns
      const distance = Math.abs(Math.log(columns / rows / target))
      if (!best || distance < best.distance) best = { rows, columns, count: total, distance }
    }
    if (best.distance <= accept) break
  }
  return best
}

// Deterministic per level and per edge, so both neighbours get the same shape.
function getEdgeStyle(axis, x, y, seed = '') {
  const hash = hash32(`${seed}|${axis}:${x}:${y}`)
  const extra = hash32(`${seed}|shape|${axis}:${x}:${y}`)
  return {
    positiveSideHasTab: ((hash >>> 16) & 1) === 0,
    center: 0.4 + unit(extra, 0) * 0.2,        // knob sits between 40% and 60% along the edge
    waveA: (unit(extra, 8) - 0.5) * 0.09,      // gentle wobble before the knob
    waveB: (unit(extra, 16) - 0.5) * 0.09,     // gentle wobble after the knob
  }
}

// One edge as cubic segments, in world order (u from 0 to 1). v is how far it sticks out.
function knobSegments({ center: c, waveA, waveB }) {
  const { neck: n, head: r, rise: h, flare: f } = SHAPE
  const hc = h + r * 0.9
  const a = c - n - f
  const b = c + n + f
  return [
    [[0, 0], [a * 0.35, waveA], [a * 0.7, -waveA * 0.6], [a, 0]],
    [[a, 0], [c - n - f * 0.3, 0], [c - n, h * 0.35], [c - n, h]],
    [[c - n, h], [c - n, h + (hc - h) * 0.6], [c - r, hc - r * 0.45], [c - r, hc]],
    [[c - r, hc], [c - r, hc + r * 0.55], [c - r * 0.55, hc + r], [c, hc + r]],
    [[c, hc + r], [c + r * 0.55, hc + r], [c + r, hc + r * 0.55], [c + r, hc]],
    [[c + r, hc], [c + r, hc - r * 0.45], [c + n, h + (hc - h) * 0.6], [c + n, h]],
    [[c + n, h], [c + n, h * 0.35], [c + n + f * 0.3, 0], [b, 0]],
    [[b, 0], [b + (1 - b) * 0.3, -waveB * 0.6], [b + (1 - b) * 0.65, waveB], [1, 0]],
  ]
}

function edgePath(side, isTab, edge, width, height, flat = false) {
  if (flat) {
    if (side === 'top') return `L ${width} 0`
    if (side === 'right') return `L ${width} ${height}`
    if (side === 'bottom') return `L 0 ${height}`
    return 'L 0 0'
  }

  const vertical = side === 'right' || side === 'left'
  const reverse = side === 'bottom' || side === 'left'
  const length = vertical ? height : width
  const normal = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side]
  const sign = isTab ? 1 : -1

  // u is always the world position along the edge, so neighbours line up exactly
  const toXY = ([u, v]) => {
    const along = u * length
    const out = v * length * sign
    const x = vertical ? (side === 'right' ? width : 0) + normal[0] * out : along + normal[0] * out
    const y = vertical ? along + normal[1] * out : (side === 'bottom' ? height : 0) + normal[1] * out
    return [round2(x), round2(y)]
  }

  let segments = knobSegments(edge)
  // bottom and left edges are walked backwards, so flip the segment order
  if (reverse) segments = [...segments].reverse().map(([p0, c1, c2, p1]) => [p1, c2, c1, p0])

  return segments.map(([, c1, c2, p1]) => {
    const [x1, y1] = toXY(c1)
    const [x2, y2] = toXY(c2)
    const [x, y] = toXY(p1)
    return `C ${x1} ${y1}, ${x2} ${y2}, ${x} ${y}`
  }).join(' ')
}

export function getPiecePath(piece, grid) {
  const { width, height, row, column } = piece
  const index = row * grid.columns + column
    const seed = grid.seed || ''
  const top = row === 0 ? null : getEdgeStyle('h', column, row, seed)
  const bottom = index + grid.columns >= grid.count ? null : getEdgeStyle('h', column, row + 1, seed)
  const left = column === 0 ? null : getEdgeStyle('v', column, row, seed)
  const right = column === grid.columns - 1 || index + 1 >= grid.count ? null : getEdgeStyle('v', column + 1, row, seed)

  const topTab = top?.positiveSideHasTab ?? false
  const bottomTab = bottom ? !bottom.positiveSideHasTab : false
  const leftTab = left?.positiveSideHasTab ?? false
  const rightTab = right ? !right.positiveSideHasTab : false

  

  return [
  'M 0 0',
  edgePath('top', topTab, top, width, height, top === null),
  edgePath('right', rightTab, right, width, height, right === null),
  edgePath('bottom', bottomTab, bottom, width, height, bottom === null),
  edgePath('left', leftTab, left, width, height, left === null),
  'Z',
].join(' ')
}

// Free spots in a ring around the board where loose pieces can start
function scatterSlots(grid, band, step, jitter) {
  const pad = jitter + grid.cellSize * 0.25
  const columns = Math.floor((grid.width + band * 2) / step)
  const rows = Math.floor((grid.height + band * 2) / step)
  const slots = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -band + column * step
      const y = -band + row * step
      const touchesBoard = x < grid.width + pad && x + step > -pad && y < grid.height + pad && y + step > -pad
      if (!touchesBoard) slots.push({ x, y })
    }
  }
  return slots
}

function shuffle(list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[list[index], list[swap]] = [list[swap], list[index]]
  }
  return list
}

export async function generatePuzzlePieces({
  pieceCount,
  imageAspect = 1.5,
  boardWidth = 1800,
  seed = '',
  shuffleRotation = false,
  onProgress = () => {},
  signal,
}) {
    const requested = Number(pieceCount)
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_PIECES) {
    throw new RangeError(`Piece count must be an integer from 1 to ${MAX_PIECES}.`)
  }

  const { rows, columns, count } = getGrid(requested, imageAspect)
  const cellSize = clamp(boardWidth / columns, 24, 240)
  const grid = {
    rows,
    columns,
    cellSize,
    width: columns * cellSize,
    height: rows * cellSize,
    count,
    seed: String(seed),
  }

  // Size the scatter ring so there is a free spot for every piece
  const step = cellSize
  const jitter = step * 0.12
  const sides = (grid.width + grid.height) / step
  const estimate = (-2 * sides + Math.sqrt(4 * sides * sides + 16 * count * 1.15)) / 8
  let band = Math.max(2.5, estimate) * step
  let slots = scatterSlots(grid, band, step, jitter)
  while (slots.length < count) {
    band += step
    slots = scatterSlots(grid, band, step, jitter)
  }
  grid.bounds = { x: -band, y: -band, width: grid.width + band * 2, height: grid.height + band * 2 }

  shuffle(slots)
  const stacking = shuffle(Array.from({ length: count }, (_, index) => index))
  const pieces = new Array(count)
  const batchSize = count > 1000 ? 180 : 500

  for (let index = 0; index < count; index += 1) {
    if (signal?.aborted) throw new DOMException('Puzzle generation cancelled.', 'AbortError')

    const row = Math.floor(index / columns)
    const column = index % columns
    const slot = slots[index]

    pieces[index] = {
      id: `${row}-${column}`,
      row,
      column,
      width: cellSize,
      height: cellSize,
      targetX: column * cellSize,
      targetY: row * cellSize,
      x: slot.x + (Math.random() * 2 - 1) * jitter,
      y: slot.y + (Math.random() * 2 - 1) * jitter,
      placed: false,
      rotation: shuffleRotation ? [0, 90, 180, 270][Math.floor(Math.random() * 4)] : 0,
      movingBy: null,
      lockUntil: 0,
      style: 0,
      stackOrder: stacking[index],
    }

    if ((index + 1) % batchSize === 0 && index + 1 < count) {
      onProgress((index + 1) / count)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  onProgress(1)
  return { grid, pieces }
}

export function toLocalPiece(piece, grid) {
  return {
    ...piece,
    x: Number(piece.x) || 0,
    y: Number(piece.y) || 0,
    placed: Boolean(piece.placed),
    movingBy: piece.movingBy || null,
    lockUntil: Number(piece.lockUntil) || 0,
    path: getPiecePath(piece, grid),
  }
}

export function getPlacementTarget(piece) {
  return { x: piece.targetX, y: piece.targetY }
}

export function isCorrectPlacement(piece, x, y) {
  const tolerance = Math.min(piece.width, piece.height) * 0.1 // raise toward 0.2 for a stronger magnet
  return Math.hypot(x - piece.targetX, y - piece.targetY) <= tolerance
}

export function getDifficultyLabel(value) {
  const known = ['Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard', 'Expert', 'Master']
  return known.includes(value) ? value : 'Custom'
}
