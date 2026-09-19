# Bayer — Buyer Order MVP

Mobile-first buyer/client ordering app built with Next.js, TypeScript, Tailwind CSS and Supabase.

## MVP flow

Buyer signs in → creates an order → adds new product photos or picks saved products from the catalog → generates a public link → sends it to a client.

Client opens `/o/<token>` without registration → chooses quantities → sees the final client price → taps `Готово` → confirms `Подтвердить заказ`.

Buyer then sees the order as `Received` with confirmed items, quantities, final amount and confirmation time. `Заказано` moves it to `Ordered`; `Завершено` moves it to `Completed`.

## Buyer pricing

- Exchange rate: **1 CNY = 1.4 TJS**.
- Cargo: **30 TJS/kg**.
- Default scarf weight: **80 g**, so default cargo cost is **2.40 TJS per scarf**.
- Buyer work price is entered separately in TJS per item.
- Client price = purchase price in CNY × 1.4 + cargo + buyer work price.
- The client sees only the final client price; the cost breakdown stays in the admin.
- Weight can be adjusted for a specific product when needed.

## Bulk photo upload

The new-order form supports **up to 30 image files in one selection**. Each image becomes its own product card.

- Maximum size: **8 MB per individual photo**.
- You can add several batches.
- The filename is used as the initial product name.
- New products are automatically saved to the catalog.

## Product catalog

New products are automatically saved to the private buyer catalog. A later order can reuse the same product/photo and pricing without uploading the photo again. Catalog items can be searched, edited, hidden, and restored.

## iPhone PWA

Bayer is configured as a standalone iPhone web app:

- Web App Manifest.
- Standalone display mode.
- Dedicated 512px app icon and 180px Apple home-screen icon.
- Apple web-app metadata and iPhone safe-area support.
- Mobile-first admin and client UI.

To install on iPhone, the site must be available over HTTPS. In Safari open Bayer → **Share** → **Add to Home Screen** → **Add**. Apple documents that a site with a web app manifest and `display: standalone` can open as a Home Screen web app without normal browser UI. urlApple Web Apps overviewhttps://developer.apple.com/videos/play/wwdc2023/10120/

## Setup

1. Create/use the Supabase project.
2. Run the migration files from `supabase/migrations`.
3. Create the buyer account in Supabase Auth (email + password).
4. Copy `.env.example` to `.env.local` for local development if you are not using the built-in live-project fallbacks.
5. Run `npm install` and `npm run dev`.

For Vercel, add the public Supabase variables in Project Settings. Keep any secret key server-only and never prefix it with `NEXT_PUBLIC_`.

## Security model

Authenticated buyer data is protected with Supabase RLS. Product images live in a private Storage bucket and are only accessed by the buyer through authenticated Storage policies or by the public order page through short-lived signed URLs.

The public client never gets direct table access. A public order token is resolved server-side to exactly one order, and confirmation goes through the `buyer-public-order` Supabase Edge Function backed by a Postgres function that only accepts products belonging to that order.

## Stack

- Next.js 16.3.3
- React 19.3.0
- TypeScript 5.9.2
- Tailwind CSS 4.3.3
- Supabase SSR 0.12.7 / supabase-js 2.116.0

## Deployment note

The public client flow uses the `buyer-public-order` Supabase Edge Function. It runs with Supabase's server secret inside the Edge Function runtime, so the Next.js app does not need a secret key in the browser or repository.
