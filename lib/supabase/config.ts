export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://adviprrgbitenfubczfn.supabase.co'
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_SFjC8cschOIeirqKBTpg6w_-ZlWQ7fH'
  return { url, key }
}

export function requireSupabaseConfig() {
  const config = getSupabaseConfig()
  if (!config) throw new Error('Укажите NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY в настройках приложения.')
  return config
}
