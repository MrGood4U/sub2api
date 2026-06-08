import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  refreshUser: vi.fn().mockResolvedValue(undefined),
  getDashboardStats: vi.fn(),
  getDashboardTrend: vi.fn(),
  getDashboardModels: vi.fn(),
  getByDateRange: vi.fn()
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { balance: 20 },
    isSimpleMode: false,
    refreshUser: mocks.refreshUser
  })
}))

vi.mock('@/api/usage', () => ({
  usageAPI: {
    getDashboardStats: mocks.getDashboardStats,
    getDashboardTrend: mocks.getDashboardTrend,
    getDashboardModels: mocks.getDashboardModels,
    getByDateRange: mocks.getByDateRange
  }
}))
let DashboardView: any

function mountView() {
  return mount(DashboardView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        LoadingSpinner: { template: '<div>loading</div>' },
        UserDashboardStats: { template: '<div>stats</div>' },
        UserDashboardCharts: { template: '<div>charts</div>' },
        UserDashboardRecentUsage: { template: '<div>recent</div>' },
        UserDashboardQuickActions: { template: '<div>actions</div>' }
      }
    }
  })
}

describe('DashboardView', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
    mocks.refreshUser.mockResolvedValue(undefined)
    mocks.getDashboardStats.mockResolvedValue({
      total_cost: 0.01,
      total_actual_cost: 0.05
    })
    mocks.getDashboardTrend.mockResolvedValue({ trend: [] })
    mocks.getDashboardModels.mockResolvedValue({ models: [] })
    mocks.getByDateRange.mockResolvedValue({ items: [] })
    DashboardView = (await import('../DashboardView.vue')).default
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('refreshes on mount and periodic timer', async () => {
    mountView()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.getDashboardStats).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(15000)
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.getDashboardStats).toHaveBeenCalledTimes(2)
  })

  it('refreshes when the page becomes visible again', async () => {
    mountView()
    await Promise.resolve()
    await Promise.resolve()
    mocks.getDashboardStats.mockClear()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.getDashboardStats.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
