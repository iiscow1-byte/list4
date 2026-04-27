<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
    <SiteHeader />
    <main class="flex-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
