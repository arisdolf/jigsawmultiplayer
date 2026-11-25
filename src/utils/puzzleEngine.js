// One knob style only: a round head on a narrow neck, centered on the edge,
// exactly like the reference sheet. Variety comes from every edge randomly
// being a tab or a blank, so you get corner, edge, 1/2/3/4-tab pieces, etc.
const SHAPE = { center: 0.5, neck: 0.07, head: 0.13, rise: 0.03, flare: 0.035 }

const MAX_PIECES = 5000
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round2 = (value) => Math.round(value * 100) / 100

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
  const targetAspect = clamp(Number(imageAspect) || 1.5, 0.55, 2.4)
  let best = { rows: pieceCount, columns: 1, distance: Infinity }
  for (let columns = 1; columns <= pieceCount; columns += 1) {
    const rows = Math.ceil(pieceCount / columns)
    const distance = Math.abs(Math.log(columns / rows / targetAspect))
    if (distance < best.distance) best = { rows, columns, distance }
  }
  return { rows: best.rows, columns: best.columns }
}

// Deterministic per level (seed = level id) so every player in the room
// gets identical piece shapes, but each level has its own random layout.
function getEdgeStyle(axis, x, y, seed = '') {
  const hash = hash32(`${seed}|${axis}:${x}:${y}`)
  return { style: 0, positiveSideHasTab: ((hash >>> 16) & 1) === 0 }
}

// Classic knob, drawn along one edge from u=0 to u=1.
// v is how far the knob sticks out (as a fraction of the edge length).
function knobProfile({ center: c, neck: n, head: r, rise: h, flare: f } = SHAPE) {
  const hc = h + r * 0.9 // height of the head's center
  const anchors = [
    [0, 0],
    [c - n - f, 0],
    [c - n, h],
    [c - r, hc],
    [c, hc + r],
    [c + r, hc],
    [c + n, h],
    [c + n + f, 0],
    [1, 0],
  ]
  const ctrls = [
    null,
    [[c - n - f * 0.3, 0], [c - n, h * 0.35]],
    [[c - n, h + (hc - h) * 0.6], [c - r, hc - r * 0.45]],
    [[c - r, hc + r * 0.55], [c - r * 0.55, hc + r]],
    [[c + r * 0.55, hc + r], [c + r, hc + r * 0.55]],
    [[c + r, hc - r * 0.45], [c + n, h + (hc - h) * 0.6]],
    [[c + n, h * 0.35], [c + n + f * 0.3, 0]],
    null,
  ]
  return { anchors, ctrls }
}

function edgePath(side, isTab, styleIndex, width, height, flat = false) {
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
    const { anchors, ctrls } = knobProfile(SHAPE)

  const toXY = ([u, v]) => {
    const along = (reverse ? 1 - u : u) * length
    const out = v * length * sign
    const x = vertical ? (side === 'right' ? width : 0) + normal[0] * out : along + normal[0] * out
    const y = vertical ? along + normal[1] * out : (side === 'bottom' ? height : 0) + normal[1] * out
    return [round2(x), round2(y)]
  }

  const points = anchors.map(toXY)
  const curves = ctrls.map((pair) => pair && [toXY(pair[0]), toXY(pair[1])])
  const segment = (pair, to) => (pair
    ? `C ${pair[0][0]} ${pair[0][1]}, ${pair[1][0]} ${pair[1][1]}, ${to[0]} ${to[1]}`
    : `L ${to[0]} ${to[1]}`)

    const commands = []
  for (let i = 0; i < curves.length; i += 1) commands.push(segment(curves[i], points[i + 1]))
  return commands.join(' ')
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
    edgePath('top', topTab, top?.style ?? 0, width, height, top === null),
    edgePath('right', rightTab, right?.style ?? 0, width, height, right === null),
    edgePath('bottom', bottomTab, bottom?.style ?? 0, width, height, bottom === null),
    edgePath('left', leftTab, left?.style ?? 0, width, height, left === null),
    'Z',
  ].join(' ')
}

export async function generatePuzzlePieces({
  pieceCount,
  imageAspect = 1.5,
  boardWidth = 1800,
  seed = '',
  onProgress = () => {},
  signal,
}) {
  const count = Number(pieceCount)
  if (!Number.isInteger(count) || count < 1 || count > MAX_PIECES) {
    throw new RangeError(`Piece count must be an integer from 1 to ${MAX_PIECES}.`)
  }

  const { rows, columns } = getGrid(count, imageAspect)
  const cellSize = clamp(boardWidth / columns, 24, 240)
  const grid = {
    rows,
    columns,
    cellSize,
    width: columns * cellSize,
    height: rows * cellSize,
    count,
    seed: String(seed),
    trayGap: Math.max(80, cellSize * 2.5),
  }
  const trayColumns = Math.max(1, Math.ceil(Math.sqrt(count * clamp(imageAspect, 0.55, 2.4))))
  const pieces = new Array(count)
  const batchSize = count > 1000 ? 180 : 500

  // Fisher–Yates shuffle: every piece gets a random loose-pile slot
  const slots = Array.from({ length: count }, (_, index) => index)
  for (let index = count - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[slots[index], slots[swap]] = [slots[swap], slots[index]]
  }

  for (let index = 0; index < count; index += 1) {
    if (signal?.aborted) throw new DOMException('Puzzle generation cancelled.', 'AbortError')

    const row = Math.floor(index / columns)
    const column = index % columns
    const slot = slots[index]
    const trayRow = Math.floor(slot / trayColumns)
    const trayColumn = slot % trayColumns
    const x = grid.width + grid.trayGap + trayColumn * cellSize + (Math.random() * 20 - 10)
    const y = trayRow * cellSize + (Math.random() * 20 - 10)

    pieces[index] = {
      id: `${row}-${column}`,
      row,
      column,
      width: cellSize,
      height: cellSize,
      targetX: column * cellSize,
      targetY: row * cellSize,
      x,
      y,
      placed: false,
      rotation: 0,
      movingBy: null,
      lockUntil: 0,
      style: 0,
      stackOrder: slot, // random stacking + random order in the piece tray
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

export function isCorrectPlacement(piece, x, y, zoom = 1) {
  const tolerance = Math.max(7, Math.min(piece.width, piece.height) * 0.24 / zoom)
  return Math.hypot(x - piece.targetX, y - piece.targetY) <= tolerance
}

export function getDifficultyLabel(value) {
  const known = ['Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard', 'Expert', 'Master']
  return known.includes(value) ? value : 'Custom'
}
