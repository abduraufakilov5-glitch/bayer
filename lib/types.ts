export type OrderStatus = 'draft' | 'waiting' | 'received' | 'ordered' | 'completed'

export type Order = {
  id: string
  order_number: number
  title: string
  public_token: string
  status: OrderStatus
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

export type CatalogProduct = {
  id: string
  owner_id: string
  name: string
  price_cny: number
  work_price_somoni: number
  weight_grams: number
  supplier_url: string | null
  image_path: string
  active: boolean
  created_at: string
  updated_at: string
}

export type Product = {
  id: string
  order_id: string
  catalog_product_id: string | null
  name: string
  price: number | null
  price_cny: number | null
  cargo_cost: number | null
  work_price_somoni: number | null
  weight_grams: number | null
  supplier_url: string | null
  image_path: string
  sort_order: number
  created_at: string
}

export type SubmissionItem = {
  id: string
  product_id: string | null
  product_name: string
  price: number | null
  quantity: number
}

export type Submission = {
  id: string
  order_id: string
  total_quantity: number
  confirmed_at: string
  items: SubmissionItem[]
}

export type PublicProduct = {
  id: string
  name: string
  price: number | null
  image_url: string
}
