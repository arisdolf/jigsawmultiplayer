import { generatePuzzlePieces, getPiecePath } from '../utils/puzzleEngine'

self.onmessage = async (event) => {
  const { pieceCount, imageAspect } = event.data
  try {
    const { grid, pieces } = await generatePuzzlePieces({
      pieceCount,
      imageAspect,
      onProgress: (progress) => self.postMessage({ type: 'progress', progress: progress * 0.7 }),
    })
    const piecesWithPaths = new Array(pieces.length)
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]
      piecesWithPaths[index] = { ...piece, pathData: getPiecePath(piece, grid) }
      if ((index + 1) % 250 === 0 || index + 1 === pieces.length) {
        self.postMessage({ type: 'progress', progress: 0.7 + ((index + 1) / pieces.length) * 0.29 })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    self.postMessage({ type: 'ready', grid, pieces: piecesWithPaths })
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'Could not prepare this puzzle.' })
  }
}
