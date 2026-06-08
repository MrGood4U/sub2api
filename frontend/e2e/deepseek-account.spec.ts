import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const adminCredentials = {
  email: 'admin@sub2api.local',
  password: 'admin123456'
}

const managedAccountNames = [
  'deepseek-openai',
  'deepseek-anthropic',
  'deepseek-openai-local',
  'deepseek-anthropic-local'
]

async function getAdminToken(request: APIRequestContext) {
  const response = await request.post('/api/v1/auth/login', {
    data: adminCredentials
  })
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  return payload.data.access_token as string
}

async function deleteAccountsByName(request: APIRequestContext, names: string[]) {
  const token = await getAdminToken(request)
  const response = await request.get('/api/v1/admin/accounts?page=1&page_size=200', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  const items = (payload.data?.items || []) as Array<{ id: number; name: string }>
  const matchedAccounts = items.filter((item) => names.includes(item.name))

  for (const account of matchedAccounts) {
    const deleteResponse = await request.delete(`/api/v1/admin/accounts/${account.id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
    expect(deleteResponse.ok()).toBeTruthy()
  }
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(adminCredentials.email)
  await page.locator('#password').fill(adminCredentials.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/dashboard$/)
}

async function openCreateModal(page: Page) {
  await page.goto('/admin/accounts')
  await page.getByTestId('accounts-create-button').click()
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

  await expect(baseURLInput).toHaveValue('https://api.deepseek.com')

  if (baseURL !== 'https://api.deepseek.com') {
    await baseURLInput.fill(baseURL)
  }

  await expect(groupSelector.getByText(new RegExp(`^${expectedGroupName}$`))).toBeVisible()
  await expect(groupSelector.getByText(new RegExp(`^${excludedGroupName}$`))).toHaveCount(0)

  await apiKeyInput.fill(`sk-${accountName}-placeholder`)
  await groupSelector.getByText(new RegExp(`^${expectedGroupName}$`)).click()

  await page.locator('button[form="create-account-form"]').click()
  await expect(page.locator('#create-account-form')).toHaveCount(0)
  await expect(page.getByRole('table').getByText(accountName, { exact: true })).toBeVisible()
}

test.describe('DeepSeek account creation', () => {
  test.beforeAll(async ({ request }) => {
    await deleteAccountsByName(request, managedAccountNames)
  })

  test('creates official DeepSeek OpenAI and Anthropic accounts', async ({ page }) => {
    await loginAsAdmin(page)

    await createDeepSeekAccount(page, 'deepseek-openai', 'https://api.deepseek.com', 'ds', 'deepseek')
    await createDeepSeekAccount(
      page,
      'deepseek-anthropic',
      'https://api.deepseek.com/anthropic',
      'deepseek',
      'ds'
    )
  })
})
