import { createClient } from '@supabase/supabase-js'
import { createTelegramNotifier } from './telegram.ts'
import { createHandler } from './handler.ts'

const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
Deno.serve(createHandler(client, createTelegramNotifier(client, {
  botToken: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '',
  chatId: Deno.env.get('TELEGRAM_CHAT_ID') ?? '',
  ownerId: Deno.env.get('TELEGRAM_BUYER_ID') ?? '',
})))
