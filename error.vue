<script setup lang="ts">
const props = defineProps<{ error: { statusCode: number; statusMessage?: string; message?: string } }>()
const notFound = computed(() => props.error.statusCode === 404)

function handleHome() {
  return clearError({ redirect: '/levels/1' })
}

useHead({ title: `${notFound.value ? 'Not found' : 'Error'} — All Levels List` })
</script>

<template>
  <!-- The site's own header and footer, so a dead link still leaves the rest
       of the site one click away. -->
  <NuxtLayout name="default">
    <div class="container-tight py-24 text-center">
      <p class="rank text-6xl text-zinc-700">{{ error.statusCode }}</p>
      <h1 class="page-title mt-4">{{ notFound ? 'Nothing here' : 'Something went wrong' }}</h1>
      <p class="page-lead mt-2">
        <template v-if="notFound">There's no page at this address.</template>
        <template v-else>{{ error.statusMessage || 'Try again in a moment.' }}</template>
      </p>
      <button type="button" class="btn btn-md btn-primary mt-8" @click="handleHome">
        Back to the list
      </button>
    </div>
  </NuxtLayout>
</template>
