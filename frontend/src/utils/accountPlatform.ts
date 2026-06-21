import type { AccountPlatform, GroupPlatform } from '@/types'

export type VendorCompatibleProtocol = 'openai' | 'anthropic'

type AccountPlatformCompatibility = {
  gatewayPlatform: GroupPlatform
  defaultBaseURL?: string
  apiKeyOnly?: boolean
  supportsAnthropicCompatibleMode?: boolean
}

const ACCOUNT_PLATFORM_COMPATIBILITY: Partial<Record<AccountPlatform, AccountPlatformCompatibility>> = {
  openai: {
    gatewayPlatform: 'openai',
    defaultBaseURL: 'https://api.openai.com'
  },
  sora: {
    gatewayPlatform: 'openai',
    defaultBaseURL: 'https://api.openai.com'
  },
  deepseek: {
    gatewayPlatform: 'openai',
    defaultBaseURL: 'https://api.deepseek.com',
    apiKeyOnly: true,
    supportsAnthropicCompatibleMode: true
  },
  qwen: {
    gatewayPlatform: 'openai',
    defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode',
    apiKeyOnly: true
  },
  glm: {
    gatewayPlatform: 'openai',
    defaultBaseURL: 'https://open.bigmodel.cn/api/paas',
    apiKeyOnly: true,
    supportsAnthropicCompatibleMode: true
  },
  other: {
    gatewayPlatform: 'openai',
    defaultBaseURL: 'https://api.openai.com'
  },
  anthropic: {
    gatewayPlatform: 'anthropic',
    defaultBaseURL: 'https://api.anthropic.com'
  },
  gemini: {
    gatewayPlatform: 'gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com'
  },
  antigravity: {
    gatewayPlatform: 'antigravity'
  }
}

const OPENAI_COMPATIBLE_PLATFORMS = new Set<AccountPlatform>(
  Object.entries(ACCOUNT_PLATFORM_COMPATIBILITY)
    .filter(([, config]) => config?.gatewayPlatform === 'openai')
    .map(([platform]) => platform as AccountPlatform)
)

const getAccountPlatformCompatibility = (platform?: string | null) =>
  (platform ? ACCOUNT_PLATFORM_COMPATIBILITY[platform as AccountPlatform] : undefined)

export const isOpenAICompatiblePlatform = (platform?: string | null): platform is AccountPlatform =>
  !!platform && OPENAI_COMPATIBLE_PLATFORMS.has(platform as AccountPlatform)

export const isAnthropicCompatibleVendorBaseURL = (baseURL?: string | null) =>
  (baseURL || '').trim().toLowerCase().replace(/\/+$/, '').endsWith('/anthropic')

export const isAPIKeyOnlyPlatform = (platform?: string | null) =>
  getAccountPlatformCompatibility(platform)?.apiKeyOnly === true

export const resolveCompatibleGroupPlatform = (
  platform?: string | null,
  baseURL?: string | null
): GroupPlatform | null => {
  const config = getAccountPlatformCompatibility(platform)
  if (!config) return null
  if (config.supportsAnthropicCompatibleMode) {
    return isAnthropicCompatibleVendorBaseURL(baseURL) ? 'anthropic' : 'openai'
  }
  return config.gatewayPlatform
}

export const isAnthropicCompatiblePlatform = (
  platform?: string | null,
  baseURL?: string | null
) => resolveCompatibleGroupPlatform(platform, baseURL) === 'anthropic'

export const resolveDefaultAccountBaseURL = (
  platform?: string | null,
  protocol: VendorCompatibleProtocol = 'openai'
) => {
  const config = getAccountPlatformCompatibility(platform)
  if (!config) {
    return 'https://api.anthropic.com'
  }
  if (config.supportsAnthropicCompatibleMode && protocol === 'anthropic' && config.defaultBaseURL) {
    return `${config.defaultBaseURL.replace(/\/+$/, '')}/anthropic`
  }
  return config.defaultBaseURL || 'https://api.anthropic.com'
}
