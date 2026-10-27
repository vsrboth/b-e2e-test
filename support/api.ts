import { APIRequestContext, expect, request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { credentials } from './env'

export type RecordKind = 'baseline' | 'rental' | 'damage_event'

export interface CreatedRecord {
  kind: RecordKind
  vin: string
  /** relative path of the customer page, e.g. /damage_photo/baselines/<uuid> */
  customerPath: string
  uuid: string
}

const CALLBACK_URL = 'https://example.com/callback'

async function api(): Promise<APIRequestContext> {
  const httpCredentials = process.env.E2E_BASIC_AUTH_USER
    ? { username: process.env.E2E_BASIC_AUTH_USER, password: process.env.E2E_BASIC_AUTH_PASSWORD ?? '' }
    : undefined
  return request.newContext({ baseURL: process.env.BASE_URL, httpCredentials })
}

let cachedToken: { value: string; expiresAt: number } | undefined

/** Exchanges the account SID + secret key for a short-lived access token, caching it until it expires. */
export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value
  }
  const ctx = await api()
  const response = await ctx.post('/oauth/token', {
    data: { client_id: credentials.accountSid, client_secret: credentials.secretKey, grant_type: 'client_credentials' }
  })
  const text = await response.text()
  expect(response.status(), `POST /oauth/token -> ${text}`).toBe(200)
  await ctx.dispose()
  const json = JSON.parse(text)
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in * 1000) - 5_000 }
  return cachedToken.value
}

async function post(path: string, body: object): Promise<any> {
  const ctx = await api()
  const response = await ctx.post(path, {
    data: body,
    headers: { Authorization: `Bearer ${await accessToken()}` }
  })
  const text = await response.text()
  expect(response.status(), `POST ${path} -> ${text}`).toBe(200)
  await ctx.dispose()
  return JSON.parse(text)
}

function toRecord(kind: RecordKind, vin: string, json: any): CreatedRecord {
  const customerPath = new URL(json.webApp.webUrl).pathname
  return { kind, vin, customerPath, uuid: customerPath.split('/').pop() as string }
}

export async function createBaseline(options: { vin: string; language?: string; company?: string; licensePlate?: string }): Promise<CreatedRecord> {
  const json = await post('/api/v1/baseline', {
    baseline: { vin: options.vin, callbackUrl: CALLBACK_URL, language: options.language ?? 'en', company: options.company, licensePlate: options.licensePlate }
  })
  return toRecord('baseline', options.vin, json)
}

export async function createRental(options: { vin: string; language?: string }): Promise<CreatedRecord> {
  const json = await post('/api/v1/rental', {
    rental: { rentalId: randomUUID(), vin: options.vin, timestamp: Date.now(), callbackUrl: CALLBACK_URL, language: options.language ?? 'en' }
  })
  return toRecord('rental', options.vin, json)
}

export async function createDamageEvent(options: { vin: string; location?: string; language?: string }): Promise<CreatedRecord> {
  const json = await post('/events/damage', {
    damageEvent: {
      messageId: randomUUID(),
      vin: options.vin,
      damageClass: 'A',
      location: options.location ?? 'loc_front',
      timestamp: Math.floor(Date.now() / 1000),
      callbackUrl: CALLBACK_URL,
      language: options.language ?? 'en'
    }
  })
  return toRecord('damage_event', options.vin, json)
}

export interface PredictionItem {
  carpart: string
  side_1: string
  side_2: string
  treatment: string
  /** one confidence per damage, same order */
  confidence: number[]
  /** [damage type, damage number] pairs */
  damage: [string, number][]
}

/**
 * Plays the part of the damage-prediction service: it delivers a result to the app's callback endpoint
 * (POST /damage_prediction/results, which is open to the service, no login). The app then turns the items
 * into assessments in a background job, so allow a moment before asserting on them.
 */
export async function deliverPredictionResult(record: CreatedRecord, items: PredictionItem[]): Promise<void> {
  const ctx = await api()
  const response = await ctx.post(`/damage_prediction/results?resource=${record.kind}&uuid=${record.uuid}`, {
    data: { payload: { items } }
  })
  expect(response.status(), `POST /damage_prediction/results -> ${await response.text()}`).toBe(200)
  await ctx.dispose()
}
