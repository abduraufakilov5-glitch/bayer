'use client'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
export function MoneySheet({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [closing, setClosing] = useState(false)
  useLayoutEffect(() => {
    const node = dialog.current
    if (!node) return
    const body = document.body, scrollY = window.scrollY
    const previous = { position: body.style.position, top: body.style.top,
      width: body.style.width, overflow: body.style.overflow }
    // overflow:hidden alone still lets Safari pan the page behind a keyboard.
    Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' })
    body.dataset.moneySheet = 'open'
    const viewport = window.visualViewport
    let frame = 0
    const measure = () => {
      frame = 0
      if (viewport && viewport.scale !== 1) return // preserve pinch zoom
      const height = viewport?.height ?? window.innerHeight
      const bottom = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))
      // No React state/layout animation on keyboard frames. Only the sheet's
      // viewport changes, and the inner scroller retains the draft and focus.
      node.style.setProperty('--sheet-height', `${Math.round(height)}px`)
      node.style.setProperty('--sheet-bottom', `${Math.round(bottom)}px`)
      node.dataset.keyboard = window.innerHeight - height > 120 ? 'open' : 'closed'
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    node.showModal()
    viewport?.addEventListener('resize', schedule, { passive: true })
    viewport?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      if (timer.current) clearTimeout(timer.current)
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      node.close()
      Object.assign(body.style, previous)
      delete body.dataset.moneySheet
      window.scrollTo({ top: scrollY, behavior: 'instant' })
    }
  }, [])
  function close() {
    if (busy || closing) return
    setClosing(true)
    timer.current = setTimeout(onClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120)
  }
  return <dialog ref={dialog} aria-label={title} tabIndex={-1}
    className={'money-sheet' + (closing ? ' closing' : '')}
    onCancel={e => { e.preventDefault(); close() }}
    onClick={e => { if (e.target === e.currentTarget) close() }}>
    <div className="money-sheet-body">
      <div className="sheet-handle" aria-hidden="true" />
      <header className="sheet-heading">
        <h2>{title}</h2>
        <button className="keyboard-dismiss" type="button" aria-label="Скрыть клавиатуру" onClick={() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        }}>⌄</button>
        <button className="icon-button" type="button" aria-label="Закрыть" disabled={busy} onClick={close}>×</button>
      </header>
      <div className="money-sheet-content">{children}</div>
    </div>
  </dialog>
}
