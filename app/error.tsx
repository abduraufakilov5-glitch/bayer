'use client'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-md px-5 py-20 text-center"><h1 className="text-2xl font-semibold">Не удалось загрузить страницу</h1><p className="mt-3 text-sm text-neutral-500">Проверьте подключение и попробуйте ещё раз. Если ошибка повторяется, обратитесь к байеру.</p><button onClick={reset} className="mt-6 rounded-2xl bg-black px-5 py-3 font-medium text-white">Повторить</button></main>
}
