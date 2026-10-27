import { test, expect } from '@playwright/test'
import { chooseFromGallery, makeHeic, makeJpeg, openCamera } from '../../support/customer'
import { CreatedRecord, createBaseline, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'

// Baselines and rentals share the exact same customer upload page (.car-part / #phoneGallery /
// #picturePreviewContainer markup, confirmed against the real pages) - only the record creator differs, so
// the test bodies (sharedUploadTests) are written once and reused by both describe blocks below.
function sharedUploadTests(createRecord: () => Promise<CreatedRecord>) {
  test('a non-image file is rejected before upload', async ({ page }) => {
    const record = await createRecord()
    await page.goto(record.customerPath)

    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not an image') })

    await expect(page.locator('#alert span')).toContainText('File has an invalid content type')
    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(0)
  })

  // @writes: this really uploads a photo to the environment's storage
  test('@writes a valid photo is uploaded and the car part is marked as done', async ({ page }) => {
    const record = await createRecord()
    await page.goto(record.customerPath)

    const jpeg = await makeJpeg(page)
    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpeg })
    await page.locator('#picturePreviewContainer .btn-save-picture').click()

    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(1)
  })

  // @writes: this really uploads a photo to the environment's storage
  test('@writes a HEIC photo is uploaded and the car part is marked as done', async ({ page }) => {
    const record = await createRecord()
    await page.goto(record.customerPath)

    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'front.heic', mimeType: 'image/heic', buffer: makeHeic() })
    await page.locator('#picturePreviewContainer .btn-save-picture').click()

    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(1)
  })

  test('@writes a valid photo still uploads after a rejected file', async ({ page }) => {
    const record = await createRecord()
    await page.goto(record.customerPath)

    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
    await expect(page.locator('#alert span')).toContainText('File has an invalid content type')

    await chooseFromGallery(page, { name: 'front.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page) })
    await page.locator('#picturePreviewContainer .btn-save-picture').click()

    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(1)
  })
}

test.describe('customer photo upload (baselines)', () => {
  sharedUploadTests(() => createBaseline({ vin: uniquePrefix('UPLOAD') }))
})

test.describe('customer photo upload (rentals)', () => {
  sharedUploadTests(() => createRental({ vin: uniquePrefix('UPLOAD') }))
})
