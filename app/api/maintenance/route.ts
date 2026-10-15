import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { runMaintenance } from '@/lib/server/maintenance'
import { createTelegramNotifier } from '@/supabase/functions/buyer-public-order/telegram'
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET,
    auth = request.headers.get('authorization') ?? ''
  if (
    !secret ||
    Buffer.byteLength(auth) !== Buffer.byteLength('Bearer ' + secret) ||
    !timingSafeEqual(Buffer.from(auth), Buffer.from('Bearer ' + secret))
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    return Response.json(
      { error: 'Maintenance not configured' },
      { status: 503 },
    )
  const deadline = Date.now() + 55000
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(10000, deadline - Date.now())),
          ),
        }),
    },
  })
  try {
    return Response.json(
      await runMaintenance(
        client,
        createTelegramNotifier(client, {
          botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
          chatId: process.env.TELEGRAM_CHAT_ID ?? '',
          ownerId: process.env.TELEGRAM_BUYER_ID ?? '',
          adminUrl: process.env.BAYER_ADMIN_URL ?? '',
        }),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    console.error('Bayer maintenance failed; queued work will retry')
    return Response.json({ error: 'Maintenance failed' }, { status: 503 })
  }
}
