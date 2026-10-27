'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { CNY_TO_TJS, USD_TO_TJS } from '@/lib/pricing'
import { NBT_SOURCE, parseRate, type ExchangeRates } from '@/lib/exchange-rates'
type RatesState = {
  rates: ExchangeRates | null
  cny: number
  usd: number
  ready: boolean
  mode: string
  setMode: (v: string) => void
  manualCny: string
  manualUsd: string
  setManualCny: (v: string) => void
  setManualUsd: (v: string) => void
  error: string
  refresh: () => Promise<void>
}
const Context = createContext<RatesState | null>(null)
export function RatesProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<ExchangeRates | null>(null),
    [error, setError] = useState(''),
    [mode, setMode] = useState('nbt')
  const [manualCny, setManualCny] = useState(String(CNY_TO_TJS)),
    [manualUsd, setManualUsd] = useState(String(USD_TO_TJS))
  async function refresh() {
    try {
      const r = await fetch('/api/exchange-rates')
      const data = await r.json()
      setRates(data.rates ?? null)
      setError(
        data.error ??
          (data.stale ? 'Показан последний опубликованный курс НБТ.' : ''),
      )
    } catch {
      setError('Нет связи с НБТ. Выберите ручной курс.')
    }
  }
  // Fetch state comes from the asynchronous network response.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const timer = setInterval(() => void refresh(), 3600000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [])
  const cny = mode === 'manual' ? parseRate(manualCny) : (rates?.cny ?? NaN),
    usd = mode === 'manual' ? parseRate(manualUsd) : (rates?.usd ?? NaN)
  return (
    <Context
      value={{
        rates,
        cny,
        usd,
        ready:
          Number.isFinite(cny) && cny > 0 && Number.isFinite(usd) && usd > 0,
        mode,
        setMode,
        manualCny,
        manualUsd,
        setManualCny,
        setManualUsd,
        error,
        refresh,
      }}
    >
      {children}
    </Context>
  )
}
export function useRates() {
  const context = useContext(Context)
  if (!context) throw new Error('RatesProvider required')
  return context
}
export function RateSettings() {
  const r = useRates()
  return (
    <section className="panel panel-padding">
      <div className="wallet-row">
        <h2 className="text-lg font-semibold">Курсы и доставка</h2>
        <select
          aria-label="Источник курса"
          value={r.mode}
          onChange={(e) => r.setMode(e.target.value)}
        >
          <option value="nbt">Курс НБТ</option>
          <option value="manual">Ручной курс</option>
        </select>
      </div>
      {r.mode === 'manual' ? (
        <div className="wallet-form-grid mt-4">
          <label className="field">
            1 юань, смн
            <input
              inputMode="decimal"
              value={r.manualCny}
              onChange={(e) => r.setManualCny(e.target.value)}
            />
          </label>
          <label className="field">
            1 доллар, смн
            <input
              inputMode="decimal"
              value={r.manualUsd}
              onChange={(e) => r.setManualUsd(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <p className="subtitle mt-3">
          {r.rates
            ? `1 ¥ = ${r.rates.cny} смн · 1 $ = ${r.rates.usd} смн · дата ${r.rates.date}`
            : 'Получаем курсы…'}
        </p>
      )}
      <p className="subtitle mt-3 text-xs">
        Автокарго: 3,50 $/кг · средний вес: 120 г.{' '}
        <a
          href={NBT_SOURCE}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Источник: НБТ
        </a>
        . Курс обновляется ежедневно при работе в приложении. Цена фиксируется
        при сохранении товара.
      </p>
      {r.error && (
        <p role="status" className="mt-2 text-xs">
          {r.error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void r.refresh()}
          >
            Повторить
          </button>
        </p>
      )}
    </section>
  )
}
