import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts, expectRecordCount, filterBy } from '../../support/pages'

// Records created through the API start in the "new" state. That is enough to prove the state filter
// works in both directions without needing to move records through the rest of the workflow.
test.describe('state filter', () => {
  test('baselines: only records in the selected state are listed', async ({ page }) => {
    const prefix = uniquePrefix('STATE')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto('/baselines')
    await page.locator('#query_state').selectOption({ label: 'New' })
    await filterBy(page, { query_vin: prefix })
    await expectRecordCount(page, 'Baselines', 2)
    expect(await columnTexts(page, 4)).toEqual(['New', 'New'])

    await page.locator('#query_state').selectOption({ label: 'Internal reviewed' })
    await page.getByRole('button', { name: 'Filter' }).click()
    await expectRecordCount(page, 'Baselines', 0)
  })

  test('the state list offers every workflow state', async ({ page }) => {
    await page.goto('/baselines')

    const labels = await page.locator('#query_state option').allInnerTexts()
    expect(labels).toEqual(expect.arrayContaining(['New', 'Damage prediction requested', 'Damage prediction resulted', 'Internal reviewed']))
  })

  test('rentals: filtering by a state with no records shows none', async ({ page }) => {
    const prefix = uniquePrefix('STATE')
    await createRental({ vin: `${prefix}-A` })

    await page.goto('/rentals')
    await page.locator('#query_state').selectOption({ label: 'New' })
    await filterBy(page, { query_vin: prefix })
    await expectRecordCount(page, 'Rentals', 1)

    await page.locator('#query_state').selectOption({ label: 'Damage prediction resulted' })
    await page.getByRole('button', { name: 'Filter' }).click()
    await expectRecordCount(page, 'Rentals', 0)
  })

  test('damage events: the selected state is kept after filtering', async ({ page }) => {
    const prefix = uniquePrefix('STATE')
    await createDamageEvent({ vin: `${prefix}-A` })

    await page.goto('/damage_events')
    await page.locator('#query_state').selectOption({ label: 'New' })
    await filterBy(page, { query_vin: prefix })

    await expectRecordCount(page, 'Damage Events', 1)
    await expect(page.locator('#query_state option:checked')).toHaveText('New')
  })
})
