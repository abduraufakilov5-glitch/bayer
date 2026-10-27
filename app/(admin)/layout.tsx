import { getSupabaseConfig } from '@/lib/supabase/config'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RatesProvider } from '@/app/components/exchange-rates'
import { WalletProvider } from '@/app/components/wallet-store'
import { AppChrome } from '@/app/components/app-chrome'
export const dynamic = 'force-dynamic'
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!getSupabaseConfig()) redirect('/login')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <WalletProvider key={user.id} ownerId={user.id}>
      <RatesProvider>
        <AppChrome>{children}</AppChrome>
      </RatesProvider>
    </WalletProvider>
  )
}
