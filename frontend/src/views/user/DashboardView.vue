<template>
  <AppLayout>
    <div class="space-y-6">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
      <template v-else-if="stats">
        <UserDashboardStats
          :stats="stats"
          :balance="user?.balance || 0"
          :is-simple="authStore.isSimpleMode"
          :platform-quotas="platformQuotas"
        />
        <UserDashboardCharts
          v-model:startDate="startDate"
          v-model:endDate="endDate"
          v-model:granularity="granularity"
          :loading="loadingCharts"
          :trend="trendData"
          :models="modelStats"
          @dateRangeChange="loadCharts"
          @granularityChange="loadCharts"
          @refresh="refreshAll"
        />
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2">
            <UserDashboardRecentUsage :data="recentUsage" :loading="loadingUsage" />
          </div>
          <div class="lg:col-span-1">
            <UserDashboardQuickActions />
          </div>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usageAPI, type UserDashboardStats as UserStatsType } from '@/api/usage'
import AppLayout from '@/components/layout/AppLayout.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import UserDashboardStats from '@/components/user/dashboard/UserDashboardStats.vue'
import UserDashboardCharts from '@/components/user/dashboard/UserDashboardCharts.vue'
import UserDashboardRecentUsage from '@/components/user/dashboard/UserDashboardRecentUsage.vue'
import UserDashboardQuickActions from '@/components/user/dashboard/UserDashboardQuickActions.vue'
import type { ModelStat, PlatformQuotaItem, TrendDataPoint, UsageLog } from '@/types'
import { getMyPlatformQuotas } from '@/api/user'

const dashboardRefreshIntervalMs = 15000

const authStore = useAuthStore()
const user = computed(() => authStore.user)
const stats = ref<UserStatsType | null>(null)
const loading = ref(false)
const loadingUsage = ref(false)
const loadingCharts = ref(false)
const trendData = ref<TrendDataPoint[]>([])
const modelStats = ref<ModelStat[]>([])
const recentUsage = ref<UsageLog[]>([])
const platformQuotas = ref<PlatformQuotaItem[] | null>(null)

const formatLD = (date: Date) => date.toISOString().split('T')[0]

const startDate = ref(formatLD(new Date(Date.now() - 6 * 86400000)))
const endDate = ref(formatLD(new Date()))
const granularity = ref('day')

let dashboardRefreshTimer: number | null = null

const loadStats = async (showLoading = false) => {
  if (showLoading) {
    loading.value = true
  }
  try {
    await authStore.refreshUser()
    stats.value = await usageAPI.getDashboardStats()
  } catch (error) {
    console.error('Failed to load dashboard stats:', error)
  } finally {
    if (showLoading) {
      loading.value = false
    }
  }
}

const loadCharts = async () => {
  loadingCharts.value = true
  try {
    const [trend, models] = await Promise.all([
      usageAPI.getDashboardTrend({
        start_date: startDate.value,
        end_date: endDate.value,
        granularity: granularity.value as 'day' | 'hour'
      }),
      usageAPI.getDashboardModels({
        start_date: startDate.value,
        end_date: endDate.value
      })
    ])
    trendData.value = trend.trend || []
    modelStats.value = models.models || []
  } catch (error) {
    console.error('Failed to load charts:', error)
  } finally {
    loadingCharts.value = false
  }
}

const loadRecent = async () => {
  loadingUsage.value = true
  try {
    const response = await usageAPI.getByDateRange(startDate.value, endDate.value)
    recentUsage.value = response.items.slice(0, 5)
  } catch (error) {
    console.error('Failed to load recent usage:', error)
  } finally {
    loadingUsage.value = false
  }
}

const loadPlatformQuotas = async () => {
  try {
    const data = await getMyPlatformQuotas()
    platformQuotas.value = data.platform_quotas ?? []
  } catch (error) {
    console.warn('Failed to load platform quotas:', error)
    platformQuotas.value = []
  }
}

const refreshAll = async (showLoading = false) => {
  await Promise.all([
    loadStats(showLoading),
    loadCharts(),
    loadRecent(),
    loadPlatformQuotas()
  ])
}

const handleVisibilityRefresh = () => {
  if (document.visibilityState === 'visible') {
    void refreshAll()
  }
}

const startDashboardRefresh = () => {
  stopDashboardRefresh()
  dashboardRefreshTimer = window.setInterval(() => {
    void refreshAll()
  }, dashboardRefreshIntervalMs)
}

const stopDashboardRefresh = () => {
  if (dashboardRefreshTimer !== null) {
    window.clearInterval(dashboardRefreshTimer)
    dashboardRefreshTimer = null
  }
}

onMounted(() => {
  void refreshAll(true)
  startDashboardRefresh()
  window.addEventListener('focus', handleVisibilityRefresh)
  document.addEventListener('visibilitychange', handleVisibilityRefresh)
})

onActivated(() => {
  void refreshAll()
})

onUnmounted(() => {
  stopDashboardRefresh()
  window.removeEventListener('focus', handleVisibilityRefresh)
  document.removeEventListener('visibilitychange', handleVisibilityRefresh)
})
</script>
