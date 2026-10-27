import { test, expect } from '@playwright/test'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts, recordIdFromIndex } from '../../support/pages'

// The Ruby specs freeze the clock (Timecop) and compare exact dates. On a real environment the clock
// cannot be frozen, so these tests check the *format* and that the value is recent.
const DATE_FORMAT = /^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} (AM|PM)$/

test.describe('date display', () => {
  test('the index shows the created date in "dd Mon yyyy, hh:mm AM/PM" format', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })

    await page.goto(`/baselines?query[vin]=${baseline.vin}`)
    const [created] = await columnTexts(page, 1)

    expect(created.trim()).toMatch(DATE_FORMAT)
  })

  test('a record created now is shown with today\'s date', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })

    await page.goto(`/baselines?query[vin]=${baseline.vin}`)
    const [created] = await columnTexts(page, 1)

    // compare the day only (time zone differences between the runner and the server can shift the hour)
    const shown = new Date(created.replace(',', ''))
    const ageInHours = Math.abs(Date.now() - shown.getTime()) / 36e5
    expect(ageInHours).toBeLessThan(36)
  })

  test('the record page shows the same format under "Created Date"', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    await page.goto(`/baselines/${id}`)

    const created = page.locator('table.basic-info td', { hasText: 'Created Date' }).locator('.text-break')
    await expect(created).toHaveText(DATE_FORMAT)
  })

  test('the CSV export uses the same date format', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })

    const response = await page.request.get(`/baselines/export.csv?query[vin]=${baseline.vin}`)
    const firstValue = (await response.text()).trim().split('\n')[1].split(';')[0]

    expect(firstValue).toMatch(DATE_FORMAT)
  })
})
