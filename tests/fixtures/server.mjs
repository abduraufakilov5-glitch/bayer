// Loopback-only HTTP fixture for browser tests. No real accounts or orders.
import { createServer } from 'node:http'
const owner = '33333333-3333-4333-8333-333333333333'
const token = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'buyer@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const jwt = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub:owner,aud:'authenticated',role:'authenticated',exp:4102444800})).toString('base64url'), 'fixture'].join('.')
const orders = [
 { id: token, owner_id: owner, title: 'Осенняя закупка', order_number: 12, public_token: token, status: 'waiting', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z', confirmed_at: null, deleted_at:null },
 { id: productId, owner_id: owner, title: 'Зимняя коллекция', order_number: 13, public_token: productId, status: 'received', created_at: '2026-09-19T10:00:00Z', updated_at: '2026-09-19T10:00:00Z', confirmed_at: null, deleted_at:null },
]
const product = { id: productId, name: 'Шёлковый платок', price: 56.4, image_url: 'http://127.0.0.1:54329/photo.svg' }
createServer(async (req, res) => {
 res.setHeader('Access-Control-Allow-Origin', '*')
 res.setHeader('Access-Control-Allow-Headers', '*')
 res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
 res.setHeader('Content-Type', 'application/json')
 if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
 const url = new URL(req.url, 'http://127.0.0.1:54329')
 if (url.pathname.endsWith('/photo.svg')) { res.setHeader('Content-Type','image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#ebe1d5"/><path d="M60 100h360v400H60z" fill="#82604e"/><path d="m60 100 360 400M420 100 60 500" stroke="#dfcbb4" stroke-width="40"/></svg>'); return }
 let data = {}
 if (url.pathname === '/auth/v1/user') data = user
 else if (url.pathname === '/auth/v1/token') {
   orders[0].title = 'Осенняя закупка'; orders[0].deleted_at = null
   data = { access_token: jwt, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in:3600, user }
 }
 else if (url.pathname === '/auth/v1/logout') { res.writeHead(204); res.end(); return }
 else if (url.pathname === '/functions/v1/buyer-public-order') {
   if (req.method === 'POST') { data = {order_number:12,total_quantity:2,confirmed_at:'2026-09-20T12:00:00Z'} }
   else if (url.searchParams.get('token') !== token) { res.writeHead(404); res.end('{}'); return }
   else data = { order: orders[0], products: [product, {...product, id:'44444444-4444-4444-8444-444444444444', name:'Сумка без цены', price:null}] }
 }
 else if (url.pathname === '/rest/v1/buyer_orders') {
   if (req.method === 'PATCH') {
     const body = await new Promise(resolve => { let value=''; req.on('data',chunk => value += chunk); req.on('end',() => resolve(JSON.parse(value || '{}'))) })
     const match = orders.find(order => !url.searchParams.get('id') || order.id === url.searchParams.get('id')?.slice(3)) ?? orders[0]
     Object.assign(match, body)
     res.writeHead(204); res.end(); return
   }
   let rows = orders
   const deleted = url.searchParams.get('deleted_at')
   if (deleted === 'is.null') rows = rows.filter(o => o.deleted_at === null)
   if (deleted === 'not.is.null') rows = rows.filter(o => o.deleted_at !== null)
   const status = url.searchParams.get('status')
   if (status?.startsWith('eq.')) rows = rows.filter(o => o.status === status.slice(3))
   if (status?.startsWith('neq.')) rows = rows.filter(o => o.status !== status.slice(4))
   const title = url.searchParams.get('title')
   if (title) rows = rows.filter(o => o.title.toLowerCase().includes(title.slice(6).replace(/%/g,'').toLowerCase()))
   const num = url.searchParams.get('order_number')
   if (num) rows = rows.filter(o => o.order_number === Number(num.slice(3)))
   res.setHeader('Content-Range', `0-${Math.max(rows.length-1,0)}/${rows.length}`)
   res.setHeader('Access-Control-Expose-Headers','Content-Range')
   data = url.searchParams.has('id') ? orders[0] : rows
 }
 else if (url.pathname === '/rest/v1/rpc/buyer_finance_summary') data = [{revenue:451.2,spent:411.2,earned:40,month_revenue:169.2,month_spent:154.2,month_earned:15,confirmed_orders:2}]
 else if (url.pathname === '/rest/v1/buyer_products') data = [{...product,order_id:token,catalog_product_id:null,price_cny:35,work_price_somoni:5,weight_grams:80,cargo_cost:2.4,image_path:owner+'/photo.svg',sort_order:0}]
 else if (url.pathname === '/rest/v1/buyer_submissions') data = null
 else if (url.pathname === '/rest/v1/buyer_catalog_products') data = [{ id:productId,owner_id:owner,name:product.name,price_cny:35,work_price_somoni:5,weight_grams:80,supplier_url:null,image_path:owner+'/photo.svg',active:true,created_at:'2026-09-20T10:00:00Z' }]
 else if (url.pathname === '/storage/v1/object/sign/buyer-product-images') data = [{path:owner+'/photo.svg',signedURL:'/photo.svg'}]
 else if (url.pathname.startsWith('/storage/v1/object/sign/')) data = { signedURL:'/photo.svg' }
 res.end(JSON.stringify(data))
}).listen(54329,'127.0.0.1')
