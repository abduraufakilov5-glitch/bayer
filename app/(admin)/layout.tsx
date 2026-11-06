import { getSupabaseConfig } from '@/lib/supabase/config'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RatesProvider } from '@/app/components/exchange-rates'
import { WalletProvider } from '@/app/components/wallet-store'
import { AppChrome } from '@/app/components/app-chrome'
import type { WalletData } from '@/lib/wallet'
import { Suspense, type ReactNode } from 'react'
export const dynamic = 'force-dynamic'
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!getSupabaseConfig()) redirect('/login')
  const supabase = await createClient()
  // Both requests use this request's cookies and RLS. Never share this snapshot
  // between users. Start together rather than waiting for browser hydration.
  const snapshot = supabase.rpc('wallet_snapshot').abortSignal(AbortSignal.timeout(8000))
    .then(result => !result.error && result.data?.accounts ? result.data as WalletData : null)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Suspense fallback={<AppChrome><div className="money-loading" role="status" aria-label="Загрузка финансов"><div className="skeleton"/><div className="skeleton"/></div></AppChrome>}>
      <WalletSession ownerId={user.id} snapshot={snapshot}>{children}</WalletSession>
    </Suspense>
  )
}
async function WalletSession({ ownerId, snapshot, children }: {
  ownerId: string; snapshot: PromiseLike<WalletData | null>; children: ReactNode
}) {
  const initialData = await snapshot
  return (
    <WalletProvider key={ownerId} ownerId={ownerId} initialData={initialData}>
      <RatesProvider>
        <AppChrome>{children}</AppChrome>
      </RatesProvider>
    </WalletProvider>
  )
}
