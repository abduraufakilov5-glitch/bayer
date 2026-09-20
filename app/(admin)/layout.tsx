import { getSupabaseConfig } from '@/lib/supabase/config'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!getSupabaseConfig()) redirect('/login')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="app-shell min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-[#17221d]/[0.06] bg-[#f4f1eb]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ed5b32] text-sm font-bold text-white shadow-[0_8px_22px_rgba(237,91,50,.25)]">B</span>
            <span><span className="block font-semibold leading-none tracking-tight">Bayer</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-[.2em] text-neutral-400">order studio</span></span>
          </Link>
          <nav className="hidden items-center gap-1 rounded-2xl bg-white/70 p-1 text-sm shadow-sm ring-1 ring-black/5 sm:flex">
            <Link href="/dashboard" className="rounded-xl px-4 py-2 font-medium text-neutral-700 transition hover:bg-[#f1eee8]">Заказы</Link>
            <Link href="/catalog" className="rounded-xl px-4 py-2 font-medium text-neutral-700 transition hover:bg-[#f1eee8]">Каталог</Link>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/orders/new" className="rounded-xl bg-[#173c30] px-3.5 py-2.5 font-semibold text-white shadow-[0_8px_22px_rgba(23,60,48,.18)] transition hover:bg-[#214f3f]">＋ Новый</Link>
            <form action="/api/auth/signout" method="post">
              <button aria-label="Выйти" className="rounded-xl border border-black/[0.07] bg-white/80 px-3.5 py-2.5 font-medium text-neutral-700 transition hover:bg-white">Выйти</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:py-9 sm:pb-10">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-black/[0.06] bg-[#f4f1eb]/90 px-4 pb-[calc(.6rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:hidden">
        <div className="grid w-full max-w-md grid-cols-2 gap-2">
          <Link href="/dashboard" className="rounded-2xl bg-white px-3 py-2.5 text-center text-xs font-semibold text-[#173c30] shadow-sm">Заказы</Link>
          <Link href="/catalog" className="rounded-2xl px-3 py-2.5 text-center text-xs font-medium text-neutral-600">Каталог</Link>
        </div>
      </nav>
    </div>
  )
}
