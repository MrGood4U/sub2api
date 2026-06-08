<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span
      v-if="supportsOpenAIChatCompletions"
      class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
    >
      OpenAI Chat
    </span>
    <span
      v-if="supportsOpenAIResponses"
      class="inline-flex items-center rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300"
    >
      Responses
    </span>
    <span
      v-if="supportsAnthropicMessages"
      class="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
    >
      Anthropic Messages
    </span>
    <span
      v-if="!hasAnyCapability"
      class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-dark-700 dark:text-dark-300"
    >
      No protocol
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  supportsOpenAIChatCompletions?: boolean
  supportsOpenAIResponses?: boolean
  supportsAnthropicMessages?: boolean
}

const props = defineProps<Props>()

const hasAnyCapability = computed(() =>
  !!props.supportsOpenAIChatCompletions ||
  !!props.supportsOpenAIResponses ||
  !!props.supportsAnthropicMessages
)
</script>
