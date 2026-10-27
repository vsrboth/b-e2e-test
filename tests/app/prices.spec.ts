import { test, expect, Page } from '@playwright/test'
import { uniqueCost } from '../../support/env'
import { flashMessage, findRow } from '../../support/pages'

async function createPrice(page: Page, cost: string) {
  await page.goto('/prices/new')
  await page.locator('#price_car_part').selectOption('door')
  await page.locator('#price_labor_hour').fill('1.7')
  await page.locator('#price_material_cost').fill(cost)
  await page.locator('#price_paint_hour').fill('3.7')
  await page.locator('#price_paint_material_cost').fill('230.50')
  await page.getByRole('button', { name: 'Save' }).click()
}

// every price this file creates has car_part 'door', which keeps the search well within one page on
// a shared environment - see findRow for why a plain 'tbody tr' locator is not reliable here.
function row(page: Page, cost: string) {
  return findRow(page, '/prices', 'query[car_part]=door', cost)
}

async function deletePrice(page: Page, cost: string) {
  const target = await row(page, cost)
  page.once('dialog', dialog => dialog.accept())
  await target.first().locator('.fa-trash-alt').click()
  await expect(await row(page, cost)).toHaveCount(0)
}

test.describe('pricing', () => {
  test('I can create, update and delete a price', async ({ page }) => {
    const cost = uniqueCost()

    await createPrice(page, cost)
    expect(await flashMessage(page)).toContain('Price was successfully created.')
    await expect(await row(page, cost)).toHaveCount(1)

    await (await row(page, cost)).locator('.fa-pencil-alt').click()
    await page.locator('#price_labor_hour').fill('2.50')
    await page.getByRole('button', { name: 'Save' }).click()
    expect(await flashMessage(page)).toContain('Price was successfully updated.')
    await expect(await row(page, cost)).toContainText('2.5')

    await deletePrice(page, cost)
  })

  test('I cannot create a price without a car part', async ({ page }) => {
    await page.goto('/prices/new')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('body')).toContainText("can't be blank")
  })

  test('I cannot save a negative labour value', async ({ page }) => {
    await page.goto('/prices/new')
    await page.locator('#price_car_part').selectOption('door')
    await page.locator('#price_labor_hour').fill('-1')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('body')).toContainText('must be greater than or equal to 0')
  })

  test('I cannot save a negative material cost', async ({ page }) => {
    await page.goto('/prices/new')
    await page.locator('#price_car_part').selectOption('door')
    await page.locator('#price_material_cost').fill('-5')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('body')).toContainText('must be greater than or equal to 0')
  })

  test('the price stays when I dismiss the delete confirmation', async ({ page }) => {
    const cost = uniqueCost()
    await createPrice(page, cost)
    await expect(await row(page, cost)).toHaveCount(1)

    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to delete this Pricing record?')
      return dialog.dismiss()
    })
    await (await row(page, cost)).locator('.fa-trash-alt').click()

    await expect(await row(page, cost)).toHaveCount(1)
    await deletePrice(page, cost)
  })

  test('an unknown price is a 404', async ({ request }) => {
    const response = await request.get('/prices/0/edit')
    expect(response.status()).toBe(404)
  })
})
