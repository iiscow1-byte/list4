<template>
  <div class="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
    <SiteHeader />
    <main class="flex-1 min-h-0">
      <slot />
    </main>
  </div>
</template>
