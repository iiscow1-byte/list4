<script setup lang="ts">
import { countryFlagUrl, countryName, normalizeCountry } from '~/utils/countries'

/**
 * A country's flag, from whatever is stored on the row.
 *
 * Takes the raw value rather than a code, because `accounts.country` was a
 * free-text box before it was a picker and a profile filled in then still says
 * "United States". Anything that resolves to a country gets a flag; anything
 * else renders nothing at all, rather than a broken image.
 */
const props = withDefaults(defineProps<{
  country: string | null | undefined
  /** Matches the type it sits beside. */
  size?: 'sm' | 'md'
  /** Print the country's name after the flag. */
  withName?: boolean
}>(), { size: 'md', withName: false })

const code = computed(() => normalizeCountry(props.country))
const name = computed(() => countryName(code.value))
// The 40px-tall file for the larger size, so it stays sharp on a HiDPI screen.
const url = computed(() => countryFlagUrl(code.value, props.size === 'md' ? 40 : 20))

const failed = ref(false)
watch(code, () => { failed.value = false })
</script>

<template>
  <span v-if="code && !failed" class="inline-flex items-center gap-1.5 min-w-0">
    <img
      :src="url!"
      :alt="name ?? code"
      :title="name ?? code"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="rounded-[2px] shrink-0 ring-1 ring-white/10 object-cover"
      :class="size === 'md' ? 'h-4 w-[22px]' : 'h-3 w-[17px]'"
      @error="failed = true"
    />
    <span v-if="withName" class="truncate">{{ name ?? code }}</span>
  </span>
  <!-- The image didn't load, or the value isn't a country the site knows: say
       what is stored rather than dropping it. -->
  <span v-else-if="withName && country" class="truncate">{{ name ?? country }}</span>
</template>
