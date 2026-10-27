import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { newGuestContext } from '../../support/guest'
import { recordIdFromIndex } from '../../support/pages'

// /pdf needs the numeric record id, which the API does not return, so the id is read from the index page.
// The report only renders as .pdf (wkhtmltopdf); "debug=1" makes the server return the HTML it would print.
test.describe('PDF report', () => {
  test('a baseline report renders as HTML with the VIN (debug mode)', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    const response = await page.request.get(`/pdf.pdf?resource=baseline&id=${id}&debug=1`)

    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(baseline.vin)
  })

  test('a damage event report renders as HTML with the VIN (debug mode)', async ({ page }) => {
    const damageEvent = await createDamageEvent({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/damage_events', damageEvent.vin)

    const response = await page.request.get(`/pdf.pdf?resource=damage_event&id=${id}&debug=1`)

    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(damageEvent.vin)
  })

  test('a rental report renders as HTML with the VIN (debug mode)', async ({ page }) => {
    const rental = await createRental({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/rentals', rental.vin)

    const response = await page.request.get(`/pdf.pdf?resource=rental&id=${id}&debug=1`)

    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(rental.vin)
  })

  test('the real PDF is generated and is a valid PDF file', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    const response = await page.request.get(`/pdf.pdf?resource=baseline&id=${id}`)

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-')
  })

  test('the report is available without logging in', async ({ page, browser, baseURL }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    const guest = await newGuestContext(browser, baseURL)
    const response = await guest.request.get(`/pdf.pdf?resource=baseline&id=${id}&debug=1`)
    expect(response.status()).toBe(200)
    await guest.close()
  })

  test('the stored Bosch report (/pdf/:id) is for signed-in users only', async ({ browser, baseURL }) => {
    const guest = await newGuestContext(browser, baseURL)
    const guestPage = await guest.newPage()
    await guestPage.goto('/pdf/1?resource=baseline')

    await expect(guestPage).toHaveURL(/\/users\/sign_in$/)
    await guest.close()
  })

  test('an unknown record is a 404', async ({ request }) => {
    const response = await request.get('/pdf.pdf?resource=baseline&id=0&debug=1')
    expect(response.status()).toBe(404)
  })

  test('a missing resource parameter is a 400', async ({ request }) => {
    const response = await request.get('/pdf.pdf')
    expect(response.status()).toBe(400)
  })
})
