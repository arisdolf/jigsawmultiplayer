const STYLE_NAMES = [
  'rounded',
  'wide-rounded',
  'narrow-rounded',
  'asymmetric',
  'irregular',
  'necked',
]

const SHAPES = [
  { start: 0.3, end: 0.7, center: 0.5, depth: 0.22, shoulder: 0.055 },
  { start: 0.16, end: 0.84, center: 0.5, depth: 0.24, shoulder: 0.11 },
  { start: 0.39, end: 0.61, center: 0.5, depth: 0.19, shoulder: 0.035 },
  { start: 0.23, end: 0.72, center: 0.44, depth: 0.21, shoulder: 0.06 },
  { start: 0.26, end: 0.77, center: 0.56, depth: 0.29, shoulder: 0.1 },
  { start: 0.31, end: 0.69, center: 0.5, depth: 0.27, shoulder: 0.035 },
]

const MAX_PIECES = 5000
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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

function getEdgeStyle(axis, x, y) {
  const key = `${axis}:${x}:${y}`
  const hash = hash32(key)
  return {
    style: hash % SHAPES.length,
    positiveSideHasTab: (hash & 1) === 0,
  }
}

function edgePath(side, isTab, styleIndex, width, height, flat = false) {
  if (flat) {
    if (side === 'top') return `L ${width} 0`
    if (side === 'right') return `L ${width} ${height}`
    if (side === 'bottom') return `L 0 ${height}`
    return 'L 0 0'
  }

  const shape = SHAPES[styleIndex]
  const vertical = side === 'right' || side === 'left'
  const reverse = side === 'bottom' || side === 'left'
  const length = vertical ? height : width
  const normal = {
    top: [0, -1],
    right: [1, 0],
    bottom: [0, 1],
    left: [-1, 0],
  }[side]
  const direction = isTab ? 1 : -1
  const depth = length * shape.depth * direction
  const start = shape.start
  const end = shape.end
  const middle = shape.center
  const shoulder = shape.shoulder
  const points = [
    [start, 0],
    [start + shoulder, 0],
    [middle - shoulder * 1.2, depth * 0.48],
    [middle, depth],
    [middle + shoulder * 1.2, depth],
    [end - shoulder, depth * 0.48],
    [end, 0],
  ]

  const point = ([u, offset]) => {
    const along = (reverse ? 1 - u : u) * length
    const outward = offset * (vertical ? width : height) / length
    if (vertical) {
      return [
        (side === 'right' ? width : 0) + normal[0] * outward,
        along + normal[1] * outward,
      ]
    }
    return [
      along + normal[0] * outward,
      (side === 'bottom' ? height : 0) + normal[1] * outward,
    ]
  }

  const ordered = reverse ? [...points].reverse() : points
  const coords = ordered.map(point)
  const [sx, sy] = coords[0]
  const [c1x, c1y] = coords[1]
  const [c2x, c2y] = coords[2]
  const [mx, my] = coords[3]
  const [d1x, d1y] = coords[4]
  const [d2x, d2y] = coords[5]
  const [ex, ey] = coords[6]

  return `L ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${mx} ${my} C ${d1x} ${d1y}, ${d2x} ${d2y}, ${ex} ${ey}`
}

export function getPiecePath(piece, grid) {
  const { width, height, row, column } = piece
  const index = row * grid.columns + column
  const top = row === 0 ? null : getEdgeStyle('h', column, row)
  const bottom = index + grid.columns >= grid.count ? null : getEdgeStyle('h', column, row + 1)
  const left = column === 0 ? null : getEdgeStyle('v', column, row)
  const right = column === grid.columns - 1 || index + 1 >= grid.count ? null : getEdgeStyle('v', column + 1, row)

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
    trayGap: Math.max(80, cellSize * 2.5),
  }
  const trayColumns = Math.max(1, Math.ceil(Math.sqrt(count * clamp(imageAspect, 0.55, 2.4))))
  const pieces = new Array(count)
  const batchSize = count > 1000 ? 180 : 500

  for (let index = 0; index < count; index += 1) {
    if (signal?.aborted) throw new DOMException('Puzzle generation cancelled.', 'AbortError')

    const row = Math.floor(index / columns)
    const column = index % columns
    const trayRow = Math.floor(index / trayColumns)
    const trayColumn = index % trayColumns
    const seed = hash32(`${row}:${column}`)
    const jitter = (seed % 17) - 8
    const x = grid.width + grid.trayGap + trayColumn * cellSize + jitter
    const y = trayRow * cellSize + ((seed >>> 8) % 17) - 8

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
      style: seed % STYLE_NAMES.length,
      styleName: STYLE_NAMES[seed % STYLE_NAMES.length],
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
