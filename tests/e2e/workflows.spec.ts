import { expect, test } from '@playwright/test'
const token = '11111111-1111-4111-8111-111111111111'

test('customer selection survives reload, filters, reviews, retries and confirms', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/o/'+token)
  await page.getByRole('button', { name: 'Увеличить: Шёлковый платок' }).click()
  await page.getByRole('button', { name: 'Увеличить: Шёлковый платок' }).click()
  await expect(page.getByRole('button', { name: /Проверить заказ/ })).toContainText('112,8')
  await page.reload()
  await expect(page.getByText('Ваш предыдущий выбор восстановлен.', {exact:true})).toBeVisible()
  await expect(page.getByLabel('Количество: Шёлковый платок')).toHaveText('2')
  await page.getByLabel('Поиск товаров').fill('нет такого')
  await expect(page.getByText('Товары не найдены.')).toBeVisible()
  await page.getByLabel('Поиск товаров').fill('')
  await page.getByRole('button', { name: /Проверить заказ/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Шёлковый платок × 2')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: /Проверить заказ/ }).click()
  let attempts = 0
  await page.route('**/functions/v1/buyer-public-order', async route => {
    expect(route.request().postDataJSON()).toEqual({ token, items: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 2 }] })
    attempts++
    await route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { error:'temporary' } : { order_number:12 } })
  })
  await page.getByRole('button', { name: 'Подтвердить заказ', exact:true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Подтвердить заказ', exact:true }).click()
  await expect(page.getByRole('heading', { name: 'Заказ отправлен' })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), `bayer:cart:v1:${token}`)).toBeNull()
  expect(errors).toEqual([])
})

test('buyer signs in, searches, filters, exports CSV, opens immutable order and signs out', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact:true }).fill('buyer@example.test')
  await page.getByLabel('Пароль', { exact:true }).fill('fixture-password')
  await page.getByRole('button', {name:'Войти',exact:true}).click()
  await expect(page).toHaveURL(/dashboard/)
  await expect(page.getByRole('heading', {name:'Осенняя закупка'})).toBeVisible()
  await page.getByLabel('Поиск заказов').fill('#00013')
  await expect(page.getByRole('heading', {name:'Зимняя коллекция'})).toBeVisible()
  await expect(page.getByRole('heading', {name:'Осенняя закупка'})).not.toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', {name:'Скачать CSV',exact:true}).click()
  expect((await download).suggestedFilename()).toBe('bayer-orders.csv')
  await page.getByLabel('Поиск заказов').fill('')
  await page.getByRole('button', {name:'Ждём клиента · 1',exact:true}).click()
  await expect(page.getByRole('heading', {name:'Зимняя коллекция'})).not.toBeVisible()
  await page.getByRole('heading', {name:'Осенняя закупка'}).click()
  await expect(page.getByText('Заказ опубликован: состав и цены зафиксированы.')).toBeVisible()
  await expect(page.getByRole('button', {name:'Изменить',exact:true})).toHaveCount(0)
  await page.getByRole('button', {name:'Выйти',exact:true}).click()
  await expect(page).toHaveURL(/login/)
})

test('invalid token shows friendly 404 and private pages redirect to login', async ({ page }) => {
  const response = await page.goto('/o/broken-token')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', {name:'Ссылка не найдена'})).toBeVisible()
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/login/)
})

test('catalog product creates no empty placeholder; failed saves roll back and can be retried', async ({page}) => {
  await page.goto('/login')
  await page.getByLabel('Email', {exact:true}).fill('buyer@example.test')
  await page.getByLabel('Пароль', {exact:true}).fill('fixture-password')
  await page.getByRole('button', {name:'Войти',exact:true}).click()
  await expect(page).toHaveURL(/dashboard/)
  await page.goto('/orders/new')
  await page.getByLabel('Название заказа', {exact:true}).fill('Новый тестовый заказ')
  await page.getByRole('button', {name:/Шёлковый платок/}).click()
  await expect(page.getByLabel('Название товара', {exact:true})).toHaveCount(1)
  await page.getByPlaceholder('35', {exact:true}).fill('')
  await page.getByRole('button', {name:'Создать заказ',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'Проверьте цену'})).toBeVisible()
  await page.getByPlaceholder('35', {exact:true}).fill('35,50')
  let rolledBack = false
  let fail = true
  await page.route('**/rest/v1/buyer_orders*', async route => {
    if (route.request().method() === 'POST') await route.fulfill({status:201,json:{id:token}})
    else if (route.request().method() === 'DELETE') { rolledBack = true; await route.fulfill({status:204}) }
    else await route.continue()
  })
  await page.route('**/rest/v1/buyer_products*', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    expect(route.request().postDataJSON().price).toBe(57.1)
    await route.fulfill({status: fail ? 500 : 201, json:fail ? {message:'fixture failure'} : {}})
  })
  await page.getByRole('button', {name:'Создать заказ',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'Изменения отменены'})).toBeVisible()
  expect(rolledBack).toBe(true)
  fail = false
  await page.getByRole('button', {name:'Создать заказ',exact:true}).click()
  await expect(page).toHaveURL('/orders/'+token)
})
