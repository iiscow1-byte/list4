<script setup lang="ts">
const props = defineProps<{
  difficulty: string | null | undefined
  rated: string | null | undefined
  position: number | null | undefined
}>()

// Sprite sheet: 10 cols × 8 rows (cols 0-4 = non-demon, cols 5-9 = demon/insane)
// Each column offset corresponds to a GD rating level.
const RATING_COL: Record<string, number> = { featured: 1, epic: 2, legendary: 3, mythic: 4 }

// Left-side rows (cols 0-4): non-demon difficulties
const LEFT_ROW: Record<string, number> = { auto: 1, easy: 2, normal: 4, hard: 5, harder: 6 }

// Right-side rows (cols 5-9): insane + demon difficulties
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

// Each cell displayed at 80×80px.
// Full image rendered at 800×640px (10 cols × 80px, 8 rows × 80px).
const CELL = 80

const coords = computed(() => {
  const diff = (props.difficulty ?? '').toLowerCase().trim()
  // 'challenge' rated means unrated in GD → col offset 0
  const ratedKey = (props.rated ?? '').toLowerCase().trim()
  const colOffset = ratedKey === 'challenge' ? 0 : (RATING_COL[ratedKey] ?? 0)
  const isDemon = DEMON_SET.has(diff)
  const isTop150 = isDemon && props.position != null && props.position <= 150
  if (isTop150) return { col: 5 + colOffset, row: 7 }
  if (RIGHT_SET.has(diff)) return { col: 5 + colOffset, row: RIGHT_ROW[diff] ?? 0 }
  return { col: colOffset, row: LEFT_ROW[diff] ?? 0 }
})

const bgPos = computed(() => {
  const { col, row } = coords.value
  return `-${col * CELL}px -${row * CELL}px`
})
</script>

<template>
  <div
    class="shrink-0"
    :style="{
      width: `${CELL}px`,
      height: `${CELL}px`,
      backgroundImage: `url('/difficulty-sprites.png')`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${CELL * 10}px ${CELL * 8}px`,
      backgroundPosition: bgPos,
    }"
    :title="difficulty ?? 'Unknown'"
  />
</template>
