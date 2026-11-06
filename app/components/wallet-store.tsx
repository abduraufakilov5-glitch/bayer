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
import { EMPTY_WALLET, type WalletData, type Entry } from '@/lib/wallet'
type Store = {
  ownerId: string
  data: WalletData
  loading: boolean
  refreshing: boolean
  error: string
  reload: () => Promise<void>
  ensure: () => Promise<void>
  commitEntry: (entry: Entry) => void
}
const Context = createContext<Store | null>(null)
export function WalletProvider({
  children,
  ownerId,
  initialData,
}: {
  children: ReactNode
  ownerId: string
  initialData: WalletData | null
}) {
  const [data, setData] = useState(initialData ?? EMPTY_WALLET),
    [loading, setLoading] = useState(!initialData),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState('')
  const [initialTime] = useState(() => initialData ? Date.now() : 0)
  const loadedAt = useRef(initialTime),
    revision = useRef(0),
    flight = useRef<Promise<void> | null>(null)
  const load = useCallback(function load(force = false): Promise<void> {
    if (flight.current) return force ? flight.current.then(() => load(true)) : flight.current
    if (!force && Date.now() - loadedAt.current < 30000)
      return Promise.resolve()
    const startedAtRevision = revision.current
    setRefreshing(true)
    flight.current = (async () => {
      try {
        const r = await createClient().rpc('wallet_snapshot').abortSignal(AbortSignal.timeout(12000))
        if (r.error || !r.data?.accounts) throw r.error
        // A request started before a confirmed write must not undo that write.
        if (revision.current !== startedAtRevision) return
        setData(r.data as WalletData)
        loadedAt.current = Date.now()
        setError('')
      } catch {
        if (revision.current === startedAtRevision) setError('Не удалось загрузить данные. Повторите попытку.')
      } finally {
        setLoading(false)
        setRefreshing(false)
        flight.current = null
      }
    })()
    return flight.current
  }, [])
  const reload = useCallback(() => { revision.current++; return load(true) }, [load]),
    ensure = useCallback(() => load(false), [load])
  const commitEntry = useCallback((entry: Entry) => {
    revision.current++
    setData(previous => ({ ...previous, entries: [entry, ...previous.entries.filter(e => e.id !== entry.id)]
      .sort((a,b) => b.entry_date.localeCompare(a.entry_date)) }))
    loadedAt.current = Date.now()
    setError('')
  }, [])
  useEffect(() => {
    const refresh = () => {
      // Opening/dismissing a keyboard can cause focus events on iOS. Only
      // resume from the background or reconnect; never refetch on field focus.
      if (document.visibilityState === 'visible' && navigator.onLine) void ensure()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [ensure])
  const value = useMemo(
    () => ({ ownerId, data, loading, refreshing, error, reload, ensure, commitEntry }),
    [ownerId, data, loading, refreshing, error, reload, ensure, commitEntry],
  )
  return <Context value={value}>{children}</Context>
}
export function useWalletStore() {
  const store = useContext(Context)
  if (!store) throw new Error('WalletProvider required')
  const { ensure } = store
  useEffect(() => {
    void ensure()
  }, [ensure])
  return store
}

export function useWalletWriter() {
  const store = useContext(Context)
  if (!store) throw new Error('WalletProvider required')
  return store.commitEntry
}

export function useWalletOwner() {
  const store = useContext(Context)
  if (!store) throw new Error('WalletProvider required')
  return store.ownerId
}
