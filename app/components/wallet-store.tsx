'use client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { EMPTY_WALLET, type WalletData } from '@/lib/wallet'
type Store = {
  ownerId: string
  data: WalletData
  loading: boolean
  error: string
  reload: () => Promise<void>
  ensure: () => Promise<void>
}
const Context = createContext<Store | null>(null)
export function WalletProvider({
  children,
  ownerId,
}: {
  children: ReactNode
  ownerId: string
}) {
  const [data, setData] = useState(EMPTY_WALLET),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const loadedAt = useRef(0),
    flight = useRef<Promise<void> | null>(null)
  const load = useCallback((force = false): Promise<void> => {
    if (flight.current) return flight.current
    if (!force && Date.now() - loadedAt.current < 30000)
      return Promise.resolve()
    flight.current = (async () => {
      try {
        const r = await createClient().rpc('wallet_snapshot')
        if (r.error || !r.data?.accounts) throw r.error
        setData(r.data as WalletData)
        loadedAt.current = Date.now()
        setError('')
      } catch {
        setError('Не удалось загрузить данные. Повторите попытку.')
      } finally {
        setLoading(false)
        flight.current = null
      }
    })()
    return flight.current
  }, [])
  const reload = useCallback(() => load(true), [load]),
    ensure = useCallback(() => load(false), [load])
  const value = useMemo(
    () => ({ ownerId, data, loading, error, reload, ensure }),
    [ownerId, data, loading, error, reload, ensure],
  )
  return <Context value={value}>{children}</Context>
}
export function useWalletStore() {
  const store = useContext(Context)
  if (!store) throw new Error('WalletProvider required')
  const { ensure } = store
  useEffect(() => {
    void ensure()
    const focus = () => {
      if (document.visibilityState === 'visible') void ensure()
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [ensure])
  return store
}

export function useWalletOwner() {
  const store = useContext(Context)
  if (!store) throw new Error('WalletProvider required')
  return store.ownerId
}
