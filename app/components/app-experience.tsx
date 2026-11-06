'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify); window.addEventListener('offline', notify)
  return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify) }
}
const subscribeDisplay = (notify: () => void) => {
  const query = matchMedia('(display-mode: standalone)')
  query.addEventListener('change', notify)
  window.addEventListener('appinstalled', notify)
  return () => { query.removeEventListener('change', notify); window.removeEventListener('appinstalled', notify) }
}
function display() {
  if (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) return 'installed'
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : 'browser'
}
export function ConnectionStatus() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  return !online && <p className="app-connection" role="status">Нет интернета. Показаны последние загруженные данные. Для сохранения подключитесь к сети.</p>
}
export function AppExperience({ wallet }: { wallet: boolean }) {
  const mode = useSyncExternalStore(subscribeDisplay, display, () => 'browser')
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [instructions, setInstructions] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
    }
    const install = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    window.addEventListener('beforeinstallprompt', install)
    return () => window.removeEventListener('beforeinstallprompt', install)
  }, [])
  return <>
    {wallet && mode !== 'installed' && !dismissed && (mode === 'ios' || prompt) &&
      <aside className="install-app" aria-label="Установка приложения">
        <div><strong>Мой баланс на экране «Домой»</strong><p>{instructions ? 'В Safari нажмите «Поделиться» → «На экран „Домой“» → «Добавить». Открывайте по новой иконке.' : 'Отдельное окно, быстрый доступ и запуск без вкладок.'}</p></div>
        <button type="button" onClick={async () => {
          if (!prompt) { setInstructions(true); return }
          await prompt.prompt()
          await prompt.userChoice
          setPrompt(null)
        }}>Установить</button>
        <button type="button" aria-label="Скрыть подсказку установки" onClick={() => setDismissed(true)}>×</button>
      </aside>}
  </>
}
