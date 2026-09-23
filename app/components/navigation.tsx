'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from './icons'
export function Navigation({mobile = false}: {mobile?:boolean}) {
  const pathname = usePathname()
  const items = [
    {href:'/dashboard',label:'Заказы',icon:'bag' as const},
    {href:'/catalog',label:'Каталог',icon:'grid' as const},
    {href:'/orders/new',label:'Создать',icon:'plus' as const},
  ]
  return <nav className={'main-nav' + (mobile ? ' nav-mobile' : '')} aria-label="Основная навигация">{items.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className={pathname === item.href ? 'active' : ''}><Icon name={item.icon} size={19}/>{item.label}</Link>)}</nav>
}
