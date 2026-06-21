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
const openAIGroupName = `glm-openai-${suffix}`
const anthropicGroupName = `glm-anthropic-${suffix}`
const openAIAccountName = `glm-openai-${suffix}`
const anthropicAccountName = `glm-anthropic-${suffix}`
const userEmail = `glm-dual-${suffix}@test.local`
const userPassword = 'E2eGlmDualProtocol@12345'
const userName = `glm-dual-${suffix}`
const openAIKeyName = `glm-openai-key-${suffix}`
const anthropicKeyName = `glm-anthropic-key-${suffix}`

let mockServer: http.Server
let mockBaseURL = ''
let mockChatCompletionsCount = 0
let mockAnthropicMessagesCount = 0

async function waitForAnthropicMessagesReady(
  request: APIRequestContext,
  apiKey: string
) {
  let lastStatus = 0
  let lastBody = ''

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await request.post('/v1/messages', {
      headers: bearerHeaders(apiKey),
      data: {
        model: 'glm-5.1',
        max_tokens: 128,
        messages: [
          {
            role: 'user',
            content: 'say anthropic ok'
          }
        ]
      }
    })

    if (response.ok()) {
      return response
    }

    lastStatus = response.status()
    lastBody = await response.text()
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`anthropic messages completion should succeed, last_status=${lastStatus}, last_body=${lastBody}`)
}

async function waitForUsageStatsReady(request: APIRequestContext, userToken: string) {
  let lastStats: { total_requests: number; total_actual_cost: number } | null = null

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await request.get('/api/v1/usage/dashboard/stats', {
      headers: bearerHeaders(userToken)
    })
    expectOK(response, 'user usage stats')
    const payload = await response.json()
    const stats = payload.data as {
      total_requests: number
      total_actual_cost: number
    }
    lastStats = stats
    if (stats.total_requests >= 2 && stats.total_actual_cost > 0) {
      return stats
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`usage stats not ready: ${JSON.stringify(lastStats)}`)
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
        model: body.model || 'glm-4.7-flash',
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

    if (req.method === 'POST' && url.startsWith('/anthropic/v1/messages')) {
      mockAnthropicMessagesCount += 1
      const body = await readJSONBody(req)
      writeJSON(res, {
        id: `msg_glm_${mockAnthropicMessagesCount}`,
        type: 'message',
        role: 'assistant',
        model: body.model || 'glm-5.1',
        content: [
          {
            type: 'text',
            text: 'mock-glm-anthropic-ok'
          }
        ],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1000,
          output_tokens: 100
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

test.describe('GLM dual protocol end-to-end flow', () => {
  test.setTimeout(120_000)

  test.beforeAll(async () => {
    await startMockServer()
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((err) => (err ? reject(err) : resolve()))
    })
  })

  test('configures admin groups/accounts and completes user OpenAI + Anthropic usage flow', async ({ page, request }) => {
    const adminToken = await getAdminToken(request)
    const openAIGroup = await ensureGroup(request, adminToken, {
      name: openAIGroupName,
      platform: 'openai',
      description: 'GLM OpenAI e2e group'
    })
    const anthropicGroup = await ensureGroup(request, adminToken, {
      name: anthropicGroupName,
      platform: 'anthropic',
      description: 'GLM Anthropic e2e group'
    })
    await ensureRegistrationEnabled(request, adminToken)

    await createDeepSeekAPIKeyAccount(request, adminToken, {
      name: openAIAccountName,
      platform: 'glm',
      baseURL: mockBaseURL,
      groupID: openAIGroup.id,
      extra: {
        openai_responses_mode: 'force_chat_completions'
      }
    })
    await createDeepSeekAPIKeyAccount(request, adminToken, {
      name: anthropicAccountName,
      platform: 'glm',
      baseURL: `${mockBaseURL}/anthropic`,
      groupID: anthropicGroup.id
    })

    await loginAsAdmin(page)
    await page.goto('/admin/accounts')
    await dismissWelcomeDialog(page)
    const searchInput = page.getByPlaceholder('Search accounts...')
    await searchInput.fill(openAIAccountName)
    const openAIRow = page.locator('tr').filter({ hasText: openAIAccountName }).first()
    await expect(openAIRow).toContainText('OpenAI Chat')
    await searchInput.fill(anthropicAccountName)
    const anthropicRow = page.locator('tr').filter({ hasText: anthropicAccountName }).first()
    await expect(anthropicRow).toContainText('Anthropic Messages')

    await registerUser(request, {
      email: userEmail,
      password: userPassword,
      username: userName
    })
    const user = await findUserByEmail(request, adminToken, userEmail)
    await addUserBalance(request, adminToken, user.id, 50)

    const userToken = await getJWTToken(request, {
      email: userEmail,
      password: userPassword
    })
    const openAIKey = await createUserAPIKey(request, userToken, {
      name: openAIKeyName,
      groupID: openAIGroup.id
    })
    const anthropicKey = await createUserAPIKey(request, userToken, {
      name: anthropicKeyName,
      groupID: anthropicGroup.id
    })

    const chatResponse = await request.post('/v1/chat/completions', {
      headers: bearerHeaders(openAIKey.key),
      data: {
        model: 'glm-4.7-flash',
        messages: [
          {
            role: 'user',
            content: 'say openai ok'
          }
        ]
      }
    })
    expectOK(chatResponse, 'glm openai chat completion')
    const chatPayload = await chatResponse.json()
    expect(chatPayload.choices?.[0]?.message?.content).toContain('mock-glm-openai-ok')
    expect(mockChatCompletionsCount).toBe(1)

    const anthropicResponse = await waitForAnthropicMessagesReady(request, anthropicKey.key)
    expectOK(anthropicResponse, 'glm anthropic messages completion')
    const anthropicPayload = await anthropicResponse.json()
    expect(anthropicPayload.content?.[0]?.text).toContain('mock-glm-anthropic-ok')
    expect(mockAnthropicMessagesCount).toBe(1)

    const stats = await waitForUsageStatsReady(request, userToken)
    expect(stats.total_requests).toBeGreaterThanOrEqual(2)
    expect(stats.total_actual_cost).toBeGreaterThan(0)
  })
})
