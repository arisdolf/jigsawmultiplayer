import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCw } from 'lucide-react'
import { generatePuzzlePieces, getPiecePath, isCorrectPlacement } from '../utils/puzzleEngine'
import { SpatialIndex } from '../utils/spatialIndex'
import '../css/components/PuzzleBoard.css'

const ZOOM_MIN = 0.18
const ZOOM_MAX = 2.5
const PATH_CACHE_LIMIT = 600
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function normalizeImageRotation(value) {
  const rotation = Number(value)
  return [0, 90, 180, 270].includes(rotation) ? rotation : 0
}

function makeBoardImage(source, grid, rotation = 0) {
  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const context = canvas.getContext('2d', { alpha: false })
  const quarterTurn = rotation % 180 !== 0
  const orientedWidth = quarterTurn ? source.naturalHeight : source.naturalWidth
  const orientedHeight = quarterTurn ? source.naturalWidth : source.naturalHeight
  const ratio = Math.max(grid.width / orientedWidth, grid.height / orientedHeight)
  const width = source.naturalWidth * ratio
  const height = source.naturalHeight * ratio
  context.save()
  context.translate(grid.width / 2, grid.height / 2)
  context.rotate((rotation * Math.PI) / 180)
  context.drawImage(source, -width / 2, -height / 2, width, height)
  context.restore()
  return canvas
}

function screenToWorld(point, view) {
  return { x: (point.x - view.panX) / view.scale, y: (point.y - view.panY) / view.scale }
}

