'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Navigation, WorkNavigation } from './navigation'
import { ThemeToggle } from './theme-toggle'
import { Icon } from './icons'
export function AppChrome({ children }: { children: ReactNode }) {
  const wallet = usePathname().startsWith('/wallet')
  return (
    <div className={'app-shell ' + (wallet ? 'personal-space' : 'work-space')}>
      <a href="#main-content" className="skip-link">
        К содержимому
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/wallet" className="brand">
            <span className="brand-mark">
              <Icon name="wallet" size={18} />
            </span>
            <span>
              Мой баланс
              <small>
                {wallet ? 'Личное пространство' : 'Рабочее пространство'}
              </small>
            </span>
          </Link>
          <Navigation />
          <div className="topbar-actions">
            <ThemeToggle />
            <form action="/api/auth/signout" method="post">
              <button className="signout" aria-label="Выйти">
                <Icon name="logout" size={19} />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main-content" className="workspace">
        <WorkNavigation />
        {children}
      </main>
      <Navigation mobile />
    </div>
  )
}
