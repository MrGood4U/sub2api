import type { AccountPlatform, GroupPlatform } from '@/types'

export type DeepSeekProtocol = 'openai' | 'anthropic'

const OPENAI_COMPATIBLE_PLATFORMS = new Set<AccountPlatform>([
  'openai',
  'sora',
  'deepseek',
  'qwen',
  'glm',
  'other'
])

export const isOpenAICompatiblePlatform = (platform?: string | null): platform is AccountPlatform =>
  !!platform && OPENAI_COMPATIBLE_PLATFORMS.has(platform as AccountPlatform)

export const isDeepSeekAnthropicBaseURL = (baseURL?: string | null) =>
  (baseURL || '').trim().toLowerCase().replace(/\/+$/, '').endsWith('/anthropic')

export const isAnthropicCompatiblePlatform = (
  platform?: string | null,
  baseURL?: string | null
) => resolveCompatibleGroupPlatform(platform, baseURL) === 'anthropic'

export const resolveCompatibleGroupPlatform = (
  platform?: string | null,
  baseURL?: string | null
): GroupPlatform | null => {
  if (!platform) return null
  if (platform === 'deepseek') {
    return isDeepSeekAnthropicBaseURL(baseURL) ? 'anthropic' : 'openai'
  }
  if (platform === 'qwen' || platform === 'glm' || platform === 'other' || platform === 'openai') {
    return 'openai'
  }
  if (platform === 'sora') {
    return 'sora'
  }
  if (platform === 'anthropic' || platform === 'gemini' || platform === 'antigravity') {
    return platform
  }
  return null
}

export const resolveDefaultAccountBaseURL = (
  platform?: string | null,
  deepSeekProtocol: DeepSeekProtocol = 'openai'
) => {
  if (platform === 'deepseek') {
    return deepSeekProtocol === 'anthropic'
      ? 'https://api.deepseek.com/anthropic'
      : 'https://api.deepseek.com'
  }
  if (platform === 'gemini') {
    return 'https://generativelanguage.googleapis.com'
  }
  if (platform === 'openai' || platform === 'sora' || platform === 'qwen' || platform === 'glm' || platform === 'other') {
    return 'https://api.openai.com'
  }
  return 'https://api.anthropic.com'
}
