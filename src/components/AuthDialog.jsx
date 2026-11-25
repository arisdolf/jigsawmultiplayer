import { useState } from 'react'
import { Globe2, Mail, UserRound } from 'lucide-react'
import Modal from './Modal'
import '../css/components/AuthDialog.css'

const errorText = {
  'auth/email-already-in-use': 'That email already has an account. Try signing in.',
  'auth/invalid-credential': 'Email or password did not match. Try again.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Use a password with at least six characters.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
  'auth/unauthorized-domain': 'Add this app domain in Firebase Authentication settings.',
}

function readableError(error) {
  return errorText[error?.code] || error?.message || 'Could not sign in. Try again.'
}

export default function AuthDialog({ open, onClose, auth, onAuthenticated }) {
  const [mode, setMode] = useState('guest')
  const [values, setValues] = useState({ displayName: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const nextUser = mode === 'register'
        ? await auth.register(values)
        : mode === 'login'
          ? await auth.login(values)
          : await auth.guest(values.displayName)
      onAuthenticated(nextUser)
    } catch (authError) {
      setError(readableError(authError))
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setError('')
    setBusy(true)
    try {
      onAuthenticated(await auth.google())
    } catch (authError) {
      setError(readableError(authError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Come on in" description="Save your little corner and meet your puzzle pals." className="auth-modal">
      <div className="auth-tabs" role="tablist" aria-label="Account options">
        <button type="button" className={mode === 'guest' ? 'active' : ''} onClick={() => { setMode('guest'); setError('') }}>Play as guest</button>
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
        <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
      </div>

      {mode === 'guest' ? (
        <form className="auth-form" onSubmit={submit}>
          <label>What should we call you?<input value={values.displayName} onChange={(event) => setValues({ ...values, displayName: event.target.value })} maxLength={32} autoComplete="nickname" placeholder="Puzzle Pal" /></label>
          <p className="auth-hint">Guest play stays in this browser tab. Sign in to carry progress across devices.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary button-block" disabled={busy}><UserRound size={17} /> {busy ? 'Opening the room…' : 'Continue as guest'}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && <label>Display name<input value={values.displayName} onChange={(event) => setValues({ ...values, displayName: event.target.value })} maxLength={32} autoComplete="nickname" required placeholder="Your name in the room" /></label>}
          <label>Email address<input type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} autoComplete="email" required placeholder="you@example.com" /></label>
          <label>Password<input type="password" value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={6} required placeholder="At least 6 characters" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary button-block" disabled={busy}><Mail size={17} /> {busy ? 'One moment…' : mode === 'register' ? 'Create my account' : 'Sign in with email'}</button>
          <div className="auth-divider"><span>or</span></div>
          <button type="button" className="button button-outline button-block" onClick={google} disabled={busy}><Globe2 size={17} /> Continue with Google</button>
        </form>
      )}
      {!auth.firebaseReady && mode !== 'guest' && <p className="firebase-hint">Online accounts turn on when Firebase credentials are set in `.env`.</p>}
      {!auth.firebaseReady && <p className="firebase-hint">Local play is ready. Cloud accounts and rooms need Firebase setup.</p>}
    </Modal>
  )
}
