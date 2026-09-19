'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsStandalone(standalone)
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div>
          <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-lg font-semibold text-white shadow-sm">B</div>
          <h1 className="text-2xl font-semibold tracking-tight">Вход для байера</h1>
          <p className="mt-1 text-sm text-neutral-500">Создавайте заказы и отправляйте клиентам.</p>
        </div>

        {!isStandalone && (
          <div className="rounded-[22px] bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-lg">⌁</div>
              <div>
                <div className="text-sm font-semibold">Установить Bayer на iPhone</div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  Откройте меню <strong className="text-neutral-700">Поделиться</strong> в Safari → <strong className="text-neutral-700">На экран «Домой»</strong> → <strong className="text-neutral-700">Добавить</strong>.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" autoComplete="email" required className="h-12 w-full rounded-2xl border border-neutral-200 bg-white px-4 outline-none focus:border-black" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Пароль" autoComplete="current-password" required className="h-12 w-full rounded-2xl border border-neutral-200 bg-white px-4 outline-none focus:border-black" />
        </div>
        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button disabled={loading} className="h-12 w-full rounded-2xl bg-black font-medium text-white shadow-lg shadow-black/10 disabled:opacity-50">{loading ? 'Входим…' : 'Войти'}</button>
      </form>
    </main>
  )
}
