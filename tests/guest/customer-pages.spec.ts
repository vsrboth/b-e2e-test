import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'

test.describe('customer pages (no login)', () => {
  test('an unknown baseline link is a 404', async ({ request }) => {
    const response = await request.get('/damage_photo/baselines/00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(404)
  })

  test('an unknown rental link is a 404', async ({ request }) => {
    const response = await request.get('/damage_photo/rentals/00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(404)
  })

  test('the baseline page shows the VIN and the upload instructions', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('BASE') })

    await page.goto(baseline.customerPath)

    await expect(page.locator('header')).toContainText('Vehicle Baseline')
    await expect(page.locator('body')).toContainText(`VIN: ${baseline.vin}`)
    await expect(page.locator('.required-loc')).toHaveCount(9)
  })

  test('the send button is disabled until all required photos are uploaded', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('BASE') })

    await page.goto(baseline.customerPath)

    await expect(page.locator('#termOfService .btn-info.disabled')).toHaveCount(1)
  })

  test('the rental thank-you page is shown in English', async ({ page }) => {
    const rental = await createRental({ vin: uniquePrefix('RENT') })

    await page.goto(`${rental.customerPath}/thank_you`)

    await expect(page.locator('body')).toContainText('Thank you!')
    await expect(page.locator('body')).toContainText('Vehicle Rental')
    await expect(page.locator('body')).toContainText(rental.vin)
  })

  test('the rental thank-you page is shown in Japanese when the record language is ja', async ({ page }) => {
    const rental = await createRental({ vin: uniquePrefix('RENT'), language: 'ja' })

    await page.goto(`${rental.customerPath}/thank_you`)

    await expect(page.locator('body')).toContainText('ありがとうございました。')
    await expect(page.locator('body')).toContainText('車両レンタル')
  })

  test('the damage event thank-you page shows the VIN', async ({ page }) => {
    const damageEvent = await createDamageEvent({ vin: uniquePrefix('EVT') })

    await page.goto(`${damageEvent.customerPath}/thank_you`)

    await expect(page.locator('body')).toContainText('Thank you!')
    await expect(page.locator('body')).toContainText(damageEvent.vin)
  })
})
