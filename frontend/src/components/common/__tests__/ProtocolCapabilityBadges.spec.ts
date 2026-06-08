import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProtocolCapabilityBadges from '../ProtocolCapabilityBadges.vue'

describe('ProtocolCapabilityBadges', () => {
  it('renders each enabled capability', () => {
    const wrapper = mount(ProtocolCapabilityBadges, {
      props: {
        supportsOpenAIChatCompletions: true,
        supportsOpenAIResponses: true,
        supportsAnthropicMessages: true
      }
    })

    expect(wrapper.text()).toContain('OpenAI Chat')
    expect(wrapper.text()).toContain('Responses')
    expect(wrapper.text()).toContain('Anthropic Messages')
  })

  it('renders fallback when no capability is available', () => {
    const wrapper = mount(ProtocolCapabilityBadges)
    expect(wrapper.text()).toContain('No protocol')
  })
})
