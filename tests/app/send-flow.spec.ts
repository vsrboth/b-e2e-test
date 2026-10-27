import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent } from '../../support/api'
import { sendPhotos, uploadAllRequiredPhotos } from '../../support/customer'
import { uniquePrefix } from '../../support/env'

// "Sending" makes the app call the damage-prediction service for real. These tests are therefore OPT-IN:
// run them only against an environment whose prediction service is a stub or sandbox, by setting
//   E2E_ALLOW_SEND=true
// They are never run by default, so a normal run cannot trigger real predictions.
//
// Baselines go through the exact same customer-facing flow as damage events (same #termOfService /
// btn-send markup, same "loading -> success -> redirect" animation, same requested/resulted states), so
// the two describe blocks below are kept in lockstep on purpose. What differs: baselines are listed on
// /baselines (not /damage_events), and a baseline requires photos for all 9 car parts instead of one
// location - uploadAllRequiredPhotos reads the required list from the DOM, so no test code changes for that.
test.describe('sending photos for damage prediction (damage events)', () => {
  test.skip(process.env.E2E_ALLOW_SEND !== 'true', 'Set E2E_ALLOW_SEND=true to run (calls the prediction service)')

  test('@writes the full customer flow: upload required photos, send, and return to the callback URL', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createDamageEvent({ vin: uniquePrefix('SEND'), location: 'loc_front' })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>callback</h1>' }))

    await page.goto(record.customerPath)
    await expect(page.locator('#termOfService .btn-info.disabled')).toHaveCount(1)

    await uploadAllRequiredPhotos(page)

    await sendPhotos(page)

    // the page plays a short "sending" animation, then returns the customer to the callback URL
    await expect(page.locator('.damage-prediction-requested .loading')).toHaveCount(1)
    await expect(page.locator('.damage-prediction-requested .success')).toHaveCount(1, { timeout: 15_000 })
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 15_000 })
  })

  test('@writes after sending, the record is listed as "Damage prediction requested"', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createDamageEvent({ vin: uniquePrefix('SEND'), location: 'loc_front' })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    await page.goto(record.customerPath)
    await uploadAllRequiredPhotos(page)
    await sendPhotos(page)

    // Sending is synchronous server-side: it sets the state to "requested" and immediately calls the
    // (sandboxed) prediction service, which replies within a few seconds and advances the record straight
    // to "resulted" - well before the browser's own "success" animation and redirect finish. So the
    // "requested" state only exists for a short window while the original request is still in flight;
    // check it from a second tab, polling because the exact moment it flips varies.
    const admin = await page.context().newPage()
    const filteredUrl = `/damage_events?query[state]=damage_prediction_requested&query[vin]=${encodeURIComponent(record.vin)}`
    await expect.poll(async () => {
      await admin.goto(filteredUrl)
      return admin.getByRole('heading').innerText()
    }, { timeout: 7_000 }).toContain('Damage Events - 1 record')
    await admin.close()

    await expect(page).toHaveURL('https://example.com/callback', { timeout: 20_000 })
  })

  test('@writes after sending, the customer page no longer offers an enabled send button', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createDamageEvent({ vin: uniquePrefix('SEND'), location: 'loc_front' })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    await page.goto(record.customerPath)
    await uploadAllRequiredPhotos(page)
    await sendPhotos(page)
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 20_000 })

    await page.goto(record.customerPath)

    await expect(page.locator('a.btn-send:not(.disabled)')).toHaveCount(0)
  })

  // KNOWN APP BUG (see "App issues", item 10): the server does not check that the record is ready to send,
  // so a direct request succeeds even with no photos. This test describes the CORRECT behaviour and is marked
  // as an expected failure; when the app is fixed it will start "unexpectedly passing" - remove test.fail() then.
  test('@writes the server refuses to send a record that has no photos', async ({ request }) => {
    test.fail(true, 'Known bug: RequestsController#new does not check can_request_damage_prediction?')
    const record = await createBaseline({ vin: uniquePrefix('SEND') })

    const response = await request.get(`/damage_prediction/requests/new?resource=baseline&uuid=${record.uuid}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/javascript' }
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('sending photos for damage prediction (baselines)', () => {
  test.skip(process.env.E2E_ALLOW_SEND !== 'true', 'Set E2E_ALLOW_SEND=true to run (calls the prediction service)')

  test('@writes the full customer flow: upload required photos, send, and return to the callback URL', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createBaseline({ vin: uniquePrefix('SEND') })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>callback</h1>' }))

    await page.goto(record.customerPath)
    await expect(page.locator('#termOfService .btn-info.disabled')).toHaveCount(1)

    await uploadAllRequiredPhotos(page)

    await sendPhotos(page)

    // the page plays a short "sending" animation, then returns the customer to the callback URL
    await expect(page.locator('.damage-prediction-requested .loading')).toHaveCount(1)
    await expect(page.locator('.damage-prediction-requested .success')).toHaveCount(1, { timeout: 15_000 })
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 15_000 })
  })

  test('@writes after sending, the record is listed as "Damage prediction requested"', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createBaseline({ vin: uniquePrefix('SEND') })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    await page.goto(record.customerPath)
    await uploadAllRequiredPhotos(page)
    await sendPhotos(page)

    // same race as the damage-event version of this test above: the sandboxed prediction service can
    // resolve before the browser's own "success" animation and redirect finish, moving the record straight
    // to "resulted" - check it from a second tab while the original request is still in flight, polling
    // because the exact moment it flips to "requested" varies.
    const admin = await page.context().newPage()
    const filteredUrl = `/baselines?query[state]=damage_prediction_requested&query[vin]=${encodeURIComponent(record.vin)}`
    await expect.poll(async () => {
      await admin.goto(filteredUrl)
      return admin.getByRole('heading').innerText()
    }, { timeout: 7_000 }).toContain('Baselines - 1 record')
    await admin.close()

    await expect(page).toHaveURL('https://example.com/callback', { timeout: 20_000 })
  })

  test('@writes after sending, the customer page no longer offers an enabled send button', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createBaseline({ vin: uniquePrefix('SEND') })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    await page.goto(record.customerPath)
    await uploadAllRequiredPhotos(page)
    await sendPhotos(page)
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 20_000 })

    await page.goto(record.customerPath)

    await expect(page.locator('a.btn-send:not(.disabled)')).toHaveCount(0)
  })
})
