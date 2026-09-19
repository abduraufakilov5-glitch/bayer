# Bayer — Buyer Order MVP

Mobile-first buyer/client ordering app built with Next.js, TypeScript, Tailwind CSS and Supabase.

## MVP flow

Buyer signs in → creates an order → adds product photos/name/optional price/supplier URL → generates a public link → sends it to a client.

Client opens `/o/<token>` without registration → chooses quantities → taps `Готово` → confirms `Подтвердить заказ`.

Buyer then sees the order as `Received` with the confirmed items, quantities, total quantity and confirmation time. `Заказано` moves it to `Ordered`; `Завершено` moves it to `Completed`.

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor run `supabase/migrations/001_init.sql`.
3. Create the buyer account in Supabase Auth (email + password).
4. Copy `.env.example` to `.env.local` and fill in the Supabase URL/public key and server secret key.
5. For optional Telegram notifications, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
6. Run `npm install` and `npm run dev`.

For Vercel, add the same environment variables in Project Settings. `SUPABASE_SECRET_KEY` is server-only and must never be prefixed with `NEXT_PUBLIC_`.

## Security model

Authenticated buyer data is protected with Supabase RLS. Product images live in a private Storage bucket and are only accessed by the buyer through authenticated Storage policies or by the public order page through short-lived signed URLs.

The public client never gets direct table access. A public order token is resolved server-side to exactly one order, and confirmation goes through a server endpoint backed by a Postgres function that accepts only products belonging to that order.

## Stack

- Next.js 16.3.3
- React 19.3.0
- TypeScript 5.9.2
- Tailwind CSS 4.3.3
- Supabase SSR 0.12.7 / supabase-js 2.116.0

## Deployment note

The public client flow uses the `buyer-public-order` Supabase Edge Function. It runs with Supabase's server secret inside the Edge Function runtime, so the Next.js app does not need a secret key in the browser or repository.
