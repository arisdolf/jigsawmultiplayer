import { ArrowLeft, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import LevelCard, { LevelCardSkeleton } from '../components/LevelCard'
import { getLocalLevels } from '../data/localLevels'
import '../css/pages/LevelsPage.css'
import '../css/pages/LevelsPage.mobile.css'

const difficulties = ['All', 'Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard', 'Expert', 'Master']
const localLevelCount = getLocalLevels().length

export default function LevelsPage({ levels, loading, error, completions, onPlay, onRetry, onBack, interactionDisabled = false }) {
  const [difficulty, setDifficulty] = useState('All')
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => levels.filter((level) => {
    const matchesDifficulty = difficulty === 'All' || level.difficulty === difficulty
    const matchesSearch = `${level.title} ${level.description}`.toLowerCase().includes(search.toLowerCase())
    return matchesDifficulty && matchesSearch
  }), [levels, difficulty, search])

  function completionFor(levelId) {
    const records = completions.filter((record) => record.levelId === levelId)
    return {
      completed: records.length > 0,
      bestTime: records.length ? Math.min(...records.map((record) => record.totalTime)) : undefined,
    }
  }

  return (
    <main className="levels-page page-wrap" aria-busy={loading}>
      <div className="page-back-row"><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back home</button><span className="collection-mark"><Sparkles size={15} /> A small collection for a slow day</span></div>
      <header className="levels-header"><div><p className="section-eyebrow">FIND YOUR NEXT PIECE</p><h1>The puzzle shelf</h1><p>Ten scenes, from a few easy edges to a whole afternoon together.</p></div><div className="levels-total"><strong>{loading ? <span className="data-skeleton levels-count-skeleton" aria-hidden="true" /> : levels.length.toString().padStart(2, '0')}</strong><span>puzzles<br />to share</span></div></header>
      <div className="library-tools">
        <label className="library-search"><Search size={17} /><span className="sr-only">Search puzzles</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a place…" /></label>
        <div className="difficulty-filters" role="group" aria-label="Filter by difficulty"><SlidersHorizontal size={16} /><div>{difficulties.map((item) => <button type="button" key={item} className={difficulty === item ? 'active' : ''} aria-pressed={difficulty === item} onClick={() => setDifficulty(item)}>{item}</button>)}</div></div>
      </div>

      {loading ? (
        <><p className="puzzles-loading-status" role="status" aria-live="polite"><span className="live-dot" aria-hidden="true" /> Puzzles are loading…</p><div className="level-grid library-grid" aria-label="Loading levels">{Array.from({ length: Math.max(levels.length, localLevelCount, 6) }, (_, index) => <LevelCardSkeleton key={index} />)}</div></>
      ) : error ? (
        <div className="library-empty"><strong>The shelf is still getting ready.</strong><p>{error}</p><button type="button" className="button button-primary" onClick={onRetry}>Try again</button></div>
      ) : filtered.length ? (
        <div className="level-grid library-grid">
          {filtered.map((level) => <LevelCard key={level.id} level={level} {...completionFor(level.id)} onPlay={onPlay} interactionDisabled={interactionDisabled} />)}
        </div>
      ) : (
        <div className="library-empty"><strong>No scene found.</strong><p>Try another title or difficulty.</p><button type="button" className="button button-outline" onClick={() => { setSearch(''); setDifficulty('All') }}>Clear filters</button></div>
      )}
      <div className="levels-note"><span className="note-sun">✦</span><span>Every puzzle is a shared table. Friends can join any time, leave, and come back to the same pieces.</span></div>
    </main>
  )
}
