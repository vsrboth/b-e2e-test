export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example`)
  return value
}

export const credentials = {
  get email() { return requireEnv('E2E_USER_EMAIL') },
  get password() { return requireEnv('E2E_USER_PASSWORD') },
  get accountSid() { return requireEnv('E2E_ACCOUNT_SID') },
  get secretKey() { return requireEnv('E2E_SECRET_KEY') }
}

/** Unique, recognisable prefix so test data is easy to find and clean up on a shared environment. */
export function uniquePrefix(label = 'E2E'): string {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `${label}-${Date.now().toString(36).toUpperCase()}-${rand}`
}

/**
 * A unique decimal used to find a pricing record in the table.
 * The app prints decimals without trailing zeros (925.00 -> "925.0"), so the last digit is never 0.
 */
export function uniqueCost(): string {
  const whole = 700 + Math.floor(Math.random() * 900)
  const tenths = Math.floor(Math.random() * 10)
  const hundredths = 1 + Math.floor(Math.random() * 9)
  return `${whole}.${tenths}${hundredths}`
}
