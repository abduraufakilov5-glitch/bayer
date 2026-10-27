import { Suspense } from 'react'
import { FinanceWorkspace } from '@/app/components/finance-workspace'
export default function WorkFinances() {
  return (
    <Suspense fallback={<div className="skeleton" />}>
      <FinanceWorkspace work />
    </Suspense>
  )
}
