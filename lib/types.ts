export type OrderStatus =
  | 'draft'
  | 'waiting'
  | 'received'
  | 'ordered'
  | 'completed'

export type Order = {
  id: string
  order_number: number
  title: string
  public_token: string
  cargo_method: 'auto' | 'air'
  cargo_rate: number
  exchange_rate: number
  revision: number
  edit_version: number
  link_revoked: boolean
  status: OrderStatus
  confirmed_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type Product = {
  id: string
  order_id: string
  name: string
  price: number | null
  price_cny: number | null
  cargo_cost: number | null
  work_price_somoni: number | null
  weight_grams: number | null
  supplier_url: string | null
  image_path: string
  thumbnail_path: string | null
  sort_order: number
  created_at: string
}

export type SubmissionItem = {
  id: string
  product_id: string | null
  product_name: string
  price: number | null
  quantity: number
  cost_price: number | null
  buyer_earnings: number | null
  note: string
  image_path: string
  supplier_url: string | null
  price_cny: number | null
  cargo_cost: number | null
  work_price_somoni: number | null
}

export type FinanceSummary = {
  planned_revenue: number | null
  planned_cost: number | null
  planned_profit: number | null
  cash_received: number
  actual_spent: number | null
  actual_profit: number | null
}
export type Purchase = {
  product_id: string
  purchased_quantity: number
  cancelled_quantity: number
  actual_price_cny: number | null
  actual_exchange_rate: number | null
  actual_cargo: number | null
  extra_cost: number
  problem: string
  version: number
}

export type Submission = {
  id: string
  order_id: string
  total_quantity: number
  confirmed_at: string
  revision: number
  note: string
  items: SubmissionItem[]
}

export type PublicProduct = {
  id: string
  name: string
  price: number | null
  image_url: string
  full_image_url?: string
}

export type PublicReceipt = {
  note: string
  revision: number
  total_quantity: number
  confirmed_at: string
  items: {
    product_id: string
    product_name: string
    price: number | null
    quantity: number
    note: string
  }[]
}
