import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-dvh bg-[#f7f7f5]">
      <header className="sticky top-0 z-20 border-b border-neutral-200/80 bg-[#f7f7f5]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-black text-sm font-semibold text-white">B</span>
            <span className="font-semibold">Bayer</span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/orders/new" className="rounded-xl bg-black px-3.5 py-2 font-medium text-white">+ Новый</Link>
            <form action="/api/auth/signout" method="post">
              <button className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-neutral-700">Выйти</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  )
}
