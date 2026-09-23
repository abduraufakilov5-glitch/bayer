'use client'

import { Icon } from './icons'

export function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    document.documentElement.style.colorScheme = next
    localStorage.setItem('bayer:theme', next)
  }

  return <button type="button" className="theme-toggle" onClick={toggle} aria-label="Переключить тему"><span className="theme-icon-light"><Icon name="moon" size={18}/></span><span className="theme-icon-dark"><Icon name="sun" size={18}/></span></button>
}
