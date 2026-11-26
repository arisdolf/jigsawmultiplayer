import { ArrowRight, ArrowUpRight, Check, Clock3, Compass, Heart, LockKeyhole, MoveRight, Puzzle, Sparkles, UsersRound } from 'lucide-react'
import { useState } from 'react'
import LevelCard from '../components/LevelCard'
import '../css/pages/HomePage.css'
import '../css/pages/HomePage.mobile.css'

export default function HomePage({
  levels,
  loading,
  error,
  user,
  stats,
  recentLevels = [],
  onPlay,
  onCreateRoom,
  onJoinRoom,
  onBrowse,
  onRetry,
}) {
  const [featuredImageSize, setFeaturedImageSize] = useState(null)
  const recentLevel = recentLevels[0] || null
  const featured = recentLevel || levels.find((level) => level.isActive && !level.isLocked) || levels[0]
  const featuredRotation = ((Number(featured?.imageRotation) || 0) % 360 + 360) % 360
  const measuredImage = featuredImageSize?.url === featured?.imageURL ? featuredImageSize : null
  const imageAspect = measuredImage ? measuredImage.width / measuredImage.height : 1.5
  const featuredAspect = featuredRotation % 180 ? 1 / imageAspect : imageAspect

  function rememberFeaturedImage(event) {
    const image = event.currentTarget
    if (!image.naturalWidth || !image.naturalHeight) return
    setFeaturedImageSize({ url: featured.imageURL, width: image.naturalWidth, height: image.naturalHeight })
  }

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <div className="hero-welcome"><span className="welcome-flower"><Sparkles size={15} /></span><span>A little room for the good stuff</span></div>
          <h1>Put the world<br />back <em>together.</em></h1>
          <p className="hero-description">Meet your people at the puzzle table. Find the edge pieces, trade a few stories, and take your time.</p>
          <div className="hero-actions">
            <button className="button button-primary button-large" type="button" onClick={() => featured && onPlay(featured)} disabled={!featured || loading}>
              <Puzzle size={19} /> {recentLevel ? 'Continue' : 'Play now'} <ArrowRight size={18} />
            </button>
            <button className="button button-outline button-large" type="button" onClick={onCreateRoom}>
              <UsersRound size={18} /> Make a room
            </button>
          </div>
          <button type="button" className="browse-link" onClick={onBrowse}>Browse all 10 puzzles <MoveRight size={15} /></button>
          <div className="hero-small-note"><span className="live-dot" /> A seat is always open</div>
        </div>

        <div className="hero-art" style={{ aspectRatio: featuredAspect }} aria-label={featured ? `Featured puzzle: ${featured.title}` : 'Puzzle room'}>
          {featured ? (
            <>
              <div className="hero-image-frame"><img className={featuredRotation % 180 ? 'is-quarter-turn' : undefined} src={featured.imageURL} alt={featured.imageAlt || ''} onLoad={rememberFeaturedImage} style={{ '--level-image-rotation': `${featuredRotation}deg` }} /></div>
              <div className="hero-image-wash" />
              <div className="hero-art-topline"><span className="hero-art-tag"><span className="tiny-sparkle">✦</span> {recentLevel ? 'LAST PLAYED' : "TODAY'S PUZZLE"}</span><span className="hero-art-index">{String(featured.order).padStart(2, '0')} / 10</span></div>
              <div className="hero-art-caption"><div><p>{recentLevel ? 'Pick up where you left off' : 'Start with something lovely'}</p><h2>{featured.title}</h2><span>{featured.pieceCount.toLocaleString()} pieces <i /> {featured.difficulty}</span></div><button type="button" className="hero-art-play" aria-label={`Play ${featured.title}`} onClick={() => onPlay(featured)}><ArrowUpRight size={19} /></button></div>
      
            </>
          ) : (
            <div className="hero-art-empty"><Puzzle size={42} /><strong>Your next table is taking shape.</strong><span>{error || 'Connect Firebase or load the local puzzle library to begin.'}</span>{error && <button type="button" className="button button-quiet" onClick={onRetry}>Try again</button>}</div>
          )}
          <div className="hero-doodle doodle-one" aria-hidden="true">✳</div>
          <div className="hero-doodle doodle-two" aria-hidden="true">✦</div>
        </div>
      </section>

      <section className="join-strip" aria-label="Join a room by code">
        <div className="join-strip-copy"><span className="join-key-icon"><LockKeyhole size={17} /></span><div><strong>Someone saved you a seat?</strong><span>Pop in with their room code.</span></div></div>
        <form className="join-code-form" onSubmit={(event) => { event.preventDefault(); onJoinRoom(event.currentTarget.elements.roomCode.value) }}>
          <label className="sr-only" htmlFor="home-room-code">Room code</label>
          <input id="home-room-code" name="roomCode" maxLength={6} pattern="[A-Za-z0-9]{6}" placeholder="ENTER CODE" autoCapitalize="characters" required />
          <button type="submit" className="button button-dark">Join room <ArrowRight size={16} /></button>
        </form>
      </section>

      {recentLevels.length > 1 && (
        <section className="recent-section" aria-labelledby="recent-title">
          <div className="section-title-row"><div><p className="section-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="recent-title">Recently played</h2></div></div>
          <div className="recent-row">
            {recentLevels.slice(1).map((level, i) => {
              const rotation = ((Number(level.imageRotation) || 0) % 360 + 360) % 360
              return (
                <button key={level.id} type="button" className="recent-card" onClick={() => onPlay(level)} aria-label={`Continue ${level.title}`}>
                  <span className="recent-thumb">
                    <img className={rotation % 180 ? 'is-quarter-turn' : undefined} src={level.imageURL} alt="" loading="lazy" style={{ '--level-image-rotation': `${rotation}deg` }} />

                    {level.completed && <span className="recent-badge is-done"><Check size={12} /> Finished</span>}
                  </span>
                  <span className="recent-info">
                    <strong>{level.title}</strong>
                    <small>{level.pieceCount.toLocaleString()} pieces · {level.difficulty}</small>
                    <span className="recent-cta">{level.completed ? 'Play again' : 'Continue'} <ArrowUpRight size={14} /></span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {loading ? (
        <section className="featured-section" aria-label="Loading puzzle library"><div className="section-title-row"><h2>Pick a little scene</h2></div><div className="level-grid home-level-grid">{[1, 2, 3].map((item) => <div key={item} className="level-skeleton" />)}</div></section>
      ) : error ? (
        <section className="home-library-error"><p>{error}</p><button type="button" className="text-action" onClick={onRetry}>Reload puzzle library <ArrowRight size={15} /></button></section>
      ) : (
        <section className="featured-section" aria-labelledby="featured-title">
          <div className="section-title-row"><div><p className="section-eyebrow">TEN LITTLE WORLDS TO WANDER INTO</p><h2 id="featured-title">Pick a little scene</h2></div><button className="text-action" type="button" onClick={onBrowse}>See the whole shelf <ArrowRight size={16} /></button></div>
          <div className="level-grid home-level-grid">
            {levels.slice(0, 3).map((level) => <LevelCard key={level.id} level={level} completed={Boolean(level.completed)} bestTime={level.bestTime} compact onPlay={onPlay} />)}
          </div>
        </section>
      )}

      <section className="home-lower-grid">
        <div className="how-it-works">
          <div className="section-title-row"><div><p className="section-eyebrow">NOT MUCH TO LEARN</p><h2>Make yourself at home</h2></div></div>
          <div className="steps-row">
            <div className="step"><span className="step-mark"><Compass size={19} /></span><div><strong>Pick a picture</strong><p>Find a scene that feels like today.</p></div></div>
            <span className="step-connector" aria-hidden="true"><MoveRight size={18} /></span>
            <div className="step"><span className="step-mark step-coral"><UsersRound size={19} /></span><div><strong>Invite your people</strong><p>Send a little code. They can join from anywhere.</p></div></div>
            <span className="step-connector" aria-hidden="true"><MoveRight size={18} /></span>
            <div className="step"><span className="step-mark step-beige"><Check size={19} /></span><div><strong>Find the fit</strong><p>Every piece lands on the same shared board.</p></div></div>
          </div>
        </div>
        <aside className="your-table">
          <div className="your-table-heading"><span className="table-stamp"><Heart size={16} /></span><div><p className="section-eyebrow">YOUR LITTLE CORNER</p><h3>{user?.displayName ? `Hi, ${user.displayName.split(' ')[0]}.` : 'Your table is ready.'}</h3></div></div>
          {recentLevel ? <button className="recent-puzzle-row" type="button" onClick={() => onPlay(recentLevel)}><img src={recentLevel.imageURL} alt="" /><span><strong>Pick up where you left off</strong><small>{recentLevel.title} · {recentLevel.pieceCount.toLocaleString()} pieces</small></span><ArrowUpRight size={17} /></button> : <div className="table-empty"><p>Your recent puzzles and room notes will gather here.</p><button type="button" className="text-action" onClick={onBrowse}>Choose your first <ArrowRight size={15} /></button></div>}
          <div className="your-stats"><div><strong>{stats.completed}</strong><span>finished</span></div><div><strong>{stats.rooms}</strong><span>rooms joined</span></div><div><strong>{stats.pieces.toLocaleString()}</strong><span>pieces placed</span></div></div>
        </aside>
      </section>
      <footer className="page-footer"><span>JigsawMult</span><span>Take your time. Find your people. <Heart size={13} fill="currentColor" /></span><button type="button" onClick={onCreateRoom}>Make a room <ArrowUpRight size={14} /></button></footer>
    </main>
  )
}
