import { Page, expect } from '@playwright/test'

export interface UploadFile {
  name: string
  mimeType: string
  buffer: Buffer
}

export type VehicleType = 'sedan' | 'suv' | 'mini_suv'

/** Cycled across uploadAllRequiredPhotos's multiple photos so a record ends up with more than one body type. */
export const VEHICLE_TYPES: VehicleType[] = ['sedan', 'suv', 'mini_suv']

const VEHICLE_BODIES: Record<VehicleType, { path: string; label: string }> = {
  sedan: {
    label: 'Sedan',
    path: 'M30,300 L70,300 L100,245 L180,220 L420,220 L480,245 L580,260 L610,300 L610,330 L30,330 Z'
  },
  suv: {
    label: 'SUV',
    path: 'M30,320 L50,230 L100,190 L160,175 L460,175 L520,195 L580,220 L610,250 L610,330 L30,330 Z'
  },
  mini_suv: {
    label: 'Mini SUV',
    path: 'M60,315 L80,245 L130,205 L180,195 L440,195 L490,215 L550,245 L580,270 L580,330 L60,330 Z'
  }
}

/** An SVG page, drawn by the browser itself, showing a damaged vehicle (sedan / SUV / mini SUV) with a dent and a scratch. */
function damagedVehicleMarkup(vehicle: VehicleType): string {
  const { path, label } = VEHICLE_BODIES[vehicle]
  return `<body style="margin:0"><svg width="640" height="480" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
    <rect width="640" height="480" fill="#dde6ee" />
    <rect x="0" y="330" width="640" height="150" fill="#99a3ab" />
    <path d="${path}" fill="#33475a" stroke="#101820" stroke-width="4" />
    <circle cx="150" cy="330" r="36" fill="#14181b" stroke="#000" stroke-width="2" />
    <circle cx="520" cy="330" r="36" fill="#14181b" stroke="#000" stroke-width="2" />
    <ellipse cx="300" cy="270" rx="34" ry="20" fill="#7a1414" opacity="0.9" />
    <path d="M340,245 L400,235 L405,245 L345,257 Z" fill="#4a0b0b" opacity="0.85" />
    <text x="20" y="40" font-size="26" fill="#101820">${label} - damage photo</text>
  </svg></body>`
}

/** A real JPEG of a damaged vehicle, rendered by the browser itself so no binary fixture has to be committed. */
export async function makeJpeg(page: Page, vehicle: VehicleType = 'sedan'): Promise<Buffer> {
  const scratch = await page.context().newPage()
  await scratch.setContent(damagedVehicleMarkup(vehicle))
  const buffer = await scratch.screenshot({ type: 'jpeg', clip: { x: 0, y: 0, width: 640, height: 480 } })
  await scratch.close()
  return buffer
}

/**
 * A tiny real HEIC image (64x64), the format iPhones save photos in by default.
 * Unlike makeJpeg, no browser API can encode HEIC, so this is a pre-rendered fixture instead.
 */
const HEIC_BASE64 =
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAVZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABegABAAAAAAAAAI0AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA1mlwcnAAAAC3aXBjbwAAAHhodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQArQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqSSmubgIaDAgAAAMAyAAAAwAIQGIAAQAHRAHBcrAiQAAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAAJVtZGF0AAAAiSgBrwT47Xl4st6nvzOeNdFk7EvH9anvE/dge/ASn1/Vf/8XyonP9ao/79HZ0vVu3r7lWtyVq4ZqdkBTB0+XEKg10ZRJJjH4EhHHq/Y8Z7Ng6jXkxJVhuS7GZScHIzH1doK+wxKYJI3W2aq7itEfbr29euYHIIwxcmvGSA/MDFojKzdRSmVVsjaY'

export function makeHeic(): Buffer {
  return Buffer.from(HEIC_BASE64, 'base64')
}

export async function openCamera(page: Page, carPart: string) {
  await page.locator(`.car-part.${carPart}`).click()
  // the first-time tooltip animates in; wait for it and dismiss it (it does not show again afterwards)
  const gotIt = page.locator('#takePictureTooltip .btn-got-it')
  await gotIt.click({ timeout: 3_000 }).catch(() => {})
  await expect(page.locator('#takePictureTooltip')).not.toHaveClass(/show/)
}

export async function chooseFromGallery(page: Page, file: UploadFile) {
  // the visible label only forwards to this hidden input, so set the file on the input itself
  await page.locator('#phoneGallery').setInputFiles(file)
}

/** Uploads one JPEG for a car part through the real customer page and waits until it is marked as uploaded. */
export async function uploadPhoto(page: Page, carPart: string, jpeg?: Buffer) {
  const buffer = jpeg ?? (await makeJpeg(page))
  await openCamera(page, carPart)
  await chooseFromGallery(page, { name: `${carPart}.jpg`, mimeType: 'image/jpeg', buffer })
  await page.locator('#picturePreviewContainer .btn-save-picture').click()
  if (carPart !== 'loc_unknown') await expect(page.locator(`.car-part.${carPart}.uploaded`)).toHaveCount(1)
}

/** Car parts the customer must photograph before they can send (the page marks them .required-loc). */
export async function requiredCarParts(page: Page): Promise<string[]> {
  // the car parts are loaded asynchronously after the page opens; reading too early returns an empty list
  await page.locator('.required-loc').first().waitFor({ state: 'attached' })
  const parts = await page.locator('.required-loc').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.carPart as string))
  return parts.filter(Boolean)
}

export async function uploadAllRequiredPhotos(page: Page) {
  const carParts = await requiredCarParts(page)
  for (const [index, carPart] of carParts.entries()) {
    const jpeg = await makeJpeg(page, VEHICLE_TYPES[index % VEHICLE_TYPES.length])
    await uploadPhoto(page, carPart, jpeg)
  }
}

/** Waits for the send button to become enabled (it refreshes itself after every upload) and clicks it. */
export async function sendPhotos(page: Page) {
  const send = page.locator('#termOfService a.btn-send')
  await expect(send).not.toHaveClass(/disabled/)
  await send.click()
}
