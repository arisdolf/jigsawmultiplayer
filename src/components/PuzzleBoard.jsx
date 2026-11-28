import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { generatePuzzlePieces, getPiecePath, isCorrectPlacement } from '../utils/puzzleEngine'
import { SpatialIndex } from '../utils/spatialIndex'
import '../css/components/PuzzleBoard.css'

const ZOOM_MIN = 0.02
const ZOOM_MAX = 2.5
const PATH_CACHE_LIMIT = 600
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const TAP_SLOP = 6
const FADE_MS = 1800 // outlines fade from the centre out to the edges
const ZOOM_MS = 1700 // board zooms in to fill the view
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const LIFT_MS = 40  // pick-up lift
const POP_MS = 150    // connect / correct pop
const SETTLE_MS = 80 // drop settle
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

// lower pixel ratio on phones = far fewer pixels to paint every frame
function getDpr(count = 0) {
  let dpr = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2)
  if (count > 300) dpr *= 0.75
  return Math.max(0.75, dpr)
}

function normalizeImageRotation(value) {
  const rotation = Number(value)
  return [0, 90, 180, 270].includes(rotation) ? rotation : 0
}

function makeBoardImage(source, grid, rotation = 0) {
  const quarterTurn = rotation % 180 !== 0
  const orientedWidth = quarterTurn ? source.naturalHeight : source.naturalWidth
  const orientedHeight = quarterTurn ? source.naturalWidth : source.naturalHeight
  const ratio = Math.max(grid.width / orientedWidth, grid.height / orientedHeight)
  // keep the photo's real detail (up to a safe canvas size) instead of the small grid size
  const maxSide = IS_TOUCH ? 3072 : 4096
  const quality = clamp(Math.min(1 / ratio, maxSide / Math.max(grid.width, grid.height)), 1, 4)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(grid.width * quality)
  canvas.height = Math.round(grid.height * quality)
  const context = canvas.getContext('2d', { alpha: false })
  context.imageSmoothingQuality = 'high'
  const width = source.naturalWidth * ratio * quality
  const height = source.naturalHeight * ratio * quality
  context.save()
  context.translate(canvas.width / 2, canvas.height / 2)
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
  referenceOpacity = 0.16,
  onGenerated,
  onReadyChange,
  onSound,
  celebrate = false,
  onCelebrationEnd,
  fullscreen = false,
}) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const workerRef = useRef(null)
  const gridRef = useRef(null)
  const boardImageRef = useRef(null)
  const settlingRef = useRef(new Set())
  const piecesRef = useRef(new Map())
  const pathCacheRef = useRef(new Map())
  const groupsRef = useRef(new Map())
  const indexRef = useRef(null)
  const fittedRef = useRef(false)
  const landscapeRef = useRef(null)
  const viewRef = useRef({ scale: 1, panX: 0, panY: 0 })
  const roomStatusRef = useRef(level.roomStatus)
  roomStatusRef.current = level.roomStatus
  const dragRef = useRef(null)
  const pointerPointsRef = useRef(new Map())
  const pinchRef = useRef(null)
  const seedRef = useRef(null)
  const seededRef = useRef(false)
  const lastTapRef = useRef(null)
  const celebrationRef = useRef(null)
  const spritesRef = useRef(new Map())
  const sceneRef = useRef({ canvas: null, dirty: true, excluded: new Set() })
  const spriteInfoRef = useRef({ margin: 0, scale: 1, layerScale: 1 })
  const placedLayerRef = useRef(null)
  const paintedRef = useRef(new Set())
  const flashingRef = useRef(new Set())
  const renderRef = useRef(null)
  const frameRef = useRef(0)
  const [rising, setRising] = useState(false)
  const fitZoomRef = useRef(1)
  const rafRef = useRef(0)
  const selectedPieceRef = useRef(null)
  const lastWriteRef = useRef({ at: 0, pending: null })
  const hitContextRef = useRef(null)
  const drawRef = useRef(null)
  const [generation, setGeneration] = useState({ progress: 0, ready: false, error: '' })
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (!celebrate || !generation.ready) { setRising(false); return undefined }
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid) return undefined
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const scale = Math.min((width - 40) / grid.width, (height - 40) / grid.height)
    celebrationRef.current = {
      start: Date.now(),
      from: { ...viewRef.current },
      to: { scale, panX: (width - grid.width * scale) / 2, panY: (height - grid.height * scale) / 2 },
    }
    setRising(false)
    drawRef.current?.()
    const rise = window.setTimeout(() => setRising(true), FADE_MS + ZOOM_MS + 150)
    const done = window.setTimeout(() => {
      setZoom(viewRef.current.scale)
      onCelebrationEnd?.()
    }, FADE_MS + ZOOM_MS + 600)
    return () => {
      window.clearTimeout(rise)
      window.clearTimeout(done)
      celebrationRef.current = null
    }
  }, [celebrate, generation.ready])

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
            worker.postMessage({ pieceCount: level.pieceCount, imageAspect, seed: level.id, shuffleRotation: Boolean(level.allowRotation) })
          })
        } else {
          generated = await generatePuzzlePieces({
            pieceCount: level.pieceCount,
            imageAspect,
            seed: level.id,
            shuffleRotation: Boolean(level.allowRotation),
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
          pieceMap.set(piece.id, {
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
            stackOrder: piece.stackOrder ?? piece.row * grid.columns + piece.column,
            group: remote?.group || piece.id,
          })
        })
        fittedRef.current = false
        gridRef.current = grid
        boardImageRef.current = imageCanvas
        piecesRef.current = pieceMap
        rebuildGroups()

        // sprites: sized so the biggest stays under ~190px
        const margin = grid.cellSize * 0.42
        const side = grid.cellSize + margin * 2
        const budget = IS_TOUCH ? 14e6 : 40e6 // total sprite pixels, keeps memory safe on big puzzles
        const density = imageCanvas.width / grid.width
        const scale = clamp(Math.sqrt(budget / pieceMap.size) / side, 0.5, Math.min(3, density))
        const layerScale = Math.min(scale, IS_TOUCH ? 2 : 3, (IS_TOUCH ? 3072 : 4096) / Math.max(grid.width, grid.height))
        spriteInfoRef.current = { margin, scale, layerScale }
        spritesRef.current = new Map()
        placedLayerRef.current = null
        flashingRef.current = new Set()
        const all = [...pieceMap.values()]
        for (let i = 0; i < all.length; i += 40) {
          if (cancelled) return
          all.slice(i, i + 40).forEach((piece) => spritesRef.current.set(piece.id, buildSprite(piece, grid, imageCanvas)))
          await new Promise((resolve) => setTimeout(resolve, 0)) // keep the page responsive
        }
        if (cancelled) return
        rebuildPlacedLayer()
        markDirty()
        pathCacheRef.current.clear()
        indexRef.current = new SpatialIndex(grid.cellSize)
        pieceMap.forEach((piece) => indexRef.current.insert(piece))
        onGenerated?.(grid, pieces.length)
        setGeneration({ progress: 1, ready: true, error: '' })
        onReadyChange(true)
        drawRef.current?.()

        seedRef.current = pieces.map((piece) => {
          const { pathData, ...rest } = piece
          return rest
        })
        seededRef.current = false
        if (isHost && resetToken > 0) {
          seededRef.current = true
          await roomControl.prepare(seedRef.current)
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

  useEffect(() => {
    if (!generation.ready || !isHost || level.roomStatus !== 'playing') return
    if (!seedRef.current || seededRef.current) return
    const remoteCount = Object.keys(roomControl.piecesRef.current).length
    if (remoteCount === seedRef.current.length) return // already seeded correctly
    seededRef.current = true
    roomControl.prepare(seedRef.current).catch((error) => {
      seededRef.current = false
      console.error('Could not seed puzzle pieces', error)
    })
  }, [generation.ready, isHost, level.roomStatus, level.id, roomControl.prepare, roomControl.piecesRef])

  useEffect(() => roomControl.subscribePieces((event) => {
    if (event.type === 'reset') {
      if (!gridRef.current || !Object.keys(event.pieces).length) return
      const next = new Map(piecesRef.current)
      Object.entries(event.pieces).forEach(([id, remote]) => {
        const local = next.get(id)
        if (local) next.set(id, { ...local, movingBy: null, placedBy: null, placedByName: null, ...remote, id, group: remote.group || id })
      })
      piecesRef.current = next
      rebuildGroups()
      indexRef.current = new SpatialIndex(gridRef.current.cellSize)
      next.forEach((piece) => indexRef.current.insert(piece))
      rebuildPlacedLayer()
      drawRef.current?.()
      return
    }
    const local = piecesRef.current.get(event.piece.id)
    if (!local) return
    const drag = dragRef.current
    const carried = drag?.kind === 'piece' && drag.members.some((member) => member.piece.id === event.piece.id)
    // our own drag echoing back from Firebase: nothing to do
    if (carried && event.piece.movingBy === user.uid && !event.piece.placed) return

    const wasPlaced = local.placed
    const before = local.group || local.id
    Object.assign(local, { movingBy: null, placedBy: null, placedByName: null }, event.piece)
    const after = local.group || local.id
    if (before !== after) { local.group = before; regroup(local, after) }
    if (!wasPlaced && local.placed) flash(local)
    syncPlaced(local)
    indexRef.current?.update(local)
    // someone else dragging a piece we already draw live: no rebuild needed
    if (!(sceneRef.current.excluded.has(local.id) && isLive(local))) markDirty()
    drawRef.current?.()
  }), [roomControl.subscribePieces, user?.uid])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  })

  // keep the lock alive while a piece is being carried but not moved
  useEffect(() => {
    const timer = window.setInterval(() => {
      const drag = dragRef.current
      if (drag?.kind === 'piece' && drag.locked) {
        roomControl.moveMany(
          drag.members.map((member) => ({ id: member.piece.id, x: member.piece.x, y: member.piece.y, rotation: member.piece.rotation || 0 })),
          { keepAlive: true },
        ).catch(() => { })
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [roomControl.moveMany])

  function fitView(width, height) {
    const grid = gridRef.current
    if (!grid) return
    const bounds = grid.bounds || { x: 0, y: 0, width: grid.width, height: grid.height }
    const scale = clamp(Math.min((width - 24) / bounds.width, (height - 24) / bounds.height), ZOOM_MIN, 1.15)
    fitZoomRef.current = scale
    viewRef.current = {
      scale,
      panX: (width - bounds.width * scale) / 2 - bounds.x * scale,
      panY: (height - bounds.height * scale) / 2 - bounds.y * scale,
    }
    setZoom(scale)
  }

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current)
    cancelAnimationFrame(rafRef.current)
    frameRef.current = 0
    rafRef.current = 0
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return undefined

    const resize = () => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = getDpr(gridRef.current?.count || 0)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const landscape = rect.width > rect.height
      if (gridRef.current && (!fittedRef.current || landscapeRef.current !== landscape)) {
        fitView(rect.width, rect.height)
        fittedRef.current = true
      }
      landscapeRef.current = landscape
      drawRef.current?.()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => observer.disconnect()
  }, [generation.ready])
  useEffect(() => { markDirty(); drawRef.current?.() }, [referenceVisible, referenceOpacity])
  // entering / leaving full screen: fit the board to the new size
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const container = containerRef.current
      if (!container || !gridRef.current) return
      const rect = container.getBoundingClientRect()
      fitView(rect.width, rect.height)
      fittedRef.current = true
      drawRef.current?.()
    }, 220)
    return () => window.clearTimeout(timer)
  }, [fullscreen])

  renderRef.current = () => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    const image = boardImageRef.current
    const index = indexRef.current
    if (!canvas || !grid || !index) return

    const context = canvas.getContext('2d')
    context.imageSmoothingQuality = IS_TOUCH ? 'medium' : 'high'
    const dpr = getDpr(grid.count || 0)
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    const celebration = celebrationRef.current
    let fadeP = 0
    if (celebration) {
      const elapsed = Date.now() - celebration.start
      fadeP = clamp(elapsed / FADE_MS, 0, 1)
      const zoomP = clamp((elapsed - FADE_MS) / ZOOM_MS, 0, 1)
      if (zoomP > 0) {
        const eased = 1 - Math.pow(1 - zoomP, 3)
        const { from, to } = celebration
        viewRef.current = {
          scale: from.scale + (to.scale - from.scale) * eased,
          panX: from.panX + (to.panX - from.panX) * eased,
          panY: from.panY + (to.panY - from.panY) * eased,
        }
      }
    }
    const view = viewRef.current
    const px = 1 / view.scale
    const bounds = grid.bounds
    const boardRadius = Math.min(22, grid.cellSize * 0.2)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#f3eee5'
    context.fillRect(0, 0, width, height)
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.panX, dpr * view.panY)

    const scene = sceneRef.current
    const useCache = !celebration && view.scale <= cacheScale(scene.bounds || grid.bounds) * 1.25
    let live
    if (useCache) {
      if (scene.dirty || !scene.canvas) buildScene(grid, image)
      const sb = scene.bounds
      context.drawImage(scene.canvas, sb.x, sb.y, sb.width, sb.height)
      live = [...scene.excluded].map((id) => piecesRef.current.get(id)).filter((piece) => piece && !piece.placed)
    } else {
      scene.dirty = true // cache goes stale while drawing live
      drawBackdrop(context, grid, image, px, !IS_TOUCH)
      const visible = {
        x: (0 - view.panX) / view.scale,
        y: (0 - view.panY) / view.scale,
        width: width / view.scale,
        height: height / view.scale,
      }
      live = index.query(visible, grid.cellSize).filter((piece) => !piece.placed)
    }
    live.sort((a, b) => a.stackOrder - b.stackOrder)

    if (celebration && image) {
      const maxR = Math.hypot(grid.width / 2, grid.height / 2)
      context.save()
      context.beginPath()
      context.roundRect(0, 0, grid.width, grid.height, boardRadius)
      context.clip()
      context.beginPath()
      context.arc(grid.width / 2, grid.height / 2, clamp(fadeP * 1.15, 0, 1.05) * maxR, 0, Math.PI * 2)
      context.clip()
      context.drawImage(image, 0, 0, grid.width, grid.height)
      context.restore()
    }

    const frameNow = Date.now()
    const heldDrag = dragRef.current
    const heldSet = heldDrag?.kind === 'piece' ? new Set(heldDrag.members.map((m) => m.piece)) : null
    let lifting = false
    live.forEach((piece) => {
      const selected = piece === selectedPieceRef.current
      const active = selected || Boolean(heldSet?.has(piece))
      let scale = 1
      let lift = 1
      if (active) {
        const t = clamp((frameNow - (piece.liftAt || 0)) / LIFT_MS, 0, 1)
        if (t < 1) lifting = true
        scale = 1 + 0.08 * easeOutBack(t)
        lift = 1 - Math.pow(1 - t, 3)
      }
      drawSprite(context, piece, px, active, selected, scale, lift)

      if (piece.movingBy && piece.movingBy !== user?.uid && piece.id === (piece.group || piece.id) && piece.width * view.scale > 46) {
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

    // green "click" glow on pieces that just snapped in or joined
    let animating = false
    const now = Date.now()

    // wrong drop: the piece settles back down onto the table
    settlingRef.current.forEach((piece) => {
      const t = (now - (piece.settleAt || 0)) / SETTLE_MS
      if (t >= 1 || piece.placed || heldSet?.has(piece)) { settlingRef.current.delete(piece); return }
      animating = true
      if (celebration) return
      const k = 1 - t
      drawSprite(context, piece, px, true, false, 1 + 0.07 * k * k, k)
    })

    flashingRef.current.forEach((piece) => {
     const glow = Math.max(0, 1 - (now - (piece.flashAt || 0)) / 700)
      if (glow <= 0) { flashingRef.current.delete(piece); return }
      animating = true
      if (celebration) return

      // pop: a quick grow-and-settle, bigger when the piece locks into the board
      const popT = (now - (piece.flashAt || 0)) / POP_MS
      if (popT < 1) {
        const pulse = Math.sin(Math.PI * popT)
        drawSprite(context, piece, px, true, false, 1 + (piece.placed ? 0.12 : 0.06) * pulse, pulse)
        if (piece.placed) {
          // expanding ring
          context.save()
          context.translate(piece.x + piece.width / 2, piece.y + piece.height / 2)
          context.rotate(((piece.rotation || 0) * Math.PI) / 180)
          context.scale(1 + 0.35 * popT, 1 + 0.35 * popT)
          context.translate(-piece.width / 2, -piece.height / 2)
          context.strokeStyle = `rgba(46, 176, 102, ${0.6 * (1 - popT)})`
          context.lineWidth = 3 * px
          context.stroke(piecePath(piece))
          context.restore()
        }
      }

      context.save()
      context.translate(piece.x + piece.width / 2, piece.y + piece.height / 2)
      context.rotate(((piece.rotation || 0) * Math.PI) / 180)
      context.translate(-piece.width / 2, -piece.height / 2)
      context.strokeStyle = `rgba(46, 176, 102, ${0.95 * glow})`
      context.lineWidth = 3.4 * px
      if (!IS_TOUCH) {
        context.shadowColor = `rgba(46, 176, 102, ${0.8 * glow})`
        context.shadowBlur = 14 * px
      }
      context.stroke(piecePath(piece))
      context.restore()
    })

    const celebrating = celebration && Date.now() - celebration.start < FADE_MS + ZOOM_MS + 60
    if ((animating || celebrating || lifting) && !rafRef.current) {
      rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; renderRef.current?.() })
    }
  }

  drawRef.current = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      renderRef.current?.()
    })
  }
  const markDirty = () => { sceneRef.current.dirty = true }

  // pieces that must be drawn live on top of the cache (held, selected, or moved by someone else)
  function isLive(piece) {
    const drag = dragRef.current
    if (drag?.kind === 'piece' && drag.members.some((m) => m.piece === piece)) return true
    if (piece === selectedPieceRef.current) return true
    return Boolean(piece.movingBy && Number(piece.lockUntil) > Date.now())
  }

  function cacheScale(bounds) {
    return Math.min(1, (IS_TOUCH ? 2200 : 3200) / Math.max(bounds.width, bounds.height))
  }

  // the area the cached bitmap must cover: the board plus wherever loose pieces ended up
  function tableBounds(grid) {
    let left = grid.bounds.x
    let top = grid.bounds.y
    let right = grid.bounds.x + grid.bounds.width
    let bottom = grid.bounds.y + grid.bounds.height
    piecesRef.current.forEach((piece) => {
      if (piece.placed) return
      left = Math.min(left, piece.x)
      top = Math.min(top, piece.y)
      right = Math.max(right, piece.x + piece.width)
      bottom = Math.max(bottom, piece.y + piece.height)
    })
    const pad = grid.cellSize * 2
    return { x: left - pad, y: top - pad, width: right - left + pad * 2, height: bottom - top + pad * 2 }
  }

  function drawBackdrop(context, grid, image, px, shadows) {

    const radius = Math.min(22, grid.cellSize * 0.2)

    context.save()
    if (shadows) {
      context.shadowColor = 'rgba(41, 76, 112, 0.14)'
      context.shadowBlur = 24
      context.shadowOffsetY = 10
    }
    context.fillStyle = '#fafcff'
    context.beginPath()
    context.roundRect(0, 0, grid.width, grid.height, radius)
    context.fill()
    context.restore()

    if (referenceVisible && image && !celebrationRef.current) {
      context.save()
      context.globalAlpha = referenceOpacity
      context.beginPath()
      context.roundRect(0, 0, grid.width, grid.height, radius)
      context.clip()
      context.drawImage(image, 0, 0, grid.width, grid.height)
      context.restore()
    }
    if (placedLayerRef.current) context.drawImage(placedLayerRef.current, 0, 0, grid.width, grid.height)
  }

  function drawSprite(context, piece, px, active = false, selected = false, scale = 1, lift = 1) {
    const sprite = spritesRef.current.get(piece.id)
    if (!sprite) return
    const { margin } = spriteInfoRef.current
    const size = piece.width + margin * 2
    context.save()
    context.translate(piece.x + piece.width / 2, piece.y + piece.height / 2)
    context.rotate(((piece.rotation || 0) * Math.PI) / 180)
    if (scale !== 1) context.scale(scale, scale)
    if (active) {
      context.shadowColor = 'rgba(41, 76, 112, 0.36)'
      context.shadowBlur = (IS_TOUCH ? 8 : 20) * px * lift
      context.shadowOffsetY = 4 * px * lift
    }
    context.drawImage(sprite, -piece.width / 2 - margin, -piece.height / 2 - margin, size, size)
    if (selected) {
      context.shadowColor = 'transparent'
      context.translate(-piece.width / 2, -piece.height / 2)
      context.strokeStyle = 'rgba(217, 104, 104, 0.9)'
      context.lineWidth = 2.4 * px
      context.stroke(piecePath(piece))
    }
    context.restore()
  }

  // bakes table + board + placed + every idle loose piece into one bitmap
  function buildScene(grid, image) {
    const scene = sceneRef.current
    const bounds = tableBounds(grid)
    scene.bounds = bounds
    const scale = cacheScale(bounds)
    const w = Math.ceil(bounds.width * scale)
    const h = Math.ceil(bounds.height * scale)
    if (!scene.canvas || scene.canvas.width !== w || scene.canvas.height !== h) {
      scene.canvas = document.createElement('canvas')
      scene.canvas.width = w
      scene.canvas.height = h
    }
    const g = scene.canvas.getContext('2d')
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, w, h)
    g.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale)
    const excluded = new Set()
    const idle = []
    piecesRef.current.forEach((piece) => {
      if (piece.placed) return
      if (isLive(piece)) excluded.add(piece.id)
      else idle.push(piece)
    })
    drawBackdrop(g, grid, image, 1 / scale, false)
    idle.sort((p, q) => p.stackOrder - q.stackOrder).forEach((piece) => drawSprite(g, piece, 1 / scale))
    scene.excluded = excluded
    scene.dirty = false
  }
  // one pre-rendered bitmap per piece: image clipped to the piece shape + baked outline
  function buildSprite(piece, grid, image) {
    const { margin, scale } = spriteInfoRef.current
    const size = Math.ceil((piece.width + margin * 2) * scale)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const g = canvas.getContext('2d')
    g.scale(scale, scale)
    g.translate(margin, margin)
    const path = new Path2D(piece.pathData || getPiecePath(piece, grid))
    const src = piece.width + margin * 2

    g.save()
    g.clip(path)
    const q = image.width / grid.width
    g.imageSmoothingQuality = 'high'
    g.drawImage(image, (piece.targetX - margin) * q, (piece.targetY - margin) * q, src * q, src * q, -margin, -margin, src, src)
    // soft inner highlight + shade, for the cut-cardboard look
    const w = Math.max(1.2 / scale, grid.cellSize * 0.018)
    g.strokeStyle = 'rgba(255,255,255,0.5)'
    g.lineWidth = w * 2.2
    g.stroke(path)
    g.save(); g.translate(w * 0.9, w * 0.9)
    g.strokeStyle = 'rgba(20,40,70,0.22)'; g.lineWidth = w * 1.6; g.stroke(path)
    g.restore()
    g.restore()

    g.strokeStyle = 'rgba(41,76,112,0.55)'
    g.lineWidth = w
    g.stroke(path)
    return canvas
  }

  function paintPlaced(piece) {
    const layer = placedLayerRef.current
    const sprite = spritesRef.current.get(piece.id)
    if (!layer || !sprite) return
    const { margin, layerScale } = spriteInfoRef.current
    const size = (piece.width + margin * 2) * layerScale
    layer.getContext('2d').drawImage(sprite, (piece.targetX - margin) * layerScale, (piece.targetY - margin) * layerScale, size, size)
  }

  function rebuildPlacedLayer() {
    const grid = gridRef.current
    if (!grid) return
    const { layerScale } = spriteInfoRef.current
    let layer = placedLayerRef.current
    if (!layer) {
      layer = document.createElement('canvas')
      layer.width = Math.ceil(grid.width * layerScale)
      layer.height = Math.ceil(grid.height * layerScale)
      placedLayerRef.current = layer
    }
    layer.getContext('2d').clearRect(0, 0, layer.width, layer.height)
    paintedRef.current = new Set()
    piecesRef.current.forEach((piece) => {
      if (!piece.placed) return
      paintPlaced(piece)
      paintedRef.current.add(piece.id)
    })
  }

  // call whenever a piece's `placed` flag may have changed
  function syncPlaced(piece) {
    markDirty()
    const painted = paintedRef.current
    if (piece.placed && !painted.has(piece.id)) { paintPlaced(piece); painted.add(piece.id) }
    else if (!piece.placed && painted.has(piece.id)) rebuildPlacedLayer()
  }

  function flash(piece, now = Date.now()) {
    piece.flashAt = now
    flashingRef.current.add(piece)
  }

  function rebuildGroups() {
    const groups = new Map()
    piecesRef.current.forEach((piece) => {
      const key = piece.group || piece.id
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key).add(piece.id)
    })
    groupsRef.current = groups
  }

  function groupMembers(piece) {
    const ids = groupsRef.current.get(piece.group || piece.id)
    if (!ids) return [piece]
    return [...ids].map((id) => piecesRef.current.get(id)).filter(Boolean)
  }

  function regroup(piece, key) {
    const old = piece.group || piece.id
    if (old !== key) {
      const groups = groupsRef.current
      const oldSet = groups.get(old)
      oldSet?.delete(piece.id)
      if (oldSet && !oldSet.size) groups.delete(old)
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key).add(piece.id)
    }
    piece.group = key
  }

  // Joins the dropped cluster to any true neighbours that line up with it.
  // Returns the merged cluster, or null if nothing joined.
  function connectGroup(members) {
    const tolerance = gridRef.current.cellSize * 0.14
    const pieces = piecesRef.current
    const joined = new Map(members.map((member) => [member.id, member]))
    const now = Date.now()
    let merged = false

    const findJoin = () => {
      for (const piece of joined.values()) {
        for (const [dr, dc] of NEIGHBORS) {
          const neighbor = pieces.get(`${piece.row + dr}-${piece.column + dc}`)
          if (!neighbor || neighbor.placed || joined.has(neighbor.id)) continue
          const dx = piece.x + (neighbor.targetX - piece.targetX) - neighbor.x
          const dy = piece.y + (neighbor.targetY - piece.targetY) - neighbor.y
          if (Math.hypot(dx, dy) > tolerance) continue
          const others = groupMembers(neighbor)
          const blocked = others.some((member) => member.placed
            || (member.rotation || 0) % 360 !== 0
            || (member.movingBy && member.movingBy !== user.uid && Number(member.lockUntil) > now))
          if (blocked) continue
          return { others, dx, dy }
        }
      }
      return null
    }

    for (let join = findJoin(); join; join = findJoin()) {
      join.others.forEach((member) => {
        member.x += join.dx
        member.y += join.dy
        joined.set(member.id, member)
      })
      merged = true
    }
    if (!merged) return null

    const all = [...joined.values()]
    const key = all.reduce((a, b) => (a.id < b.id ? a : b)).id
    all.forEach((member) => {
      regroup(member, key)
      member.stackOrder = now
      flash(member, now)
    })
    return all
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

  // Hit-testing uses its own untransformed canvas. The visible canvas is zoomed/panned,
  // and isPointInPath applies that transform to the path, which broke picking up pieces.
  function hitPiece(point) {
    const grid = gridRef.current
    if (!grid || !indexRef.current) return null
    if (!hitContextRef.current) hitContextRef.current = document.createElement('canvas').getContext('2d')
    const hitContext = hitContextRef.current
    const world = screenToWorld(point, viewRef.current)
    const nearby = indexRef.current
      .query({ x: world.x, y: world.y, width: 1, height: 1 }, grid.cellSize)
      .filter((piece) => !piece.placed)
      .sort((a, b) => b.stackOrder - a.stackOrder)

    const exact = nearby.find((piece) => {
      const dx = world.x - piece.x - piece.width / 2
      const dy = world.y - piece.y - piece.height / 2
      const angle = -((piece.rotation || 0) * Math.PI) / 180
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + piece.width / 2
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + piece.height / 2
      return hitContext.isPointInPath(piecePath(piece), localX, localY)
    })
    if (exact) return exact

    // forgiving fallback: a tap very close to a piece's middle still grabs it
    let best = null
    let bestDistance = grid.cellSize * 0.45
    nearby.forEach((piece) => {
      const distance = Math.hypot(world.x - piece.x - piece.width / 2, world.y - piece.y - piece.height / 2)
      if (distance < bestDistance) { best = piece; bestDistance = distance }
    })
    return best
  }

  function grabPiece(piece, event, point) {

    const world = screenToWorld(point, viewRef.current)
    const members = groupMembers(piece)
    const leader = members.reduce((a, b) => (a.id < b.id ? a : b))
    const stamp = Date.now()
    const drag = {
      kind: 'piece',
      piece,
      pointerId: event.pointerId,
      pressing: true,
      tapAt: Date.now(),
      downPoint: point,
      offsetX: world.x - piece.x,
      offsetY: world.y - piece.y,
      members: members.map((member) => ({
        piece: member,
        dx: member.x - piece.x,
        dy: member.y - piece.y,
        originalX: member.x,
        originalY: member.y,
      })),
      anchor: null,
      locked: false,
      lock: null,
    }
    members.forEach((member) => { member.stackOrder = stamp })
    members.forEach((member) => { member.stackOrder = stamp; member.liftAt = stamp })
    selectedPieceRef.current = piece
    dragRef.current = drag
    markDirty()
    onSound('pickup')
    drawRef.current?.()

    drag.lock = Promise.resolve(roomControl.acquirePiece(leader)).catch(() => false).then((ok) => {
      if (!ok) console.warn('Piece lock failed', leader.id, roomControl.piecesRef.current[leader.id], 'status:', level.roomStatus)
      if (ok) { drag.locked = true; return true }
      if (dragRef.current === drag) {
        dragRef.current = null
        selectedPieceRef.current = null
        drag.members.forEach((member) => {
          member.piece.x = member.originalX
          member.piece.y = member.originalY
          indexRef.current?.update(member.piece)
        })
        drawRef.current?.()
      }
      return false
    })
  }

  function moveHeld(drag, x, y) {
    drag.members.forEach((member) => {
      member.piece.x = x + member.dx
      member.piece.y = y + member.dy
      indexRef.current.update(member.piece)
    })
    drawRef.current?.()
    if (!drag.locked) return
    const now = Date.now()
    const base = IS_TOUCH ? 220 : 120
    const interval = base + Math.min(300, drag.members.length * 4)
    if (now - lastWriteRef.current.at > interval && !lastWriteRef.current.pending) {
      lastWriteRef.current.at = now
      lastWriteRef.current.pending = roomControl.moveMany(drag.members.map((member) => ({ id: member.piece.id, x: member.piece.x, y: member.piece.y, rotation: member.piece.rotation || 0 })))
        .catch(() => { })
        .finally(() => { lastWriteRef.current.pending = null })
      onSound('move')
    }

  }

  // A second quick tap on a carried piece rotates it instead of dropping it
  function tapWhileCarrying(drag) {
    onSound('rotate')
    if (!level.allowRotation || Date.now() - drag.tapAt > 400) return false
    drag.tapAt = Date.now()
    if (drag.members.length > 1) return true // joined pieces can't rotate, but the tap is still used up
    const piece = drag.piece
    piece.rotation = ((piece.rotation || 0) + 90) % 360
    indexRef.current.update(piece)
    drawRef.current?.()
    onSound('pickup')
    if (drag.locked) {
      roomControl.moveMany([{ id: piece.id, x: piece.x, y: piece.y, rotation: piece.rotation }]).catch(() => { })
    }
    return true
  }

  async function dropPiece() {
    const drag = dragRef.current
    if (!drag || drag.kind !== 'piece') return
    const piece = drag.piece
    markDirty()
    const members = drag.members.map((member) => member.piece)
    dragRef.current = null
    selectedPieceRef.current = null
    const grid = gridRef.current
    const upright = members.every((member) => (member.rotation || 0) % 360 === 0)
    const correct = upright && isCorrectPlacement(piece, piece.x, piece.y)
    let affected = members

    if (correct) {
      const now = Date.now()
      members.forEach((member) => {
        member.x = member.targetX
        member.y = member.targetY
        member.placed = true
        member.placedBy = user.uid
        flash(member, now)
      })
      onSound('correct')
    }
    members.forEach((member) => indexRef.current.update(member))
    members.forEach(syncPlaced)
    if (!correct) {
      const settleStamp = Date.now()
      members.forEach((member) => { member.settleAt = settleStamp; settlingRef.current.add(member) })
    }
    drawRef.current?.()

    const locked = await drag.lock
    if (!locked) {
      drag.members.forEach((member) => {
        member.piece.placed = false
        member.piece.x = member.originalX
        member.piece.y = member.originalY
        indexRef.current.update(member.piece)
      })
      drag.members.forEach((member) => syncPlaced(member.piece))
      drawRef.current?.()
      return
    }

    if (!correct) {
      const joined = upright ? connectGroup(members) : null
      if (joined) {
        markDirty()
        affected = joined
        onSound('connect')

      } else if (piece.x >= 0 && piece.y >= 0 && piece.x <= grid.width && piece.y <= grid.height) {
        onSound('incorrect')
      } else {
        onSound('drop')      // dropped out on the table
      }
      affected.forEach((member) => indexRef.current.update(member))
      drawRef.current?.()
    }

    const queued = lastWriteRef.current.pending
    if (queued) await queued
    await roomControl.releaseMany(affected.map((member) => ({
      id: member.id,
      x: member.x,
      y: member.y,
      placed: member.placed,
      rotation: member.rotation || 0,
      group: member.group || member.id,
    })))
    drawRef.current?.()
  }

  function handlePointerDown(event) {
    if (!generation.ready || disabled) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = pointFromEvent(event)
    const pointers = pointerPointsRef.current
    if (event.pointerType === 'touch') pointers.set(event.pointerId, point)

    // Already carrying a piece: click drops it; on touch, drag anywhere moves it and a tap drops it
    const held = dragRef.current
    if (held?.kind === 'piece') {
      event.preventDefault()
      if (event.pointerType === 'touch') {
        if (!held.anchor && !held.pressing) {
          const world = screenToWorld(point, viewRef.current)
          held.anchor = { pointerId: event.pointerId, worldX: world.x, worldY: world.y, pieceX: held.piece.x, pieceY: held.piece.y, moved: false }
        }
      } else if (event.button === 0) {
        if (!tapWhileCarrying(held)) void dropPiece()

      }
      return
    }

    if (event.pointerType === 'touch' && pointers.size >= 2) {
      if (dragRef.current?.kind === 'pan') {
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

    const piece = event.button === 0 ? hitPiece(point) : null

    if (piece) {
      const someoneHasIt = groupMembers(piece).some((member) => member.movingBy && member.movingBy !== user.uid && Number(member.lockUntil) > Date.now())
      if (someoneHasIt) return
      event.preventDefault()
      grabPiece(piece, event, point)
      return
    }

    dragRef.current = { kind: 'pan', pointerId: event.pointerId, startX: point.x, startY: point.y, panX: viewRef.current.panX, panY: viewRef.current.panY, moved: false }
  }

  function handlePointerMove(event) {
    if (disabled) return
    const pointers = pointerPointsRef.current
    if (event.pointerType === 'touch' && pointers.has(event.pointerId)) pointers.set(event.pointerId, pointFromEvent(event))

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
    if (drag?.kind === 'piece') {
      const world = screenToWorld(pointFromEvent(event), viewRef.current)
      if (event.pointerType === 'touch') {
        const anchor = drag.anchor
        if (anchor && anchor.pointerId === event.pointerId) {
          if (!anchor.moved && Math.hypot(world.x - anchor.worldX, world.y - anchor.worldY) * viewRef.current.scale <= TAP_SLOP) return
          anchor.moved = true
          moveHeld(drag, anchor.pieceX + world.x - anchor.worldX, anchor.pieceY + world.y - anchor.worldY)
          event.preventDefault()
        } else if (drag.pointerId === event.pointerId && drag.pressing) {
          moveHeld(drag, world.x - drag.offsetX, world.y - drag.offsetY)
          event.preventDefault()
        }
        return
      }
      moveHeld(drag, world.x - drag.offsetX, world.y - drag.offsetY)
      return
    }

    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.kind === 'pan') {
      const point = pointFromEvent(event)
      if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3) drag.moved = true
      viewRef.current.panX = drag.panX + point.x - drag.startX
      viewRef.current.panY = drag.panY + point.y - drag.startY
      drawRef.current?.()
    }
  }

  function handlePointerUp(event) {
    const pointers = pointerPointsRef.current
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
    if (drag?.kind === 'piece') {
      const anchor = drag.anchor
      if (anchor && anchor.pointerId === event.pointerId) {
        drag.anchor = null
        if (!anchor.moved) { if (!tapWhileCarrying(drag)) void dropPiece() }
        return
      }
      if (drag.pointerId === event.pointerId && drag.pressing) {
        drag.pressing = false
        const point = pointFromEvent(event)
        // press, drag and release = drop there; a plain tap/click keeps carrying
        if (drag.downPoint && Math.hypot(point.x - drag.downPoint.x, point.y - drag.downPoint.y) > TAP_SLOP) void dropPiece()
      }
      return
    }

    if (!drag || drag.pointerId !== event.pointerId) return
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
    }
  }

  async function rotateSelected() {

    const piece = selectedPieceRef.current
    if (!level.allowRotation || !piece || piece.placed) return
    if (groupMembers(piece).length > 1) return // joined pieces can't be rotated
    piece.rotation = ((piece.rotation || 0) + 90) % 360
    indexRef.current.update(piece)
    drawRef.current?.()
    onSound('rotate')   // replaces onSound('pickup') in tapWhileCarrying; add to rotateSelected
    // a carried piece saves its rotation when it is dropped
    if (dragRef.current?.piece === piece) return
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
        markDirty()
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
      const drag = dragRef.current?.piece === piece ? dragRef.current : null
      let nextX = piece.x
      let nextY = piece.y
      if (event.key === 'ArrowUp') nextY -= step
      if (event.key === 'ArrowDown') nextY += step
      if (event.key === 'ArrowLeft') nextX -= step
      if (event.key === 'ArrowRight') nextX += step
      if (drag) {
        moveHeld(drag, nextX, nextY)
      } else {
        piece.x = nextX
        piece.y = nextY
        indexRef.current.update(piece)
        drawRef.current?.()
        void roomControl.move(piece.id, piece.x, piece.y)
      }
      return
    }
    if (event.key === 'Enter' && piece) {
      event.preventDefault()
      if (dragRef.current?.piece === piece) { await dropPiece(); return }
      const correct = (piece.rotation || 0) % 360 === 0 && isCorrectPlacement(piece, piece.x, piece.y, viewRef.current.scale)
      if (correct) {
        piece.x = piece.targetX
        piece.y = piece.targetY
        piece.placed = true
        syncPlaced(piece)
        piece.placedBy = user.uid
        onSound('correct')
      } else if (piece.x >= 0 && piece.y >= 0 && piece.x <= gridRef.current.width && piece.y <= gridRef.current.height) {
        onSound('incorrect')
      }
      await roomControl.release(piece.id, { x: piece.x, y: piece.y, placed: correct, rotation: piece.rotation || 0 })
      selectedPieceRef.current = null
      markDirty()
      drawRef.current?.()
      return
    }
    if (event.key === 'Escape' && piece) {
      event.preventDefault()
      const drag = dragRef.current?.piece === piece ? dragRef.current : null
      dragRef.current = null
      const held = drag ? drag.members.map((member) => member.piece) : [piece]
      await roomControl.releaseMany(held.map((member) => ({ id: member.id, x: member.x, y: member.y, placed: false, rotation: member.rotation || 0, group: member.group || member.id })))
      selectedPieceRef.current = null
      markDirty()
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
    const canvas = canvasRef.current
    if (!canvas) return
    fitView(canvas.clientWidth, canvas.clientHeight)
    drawRef.current?.()
  }

  function handleWheel(event) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 20) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.1 : 0.91
    changeZoom(viewRef.current.scale * factor, pointFromEvent(event))
  }

  return (
    <div ref={containerRef} className={`puzzle-canvas-shell ${celebrate ? 'is-celebrating' : ''} ${rising ? 'is-rising' : ''}`} aria-label={`${level.title} puzzle workspace`}>
      {!generation.ready && (
        <div className={`board-loading ${generation.error ? 'has-error' : ''}`} role="status" aria-live="polite">
          {!generation.error && <div className="board-loading-skeleton" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <span className="data-skeleton board-loading-piece" key={index} />)}</div>}
          <div className="board-loading-copy">
            <strong>{generation.error ? 'Puzzle unavailable' : 'Setting the table'}</strong>
            <span>{generation.error || `Preparing ${level.pieceCount.toLocaleString()} pieces · ${Math.round(generation.progress * 100)}%`}</span>
            {!generation.error && <div className="loading-track"><i style={{ width: `${generation.progress * 100}%` }} /></div>}
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`puzzle-canvas ${generation.ready ? 'is-ready' : ''}`}
        style={{ touchAction: 'none' }}
        role="application"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Jigsaw puzzle board. Click or tap a piece to pick it up, move it, then click or tap again to put it down."
        aria-describedby="puzzle-keyboard-help"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}

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
    </div>
  )
}
