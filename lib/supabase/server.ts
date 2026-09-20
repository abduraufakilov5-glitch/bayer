import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireSupabaseConfig } from './config'

export async function createClient() {
  const cookieStore = await cookies()
  const { url, key } = requireSupabaseConfig()

  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components cannot always mutate cookies. Proxy handles refreshes.
        }
      },
    },
  })
}
