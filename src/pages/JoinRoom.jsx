import { useState } from 'react'
import { ArrowRight, LockKeyhole, Puzzle, UsersRound } from 'lucide-react'
import '../css/pages/JoinRoom.css'

export default function JoinRoom({ onJoin, onCreate, busy }) {
  const [code, setCode] = useState('')
  return <main className="page-wrap join-page">
    <div className="join-page-card"><div className="join-page-mark"><UsersRound size={23} /></div><p className="section-eyebrow">SAVE YOU A SEAT?</p><h1>Find your people.</h1><p>Enter the six-letter room code your friend sent. The puzzle will be right where they left it.</p>
      <form className="join-code-form join-page-form" onSubmit={(event) => { event.preventDefault(); onJoin(code) }}><label className="sr-only" htmlFor="join-page-code">Room code</label><input id="join-page-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} maxLength={6} pattern="[A-Z2-9]{6}" autoComplete="off" placeholder="ROOM CODE" required /><button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Joining…' : 'Join room'} <ArrowRight size={16} /></button></form>
      <div className="join-page-divider"><span>or</span></div><button type="button" className="button button-outline button-block" onClick={onCreate} disabled={busy}><Puzzle size={17} /> Make a new room</button><small><LockKeyhole size={13} /> Private tables stay private. Share a code to invite friends.</small>
    </div><div className="join-page-decoration" aria-hidden="true"><span>✦</span><span>✳</span><span>✦</span></div>
  </main>
}