export default function PuzzleBoard({
  level,
  roomControl,
  user,
  isHost,
  players = [],
  resetToken = 0,
  disabled = false,
  referenceVisible,
  trayOpen = false,
  onTrayToggle,
  onGenerated,
  onReadyChange,
  onSound,
}) {
  const canvasRef = useRef(null)
  const trayCanvasRef = useRef(null)
  const containerRef = useRef(null)
  const workerRef = useRef(null)
  const gridRef = useRef(null)
  const boardImageRef = useRef(null)
  const piecesRef = useRef(new Map())
  const pathCacheRef = useRef(new Map())
  const indexRef = useRef(null)
  const viewRef = useRef({ scale: 1, panX: 0, panY: 0 })
  const roomStatusRef = useRef(level.roomStatus)
  roomStatusRef.current = level.roomStatus
  const dragRef = useRef(null)
  const pointerPointsRef = useRef(new Map())
  const pinchRef = useRef(null)
  const lastTapRef = useRef(null)
  const fitZoomRef = useRef(1)
  const pendingPointerRef = useRef(null)
  const selectedPieceRef = useRef(null)
  const trayPagePiecesRef = useRef([])
  const trayPageCountRef = useRef(1)
  const traySwipeStartRef = useRef(null)
  const trayDrawRef = useRef(null)
  const lastWriteRef = useRef({ at: 0, pending: null })
  const drawRef = useRef(null)
  const [generation, setGeneration] = useState({ progress: 0, ready: false, error: '' })
  const [zoom, setZoom] = useState(1)
  const [trayPage, setTrayPage] = useState(0)
  const [trayPages, setTrayPages] = useState(1)

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = async () => {
      if (cancelled) return
      const imageRotation = normalizeImageRotation(level.imageRotation)
      const imageAspect = imageRotation % 180
        ? image.naturalHeight / image.naturalWidth
        : image.naturalWidth / image.naturalHeight
      setGeneration({ progress: 0, ready: false, error: '' })
      onReadyChange(false)
      try {
        let generated
        if (typeof Worker === 'function') {
          generated = await new Promise((resolve, reject) => {
            const worker = new Worker(new URL('../workers/puzzleWorker.js', import.meta.url), { type: 'module' })
            workerRef.current = worker
            worker.onmessage = ({ data }) => {
              if (data.type === 'progress') {
                if (!cancelled) setGeneration((current) => ({ ...current, progress: data.progress }))
              } else if (data.type === 'ready') {
                worker.terminate()
                if (workerRef.current === worker) workerRef.current = null
                resolve(data)
              } else if (data.type === 'error') {
                worker.terminate()
                if (workerRef.current === worker) workerRef.current = null
                reject(new Error(data.message))
              }
            }
            worker.onerror = (error) => {
              worker.terminate()
              if (workerRef.current === worker) workerRef.current = null
              reject(error)
            }
            worker.postMessage({ pieceCount: level.pieceCount, imageAspect })
          })
        } else {
          generated = await generatePuzzlePieces({
            pieceCount: level.pieceCount,
            imageAspect,
            onProgress: (progress) => !cancelled && setGeneration((current) => ({ ...current, progress })),
          })
        }
        const { grid, pieces } = generated
        if (cancelled) return

        const imageCanvas = makeBoardImage(image, grid, imageRotation)
        const roomPieces = roomControl.piecesRef.current
        const pieceMap = new Map()
        pieces.forEach((piece) => {
          const remote = roomPieces[piece.id]
          const { pathData, ...pieceData } = piece
          const fullPiece = {
            ...pieceData,
            ...remote,
            id: piece.id,
            row: piece.row,
            column: piece.column,
            width: piece.width,
            height: piece.height,
            targetX: piece.targetX,
            targetY: piece.targetY,
            pathData,
            stackOrder: piece.row * grid.columns + piece.column,
          }
          pieceMap.set(piece.id, fullPiece)
        })

        gridRef.current = grid
        boardImageRef.current = imageCanvas
        piecesRef.current = pieceMap
        pathCacheRef.current.clear()
        indexRef.current = new SpatialIndex(grid.cellSize)
        pieceMap.forEach((piece) => indexRef.current.insert(piece))
        onGenerated?.(grid, pieces.length)
        setGeneration({ progress: 1, ready: true, error: '' })
        onReadyChange(true)
        drawRef.current?.()

        const isEmpty = Object.keys(roomPieces).length === 0
        if (isHost && ((roomStatusRef.current === 'playing' && isEmpty) || resetToken > 0)) {
          const seedPieces = pieces.map((piece) => {
            const seed = { ...piece }
            delete seed.pathData
            return seed
          })
          await roomControl.prepare(seedPieces)
        }
      } catch (error) {
        if (error.name !== 'AbortError' && !cancelled) {
          setGeneration({ progress: 0, ready: false, error: error.message || 'Could not prepare this puzzle.' })
          onReadyChange(false)
        }
      }
    }
    image.onerror = () => !cancelled && setGeneration({ progress: 0, ready: false, error: 'Puzzle image could not load.' })
    image.src = level.imageURL

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [level.id, level.imageURL, level.imageRotation, level.pieceCount, resetToken, isHost, roomControl.prepare, roomControl.piecesRef, onGenerated, onReadyChange])

  useEffect(() => roomControl.subscribePieces((event) => {
    if (event.type === 'reset') {
      if (!gridRef.current || !Object.keys(event.pieces).length) return
      const next = new Map(piecesRef.current)
      Object.entries(event.pieces).forEach(([id, remote]) => {
        const local = next.get(id)
        if (local) next.set(id, { ...local, ...remote, id })
      })
      piecesRef.current = next
      indexRef.current = new SpatialIndex(gridRef.current.cellSize)
      next.forEach((piece) => indexRef.current.insert(piece))
      drawRef.current?.()
      trayDrawRef.current?.()
      return
    }
    const local = piecesRef.current.get(event.piece.id)
    if (!local) return
    const dragPiece = dragRef.current?.kind === 'piece' && dragRef.current.piece.id === event.piece.id
      ? dragRef.current.piece
      : null
    const pendingPiece = pendingPointerRef.current?.piece.id === event.piece.id ? pendingPointerRef.current.piece : null
    const preserveLocalPosition = event.piece.movingBy === user.uid && !event.piece.placed && (dragPiece || pendingPiece)
    const grid = gridRef.current
    const wasInTray = Boolean(grid && !local.placed && !local.movingBy && local.x > grid.width)
    const x = local.x
    const y = local.y
    Object.assign(local, event.piece)
    if (preserveLocalPosition) { local.x = x; local.y = y }
    indexRef.current?.update(local)
    drawRef.current?.()
    const isInTray = Boolean(grid && !local.placed && !local.movingBy && local.x > grid.width)
    if (wasInTray !== isInTray) trayDrawRef.current?.()
  }), [roomControl.subscribePieces, user?.uid])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return undefined

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const grid = gridRef.current
      if (grid) {
        const mobile = window.matchMedia('(max-width: 760px)').matches
        const fit = Math.min(
          (rect.width - 44) / (mobile ? grid.width : grid.width + grid.trayGap + grid.cellSize * 5),
          (rect.height - 50) / (mobile ? grid.height : Math.max(grid.height, grid.cellSize * 6)),
        )
        fitZoomRef.current = clamp(fit, ZOOM_MIN, 1.15)
        viewRef.current.scale = fitZoomRef.current
        viewRef.current.panX = Math.max(18, (rect.width - grid.width * viewRef.current.scale) / 2)
        viewRef.current.panY = 38
        setZoom(viewRef.current.scale)
      }
      trayDrawRef.current?.()
      drawRef.current?.()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => observer.disconnect()
  }, [generation.ready])

  useEffect(() => { trayDrawRef.current?.() }, [trayOpen, trayPage])

  trayDrawRef.current = () => {
    const canvas = trayCanvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid || !trayOpen) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const context = canvas.getContext('2d')
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)
    context.fillStyle = '#f3eee5'
    context.fillRect(0, 0, rect.width, rect.height)

    const loose = [...piecesRef.current.values()]
      .filter((piece) => !piece.placed && !piece.movingBy && piece.x > grid.width)
      .sort((a, b) => a.stackOrder - b.stackOrder)
    const slots = Math.max(1, Math.floor((rect.width - 16) / 72))
    const pageCount = Math.max(1, Math.ceil(loose.length / slots))
    const page = Math.min(trayPage, pageCount - 1)
    if (pageCount !== trayPageCountRef.current) setTrayPages(pageCount)
    trayPageCountRef.current = pageCount
    if (page !== trayPage) setTrayPage(page)
    trayPagePiecesRef.current = loose.slice(page * slots, (page + 1) * slots)
    const gap = slots > 1 ? (rect.width - 16 - slots * 64) / (slots - 1) : 0
    const top = (rect.height - 64) / 2

    trayPagePiecesRef.current.forEach((piece, index) => {
      const left = 8 + index * (64 + gap)
      context.fillStyle = '#fafcff'
      context.strokeStyle = 'rgba(82, 127, 168, 0.2)'
      context.lineWidth = 1
      context.beginPath()
      context.roundRect(left, top, 64, 64, 12)
      context.fill()
      context.stroke()

      const scale = Math.min(46 / piece.width, 46 / piece.height)
      const margin = piece.width * 0.42
      context.save()
      context.translate(left + 32, top + 32)
      context.scale(scale, scale)
      context.translate(-piece.width / 2, -piece.height / 2)
      const path = piecePath(piece)
      context.beginPath()
      context.clip(path)
      if (boardImageRef.current) {
        const sourceSize = piece.width + margin * 2
        context.drawImage(boardImageRef.current, piece.targetX - margin, piece.targetY - margin, sourceSize, sourceSize, -margin, -margin, sourceSize, sourceSize)
      } else {
        context.fillStyle = '#527fa8'
        context.fillRect(-margin, -margin, piece.width + margin * 2, piece.height + margin * 2)
      }
      context.restore()

      context.save()
      context.translate(left + 32, top + 32)
      context.scale(scale, scale)
      context.translate(-piece.width / 2, -piece.height / 2)
      context.beginPath()
      context.lineWidth = 1.5 / scale
      context.strokeStyle = 'rgba(41, 76, 112, 0.62)'
      context.stroke(path)
      context.restore()
    })
  }

  drawRef.current = () => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    const image = boardImageRef.current
    const index = indexRef.current
    if (!canvas || !grid || !index) return

    const context = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    const view = viewRef.current
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#e5edf2'
    context.fillRect(0, 0, width, height)
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.panX, dpr * view.panY)

    const boardRadius = Math.min(22, grid.cellSize * 0.2)
    context.save()
    context.shadowColor = 'rgba(41, 76, 112, 0.14)'
    context.shadowBlur = 24
    context.shadowOffsetY = 10
    context.fillStyle = '#fafcff'
    context.beginPath()
    context.roundRect(0, 0, grid.width, grid.height, boardRadius)
    context.fill()
    context.restore()

    context.save()
    context.fillStyle = '#f3eee5'
    context.strokeStyle = 'rgba(82, 127, 168, 0.18)'
    context.lineWidth = 1
    context.beginPath()
    context.roundRect(grid.width + grid.trayGap - 22, -12, Math.ceil(Math.sqrt(grid.count * 1.5)) * grid.cellSize + 44, Math.max(grid.height, grid.cellSize * 6) + 24, boardRadius)
    context.fill()
    context.stroke()
    context.restore()

    if (referenceVisible && image) {
      context.save()
      context.globalAlpha = 0.16
      context.beginPath()
      context.roundRect(0, 0, grid.width, grid.height, boardRadius)
      context.clip()
      context.drawImage(image, 0, 0, grid.width, grid.height)
      context.restore()
    }

    const margin = grid.cellSize * 0.42
    const visible = {
      x: (0 - view.panX) / view.scale,
      y: (0 - view.panY) / view.scale,
      width: width / view.scale,
      height: height / view.scale,
    }
    const pieces = index.query(visible, margin).sort((a, b) => a.stackOrder - b.stackOrder)

    pieces.forEach((piece) => {
      const path = piecePath(piece)
      context.save()
      context.translate(piece.x + piece.width / 2, piece.y + piece.height / 2)
      context.rotate(((piece.rotation || 0) * Math.PI) / 180)
      context.translate(-piece.width / 2, -piece.height / 2)
      context.beginPath()
      context.clip(path)
      if (image) {
        const sourceX = piece.targetX - margin
        const sourceY = piece.targetY - margin
        const sourceSize = piece.width + margin * 2
        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, -margin, -margin, sourceSize, sourceSize)
      } else {
        context.fillStyle = '#527fa8'
        context.fillRect(-margin, -margin, piece.width + margin * 2, piece.height + margin * 2)
      }
      context.restore()

      context.save()
      context.translate(piece.x + piece.width / 2, piece.y + piece.height / 2)
      context.rotate(((piece.rotation || 0) * Math.PI) / 180)
      context.translate(-piece.width / 2, -piece.height / 2)
      const selected = piece === selectedPieceRef.current
      const active = selected || piece === dragRef.current?.piece
      context.lineWidth = active ? 2.2 / view.scale : 1.15 / view.scale
      context.strokeStyle = piece.placed ? 'rgba(250, 252, 255, 0.92)' : selected ? 'rgba(217, 104, 104, 0.9)' : 'rgba(41, 76, 112, 0.48)'
      context.shadowColor = active ? 'rgba(41, 76, 112, 0.36)' : 'rgba(41, 76, 112, 0.16)'
      context.shadowBlur = (active ? 18 : 5) / view.scale
      context.shadowOffsetY = 2 / view.scale
      context.stroke(path)
      context.restore()

      if (piece.movingBy && piece.width * view.scale > 46) {
        const playerName = players.find((player) => player.uid === piece.movingBy)?.displayName || 'Puzzle Pal'
        context.save()
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.font = '600 11px "DM Sans", sans-serif'
        const labelWidth = context.measureText(playerName).width + 18
        context.fillStyle = '#294c70'
        context.beginPath()
        context.roundRect(view.panX + piece.x * view.scale, view.panY + piece.y * view.scale - 23, labelWidth, 19, 8)
        context.fill()
        context.fillStyle = '#ffffff'
        context.fillText(playerName, view.panX + piece.x * view.scale + 9, view.panY + piece.y * view.scale - 10)
        context.restore()
      }
    })
  }

  function pointFromEvent(event) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function piecePath(piece) {
    const cache = pathCacheRef.current
    const cached = cache.get(piece.id)
    if (cached) {
      cache.delete(piece.id)
      cache.set(piece.id, cached)
      return cached
    }
    const path = new Path2D(piece.pathData || getPiecePath(piece, gridRef.current))
    cache.set(piece.id, path)
    if (cache.size > PATH_CACHE_LIMIT) cache.delete(cache.keys().next().value)
    return path
  }

  function hitPiece(point) {
    const view = viewRef.current
    const world = screenToWorld(point, view)
    const grid = gridRef.current
    const nearby = indexRef.current?.query({ x: world.x, y: world.y, width: 1, height: 1 }, grid.cellSize * 0.8) || []
    const hitContext = canvasRef.current.getContext('2d')
    return nearby
      .filter((piece) => !piece.placed)
      .sort((a, b) => b.stackOrder - a.stackOrder)
      .find((piece) => {
        const dx = world.x - piece.x - piece.width / 2
        const dy = world.y - piece.y - piece.height / 2
        const angle = -((piece.rotation || 0) * Math.PI) / 180
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + piece.width / 2
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + piece.height / 2
        return hitContext.isPointInPath(piecePath(piece), localX, localY)
      })
  }

  async function handlePointerDown(event) {
    if (!generation.ready || disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    const fromTray = event.currentTarget === trayCanvasRef.current
    if (event.pointerType === 'touch') {
      const pointers = pointerPointsRef.current
      pointers.set(event.pointerId, point)
      if (pointers.size >= 2) {
        if (dragRef.current?.kind === 'pan' && !pendingPointerRef.current) {
          const pair = [...pointers.entries()].slice(-2)
          const first = pair[0][1]
          const second = pair[1][1]
          const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
          pinchRef.current = {
            pointerIds: pair.map(([id]) => id),
            startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
            startScale: viewRef.current.scale,
            worldAnchor: screenToWorld(center, viewRef.current),
          }
          dragRef.current = null
          drawRef.current?.()
        }
        return
      }
    }
    let piece = null
    if (event.button === 0 && fromTray) {
      const rect = event.currentTarget.getBoundingClientRect()
      const slots = Math.max(1, Math.floor((rect.width - 16) / 72))
      const gap = slots > 1 ? (rect.width - 16 - slots * 64) / (slots - 1) : 0
      const x = event.clientX - rect.left - 8
      const y = event.clientY - rect.top - (rect.height - 64) / 2
      const slot = Math.floor(x / (64 + gap))
      if (x >= 0 && x <= rect.width - 16 && y >= 0 && y <= 64) piece = trayPagePiecesRef.current[slot] || null
    } else if (event.button === 0) {
      piece = hitPiece(point)
    }
    if (fromTray && !piece) {
      if (event.pointerType === 'touch') traySwipeStartRef.current = { pointerId: event.pointerId, x: event.clientX }
      return
    }
    if (piece) {
      event.preventDefault()
      const pending = { pointerId: event.pointerId, point, piece, released: false, fromTray }
      pendingPointerRef.current = pending
      const locked = await roomControl.acquirePiece(piece)
      if (!locked) {
        if (pendingPointerRef.current === pending) pendingPointerRef.current = null
        return
      }
      if (pending.released || pendingPointerRef.current !== pending) {
        await roomControl.release(piece.id, { x: piece.x, y: piece.y, placed: false, rotation: piece.rotation || 0 })
        return
      }
      pendingPointerRef.current = null
      const world = screenToWorld(point, viewRef.current)
      if (fromTray) {
        piece.x = world.x - piece.width / 2
        piece.y = world.y - piece.height / 2
        indexRef.current.update(piece)
        trayDrawRef.current?.()
      }
      piece.stackOrder = Date.now()
      dragRef.current = {
        kind: 'piece',
        piece,
        pointerId: event.pointerId,
        startX: world.x,
        startY: world.y,
        originalX: piece.x,
        originalY: piece.y,
        changed: false,
      }
      selectedPieceRef.current = piece
      onSound('pickup')
      drawRef.current?.()
      return
    }

    dragRef.current = { kind: 'pan', pointerId: event.pointerId, startX: point.x, startY: point.y, panX: viewRef.current.panX, panY: viewRef.current.panY, moved: false }
  }

  function handlePointerMove(event) {
    if (disabled) return
    const pointers = pointerPointsRef.current
    if (event.pointerType === 'touch' && pointers.has(event.pointerId)) pointers.set(event.pointerId, pointFromEvent(event))
    const traySwipe = traySwipeStartRef.current
    if (event.currentTarget === trayCanvasRef.current && traySwipe?.pointerId === event.pointerId) {
      const distance = event.clientX - traySwipe.x
      if (Math.abs(distance) > 26) {
        const direction = distance < 0 ? 1 : -1
        setTrayPage((page) => clamp(page + direction, 0, trayPageCountRef.current - 1))
        traySwipeStartRef.current = { pointerId: event.pointerId, x: event.clientX }
      }
      event.preventDefault()
      return
    }
    const pinch = pinchRef.current
    if (pinch?.pointerIds.includes(event.pointerId)) {
      const first = pointers.get(pinch.pointerIds[0])
      const second = pointers.get(pinch.pointerIds[1])
      if (!first || !second) return
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const scale = clamp(pinch.startScale * distance / pinch.startDistance, ZOOM_MIN, ZOOM_MAX)
      viewRef.current.scale = scale
      viewRef.current.panX = center.x - pinch.worldAnchor.x * scale
      viewRef.current.panY = center.y - pinch.worldAnchor.y * scale
      drawRef.current?.()
      event.preventDefault()
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointFromEvent(event)
    if (drag.kind === 'pan') {
      if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3) drag.moved = true
      viewRef.current.panX = drag.panX + point.x - drag.startX
      viewRef.current.panY = drag.panY + point.y - drag.startY
      drawRef.current?.()
      return
    }

    const world = screenToWorld(point, viewRef.current)
    const piece = drag.piece
    piece.x = drag.originalX + world.x - drag.startX
    piece.y = drag.originalY + world.y - drag.startY
    drag.changed = true
    indexRef.current.update(piece)
    drawRef.current?.()

    const now = Date.now()
    if (now - lastWriteRef.current.at > 120 && !lastWriteRef.current.pending) {
      lastWriteRef.current.at = now
      lastWriteRef.current.pending = roomControl.move(piece.id, piece.x, piece.y, user)
        .catch(() => {})
        .finally(() => { lastWriteRef.current.pending = null })
      onSound('move')
    }
  }

  async function handlePointerUp(event) {
    const pointers = pointerPointsRef.current
    if (traySwipeStartRef.current?.pointerId === event.pointerId) traySwipeStartRef.current = null
    if (event.pointerType === 'touch') pointers.delete(event.pointerId)
    const pinch = pinchRef.current
    if (pinch?.pointerIds.includes(event.pointerId)) {
      pinchRef.current = null
      setZoom(viewRef.current.scale)
      const remaining = [...pointers.entries()]
      if (remaining.length === 1) {
        const [pointerId, point] = remaining[0]
        dragRef.current = { kind: 'pan', pointerId, startX: point.x, startY: point.y, panX: viewRef.current.panX, panY: viewRef.current.panY, moved: true }
      } else {
        dragRef.current = null
      }
      drawRef.current?.()
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      const pending = pendingPointerRef.current
      if (pending?.pointerId === event.pointerId) {
        pending.released = true
        pendingPointerRef.current = null
      }
      return
    }
    if (drag.kind === 'pan') {
      dragRef.current = null
      drawRef.current?.()
      if (event.pointerType === 'touch' && !drag.moved) {
        const point = pointFromEvent(event)
        const now = Date.now()
        const previous = lastTapRef.current
        if (previous && now - previous.at < 320 && Math.hypot(point.x - previous.x, point.y - previous.y) < 28) {
          const nextScale = viewRef.current.scale > fitZoomRef.current * 1.65
            ? fitZoomRef.current
            : Math.min(ZOOM_MAX, viewRef.current.scale * 1.85)
          lastTapRef.current = null
          changeZoom(nextScale, point)
        } else {
          lastTapRef.current = { ...point, at: now }
        }
      }
      return
    }

    const piece = drag.piece
    const withinBoard = piece.x >= 0 && piece.y >= 0 && piece.x <= gridRef.current.width && piece.y <= gridRef.current.height
    const correct = (piece.rotation || 0) % 360 === 0 && isCorrectPlacement(piece, piece.x, piece.y, viewRef.current.scale)
    if (correct) {
      piece.x = piece.targetX
      piece.y = piece.targetY
      piece.placed = true
      piece.placedBy = user.uid
      onSound('correct')
    } else if (withinBoard) {
      onSound('incorrect')
    }

    indexRef.current.update(piece)
    drawRef.current?.()
    dragRef.current = null
    const queued = lastWriteRef.current.pending
    if (queued) await queued
    await roomControl.release(piece.id, { x: piece.x, y: piece.y, placed: correct, rotation: piece.rotation || 0 })
    drawRef.current?.()
    trayDrawRef.current?.()
  }

  async function rotateSelected() {
    const piece = selectedPieceRef.current
    if (!level.allowRotation || !piece || piece.placed) return
    const locked = await roomControl.acquirePiece(piece)
    if (!locked) return
    piece.rotation = ((piece.rotation || 0) + 90) % 360
    indexRef.current.update(piece)
    drawRef.current?.()
    await roomControl.release(piece.id, { x: piece.x, y: piece.y, placed: false, rotation: piece.rotation })
    drawRef.current?.()
  }

  async function handleKeyboard(event) {
    if (disabled) return
    const piece = selectedPieceRef.current
    if (event.key === ' ' && !piece) {
      event.preventDefault()
      const nextPiece = [...piecesRef.current.values()].find((candidate) => !candidate.placed)
      if (nextPiece && await roomControl.acquirePiece(nextPiece)) {
        selectedPieceRef.current = nextPiece
        nextPiece.stackOrder = Date.now()
        drawRef.current?.()
      }
      return
    }
    if (event.key.toLowerCase() === 'r' && level.allowRotation && piece) {
      event.preventDefault()
      await rotateSelected()
      return
    }
    if (piece && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      const step = 12 / viewRef.current.scale
      if (event.key === 'ArrowUp') piece.y -= step
      if (event.key === 'ArrowDown') piece.y += step
      if (event.key === 'ArrowLeft') piece.x -= step
      if (event.key === 'ArrowRight') piece.x += step
      indexRef.current.update(piece)
      drawRef.current?.()
      void roomControl.move(piece.id, piece.x, piece.y)
      return
    }
    if (event.key === 'Enter' && piece) {
      event.preventDefault()
      const correct = (piece.rotation || 0) % 360 === 0 && isCorrectPlacement(piece, piece.x, piece.y, viewRef.current.scale)
      if (correct) {
        piece.x = piece.targetX
        piece.y = piece.targetY
        piece.placed = true
        piece.placedBy = user.uid
        onSound('correct')
      } else if (piece.x >= 0 && piece.y >= 0 && piece.x <= gridRef.current.width && piece.y <= gridRef.current.height) {
        onSound('incorrect')
      }
      await roomControl.release(piece.id, { x: piece.x, y: piece.y, placed: correct, rotation: piece.rotation || 0 })
      selectedPieceRef.current = null
      drawRef.current?.()
      return
    }
    if (event.key === 'Escape' && piece) {
      event.preventDefault()
      await roomControl.release(piece.id, { x: piece.x, y: piece.y, placed: false, rotation: piece.rotation || 0 })
      selectedPieceRef.current = null
      drawRef.current?.()
    }
  }

  function changeZoom(nextZoom, anchor) {
    const canvas = canvasRef.current
    if (!canvas) return
    const view = viewRef.current
    const nextScale = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX)
    const center = anchor || { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
    const world = screenToWorld(center, view)
    view.panX = center.x - world.x * nextScale
    view.panY = center.y - world.y * nextScale
    view.scale = nextScale
    setZoom(nextScale)
    drawRef.current?.()
  }

  function resetView() {
    const grid = gridRef.current
    const canvas = canvasRef.current
    if (!grid || !canvas) return
    const mobile = window.matchMedia('(max-width: 760px)').matches
    const fit = Math.min(
      (canvas.clientWidth - 44) / (mobile ? grid.width : grid.width + grid.trayGap + grid.cellSize * 5),
      (canvas.clientHeight - 50) / (mobile ? grid.height : Math.max(grid.height, grid.cellSize * 6)),
    )
    fitZoomRef.current = clamp(fit, ZOOM_MIN, 1.15)
    viewRef.current = {
      scale: fitZoomRef.current,
      panX: Math.max(18, (canvas.clientWidth - grid.width * fitZoomRef.current) / 2),
      panY: 38,
    }
    setZoom(viewRef.current.scale)
    drawRef.current?.()
  }

  function handleWheel(event) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 20) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.1 : 0.91
    changeZoom(viewRef.current.scale * factor, pointFromEvent(event))
  }

  return (
    <div ref={containerRef} className="puzzle-canvas-shell" aria-label={`${level.title} puzzle workspace`}>
      {!generation.ready && (
        <div className="board-loading" role="status" aria-live="polite">
          <div className="loading-piece" aria-hidden="true" />
          <strong>{generation.error ? 'Puzzle unavailable' : 'Setting the table'}</strong>
          <span>{generation.error || `Preparing ${level.pieceCount.toLocaleString()} pieces · ${Math.round(generation.progress * 100)}%`}</span>
          {!generation.error && <div className="loading-track"><i style={{ width: `${generation.progress * 100}%` }} /></div>}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`puzzle-canvas ${generation.ready ? 'is-ready' : ''}`}
        role="application"
        tabIndex={0}
        aria-label="Jigsaw puzzle board. Drag pieces to move them. Use the zoom controls to change the view."
        aria-describedby="puzzle-keyboard-help"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyboard}
      />
      <p id="puzzle-keyboard-help" className="sr-only">Press Space to select the next loose piece. Use arrow keys to move it, Enter to place it, and Escape to release it. Press R to rotate a piece when rotation is enabled.</p>
      <div className="canvas-zoom-controls" aria-label="Puzzle view controls">
        <button type="button" aria-label="Zoom out" onClick={() => changeZoom(viewRef.current.scale / 1.18)}>−</button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => changeZoom(viewRef.current.scale * 1.18)}>+</button>
        <button type="button" aria-label="Reset view" onClick={resetView}>Reset</button>
        {level.allowRotation && <button type="button" aria-label="Rotate selected piece" onClick={rotateSelected}><RotateCw size={15} /> Rotate</button>}
      </div>
      <section className={`puzzle-piece-tray ${trayOpen ? 'is-open' : ''}`} aria-label="Unplaced puzzle pieces">
        <header className="puzzle-tray-heading"><strong>Piece tray</strong><span>Drag a piece onto the board</span><button type="button" aria-label={trayOpen ? 'Collapse piece tray' : 'Expand piece tray'} aria-expanded={trayOpen} onClick={() => onTrayToggle?.(!trayOpen)}>{trayOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button></header>
        {trayOpen && <div className="puzzle-tray-content"><button type="button" aria-label="Previous pieces" disabled={trayPage === 0} onClick={() => setTrayPage((page) => Math.max(0, page - 1))}><ChevronLeft size={20} /></button><canvas ref={trayCanvasRef} className="puzzle-tray-canvas" role="application" tabIndex={0} aria-label="Drag a loose piece to the puzzle board" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} /><span className="puzzle-tray-page" aria-live="polite">{trayPage + 1}/{trayPages}</span><button type="button" aria-label="More pieces" disabled={trayPage >= trayPages - 1} onClick={() => setTrayPage((page) => Math.min(trayPages - 1, page + 1))}><ChevronRight size={20} /></button></div>}
      </section>
    </div>
  )
}
