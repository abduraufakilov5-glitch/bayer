import type { Order, OrderStatus } from './types'

export const statusLabels: Record<OrderStatus, string> = {
  draft: 'Черновик', waiting: 'Ждём клиента', received: 'Подтверждён', ordered: 'Заказано', completed: 'Завершено',
}

export function filterOrders(orders: Order[], query: string, status: OrderStatus | 'all', sort: 'newest' | 'oldest') {
  const q = query.trim().toLocaleLowerCase('ru')
  return orders.filter(order => (status === 'all' || order.status === status) &&
    (!q || order.title.toLocaleLowerCase('ru').includes(q) ||
      String(order.order_number).padStart(5, '0').includes(q.replace(/^#/, ''))))
    .sort((a, b) => (sort === 'newest' ? -1 : 1) * a.created_at.localeCompare(b.created_at))
}

export function toCsv(rows: (string | number | null)[][]): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '')
    // Prevent formulas when opening untrusted names/titles in spreadsheet apps.
    if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text
    return '"' + text.replace(/"/g, '""') + '"'
  }).join(';')).join('\r\n')
}

export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
