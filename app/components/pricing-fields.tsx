'use client'
import { calculateCargo, calculateClientPrice, formatSomoni, CNY_TO_TJS, CARGO_PER_KG_TJS } from '@/lib/pricing'
import { parseDecimal, validPricing } from '@/lib/validation'
export type PricingDraft = { priceCny: string; workPrice: string; weightGrams: string }
export function PricingFields({value, onChange}: {value: PricingDraft; onChange: (patch: Partial<PricingDraft>) => void}) {
  const cny = parseDecimal(value.priceCny), work = parseDecimal(value.workPrice), weight = Number(value.weightGrams)
  const valid = validPricing('Товар', cny, work, weight)
  return <div className="pricing-box">
    <div className="pricing-inputs">
      <label className="field">Закупка, ¥<input aria-label="Цена в юанях" inputMode="decimal" placeholder="Не указана" value={value.priceCny} onChange={e => onChange({priceCny:e.target.value})}/></label>
      <label className="field">Работа, смн<input aria-label="Работа, смн" inputMode="decimal" value={value.workPrice} onChange={e => onChange({workPrice:e.target.value})}/></label>
      <label className="field">Вес, г<input aria-label="Вес, г" inputMode="numeric" value={value.weightGrams} onChange={e => onChange({weightGrams:e.target.value})}/></label>
    </div>
    <div className="price-result"><div><span>Цена клиенту</span><small>1 ¥ = {CNY_TO_TJS} смн · доставка {CARGO_PER_KG_TJS} смн/кг</small></div><strong>{valid ? formatSomoni(calculateClientPrice(cny, work, weight)) : '—'}</strong></div>
    {valid && <div className="price-breakdown">Закупка {formatSomoni(cny * CNY_TO_TJS)} <span>+</span> доставка {formatSomoni(calculateCargo(weight))} <span>+</span> работа {formatSomoni(work)}</div>}
  </div>
}
