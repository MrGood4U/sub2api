import { expect, test, type APIRequestContext } from '@playwright/test'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import {
  addUserBalance,
  bearerHeaders,
  createDeepSeekAPIKeyAccount,
  createUserAPIKey,
  dismissWelcomeDialog,
  ensureGroup,
  ensureRegistrationEnabled,
  expectOK,
  findUserByEmail,
  getAdminToken,
  getJWTToken,
  loginAsAdmin,
  registerUser
} from './helpers/sub2api'

const suffix = `${Date.now()}`
const groupName = `glm-openai-${suffix}`
const accountName = `glm-openai-${suffix}`
const userEmail = `glm-openai-${suffix}@test.local`
const userPassword = 'E2eGlmOpenAI@12345'
const userName = `glm-${suffix}`
const keyName = `glm-key-${suffix}`

let mockServer: http.Server
let mockBaseURL = ''
let mockChatCompletionsCount = 0

async function waitForUsageRecordReady(request: APIRequestContext, userToken: string) {
  let lastItems: Array<{ model_name?: string; model?: string }> = []

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await request.get('/api/v1/usage?page=1&page_size=20', {
      headers: bearerHeaders(userToken)
    })
    expectOK(response, 'glm usage list')
    const payload = await response.json()
    const items = (payload.data?.items || payload.data?.list || []) as Array<{ model_name?: string; model?: string }>
    lastItems = items
    if (items.some((item) => item.model_name === 'glm-4.5' || item.model === 'glm-4.5')) {
      return items
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`glm usage record not ready: ${JSON.stringify(lastItems)}`)
}

async function readJSONBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function writeJSON(res: ServerResponse, payload: unknown) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

async function startMockServer() {
  mockServer = http.createServer(async (req, res) => {
    const url = req.url || '/'

    if (req.method === 'POST' && url === '/v1/chat/completions') {
      mockChatCompletionsCount += 1
      const body = await readJSONBody(req)
      writeJSON(res, {
        id: `chatcmpl_glm_${mockChatCompletionsCount}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'glm-4.5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'mock-glm-openai-ok'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          total_tokens: 1100
        }
      })
      return
    }

    res.statusCode = 404
    res.end(`no mock route for ${req.method} ${url}`)
  })

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = mockServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind mock server')
  }
  mockBaseURL = `http://127.0.0.1:${address.port}`
}

test.describe('GLM OpenAI-compatible end-to-end flow', () => {
  test.setTimeout(90_000)

  test.beforeAll(async () => {
    await startMockServer()
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((err) => (err ? reject(err) : resolve()))
    })
  })

  test('configures admin group/account and completes user OpenAI usage flow', async ({ page, request }) => {
    const adminToken = await getAdminToken(request)
    const group = await ensureGroup(request, adminToken, {
      name: groupName,
      platform: 'openai',
      description: 'GLM OpenAI e2e group'
    })
    await ensureRegistrationEnabled(request, adminToken)

    await createDeepSeekAPIKeyAccount(request, adminToken, {
      name: accountName,
      platform: 'glm',
      baseURL: mockBaseURL,
      groupID: group.id,
      extra: {
        openai_responses_mode: 'force_chat_completions'
      }
    })

    await loginAsAdmin(page)
    await page.goto('/admin/accounts')
    await dismissWelcomeDialog(page)
    const searchInput = page.getByPlaceholder('Search accounts...')
    await searchInput.fill(accountName)
    const row = page.locator('tr').filter({ hasText: accountName }).first()
    await expect(row).toContainText('OpenAI Chat')

    await registerUser(request, {
      email: userEmail,
      password: userPassword,
      username: userName
    })
    const user = await findUserByEmail(request, adminToken, userEmail)
    await addUserBalance(request, adminToken, user.id, 20)

    const userToken = await getJWTToken(request, {
      email: userEmail,
      password: userPassword
    })
    const apiKey = await createUserAPIKey(request, userToken, {
      name: keyName,
      groupID: group.id
    })

    const response = await request.post('/v1/chat/completions', {
      headers: bearerHeaders(apiKey.key),
      data: {
        model: 'glm-4.5',
        messages: [
          {
            role: 'user',
            content: 'say glm ok'
          }
        ]
      }
    })
    expectOK(response, 'glm chat completion')
    const payload = await response.json()
    expect(payload.choices?.[0]?.message?.content).toContain('mock-glm-openai-ok')
    expect(mockChatCompletionsCount).toBe(1)

    const usageItems = await waitForUsageRecordReady(request, userToken)
    expect(usageItems.some((item) => item.model_name === 'glm-4.5' || item.model === 'glm-4.5')).toBeTruthy()

    await page.context().clearCookies()
    await page.goto('/login')
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await page.locator('#email').fill(userEmail)
    await page.locator('#password').fill(userPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/dashboard$/)

    await page.goto('/keys')
    await expect(page.getByText(keyName)).toBeVisible()
  })
})
