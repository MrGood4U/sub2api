import { expect, test, type Page } from '@playwright/test'
import {
  deleteAccountsByName,
  dismissWelcomeDialog,
  ensureGroup,
  getAdminToken,
  loginAsAdmin,
  bearerHeaders,
  expectOK
} from './helpers/sub2api'

const managedAccountNames = [
  'deepseek-openai',
  'deepseek-anthropic',
  'deepseek-openai-local',
  'deepseek-anthropic-local'
]

const openAIGroupName = process.env.DEEPSEEK_OPENAI_GROUP_NAME || 'ds'
const anthropicGroupName = process.env.DEEPSEEK_ANTHROPIC_GROUP_NAME || 'deepseek'
const openAIBaseURL = process.env.DEEPSEEK_OPENAI_BASE_URL || 'https://api.deepseek.com'
const anthropicBaseURL = process.env.DEEPSEEK_ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic'

async function openCreateModal(page: Page) {
  await page.goto('/admin/accounts')
  await dismissWelcomeDialog(page)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await expect(page.locator('#create-account-form')).toBeVisible()
}

async function createDeepSeekAccount(
  page: Page,
  accountName: string,
  baseURL: string,
  expectedGroupName: string,
  excludedGroupName: string
) {
  await openCreateModal(page)
  await page.locator('[data-tour="account-form-name"]').fill(accountName)
  await page.getByTestId('account-platform-deepseek').click()

  const baseURLInput = page.getByTestId('account-base-url-input')
  const apiKeyInput = page.getByTestId('account-api-key-input')
  const groupSelector = page.locator('[data-tour="account-form-groups"]')

  await baseURLInput.fill(baseURL)

  await expect(groupSelector.getByText(new RegExp(`^${expectedGroupName}$`))).toBeVisible()
  await expect(groupSelector.getByText(new RegExp(`^${excludedGroupName}$`))).toHaveCount(0)

  await apiKeyInput.fill(`sk-${accountName}-placeholder`)
  await groupSelector.getByText(new RegExp(`^${expectedGroupName}$`)).click()

  await page.locator('button[form="create-account-form"]').click()
  await expect(page.locator('#create-account-form')).toHaveCount(0)
}

test.describe('DeepSeek account creation', () => {
  test.beforeAll(async ({ request }) => {
    const adminToken = await getAdminToken(request)
    await ensureGroup(request, adminToken, {
      name: openAIGroupName,
      platform: 'openai'
    })
    await ensureGroup(request, adminToken, {
      name: anthropicGroupName,
      platform: 'anthropic'
    })
    await deleteAccountsByName(request, adminToken, managedAccountNames)
  })

  test('creates official DeepSeek OpenAI and Anthropic accounts', async ({ page, request }) => {
    await loginAsAdmin(page)

    await createDeepSeekAccount(page, 'deepseek-openai', openAIBaseURL, openAIGroupName, anthropicGroupName)
    await createDeepSeekAccount(
      page,
      'deepseek-anthropic',
      anthropicBaseURL,
      anthropicGroupName,
      openAIGroupName
    )

    const adminToken = await getAdminToken(request)
    const response = await request.get('/api/v1/admin/accounts?page=1&page_size=200', {
      headers: bearerHeaders(adminToken)
    })
    expectOK(response, 'list accounts after create')
    const payload = await response.json()
    const accountNames = ((payload.data?.items || []) as Array<{ name: string }>).map((item) => item.name)
    expect(accountNames).toContain('deepseek-openai')
    expect(accountNames).toContain('deepseek-anthropic')
  })
})
