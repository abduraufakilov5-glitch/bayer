import { getSupabaseConfig } from '@/lib/supabase/config'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Navigation } from '@/app/components/navigation'
import { Icon } from '@/app/components/icons'
import { ThemeToggle } from '@/app/components/theme-toggle'
export const dynamic = 'force-dynamic'
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!getSupabaseConfig()) redirect('/login')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <div className="app-shell"><header className="topbar"><div className="topbar-inner"><Link href="/dashboard" className="brand"><span className="brand-mark"><Icon name="bag" size={20}/></span>Bayer<span className="sr-only"> — заказы</span></Link><Navigation/><div className="topbar-actions"><ThemeToggle/><form action="/api/auth/signout" method="post"><button className="signout" aria-label="Выйти"><Icon name="logout" size={18}/><span>Выйти</span></button></form></div></div></header><Navigation mobile/><main className="workspace">{children}</main></div>
}
