<script setup lang="ts">
/**
 * The document's own language, kept in step with the reader's choice.
 *
 * `<html lang>` is what a screen reader picks a voice from and what a browser
 * offers to translate against, so a page rendered in Spanish that still claims
 * to be English is read aloud in the wrong accent and offered a translation it
 * doesn't need. Set here because this is the only component that wraps every
 * page, and from `useLocale` so it follows the cookie on the server too.
 */
const { locale } = useLocale()
useHead(() => ({ htmlAttrs: { lang: locale.value } }))
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
