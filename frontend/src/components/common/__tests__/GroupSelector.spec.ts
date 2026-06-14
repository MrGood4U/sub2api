import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupSelector from '../GroupSelector.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'common.selectedCount') {
        return `selected:${params?.count ?? 0}`
      }
      return key
    }
  })
}))

const groups = [
  {
    id: 1,
    name: 'openai-group',
    platform: 'openai',
    subscription_type: 'standard',
    rate_multiplier: 1,
    account_count: 1
  },
  {
    id: 2,
    name: 'anthropic-group',
    platform: 'anthropic',
    subscription_type: 'standard',
    rate_multiplier: 1,
    account_count: 1
  },
  {
    id: 3,
    name: 'gemini-group',
    platform: 'gemini',
    subscription_type: 'standard',
    rate_multiplier: 1,
    account_count: 1
  }
]

function mountSelector(props: Record<string, unknown>) {
  return mount(GroupSelector, {
    props: {
      modelValue: [],
      groups,
      ...props
    },
    global: {
      stubs: {
        GroupBadge: {
          props: ['name'],
          template: '<span>{{ name }}</span>'
        }
      }
    }
  })
}

describe('GroupSelector', () => {
  it('uses compatible platform filter for deepseek openai base url', () => {
    const wrapper = mountSelector({
      platform: 'deepseek',
      compatiblePlatform: 'openai'
    })

    expect(wrapper.text()).toContain('openai-group')
    expect(wrapper.text()).not.toContain('anthropic-group')
    expect(wrapper.text()).not.toContain('gemini-group')
  })

  it('uses compatible platform filter for deepseek anthropic base url', () => {
    const wrapper = mountSelector({
      platform: 'deepseek',
      compatiblePlatform: 'anthropic'
    })

    expect(wrapper.text()).toContain('anthropic-group')
    expect(wrapper.text()).not.toContain('openai-group')
    expect(wrapper.text()).not.toContain('gemini-group')
  })
})
