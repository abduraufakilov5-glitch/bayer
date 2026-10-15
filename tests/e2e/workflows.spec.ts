import { expect, test, type Page } from '@playwright/test'
const token = '11111111-1111-4111-8111-111111111111'
const photo = {
  name: 'Платок.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGPY2pf7Hx9mGBkKAH2Qq8Hjgp27AAAAAElFTkSuQmCC',
    'base64',
  ),
}
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('buyer@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
}
test.beforeEach(async ({ request }) => {
  expect((await request.post('http://127.0.0.1:54329/__reset')).ok()).toBe(true)
})
test('client quantity, zoom, notes, reload, retry, receipt and plain text XSS', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/o/' + token)
  await page
    .getByRole('button', { name: 'Увеличить фото: Шёлковый платок' })
    .click()
  await expect(page.getByAltText('Фото крупно')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByLabel('Количество: Шёлковый платок').fill('3')
  await page.getByRole('button', { name: /Готово/ }).click()
  await page.getByText('Добавить заметку', { exact: true }).click()
  await page
    .getByLabel('Заметка: Шёлковый платок')
    .fill('<script>alert(1)</script> Тёмный цвет')
  await page.getByLabel('Заметка к заказу').fill('Именно эти цвета')
  await page.getByRole('button', { name: 'Вернуться к выбору' }).click()
  await page.reload()
  await expect(page.getByLabel('Количество: Шёлковый платок')).toHaveValue('3')
  await page.getByRole('button', { name: /Готово/ }).click()
  await expect(page.getByLabel('Заметка к заказу')).toHaveValue(
    'Именно эти цвета',
  )
  await page.route(
    '**/functions/v1/buyer-public-order',
    async (route) => {
      await route.fulfill({ status: 503, json: { error: 'temporary' } })
    },
    { times: 1 },
  )
  await page
    .getByRole('button', { name: 'Подтвердить заказ', exact: true })
    .click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await page
    .getByRole('button', { name: 'Подтвердить заказ', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Заказ отправлен' }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText('<script>alert(1)</script> Тёмный цвет', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Именно эти цвета', { exact: true }),
  ).toBeVisible()
  await noOverflow(page)
  expect(errors).toEqual([])
})
test('unpriced selection and auth boundaries', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/login/)
  await page.goto('/o/broken-token')
  await expect(
    page.getByRole('heading', { name: 'Ссылка не найдена' }),
  ).toBeVisible()
  await page.goto('/o/' + token)
  await page.getByRole('button', { name: 'Увеличить: Сумка без цены' }).click()
  await expect(page.getByRole('button', { name: /Готово/ })).not.toContainText(
    'смн',
  )
  await page.getByRole('button', { name: /Готово/ }).click()
  await page
    .getByRole('button', { name: 'Подтвердить заказ', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Заказ отправлен' }),
  ).toBeVisible()
  await noOverflow(page)
})
test('photo draft, cargo, persisted editing after offline reload, add/remove and publication', async ({
  page,
  context,
}) => {
  await login(page)
  await expect(
    page.getByRole('link', { name: 'Каталог', exact: true }),
  ).toHaveCount(0)
  await page.goto('/orders/new')
  await page.getByLabel('Название заказа', { exact: true }).fill('Новый заказ')
  await page.getByLabel('Фото товаров').setInputFiles(photo)
  await expect(page.getByLabel('Название товара', { exact: true })).toHaveCount(
    1,
  )
  await page.getByLabel('Цена в юанях', { exact: true }).fill('40')
  await page.getByLabel('Работа, смн', { exact: true }).fill('10')
  await expect(page.getByText('68,4 смн', { exact: true })).toBeVisible()
  await page.getByRole('radio', { name: /Авиа/ }).check()
  await expect(page.getByText('70,8 смн', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Сохранено', {
    timeout: 20000,
  })
  await page.getByRole('button', { name: 'Создать заказ', exact: true }).click()
  await expect(page).toHaveURL(/orders\/[0-9a-f-]+$/)
  const id = page.url().split('/').pop()!
  await expect(page.getByLabel('Цена в юанях')).toHaveValue(/40(?:\.00)?/)
  // Keep the page reachable but fail Supabase writes, then reload online to recover IndexedDB.
  await page.route('**/rest/v1/rpc/buyer_save_draft', (r) => r.abort())
  await page.getByLabel('Название товара').fill('Сохранено без сети')
  await expect(page.getByRole('status')).toContainText('Локальная копия', {
    timeout: 15000,
  })
  await page.unroute('**/rest/v1/rpc/buyer_save_draft')
  await page.reload()
  await expect(page.getByLabel('Название товара')).toHaveValue(
    'Сохранено без сети',
  )
  await expect(page.getByRole('status')).toHaveText('Сохранено', {
    timeout: 20000,
  })
  await page
    .getByLabel('Фото товаров')
    .setInputFiles({ ...photo, name: 'Второй.png' })
  await expect(page.getByLabel('Название товара')).toHaveCount(2)
  await page
    .getByRole('button', { name: 'Удалить', exact: true })
    .last()
    .click()
  await expect(page.getByLabel('Название товара')).toHaveCount(1)
  await page.getByRole('radio', { name: /Авто/ }).check()
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(
    page.getByText('Заказ опубликован: состав и цены зафиксированы.'),
  ).toBeVisible()
  await noOverflow(page)
  await page.getByRole('button', { name: 'Отозвать ссылку' }).click()
  await page.getByRole('button', { name: 'Новая ссылка', exact: true }).click()
  await expect(page.locator('p[role=alert]')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Повторное согласование' })
    .click({ noWaitAfter: true })
    .catch(() => {}) // Native confirmation is dismissed by default.
  expect(id).toBeTruthy()
  await context.clearCookies()
})
test('admin purchase, payment, reapproval, history, theme and long names', async ({
  page,
  browser,
}) => {
  const customer = await browser.newPage()
  await customer.goto('http://127.0.0.1:3100/o/' + token)
  await customer.getByLabel('Количество: Шёлковый платок').fill('3')
  await customer.getByRole('button', { name: /Готово/ }).click()
  await customer
    .getByRole('button', { name: 'Подтвердить заказ', exact: true })
    .click()
  await expect(
    customer.getByRole('heading', { name: 'Заказ отправлен' }),
  ).toBeVisible()
  await customer.close()
  await login(page)
  await expect(page.getByText('Получено', { exact: true })).toBeVisible()
  await page
    .getByRole('heading', { name: 'Осенняя закупка', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Закупка', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Куплено, шт.').fill('1')
  await page
    .getByText('Фактические расходы и проблема', { exact: true })
    .click()
  await page.getByLabel('Цена за шт., ¥').fill('35')
  await page.getByLabel('Реальный курс ¥').fill('1.3')
  await page.getByLabel('Карго всего, смн').fill('2.4')
  await page
    .getByRole('button', { name: 'Сохранить закупку', exact: true })
    .click()
  await expect(page.getByText('Куплено 1 / 3', { exact: true })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Повторное согласование' }).click()
  await expect(page.getByLabel('Цена в юанях').first()).toBeVisible()
  await expect(page.getByText(/История подтверждений/)).toBeVisible()
  await page
    .getByLabel('Название товара')
    .first()
    .fill('Очень длинное название '.repeat(8))
  await page.getByRole('button', { name: 'Переключить тему' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await noOverflow(page)
  await page.screenshot({
    path: `output/playwright/${test.info().project.name}-draft-dark.png`,
    fullPage: true,
  })
})
test('HEIC conversion, damaged file recovery and thumbnail upload', async ({
  page,
}) => {
  test.setTimeout(60000)
  await login(page)
  await page.goto('/orders/new')
  await page.getByLabel('Название заказа').fill('HEIC')
  await page
    .getByLabel('Фото товаров')
    .setInputFiles('tests/fixtures/pixel.heic')
  await expect(
    page.getByRole('button', { name: 'Повторить обработку' }),
  ).toHaveCount(0)
  await expect(page.getByLabel('Название товара')).toHaveCount(1, {
    timeout: 30000,
  })
  await expect(page.getByRole('status')).toHaveText('Сохранено', {
    timeout: 30000,
  })
  await page.getByLabel('Фото товаров').setInputFiles({
    name: 'Повреждённое.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not an image'),
  })
  await expect(
    page.getByRole('button', { name: 'Повторить обработку' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Удалить', exact: true })
    .last()
    .click()
  await expect(
    page.getByRole('button', { name: 'Повторить обработку' }),
  ).toHaveCount(0)
  await noOverflow(page)
})
test('300 product public order stays scrollable without horizontal overflow', async ({
  page,
  request,
}) => {
  expect((await request.post('http://127.0.0.1:54329/__large')).ok()).toBe(true)
  await page.goto('/o/' + token)
  await expect(page.locator('article')).toHaveCount(300)
  await expect(page.locator('article img').first()).toHaveAttribute(
    'loading',
    'lazy',
  )
  await page.getByLabel('Количество: Платок 298', { exact: true }).fill('2')
  await expect(page.getByRole('button', { name: /Готово/ })).toContainText(
    '2 шт.',
  )
  await noOverflow(page)
})
