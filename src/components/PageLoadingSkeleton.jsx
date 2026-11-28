import '../css/components/PageLoadingSkeleton.css'

function Bone({ className = '' }) {
  return <span className={`data-skeleton loading-bone ${className}`} />
}

function GameSkeleton() {
  return <div className="loading-game" aria-hidden="true">
    <header className="loading-game-heading">
      <div className="loading-game-title"><Bone className="loading-game-thumb" /><div><Bone className="loading-eyebrow" /><Bone className="loading-game-title-line" /><Bone className="loading-game-subtitle" /></div></div>
      <div className="loading-game-players"><Bone /><Bone /><Bone /><Bone /></div>
    </header>
    <div className="loading-game-stats"><Bone /><Bone /><Bone /><Bone /></div>
    <div className="loading-game-grid">
      <section className="loading-game-board-column">
        <div className="loading-game-toolbar"><Bone /><div><Bone /><Bone /><Bone /></div></div>
        <Bone className="loading-board" />
        <div className="loading-game-hints"><Bone /><Bone /></div>
      </section>
      <aside className="loading-game-sidebar"><Bone className="loading-side-card" /><Bone className="loading-side-card loading-side-card-short" /></aside>
    </div>
  </div>
}

function TogetherSkeleton() {
  return <div className="loading-together" aria-hidden="true">
    <header className="loading-page-heading"><Bone className="loading-eyebrow" /><Bone className="loading-heading-line" /><Bone className="loading-copy-line" /><Bone className="loading-copy-line loading-copy-line-short" /></header>
    <section className="loading-together-table"><Bone className="loading-together-photo" /><div className="loading-together-details"><Bone className="loading-eyebrow" /><Bone className="loading-title-line" /><Bone className="loading-meta-line" /><Bone className="loading-progress" /><div className="loading-inline-stats"><Bone /><Bone /></div><div className="loading-inline-avatars"><Bone /><Bone /><Bone /></div><div className="loading-inline-actions"><Bone /><Bone /></div></div></section>
    <section className="loading-together-saves"><div className="loading-section-heading"><div><Bone className="loading-eyebrow" /><Bone className="loading-title-line" /></div><Bone /></div><div className="loading-card-grid"><Bone className="loading-history-card" /><Bone className="loading-history-card" /><Bone className="loading-history-card" /></div></section>
  </div>
}

function ProfileSkeleton() {
  return <div className="loading-profile" aria-hidden="true">
    <div className="loading-back-row"><Bone /><Bone /></div>
    <header className="loading-profile-heading"><Bone className="loading-profile-avatar" /><div><Bone className="loading-eyebrow" /><Bone className="loading-heading-line" /><Bone className="loading-copy-line" /></div></header>
    <div className="loading-profile-layout"><section className="loading-profile-card"><Bone className="loading-eyebrow" /><Bone className="loading-title-line" /><Bone className="loading-form-label" /><Bone className="loading-form-input" /><Bone className="loading-form-button" /><Bone className="loading-signout" /></section><section className="loading-profile-card loading-profile-records"><div className="loading-section-heading"><div><Bone className="loading-eyebrow" /><Bone className="loading-title-line" /></div><Bone /></div><div className="loading-profile-stats"><Bone /><Bone /><Bone /><Bone /></div><div className="loading-completion-list"><Bone /><Bone /><Bone /></div></section></div>
  </div>
}

function AdminSkeleton() {
  return <div className="loading-admin" aria-hidden="true">
    <header className="loading-admin-heading"><div><Bone className="loading-eyebrow" /><Bone className="loading-heading-line" /><Bone className="loading-copy-line" /></div><Bone className="loading-admin-count" /></header>
    <div className="loading-admin-toolbar"><Bone /><Bone /></div>
    <div className="loading-admin-layout"><aside className="loading-admin-list"><Bone /><Bone /><Bone /><Bone /><Bone /></aside><section className="loading-admin-editor"><div className="loading-section-heading"><div><Bone className="loading-eyebrow" /><Bone className="loading-title-line" /></div><Bone /></div><div className="loading-admin-preview"><Bone /><div><Bone className="loading-title-line" /><Bone className="loading-meta-line" /><Bone className="loading-meta-line" /></div></div><Bone className="loading-upload" /><div className="loading-admin-fields"><Bone /><Bone /><Bone /><Bone /></div><Bone className="loading-admin-description" /><Bone className="loading-admin-description" /></section></div>
  </div>
}

export default function PageLoadingSkeleton({ screen }) {
  const message = {
    game: 'Puzzle board is loading…',
    together: 'Shared puzzle is loading…',
    admin: 'Puzzle studio is loading…',
    profile: 'Profile is loading…',
  }[screen] || 'Puzzles are loading…'
  const screenSkeleton = {
    game: <GameSkeleton />,
    together: <TogetherSkeleton />,
    admin: <AdminSkeleton />,
    profile: <ProfileSkeleton />,
  }[screen] || <TogetherSkeleton />

  return <main className={`page-loading ${screen === 'game' ? 'loading-game-page' : 'page-wrap'} loading-${screen}`} aria-busy="true">
    <p className="page-loading-status" role="status"><span className="page-loading-dot" aria-hidden="true" />{message}</p>
    {screenSkeleton}
  </main>
}
