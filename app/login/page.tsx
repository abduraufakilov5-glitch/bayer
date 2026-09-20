'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const configured = !!getSupabaseConfig()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    // This browser-only value must be read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsStandalone(standalone)
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!configured || loading) return
    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) { setError('Не удалось войти. Проверьте email и пароль.'); return }
      router.replace('/dashboard')
      router.refresh()
    } catch { setError('Нет подключения к серверу. Попробуйте снова.') }
    finally { setLoading(false) }
  }

  return (
    <main className="app-shell min-h-dvh p-3 sm:p-5">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-6xl overflow-hidden rounded-[32px] bg-white shadow-[0_30px_100px_rgba(24,42,34,.12)] sm:min-h-[calc(100dvh-2.5rem)] lg:grid-cols-[1.08fr_.92fr]">
        <section className="dashboard-hero relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="noise-overlay pointer-events-none absolute inset-0 opacity-30" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ed5b32] font-bold shadow-lg shadow-black/10">B</span>
            <div><div className="font-semibold tracking-tight">Bayer</div><div className="text-[10px] uppercase tracking-[.24em] text-white/50">order studio</div></div>
          </div>
          <div className="relative max-w-xl">
            <div className="mb-7 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/75 backdrop-blur">Весь заказ — в одном окне</div>
            <h1 className="text-5xl font-semibold leading-[1.08] tracking-[-.04em]">От фото товара<br />до готового заказа.</h1>
            <p className="mt-5 max-w-md text-base leading-7 text-white/65">Собирайте каталог, отправляйте клиенту красивую ссылку и получайте подтверждённый список без переписок.</p>
          </div>
          <div className="relative grid grid-cols-3 gap-3">
            {[['01', 'Создайте'], ['02', 'Отправьте'], ['03', 'Получите заказ']].map(([number, label]) => (
              <div key={number} className="rounded-2xl border border-white/10 bg-white/[.07] p-4 backdrop-blur-sm"><div className="text-xs text-[#ff9c7e]">{number}</div><div className="mt-2 text-sm font-medium">{label}</div></div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-12 lg:px-16">
          <form onSubmit={handleSubmit} className="w-full max-w-md space-y-7">
            <div className="lg:hidden">
              <div className="mb-7 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ed5b32] text-lg font-bold text-white shadow-[0_10px_24px_rgba(237,91,50,.24)]">B</div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#ed5b32]">Личный кабинет</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-.035em] text-[#173c30]">С возвращением</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">Войдите, чтобы продолжить работу с заказами.</p>
            </div>

            {!configured ? <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">Приложение ещё не настроено. Добавьте ключи Supabase в настройки хостинга.</p> : null}
            <div className="space-y-4">
              <label className="block"><span className="mb-2 block text-sm font-medium text-[#263b32]">Email</span><input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@example.com" autoComplete="email" required className="h-13 w-full rounded-2xl border border-[#dedbd4] bg-[#faf9f7] px-4 outline-none transition focus:border-[#ed5b32] focus:bg-white focus:ring-4 focus:ring-[#ed5b32]/10" /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-[#263b32]">Пароль</span><input aria-label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Введите пароль" autoComplete="current-password" required className="h-13 w-full rounded-2xl border border-[#dedbd4] bg-[#faf9f7] px-4 outline-none transition focus:border-[#ed5b32] focus:bg-white focus:ring-4 focus:ring-[#ed5b32]/10" /></label>
            </div>
            {error ? <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
            <button aria-label="Войти" disabled={loading || !configured} className="h-13 w-full rounded-2xl bg-[#173c30] font-semibold text-white shadow-[0_12px_30px_rgba(23,60,48,.2)] transition hover:bg-[#214f3f] disabled:opacity-50">{loading ? 'Входим…' : 'Войти в Bayer →'}</button>

            {!isStandalone ? (
              <div className="flex gap-3 rounded-2xl bg-[#f4f1eb] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#ed5b32] shadow-sm">↗</div>
                <p className="text-xs leading-5 text-neutral-500"><strong className="text-neutral-700">Можно установить на iPhone.</strong><br />В Safari: Поделиться → На экран «Домой».</p>
              </div>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  )
}
