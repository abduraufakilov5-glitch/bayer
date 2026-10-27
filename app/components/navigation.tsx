'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from './icons'
export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname(),
    wallet = pathname.startsWith('/wallet')
  return (
    <nav
      className={'main-nav' + (mobile ? ' nav-mobile' : '')}
      aria-label="Разделы приложения"
    >
      <Link
        href="/wallet"
        aria-current={wallet ? 'page' : undefined}
        className={wallet ? 'active' : ''}
      >
        <Icon name="wallet" />
        <span>Кошелёк</span>
      </Link>
      <Link
        href="/dashboard"
        aria-current={!wallet ? 'page' : undefined}
        className={!wallet ? 'active' : ''}
      >
        <Icon name="bag" />
        <span>Работа</span>
      </Link>
    </nav>
  )
}
export function WorkNavigation() {
  const pathname = usePathname()
  if (pathname.startsWith('/wallet')) return null
  return (
    <nav className="work-nav" aria-label="Работа">
      {[
        { href: '/dashboard', label: 'Заказы' },
        { href: '/catalog', label: 'Каталог' },
        { href: '/work/finances', label: 'Финансы' },
      ].map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={pathname === item.href ? 'active' : ''}
          aria-current={pathname === item.href ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
