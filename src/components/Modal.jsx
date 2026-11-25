import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import '../css/components/Modal.css'
import '../css/components/Modal.mobile.css'

export default function Modal({ open, onClose, title, description, children, className = '' }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={`app-modal ${className}`}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === dialogRef.current) onClose() }}
    >
      <div className="modal-content">
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
