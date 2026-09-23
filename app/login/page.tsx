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

  return <main className="login-page"><form onSubmit={handleSubmit} className="panel login-card">
    <div className="login-logo"><span className="brand-mark" style={{width:52,height:52,borderRadius:17,fontSize:24,fontWeight:600}}>B</span></div>
    <div className="text-center mb-8"><p className="eyebrow mb-3">Bayer</p><h1 className="text-3xl font-semibold tracking-tight">Всё начинается здесь.</h1><p className="subtitle mt-3">Ваши подборки, клиенты и заказы.<br/>В одном спокойном пространстве.</p></div>
    {!configured && <p role="status" className="notice mb-5">Добавьте ключи Supabase в настройки приложения.</p>}
    <div className="space-y-5"><label className="field">Email<input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="name@example.com" autoComplete="email" required/></label><label className="field">Пароль<input aria-label="Пароль" value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Ваш пароль" autoComplete="current-password" required/></label></div>
    {error && <p role="alert" className="notice mt-5">{error}</p>}
    <button aria-label="Войти" disabled={loading || !configured} className="btn btn-primary w-full mt-7">{loading ? 'Входим…' : 'Войти'}</button>
    {!isStandalone && <p className="mt-7 text-center text-xs leading-5 text-neutral-400">Всегда под рукой.<br/>Safari → Поделиться → На экран «Домой»</p>}
  </form></main>
}
