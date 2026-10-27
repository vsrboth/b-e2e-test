import { test, expect, Page } from '@playwright/test'
import { uniqueCost } from '../../support/env'
import { flashMessage, findRow } from '../../support/pages'

const HEADER = 'car_part,side1,side2,damage,treatment,paint_hour,labor_hour,material_cost,paint_material_cost\n'

async function importCsv(page: Page, content: string) {
  await page.goto('/prices/import')
  await page.locator('input[type=file]').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from(content) })
  await page.getByRole('button', { name: 'Import' }).click()
}

// the imported price has car_part 'door', which keeps the search well within one page on a shared
// environment - see findRow for why a plain 'tbody tr' locator is not reliable here.
async function deletePrice(page: Page, cost: string) {
  const target = await findRow(page, '/prices', 'query[car_part]=door', cost)
  page.once('dialog', dialog => dialog.accept())
  await target.first().locator('.fa-trash-alt').click()
  await expect(await findRow(page, '/prices', 'query[car_part]=door', cost)).toHaveCount(0)
}

test.describe('pricing CSV import', () => {
  // @writes: creates a pricing record, which the test removes again
  test('@writes I can import a valid CSV file', async ({ page }) => {
    const cost = uniqueCost()

    await importCsv(page, `${HEADER}door,,,scratch,replace,1.5,2.5,${cost},175.00\n`)
    expect(await flashMessage(page)).toBe('Imported successfully')

    await deletePrice(page, cost)
  })

  test('rows with invalid values are reported', async ({ page }) => {
    await importCsv(page, `${HEADER}not_a_part,,,scratch,replace,1,1,1,1\n`)

    expect(await flashMessage(page)).toBe('Found some errors when importing')
    await expect(page.locator('body')).toContainText('The following errors were encountered:')
    await expect(page.locator('textarea')).toHaveValue(/not included in the list/)
  })

  test('negative values are reported', async ({ page }) => {
    await importCsv(page, `${HEADER}door,,,scratch,replace,1,-1,1,1\n`)

    await expect(page.locator('body')).toContainText('The following errors were encountered:')
  })

  test('a file that is not valid CSV is rejected', async ({ page }) => {
    await importCsv(page, 'car_part,side1\n"unclosed quote,front\n')

    expect(await flashMessage(page)).toContain('Your file is not valid.')
  })

  test('a header-only file imports nothing', async ({ page }) => {
    await importCsv(page, HEADER)

    expect(await flashMessage(page)).toBe('Imported successfully')
  })

  test('submitting without a file is rejected', async ({ page }) => {
    await page.goto('/prices/import')
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/prices/import') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Import' }).click()
    ])

    expect(response.status()).toBe(400)
  })

  test('the back link returns to the pricing table', async ({ page }) => {
    await page.goto('/prices/import')
    await page.getByRole('link', { name: 'Back to Pricing table' }).click()

    await expect(page).toHaveURL(/\/prices$/)
  })
})
