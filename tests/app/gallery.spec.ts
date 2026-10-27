import { test, expect, Page } from '@playwright/test'
import { CreatedRecord, createBaseline, createDamageEvent, createRental } from '../../support/api'
import { makeJpeg, uploadPhoto } from '../../support/customer'
import { uniquePrefix } from '../../support/env'
import { authenticatedPage, recordIdFromIndex } from '../../support/pages'

// Photos can only come from the customer, so each test uploads real JPEGs through the customer page first
// (that is the only way to get photos onto a record from outside), then reviews them in the BackOffice.
//
// The gallery/editor markup ([data-controller="damage-editor"], .photos-panel, .buttons-panel, .editor-panel,
// the assessment-panel toggle) is an identical shared partial across baselines, rentals and damage events -
// confirmed against the real pages, not assumed - so the test bodies (sharedGalleryTests) are written once and
// reused by all three describe blocks below; only the record creator and index path differ.
//
// The tests that need photos (everything but "a record without photos") share one record seeded with two
// photos in beforeAll, instead of each uploading its own, to keep the shared staging environment's footprint
// down. None of them edits or deletes a photo, so there is nothing to clean up between tests and the order
// they run in does not matter - serial mode here is only to reuse the one browser worker the seed ran in.

/** Opens the editor on the first photo and waits until it has finished loading (it disables its panels meanwhile). */
async function openEditor(page: Page) {
  await page.locator('[data-controller="damage-editor"] .photo .target').first().click()
  await expect(editor(page)).toBeVisible()
  await expect(editor(page).locator('.buttons-panel')).not.toHaveClass(/disabled/)
  await expect(editor(page).locator('.photos-panel')).not.toHaveClass(/disabled/)
}

const editor = (page: Page) => page.locator('.damage-editor.modal-backdrop')
const thumbnails = (page: Page) => page.locator('.photos-panel .img-thumbnail')

function sharedGalleryTests(indexPath: '/baselines' | '/rentals' | '/damage_events', createRecord: () => Promise<CreatedRecord>) {
  test('@writes a record without photos has nothing to open', async ({ page }) => {
    const record = await createRecord()
    const id = await recordIdFromIndex(page, indexPath, record.vin)
    await page.goto(`${indexPath}/${id}`)

    await expect(page.locator('[data-controller="damage-editor"] .photo .target')).toHaveCount(0)
  })

  test('@writes uploaded photos are listed in the gallery', async ({ page }) => {
    await expect(page.locator('[data-controller="damage-editor"] .photo')).toHaveCount(2)
  })

  test('@writes I can open the editor, see its panels and close it without changing anything', async ({ page }) => {
    await openEditor(page)
    await expect(editor(page).locator('.photos-panel')).toBeVisible()
    await expect(editor(page).locator('.editor-panel')).toBeVisible()
    await expect(editor(page).locator('.buttons-panel')).toBeVisible()
    // openEditor already waited for the gallery to load, so the editor's own thumbnail count is a safe
    // "before" baseline here - reading it from the outer gallery instead would race the async photo load.
    const photoCount = await thumbnails(page).count()
    expect(photoCount).toBeGreaterThan(0)

    await editor(page).locator('[data-damage-editor-target="btnClose"]').click()
    await expect(editor(page)).toBeHidden()
    await expect(page.locator('[data-controller="damage-editor"] .photo')).toHaveCount(photoCount)
  })

  test('@writes I can switch between photos inside the editor', async ({ page }) => {
    await openEditor(page)
    await expect(thumbnails(page)).toHaveCount(2)

    const ids = await thumbnails(page).evaluateAll(els => els.map(el => (el as HTMLElement).dataset.photoId as string))
    await thumbnails(page).nth(1).click()
    await expect(page.locator(`.photos-panel .img-thumbnail.selected[data-photo-id="${ids[1]}"]`)).toHaveCount(1)

    await thumbnails(page).nth(0).click()
    await expect(page.locator(`.photos-panel .img-thumbnail.selected[data-photo-id="${ids[0]}"]`)).toHaveCount(1)
    await expect(page.locator(`.photos-panel .img-thumbnail.selected[data-photo-id="${ids[1]}"]`)).toHaveCount(0)
  })

  test('@writes the assessment panel opens inside the editor', async ({ page }) => {
    await openEditor(page)
    await editor(page).locator('button[data-action="click->damage-editor#onBtnShowAssessment"]').click()

    await expect(editor(page).locator('.assessment-panel:not(.d-none)')).toBeVisible()
  })

  test('@writes a photo without an edited version cannot be excluded from the PDF', async ({ page }) => {
    await openEditor(page)
    const photoId = await thumbnails(page).first().getAttribute('data-photo-id')

    await expect(page.locator(`input#photo${photoId}`)).toBeDisabled()
  })
}

test.describe('photo gallery and editor (damage events)', () => {
  test.describe.configure({ mode: 'serial' })

  let damageEventId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createDamageEvent({ vin: uniquePrefix('GALLERY'), location: 'loc_front' })

    // uploading is a guest (customer) flow, no BackOffice session needed. Needs camera permission for
    // the same reason support/customer.ts's uploadPhoto does - see playwright.config.ts.
    const guestContext = await browser.newContext({ baseURL: process.env.BASE_URL, permissions: ['camera'] })
    const guestPage = await guestContext.newPage()
    await guestPage.goto(record.customerPath)
    const jpeg = await makeJpeg(guestPage)
    for (const carPart of ['loc_front', 'loc_rear']) await uploadPhoto(guestPage, carPart, jpeg)
    await guestContext.close()

    const page = await authenticatedPage(browser)
    damageEventId = await recordIdFromIndex(page, '/damage_events', record.vin)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/damage_events/${damageEventId}`)
  })

  sharedGalleryTests('/damage_events', () => createDamageEvent({ vin: uniquePrefix('GALLERY') }))
})

test.describe('photo gallery and editor (baselines)', () => {
  test.describe.configure({ mode: 'serial' })

  let baselineId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createBaseline({ vin: uniquePrefix('GALLERY') })

    const guestContext = await browser.newContext({ baseURL: process.env.BASE_URL, permissions: ['camera'] })
    const guestPage = await guestContext.newPage()
    await guestPage.goto(record.customerPath)
    const jpeg = await makeJpeg(guestPage)
    for (const carPart of ['loc_front', 'loc_rear']) await uploadPhoto(guestPage, carPart, jpeg)
    await guestContext.close()

    const page = await authenticatedPage(browser)
    baselineId = await recordIdFromIndex(page, '/baselines', record.vin)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/baselines/${baselineId}`)
  })

  sharedGalleryTests('/baselines', () => createBaseline({ vin: uniquePrefix('GALLERY') }))
})

test.describe('photo gallery and editor (rentals)', () => {
  test.describe.configure({ mode: 'serial' })

  let rentalId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createRental({ vin: uniquePrefix('GALLERY') })

    const guestContext = await browser.newContext({ baseURL: process.env.BASE_URL, permissions: ['camera'] })
    const guestPage = await guestContext.newPage()
    await guestPage.goto(record.customerPath)
    const jpeg = await makeJpeg(guestPage)
    for (const carPart of ['loc_front', 'loc_rear']) await uploadPhoto(guestPage, carPart, jpeg)
    await guestContext.close()

    const page = await authenticatedPage(browser)
    rentalId = await recordIdFromIndex(page, '/rentals', record.vin)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/rentals/${rentalId}`)
  })

  sharedGalleryTests('/rentals', () => createRental({ vin: uniquePrefix('GALLERY') }))
})
