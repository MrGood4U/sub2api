import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const adminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@sub2api.local',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123456'
}

export function expectOK(response: { ok(): boolean }, label: string) {
  expect(response.ok(), `${label} should succeed`).toBeTruthy()
}

export async function getJWTToken(
  request: APIRequestContext,
  credentials: { email: string; password: string }
) {
  const response = await request.post('/api/v1/auth/login', {
    data: credentials
  })
  expectOK(response, `login ${credentials.email}`)

  const payload = await response.json()
  const token = payload?.data?.access_token || payload?.access_token
  expect(typeof token).toBe('string')
  expect(token.length).toBeGreaterThan(10)
  return token as string
}

export async function getAdminToken(request: APIRequestContext) {
  return getJWTToken(request, adminCredentials)
}

export function bearerHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`
  }
}

export async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(adminCredentials.email)
  await page.locator('#password').fill(adminCredentials.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/dashboard$/)
}

export async function dismissWelcomeDialog(page: Page) {
  const closeButton = page.getByRole('button', { name: 'Close' })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click()
  }
}

export async function ensureGroup(
  request: APIRequestContext,
  adminToken: string,
  input: {
    name: string
    platform: 'openai' | 'anthropic'
    rate_multiplier?: number
    description?: string
  }
) {
  const listResponse = await request.get('/api/v1/admin/groups/all', {
    headers: bearerHeaders(adminToken)
  })
  expectOK(listResponse, 'list groups')
  const listPayload = await listResponse.json()
  const groups = (listPayload?.data || []) as Array<{ id: number; name: string; platform: string }>
  const existing = groups.find((group) => group.name === input.name)
  if (existing) {
    return existing
  }

  const createResponse = await request.post('/api/v1/admin/groups', {
    headers: bearerHeaders(adminToken),
    data: {
      name: input.name,
      description: input.description || `${input.platform} e2e group`,
      platform: input.platform,
      rate_multiplier: input.rate_multiplier ?? 1
    }
  })
  expectOK(createResponse, `create group ${input.name}`)
  const createPayload = await createResponse.json()
  return createPayload.data as { id: number; name: string; platform: string }
}

export async function deleteAccountsByName(
  request: APIRequestContext,
  adminToken: string,
  names: string[]
) {
  const response = await request.get('/api/v1/admin/accounts?page=1&page_size=200', {
    headers: bearerHeaders(adminToken)
  })
  expectOK(response, 'list accounts')

  const payload = await response.json()
  const items = (payload.data?.items || []) as Array<{ id: number; name: string }>
  const matchedAccounts = items.filter((item) => names.includes(item.name))

  for (const account of matchedAccounts) {
    const deleteResponse = await request.delete(`/api/v1/admin/accounts/${account.id}`, {
      headers: bearerHeaders(adminToken)
    })
    expectOK(deleteResponse, `delete account ${account.name}`)
  }
}

export async function createDeepSeekAPIKeyAccount(
  request: APIRequestContext,
  adminToken: string,
  input: {
    name: string
    platform?: 'deepseek' | 'anthropic' | 'openai' | 'qwen' | 'glm' | 'other'
    baseURL: string
    groupID: number
    extra?: Record<string, unknown>
  }
) {
  const response = await request.post('/api/v1/admin/accounts', {
    headers: bearerHeaders(adminToken),
    data: {
      name: input.name,
      platform: input.platform || 'deepseek',
      type: 'apikey',
      credentials: {
        api_key: `sk-${input.name}-placeholder`,
        base_url: input.baseURL
      },
      group_ids: [input.groupID],
      concurrency: 1,
      priority: 50,
      extra: {
        ...(input.baseURL.endsWith('/anthropic') ? { anthropic_passthrough: true } : {}),
        ...(input.extra || {})
      }
    }
  })
  expectOK(response, `create account ${input.name}`)
  const payload = await response.json()
  return payload.data as { id: number; name: string }
}

export async function registerUser(
  request: APIRequestContext,
  input: { email: string; password: string; username: string }
) {
  const response = await request.post('/api/v1/auth/register', {
    data: input
  })
  expect([200, 201, 400]).toContain(response.status())
  if (response.status() === 400) {
    const payload = await response.json()
    const message = String(payload?.message || payload?.error || '')
    expect(message.toLowerCase()).toContain('exist')
  }
}

export async function findUserByEmail(
  request: APIRequestContext,
  adminToken: string,
  email: string
) {
  const response = await request.get(`/api/v1/admin/users?page=1&page_size=200&search=${encodeURIComponent(email)}`, {
    headers: bearerHeaders(adminToken)
  })
  expectOK(response, `find user ${email}`)
  const payload = await response.json()
  const items = (payload.data?.items || []) as Array<{ id: number; email: string }>
  const matched = items.find((item) => item.email === email)
  expect(matched, `expected user ${email} to exist`).toBeTruthy()
  return matched as { id: number; email: string }
}

export async function addUserBalance(
  request: APIRequestContext,
  adminToken: string,
  userID: number,
  amount: number
) {
  const response = await request.post(`/api/v1/admin/users/${userID}/balance`, {
    headers: bearerHeaders(adminToken),
    data: {
      balance: amount,
      operation: 'add',
      notes: 'playwright e2e topup'
    }
  })
  expectOK(response, `top up user ${userID}`)
}

export async function createUserAPIKey(
  request: APIRequestContext,
  userToken: string,
  input: { name: string; groupID: number }
) {
  const response = await request.post('/api/v1/keys', {
    headers: bearerHeaders(userToken),
    data: {
      name: input.name,
      group_id: input.groupID
    }
  })
  expectOK(response, `create key ${input.name}`)
  const payload = await response.json()
  return payload.data as { id: number; key: string; name: string }
}

export async function ensureRegistrationEnabled(
  request: APIRequestContext,
  adminToken: string
) {
  const response = await request.put('/api/v1/admin/settings', {
    headers: bearerHeaders(adminToken),
    data: {
      registration_enabled: true
    }
  })
  expectOK(response, 'enable registration')
}
