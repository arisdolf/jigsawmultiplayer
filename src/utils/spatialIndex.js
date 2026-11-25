export class SpatialIndex {
  constructor(cellSize) {
    this.cellSize = Math.max(96, cellSize * 4)
    this.buckets = new Map()
    this.locations = new Map()
  }

  key(x, y) {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`
  }

  insert(piece) {
    const key = this.key(piece.x + piece.width / 2, piece.y + piece.height / 2)
    if (!this.buckets.has(key)) this.buckets.set(key, new Map())
    this.buckets.get(key).set(piece.id, piece)
    this.locations.set(piece.id, key)
  }

  update(piece) {
    const previous = this.locations.get(piece.id)
    const next = this.key(piece.x + piece.width / 2, piece.y + piece.height / 2)
    if (previous === next) {
      this.buckets.get(previous)?.set(piece.id, piece)
      return
    }
    if (previous) {
      const bucket = this.buckets.get(previous)
      bucket?.delete(piece.id)
      if (bucket?.size === 0) this.buckets.delete(previous)
    }
    this.insert(piece)
  }

  query(bounds, margin = 0) {
    const left = Math.floor((bounds.x - margin) / this.cellSize)
    const top = Math.floor((bounds.y - margin) / this.cellSize)
    const right = Math.floor((bounds.x + bounds.width + margin) / this.cellSize)
    const bottom = Math.floor((bounds.y + bounds.height + margin) / this.cellSize)
    const found = new Map()

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const bucket = this.buckets.get(`${x}:${y}`)
        if (!bucket) continue
        bucket.forEach((piece, id) => found.set(id, piece))
      }
    }

    return [...found.values()]
  }
}
