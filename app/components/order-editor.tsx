'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { readDraft, writeDraft, removeDraft } from '@/lib/draft-store'
import { prepareImage, IMAGE_TYPES } from '@/lib/image-processing'
import {
  parseDecimal,
  parseOptionalPrice,
  validPricing,
  safeSupplierUrl,
} from '@/lib/validation'
import { CARGO_RATES, formatSomoni, type CargoMethod } from '@/lib/pricing'
import { expiresAt } from '@/lib/retention'
import type { Order, Product } from '@/lib/types'
import { PricingFields, type PricingDraft } from './pricing-fields'

type Item = PricingDraft & {
  id: string
  name: string
  supplierUrl: string
  imagePath: string | null
  thumbnailPath: string | null
  blob: Blob | null
  thumb: Blob | null
  preview: string
  error: string
  legacyPrice?: number | null
}
type Draft = {
  id: string
  title: string
  cargo: CargoMethod
  version: number
  products: Item[]
  created: string
}
export function OrderEditor({
  order,
  products = [],
  onPublished,
}: {
  order?: Order
  products?: Product[]
  onPublished?: (order: Order) => void
}) {
  const router = useRouter(),
    [state, setState] = useState<Draft | null>(null),
    [owner, setOwner] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false),
    [saveTick, setSaveTick] = useState(0),
    [imageFailures, setImageFailures] = useState<Record<string, boolean>>({}),
    [defaults, setDefaults] = useState({ workPrice: '0', weightGrams: '80' })
  const current = useRef<Draft | null>(null),
    saving = useRef(false),
    urls = useRef(new Set<string>()),
    generation = useRef(0),
    persistChain = useRef(Promise.resolve()),
    expires = useRef(0),
    imageRetry = useRef(new Map<string, number>())
  useEffect(() => {
    let live = true
    async function load() {
      const client = createClient(),
        {
          data: { user },
        } = await client.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }
      let id = order?.id
      if (!id) {
        id = localStorage.getItem('bayer:new:' + user.id) ?? crypto.randomUUID()
        localStorage.setItem('bayer:new:' + user.id, id)
      }
      const cached = await readDraft<Draft>(id, user.id)
      let draft: Draft = cached?.data ?? {
        id,
        title: order?.title ?? '',
        cargo: order?.cargo_method ?? 'auto',
        version: order?.edit_version ?? 0,
        created: order?.created_at ?? new Date().toISOString(),
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          priceCny: p.price_cny == null ? '' : String(p.price_cny),
          workPrice: String(p.work_price_somoni ?? 0),
          weightGrams: String(p.weight_grams ?? 80),
          supplierUrl: p.supplier_url ?? '',
          imagePath: p.image_path,
          thumbnailPath: p.thumbnail_path,
          blob: null,
          thumb: null,
          preview: '',
          error: '',
          legacyPrice: p.price_cny == null ? p.price : null,
        })),
      }
      if (cached && order && cached.data.version < order.edit_version) {
        setConflict(true)
        draft = { ...draft, version: cached.data.version }
        setMessage(
          'Есть локальные изменения. Если другая вкладка уже сохранила заказ, сначала обновите данные.',
        )
      }
      const signed = await client.storage
        .from('buyer-product-images')
        .createSignedUrls(
          draft.products
            .filter((p) => !p.blob && p.imagePath)
            .map((p) => p.thumbnailPath ?? p.imagePath!),
          3600,
        )
      const images = new Map(signed.data?.map((p) => [p.path, p.signedUrl]))
      draft = {
        ...draft,
        products: draft.products.map((p) => {
          const preview = p.blob
            ? URL.createObjectURL(p.thumb ?? p.blob)
            : (images.get(p.thumbnailPath ?? p.imagePath ?? '') ?? '')
          if (p.blob) urls.current.add(preview)
          return {
            ...p,
            preview,
            error:
              p.error === 'Обработка фото…'
                ? 'Обработка прервалась. Повторите.'
                : p.error,
          }
        }),
      }
      if (!live) return
      expires.current = expiresAt(draft.created)
      current.current = draft
      setOwner(user.id)
      setState(draft)
      setDirty(!!cached)
    }
    void load().catch(() =>
      setMessage(
        'Не удалось восстановить редактор. Проверьте доступ к хранилищу браузера и обновите страницу.',
      ),
    )
    const previews = urls.current
    return () => {
      live = false
      previews.forEach((u) => URL.revokeObjectURL(u))
    }
    // Initial props describe one mounted editor; subsequent refreshes must not erase typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function persist(next: Draft) {
    const snapshot = {
      ...next,
      products: next.products.map((p) => ({ ...p, preview: '' })),
    }
    persistChain.current = persistChain.current
      .catch(() => {})
      .then(() =>
        writeDraft({
          id: next.id,
          owner,
          updatedAt: Date.now(),
          expiresAt: expires.current,
          data: snapshot,
        }),
      )
    void persistChain.current.catch(() =>
      setMessage(
        'Локальная копия не сохранена: память устройства заполнена. Сохраните на сервер.',
      ),
    )
  }
  function change(patch: Partial<Draft>) {
    if (!current.current) return
    const next = { ...current.current, ...patch }
    current.current = next
    generation.current++
    setState(next)
    setDirty(true)
    persist(next)
  }
  function update(id: string, patch: Partial<Item>) {
    change({
      products: current.current!.products.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    })
  }
  const renewImage = useCallback(async (p: Item, force = false) => {
    if (
      !p.imagePath ||
      (!force && Date.now() - (imageRetry.current.get(p.id) ?? 0) < 30000)
    )
      return
    imageRetry.current.set(p.id, Date.now())
    const r = await createClient()
      .storage.from('buyer-product-images')
      .createSignedUrl(p.thumbnailPath ?? p.imagePath, 3600)
    if (r.error || !r.data?.signedUrl) {
      setImageFailures((v) => ({ ...v, [p.id]: true }))
      return
    }
    const next = {
      ...current.current!,
      products: current.current!.products.map((i) =>
        i.id === p.id ? { ...i, preview: r.data.signedUrl } : i,
      ),
    }
    current.current = next
    setState(next)
    setImageFailures((v) => ({ ...v, [p.id]: false }))
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function loadServerVersion() {
    if (
      busy ||
      !current.current ||
      !confirm(
        'Заменить локальную копию серверной версией? Несохранённые правки на этом устройстве будут отброшены. Сначала сверьте или скопируйте нужные значения.',
      )
    )
      return
    setBusy(true)
    try {
      const client = createClient(),
        id = current.current.id,
        [o, p] = await Promise.all([
          client.from('buyer_orders').select('*').eq('id', id).single(),
          client
            .from('buyer_products')
            .select('*')
            .eq('order_id', id)
            .order('sort_order'),
        ])
      if (o.error || p.error || o.data.status !== 'draft')
        throw new Error(
          'Заказ больше не является черновиком. Обновите страницу.',
        )
      const signed = await client.storage
        .from('buyer-product-images')
        .createSignedUrls(
          (p.data as Product[]).map((p) => p.thumbnail_path ?? p.image_path),
          3600,
        )
      const images = new Map(signed.data?.map((i) => [i.path, i.signedUrl]))
      const fresh: Draft = {
        id,
        title: o.data.title,
        cargo: o.data.cargo_method,
        version: o.data.edit_version,
        created: o.data.created_at,
        products: (p.data as Product[]).map((p) => ({
          id: p.id,
          name: p.name,
          priceCny: p.price_cny == null ? '' : String(p.price_cny),
          workPrice: String(p.work_price_somoni ?? 0),
          weightGrams: String(p.weight_grams ?? 80),
          supplierUrl: p.supplier_url ?? '',
          imagePath: p.image_path,
          thumbnailPath: p.thumbnail_path,
          blob: null,
          thumb: null,
          preview: images.get(p.thumbnail_path ?? p.image_path) ?? '',
          error: '',
          legacyPrice: p.price_cny == null ? p.price : null,
        })),
      }
      await persistChain.current.catch(() => {})
      await writeDraft({
        id,
        owner,
        updatedAt: Date.now(),
        expiresAt: expiresAt(fresh.created),
        data: {
          ...fresh,
          products: fresh.products.map((p) => ({ ...p, preview: '' })),
        },
      })
      generation.current++
      current.current = fresh
      setState(fresh)
      setDirty(false)
      setConflict(false)
      setMessage('Загружена серверная версия')
      urls.current.forEach((url) => URL.revokeObjectURL(url))
      urls.current.clear()
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : 'Не удалось загрузить серверную версию. Локальная копия сохранена.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function add(files: FileList | null) {
    if (!files || !current.current) return
    if (
      files.length > 30 ||
      current.current.products.length + files.length > 300
    ) {
      setMessage('До 30 фото за раз, до 300 товаров.')
      return
    }
    setBusy(true)
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        setMessage(
          'Фото ' + file.name + ' больше 20 МБ. Выберите меньший файл.',
        )
        continue
      }
      const id = crypto.randomUUID()
      change({
        products: [
          ...current.current.products,
          {
            id,
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
            priceCny: '',
            ...defaults,
            supplierUrl: '',
            imagePath: null,
            thumbnailPath: null,
            blob: file,
            thumb: null,
            preview: '',
            error: 'Обработка фото…',
          },
        ],
      })
      await persistChain.current.catch(() => {})
      try {
        const processed = await prepareImage(file),
          preview = URL.createObjectURL(processed.thumbnail)
        urls.current.add(preview)
        update(id, {
          blob: processed.image,
          thumb: processed.thumbnail,
          preview,
          error: '',
        })
      } catch (e) {
        update(id, { error: e instanceof Error ? e.message : 'Ошибка фото' })
      }
      await persistChain.current.catch(() => {})
    }
    setBusy(false)
    setSaveTick((t) => t + 1)
  }
  async function save(navigate = false, publish = false) {
    if (saving.current || !current.current) return
    const snapshot = current.current,
      gen = generation.current
    if (
      !snapshot.title.trim() ||
      snapshot.products.some(
        (p) =>
          p.error ||
          !validPricing(
            p.name,
            parseOptionalPrice(p.priceCny) ?? 0,
            parseDecimal(p.workPrice),
            Number(p.weightGrams),
          ) ||
          (p.supplierUrl && !safeSupplierUrl(p.supplierUrl)),
      )
    ) {
      setMessage('Заполните название, проверьте параметры и фотографии.')
      return
    }
    saving.current = true
    setBusy(true)
    setMessage('Сохраняем…')
    try {
      const client = createClient(),
        items: {
          id: string
          name: string
          price_cny: number | null
          work_price_somoni: number
          weight_grams: number
          supplier_url: string | null
          image_path: string
          thumbnail_path: string | null
        }[] = []
      for (const p of snapshot.products) {
        setMessage(
          `Сохраняем фото ${items.length + 1} / ${snapshot.products.length}…`,
        )
        const path = p.imagePath ?? `${owner}/${snapshot.id}/${p.id}.jpg`,
          thumbnail = p.imagePath
            ? (p.thumbnailPath ?? null)
            : `${owner}/${snapshot.id}/${p.id}-thumb.jpg`
        if (!p.imagePath) {
          if (!p.blob || !p.thumb)
            throw new Error('Повторите обработку фото ' + p.name)
          for (const [key, blob] of [
            [path, p.blob],
            [thumbnail!, p.thumb],
          ] as const) {
            const r = await client.storage
              .from('buyer-product-images')
              .upload(key, blob, { contentType: 'image/jpeg', upsert: false })
            if (
              r.error &&
              !['409', 'Duplicate'].includes(String(r.error.statusCode)) &&
              !/already exists/i.test(r.error.message)
            )
              throw new Error(
                'Не загрузилось фото «' + p.name + '». Повторите сохранение.',
              )
          }
        }
        items.push({
          id: p.id,
          name: p.name,
          price_cny: parseOptionalPrice(p.priceCny),
          work_price_somoni: parseDecimal(p.workPrice),
          weight_grams: Number(p.weightGrams),
          supplier_url: safeSupplierUrl(p.supplierUrl),
          image_path: path,
          thumbnail_path: thumbnail,
        })
      }
      const { data, error } = await client.rpc('buyer_save_draft', {
        p_id: snapshot.id,
        p_title: snapshot.title,
        p_cargo: snapshot.cargo,
        p_version: snapshot.version,
        p_products: items,
      })
      if (error?.message.includes('another tab')) setConflict(true)
      if (error)
        throw new Error(
          error.message.includes('another tab')
            ? 'Заказ изменён в другой вкладке. Локальная копия сохранена. Откройте заказ заново, чтобы сверить изменения.'
            : 'Не удалось сохранить заказ. Локальная копия и фото сохранены. Повторите.',
        )
      const saved = data as Order
      const next = {
        ...current.current!,
        version: saved.edit_version,
        products: current.current!.products.map((p) => {
          const stored = items.find((i) => i.id === p.id)
          return stored
            ? {
                ...p,
                blob: null,
                thumb: null,
                imagePath: stored.image_path,
                thumbnailPath: stored.thumbnail_path,
              }
            : p
        }),
      }
      current.current = next
      setState(next)
      persist(next)
      await persistChain.current
      if (gen === generation.current) {
        setDirty(false)
        setMessage('Сохранено')
      } else setMessage('Сохраняем следующие изменения…')
      if (publish) {
        if (gen !== generation.current)
          throw new Error(
            'Есть новые изменения. Сохраните и опубликуйте ещё раз.',
          )
        const r = await client.rpc('buyer_order_action', {
          p_id: next.id,
          p_action: 'publish',
        })
        if (r.error)
          throw new Error('Не удалось опубликовать. Черновик сохранён.')
        await removeDraft(next.id)
        localStorage.removeItem('bayer:new:' + owner)
        if (onPublished) onPublished(r.data as Order)
        else router.push('/orders/' + next.id)
        return
      }
      if (navigate && gen !== generation.current)
        throw new Error(
          'Появились новые изменения. Дождитесь сохранения и повторите переход.',
        )
      if (navigate) {
        await removeDraft(next.id)
        localStorage.removeItem('bayer:new:' + owner)
        router.push('/orders/' + next.id)
        router.refresh()
      }
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : 'Нет связи. Локальная копия сохранена.',
      )
    } finally {
      saving.current = false
      setBusy(false)
      if (gen !== generation.current) setSaveTick((t) => t + 1)
    }
  }
  useEffect(() => {
    if (!dirty || busy || !state) return
    const timer = setTimeout(() => {
      void save()
    }, 1500)
    return () => clearTimeout(timer)
    // save reads the latest state through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, dirty, saveTick])
  if (!state)
    return <p role="status">{message || 'Восстанавливаем черновик…'}</p>
  return (
    <div className="editor editor-stack">
      <label className="field">
        Название заказа
        <input
          aria-label="Название заказа"
          maxLength={140}
          value={state.title}
          onChange={(e) => change({ title: e.target.value })}
        />
      </label>
      <fieldset className="panel panel-padding">
        <legend>Карго для всего заказа</legend>
        <div className="flex gap-3">
          {(['auto', 'air'] as const).map((c) => (
            <label key={c} className="btn btn-secondary">
              <input
                type="radio"
                name="cargo"
                checked={state.cargo === c}
                onChange={() => change({ cargo: c })}
              />
              {c === 'auto' ? 'Авто' : 'Авиа'} · {CARGO_RATES[c]} смн/кг
            </label>
          ))}
        </div>
      </fieldset>
      <details className="panel panel-padding">
        <summary>Общие параметры товаров</summary>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="field">
            Общая работа, смн
            <input
              inputMode="decimal"
              value={defaults.workPrice}
              onChange={(e) =>
                setDefaults({ ...defaults, workPrice: e.target.value })
              }
            />
          </label>
          <label className="field">
            Общий вес, г
            <input
              inputMode="numeric"
              value={defaults.weightGrams}
              onChange={(e) =>
                setDefaults({ ...defaults, weightGrams: e.target.value })
              }
            />
          </label>
        </div>
        <button
          className="btn btn-secondary mt-3"
          onClick={() =>
            change({
              products: state.products.map((p) => ({ ...p, ...defaults })),
            })
          }
        >
          Применить ко всем
        </button>
      </details>
      {state.products.map((p, index) => (
        <article className="panel product-editor" key={p.id}>
          <div className="product-editor-top">
            <span>Товар {index + 1}</span>
            <div className="flex gap-3">
              <button
                className="text-button"
                aria-label={'Выше: ' + p.name}
                disabled={!index}
                onClick={() => {
                  const items = [...state.products]
                  ;[items[index - 1], items[index]] = [
                    items[index],
                    items[index - 1],
                  ]
                  change({ products: items })
                }}
              >
                ↑
              </button>
              <button
                className="text-button danger"
                onClick={() =>
                  change({
                    products: state.products.filter((i) => i.id !== p.id),
                  })
                }
              >
                Удалить
              </button>
            </div>
          </div>
          <div className="product-editor-body">
            <div>
              {p.preview ? (
                <Image
                  unoptimized
                  loading="lazy"
                  width={480}
                  height={600}
                  src={p.preview}
                  alt={p.name}
                  onError={() => {
                    setImageFailures((v) => ({ ...v, [p.id]: true }))
                    void renewImage(p)
                  }}
                  className="product-preview"
                />
              ) : (
                <p role="alert">{p.error || 'Фото недоступно'}</p>
              )}
              {p.imagePath && (imageFailures[p.id] || !p.preview) && (
                <button
                  className="text-button"
                  onClick={() => void renewImage(p, true)}
                >
                  Повторить фото
                </button>
              )}
            </div>
            <div>
              <label className="field">
                Название товара
                <input
                  maxLength={200}
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                />
              </label>
              <PricingFields
                rate={CARGO_RATES[state.cargo]}
                value={p}
                onChange={(patch) => update(p.id, patch)}
              />
              {p.legacyPrice != null && !p.priceCny.trim() && (
                <p className="subtitle text-xs">
                  Сохранится прежняя цена {formatSomoni(p.legacyPrice)}. Укажите
                  закупку для пересчёта.
                </p>
              )}
              <label className="field">
                Ссылка поставщика
                <input
                  type="url"
                  value={p.supplierUrl}
                  onChange={(e) =>
                    update(p.id, { supplierUrl: e.target.value })
                  }
                />
              </label>
              {p.error && p.error !== 'Обработка фото…' && (
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    try {
                      const r = await prepareImage(p.blob!)
                      const preview = URL.createObjectURL(r.thumbnail)
                      urls.current.add(preview)
                      update(p.id, {
                        blob: r.image,
                        thumb: r.thumbnail,
                        preview,
                        error: '',
                      })
                    } catch (e) {
                      setMessage(String(e))
                    }
                  }}
                >
                  Повторить обработку
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
      <label className="upload-zone">
        <span>
          Добавить фото товаров
          <small>JPG, PNG, WebP, HEIC · до 20 МБ · до 30 за раз</small>
        </span>
        <input
          aria-label="Фото товаров"
          type="file"
          accept={IMAGE_TYPES}
          multiple
          disabled={busy}
          onChange={(e) => {
            void add(e.target.files)
            e.target.value = ''
          }}
        />
      </label>
      {conflict && (
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void loadServerVersion()}
        >
          Загрузить серверную версию
        </button>
      )}
      <p role="status" className="subtitle">
        {message || 'Изменения сохраняются автоматически'}
      </p>
      <button
        className="btn btn-primary"
        disabled={busy || !state.products.length}
        onClick={() => void save(true)}
      >
        {busy ? 'Сохраняем…' : order ? 'Сохранить черновик' : 'Создать заказ'}
      </button>
      <button
        className="btn btn-secondary"
        disabled={busy || !state.products.length}
        onClick={() => void save(true, true)}
      >
        Опубликовать
      </button>
    </div>
  )
}
