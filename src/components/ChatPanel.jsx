import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import Avatar from './Avatar'
import '../css/components/ChatPanel.css'
import '../css/components/ChatPanel.mobile.css'

function clockTime(timestamp) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp))
}

export default function ChatPanel({ messages = [], onSend, currentUser, compact = false }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length])

  async function submit(event) {
    event.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    setError('')
    try {
      await onSend(text)
      setText('')
    } catch (sendError) {
      setError(sendError.message || 'Could not send that note.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className={`chat-panel ${compact ? 'chat-panel-compact' : ''}`} aria-label="Room chat">
      <header className="chat-heading"><div className="chat-heading-icon"><MessageCircle size={17} /></div><div><strong>Little notes</strong><span>{messages.length ? `${messages.length} messages` : 'Say hello'}</span></div></header>
      <div className="chat-message-list" ref={listRef} role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="chat-empty"><span className="chat-empty-dot">✦</span><p>Room is quiet. Leave a kind note for your puzzle pals.</p></div>
        ) : messages.map((message) => {
          const own = message.uid === currentUser?.uid
          return (
            <article className={`chat-message ${own ? 'is-own' : ''}`} key={message.id}>
              {!own && <Avatar player={message} size="xs" />}
              <div className="chat-message-content">
                <div className="chat-message-meta"><strong>{own ? 'You' : message.displayName || 'Puzzle Pal'}</strong><time>{clockTime(message.createdAt)}</time></div>
                <p>{message.text}</p>
              </div>
            </article>
          )
        })}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="room-message">Write a room message</label>
        <input id="room-message" value={text} maxLength={240} onChange={(event) => setText(event.target.value)} placeholder="Write a little note…" />
        <button type="submit" aria-label="Send message" disabled={!text.trim() || sending}><Send size={17} /></button>
      </form>
      {error && <p className="form-error chat-error" role="alert">{error}</p>}
    </section>
  )
}
