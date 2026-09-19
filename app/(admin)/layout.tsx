import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-dvh bg-[#f5f5f7]">
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-[#f5f5f7]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-black text-sm font-semibold text-white shadow-sm">B</span>
            <span className="font-semibold tracking-tight">Bayer</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            <Link href="/dashboard" className="rounded-xl px-3 py-2 font-medium text-neutral-700 hover:bg-white/70">Заказы</Link>
            <Link href="/catalog" className="rounded-xl px-3 py-2 font-medium text-neutral-700 hover:bg-white/70">Каталог</Link>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/orders/new" className="rounded-xl bg-black px-3.5 py-2.5 font-medium text-white shadow-sm">＋ Новый</Link>
            <form action="/api/auth/signout" method="post">
              <button className="rounded-xl border border-black/[0.07] bg-white/80 px-3.5 py-2.5 font-medium text-neutral-700">Выйти</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 sm:px-6 sm:py-8 sm:pb-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-black/[0.06] bg-[#f5f5f7]/90 px-4 pb-[calc(.6rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:hidden">
        <div className="grid w-full max-w-md grid-cols-2 gap-2">
          <Link href="/dashboard" className="rounded-2xl px-3 py-2 text-center text-xs font-medium text-neutral-700">Заказы</Link>
          <Link href="/catalog" className="rounded-2xl px-3 py-2 text-center text-xs font-medium text-neutral-700">Каталог</Link>
        </div>
      </nav>
    </div>
  )
}
