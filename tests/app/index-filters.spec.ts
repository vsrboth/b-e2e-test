import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts, expectRecordCount, filterBy } from '../../support/pages'

const VIN_COLUMN = 2

test.describe('baselines index', () => {
  test('filtering by VIN is case-insensitive and Reset clears it', async ({ page }) => {
    const prefix = uniquePrefix('FLT')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto('/baselines')
    await filterBy(page, { query_vin: prefix.toLowerCase() })

    await expectRecordCount(page, 'Baselines', 2)
    expect(await columnTexts(page, VIN_COLUMN)).toEqual(expect.arrayContaining([`${prefix}-A`, `${prefix}-B`]))
    await expect(page.locator('#query_vin')).toHaveValue(prefix.toLowerCase())

    await page.getByRole('link', { name: 'Reset' }).click()
    await expect(page.locator('#query_vin')).toHaveValue('')
  })

  test('a filter that matches nothing shows zero records', async ({ page }) => {
    await page.goto('/baselines')
    await filterBy(page, { query_vin: `NO-SUCH-VIN-${Date.now()}` })

    await expectRecordCount(page, 'Baselines', 0)
    await expect(page.locator('tbody tr')).toHaveCount(0)
  })

  test('filters can be combined', async ({ page }) => {
    const prefix = uniquePrefix('CMB')
    await createBaseline({ vin: `${prefix}-A`, licensePlate: 'PLATE-ONE' })
    await createBaseline({ vin: `${prefix}-B`, licensePlate: 'PLATE-TWO' })

    await page.goto('/baselines')
    await filterBy(page, { query_vin: prefix, query_license_plate: 'PLATE-TWO' })

    await expectRecordCount(page, 'Baselines', 1)
    expect(await columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-B`])
  })

  test('I can sort by VIN ascending and then descending, and sorting survives filtering', async ({ page }) => {
    const prefix = uniquePrefix('SRT')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto(`/baselines?query[vin]=${prefix}`)

    await page.locator('thead').getByRole('link', { name: /VIN/ }).click()
    await expect.poll(() => columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-A`, `${prefix}-B`])

    await page.locator('thead').getByRole('link', { name: /VIN/ }).click()
    await expect.poll(() => columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-B`, `${prefix}-A`])

    await filterBy(page, { query_vin: prefix })
    await expect.poll(() => columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-B`, `${prefix}-A`])
  })

  test('the CSV button keeps my filter', async ({ page }) => {
    await page.goto('/baselines?query[vin]=ABC')
    await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', /query%5Bvin%5D=ABC/)
  })
})

test.describe('rentals index', () => {
  test('I can filter by rental id', async ({ page }) => {
    const prefix = uniquePrefix('RNT')
    await createRental({ vin: `${prefix}-A` })
    await createRental({ vin: `${prefix}-B` })

    await page.goto('/rentals')
    await filterBy(page, { query_vin: `${prefix}-A` })

    await expectRecordCount(page, 'Rentals', 1)
  })
})

test.describe('damage events index', () => {
  test('I can filter by location', async ({ page }) => {
    const prefix = uniquePrefix('EVT')
    await createDamageEvent({ vin: `${prefix}-A`, location: 'loc_front' })
    await createDamageEvent({ vin: `${prefix}-B`, location: 'loc_rear' })

    await page.goto('/damage_events')
    await filterBy(page, { query_vin: prefix, query_location: 'rear' })

    await expectRecordCount(page, 'Damage Events', 1)
    await expect(page.locator('tbody')).toContainText(`${prefix}-B`)
  })
})
