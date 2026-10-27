import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'

const HEADER = ['Created Date', 'UUID', 'VIN', 'License Plate', 'State', 'Car Type', 'Company', 'Country']

test.describe('CSV export', () => {
  test('the export respects my filter and uses ; as separator', async ({ page }) => {
    const prefix = uniquePrefix('CSV')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto(`/baselines?query[vin]=${prefix}-A`)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'CSV' }).click()
    ])

    expect(download.suggestedFilename()).toMatch(/^baselines_\d+\.csv$/)
    const path = await download.path()
    const lines = (await readFile(path, 'utf8')).trim().split('\n')

    expect(lines[0].split(';')).toEqual(HEADER)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`${prefix}-A`)
  })

  test('blank values are exported as a dash', async ({ page }) => {
    const prefix = uniquePrefix('CSV')
    await createBaseline({ vin: `${prefix}-A` })

    const response = await page.request.get(`/baselines/export.csv?query[vin]=${prefix}-A`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')

    const row = (await response.text()).trim().split('\n')[1].split(';')
    expect(row[HEADER.indexOf('License Plate')]).toBe('-')
    expect(row[HEADER.indexOf('Company')]).toBe('-')
  })
})
