<script setup lang="ts">
const props = defineProps<{
  difficulty: string | null | undefined
  rated: string | null | undefined
  position: number | null | undefined
}>()

const RATING_COL: Record<string, number> = { featured: 1, epic: 2, legendary: 3, mythic: 4 }
const LEFT_ROW: Record<string, number> = { auto: 1, easy: 2, normal: 4, hard: 5, harder: 6 }
const RIGHT_ROW: Record<string, number> = {
  insane: 0,
  'easy demon': 2,
  'medium demon': 3,
  'hard demon': 4,
  'insane demon': 5,
  'extreme demon': 6,
}
const DEMON_SET = new Set(['easy demon', 'medium demon', 'hard demon', 'insane demon', 'extreme demon'])
const RIGHT_SET = new Set([...DEMON_SET, 'insane'])

const coords = computed(() => {
  const diff = (props.difficulty ?? '').toLowerCase().trim()
  const colOffset = RATING_COL[(props.rated ?? '').toLowerCase().trim()] ?? 0
  const isDemon = DEMON_SET.has(diff)
  const isTop150 = isDemon && props.position != null && props.position <= 150
  if (isTop150) return { col: 5 + colOffset, row: 7 }
  if (RIGHT_SET.has(diff)) return { col: 5 + colOffset, row: RIGHT_ROW[diff] ?? 0 }
  return { col: colOffset, row: LEFT_ROW[diff] ?? 0 }
})

const bgPosition = computed(() => {
  const { col, row } = coords.value
  const x = col === 0 ? 0 : (col / 9) * 100
  const y = row === 0 ? 0 : (row / 7) * 100
  return `${x.toFixed(3)}% ${y.toFixed(3)}%`
})
</script>

<template>
  <div
    class="w-20 h-20 shrink-0"
    :style="{
      backgroundImage: `url('/difficulty-sprites.png')`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: '1000% 800%',
      backgroundPosition: bgPosition,
    }"
    :title="difficulty ?? 'Unknown'"
  />
</template>
