'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
export function MoneySheet({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      if (timer.current) clearTimeout(timer.current)
      node?.close()
      document.body.style.overflow = previous
    }
  }, [])
  function close() {
    if (busy || closing) return
    setClosing(true)
    timer.current = setTimeout(onClose, 160)
  }
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className={'money-sheet' + (closing ? ' closing' : '')}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="money-sheet-body">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
