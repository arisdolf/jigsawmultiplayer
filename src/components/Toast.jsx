import { Check, CircleAlert, Info, X } from 'lucide-react'
import '../css/components/Toast.css'
import '../css/components/Toast.mobile.css'

const icons = { success: Check, error: CircleAlert, info: Info }

export default function Toast({ toast, onClose }) {
  if (!toast) return null
  const Icon = icons[toast.type] || Info

  return (
    <div className={`toast toast-${toast.type || 'info'}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <Icon size={18} aria-hidden="true" />
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={onClose}><X size={15} /></button>
    </div>
  )
}
