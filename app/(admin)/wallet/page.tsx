import { Suspense } from 'react'
import { FinanceWorkspace } from '@/app/components/finance-workspace'
export default function WalletPage() {
  return (
    <Suspense fallback={<div className="skeleton" />}>
      <FinanceWorkspace />
    </Suspense>
  )
}
