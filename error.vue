<script setup lang="ts">
defineProps<{ error: { statusCode: number; statusMessage?: string; message?: string } }>()
function handleHome() {
  return clearError({ redirect: '/' })
}
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
    <div class="text-center max-w-md">
      <p class="text-accent text-sm tracking-widest uppercase font-medium">Error</p>
      <h1 class="text-5xl font-semibold mt-2 tabular-nums">{{ error.statusCode }}</h1>
      <p class="text-zinc-400 mt-3">{{ error.statusMessage || error.message || 'Something went wrong.' }}</p>
      <button
        class="mt-8 px-4 py-2 rounded border border-zinc-800 text-sm hover:bg-zinc-900"
        @click="handleHome"
      >
        Back to the list
      </button>
    </div>
  </div>
</template>
