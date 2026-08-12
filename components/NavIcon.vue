<script setup lang="ts">
/**
 * The small stroke icons used in the header dropdowns, kept in one place so
 * the menus stay readable markup instead of walls of inline `<path>`.
 *
 * All 24×24, `currentColor`, 1.75 stroke — they inherit the row's colour.
 */
const props = defineProps<{ name: string; class?: string }>()

const PATHS: Record<string, string> = {
  // Build / lists
  build: 'M12 5v14M5 12h14',
  gallery: 'M4 6h16M4 12h16M4 18h10',
  stack: 'm12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  // The list family
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  void: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 18 18 6',
  verify: 'M9 12.5 11 14.5 15.5 10M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3Z',
  // Community
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-1.5a4 4 0 0 0-3-3.87M16 3.63a4 4 0 0 1 0 7.75',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3.5 2',
  info: 'M12 16v-5M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  sparkles: 'm12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3ZM18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z',
  // Submit
  search: 'm21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  plus: 'M12 5v14M5 12h14',
  flag: 'M4 21V4M4 4h11l-1.5 3.5L15 11H4',
  // A record is a completion you have proved, so: a medal on a ribbon. The flag
  // that used to sit here reads as "report this" or "start here" — neither of
  // which is what submitting a run means.
  medal: 'M12 15.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM8.2 13.6 6.5 21l5.5-3 5.5 3-1.7-7.4M8.5 6.6 6.5 3M15.5 6.6 17.5 3',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z',
  heart: 'M12 21s-7-4.35-9-8.5A5 5 0 0 1 12 6a5 5 0 0 1 9 6.5C19 16.65 12 21 12 21z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  // The source of truth behind the whole list.
  sheet: 'M4 4h16v16H4V4ZM4 9h16M4 14.5h16M9.5 4v16M15 4v16',
}

const d = computed(() => PATHS[props.name] ?? PATHS.info!)
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="props.class ?? 'w-4 h-4'"
    aria-hidden="true"
  >
    <path :d="d" />
  </svg>
</template>
