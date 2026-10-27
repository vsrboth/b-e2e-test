import { test, expect } from '@playwright/test'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts } from '../../support/pages'

const PER_PAGE = 20 // WillPaginate.per_page in config/initializers/will_paginate.rb

test.describe('pagination', () => {
  // Pagination needs more than one page of records, so create exactly that many under our own unique prefix
  // and filter by the prefix. The test never depends on what else is on the shared environment.
  test('records are split into pages of 20 and the filter survives page changes', async ({ page }) => {
    test.setTimeout(90_000)
    const prefix = uniquePrefix('PAGE')
    const vins = Array.from({ length: PER_PAGE + 1 }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`)
    for (let i = 0; i < vins.length; i += 7) {
      await Promise.all(vins.slice(i, i + 7).map(vin => createBaseline({ vin })))
    }

    await page.goto(`/baselines?query[vin]=${prefix}&sort_column=vin&sort_direction=asc`)
    await expect(page.locator('tbody tr')).toHaveCount(PER_PAGE)
    await expect(page.locator('.pagination')).toBeVisible()
    expect(await columnTexts(page, 2)).toEqual(vins.slice(0, PER_PAGE))

    await page.locator('.pagination').getByRole('link', { name: 'Page 2' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page).toHaveURL(new RegExp(`query%5Bvin%5D=${prefix}`))
    await expect(page.locator('tbody tr')).toHaveCount(1)
    expect(await columnTexts(page, 2)).toEqual([vins[PER_PAGE]])

    await page.locator('.pagination').getByRole('link', { name: 'Page 1' }).click()
    await expect(page.locator('tbody tr')).toHaveCount(PER_PAGE)
  })

  test('there is no second page when the results fit on one', async ({ page }) => {
    const prefix = uniquePrefix('PAGE')
    await createBaseline({ vin: `${prefix}-A` })

    await page.goto(`/baselines?query[vin]=${prefix}`)

    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('.pagination').getByRole('link', { name: 'Page 2' })).toHaveCount(0)
  })
})
