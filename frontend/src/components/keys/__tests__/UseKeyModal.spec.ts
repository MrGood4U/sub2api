import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import UseKeyModal from '../UseKeyModal.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard: vi.fn().mockResolvedValue(true)
  })
}))

function mountModal(props: Record<string, unknown>) {
  return mount(UseKeyModal, {
    props: {
      show: true,
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      group: {
        id: 1,
        name: 'openai-group',
        platform: 'openai',
        supports_openai_chat_completions: true,
        supports_openai_responses: true,
        supports_anthropic_messages: false
      },
      ...props
    },
    global: {
      stubs: {
        BaseDialog: {
          props: ['show', 'title'],
          template: '<div><slot /><slot name="footer" /></div>'
        },
        Icon: {
          template: '<span />'
        }
      }
    }
  })
}

describe('UseKeyModal', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders GPT-5.5 and goals feature in OpenAI Codex config', () => {
    const wrapper = mountModal({})
    const codeBlocks = wrapper.findAll('pre code').map((code) => code.text())
    const configToml = codeBlocks.find((content) => content.includes('model_provider = "OpenAI"'))

    expect(configToml).toBeDefined()
    expect(configToml).toContain('model = "gpt-5.5"')
    expect(configToml).toContain('review_model = "gpt-5.5"')
    expect(configToml).toContain('[features]\ngoals = true')
  })

  it('renders GPT-5.5 and goals feature in OpenAI Codex WebSocket config', async () => {
    const wrapper = mountModal({})
    const wsTab = wrapper.findAll('button').find((button) =>
      button.text().includes('keys.useKeyModal.cliTabs.codexCliWs')
    )

    expect(wsTab).toBeDefined()
    await wsTab!.trigger('click')
    await nextTick()

    const codeBlocks = wrapper.findAll('pre code').map((code) => code.text())
    const configToml = codeBlocks.find((content) => content.includes('supports_websockets = true'))

    expect(configToml).toBeDefined()
    expect(configToml).toContain('model = "gpt-5.5"')
    expect(configToml).toContain('[features]\nresponses_websockets_v2 = true\ngoals = true')
  })

  it('renders GPT-5.4 mini entry in OpenCode config', async () => {
    const wrapper = mountModal({})
    const opencodeTab = wrapper.findAll('button').find((button) =>
      button.text().includes('keys.useKeyModal.cliTabs.opencode')
    )

    expect(opencodeTab).toBeDefined()
    await opencodeTab!.trigger('click')
    await nextTick()

    const codeBlock = wrapper.find('pre code')
    expect(codeBlock.exists()).toBe(true)
    expect(codeBlock.text()).toContain('"name": "GPT-5.4 Mini"')
    expect(codeBlock.text()).not.toContain('"name": "GPT-5.4 Nano"')
  })

  it('shows openai compatible guidance for chat-completions-only groups', () => {
    const wrapper = mountModal({
      baseUrl: '',
      group: {
        id: 2,
        name: 'ds',
        platform: 'openai',
        supports_openai_chat_completions: true,
        supports_openai_responses: false,
        supports_anthropic_messages: false
      }
    })

    expect(wrapper.text()).toContain('keys.useKeyModal.cliTabs.openaiCompatible')
    expect(wrapper.text()).not.toContain('keys.useKeyModal.cliTabs.codexCli')
    expect(wrapper.text()).not.toContain('keys.useKeyModal.cliTabs.claudeCode')
  })

  it('prefers the dev proxy target as the API gateway base url', () => {
    vi.stubEnv('VITE_DEV_PROXY_TARGET', 'http://127.0.0.1:8081')

    const wrapper = mountModal({
      baseUrl: '',
      group: {
        id: 2,
        name: 'ds',
        platform: 'openai',
        supports_openai_chat_completions: true,
        supports_openai_responses: false,
        supports_anthropic_messages: false
      }
    })

    expect(wrapper.text()).toContain('http://127.0.0.1:8081/v1')
    expect(wrapper.text()).not.toContain('http://localhost:3001/v1')
  })
})
