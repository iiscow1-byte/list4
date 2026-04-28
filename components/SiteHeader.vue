<script setup lang="ts">
const links = [
  { to: '/levels/1', label: 'List' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/about', label: 'About' },
]

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
</script>

<template>
  <header class="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-30">
    <div class="container-tight flex h-14 items-center justify-between gap-4">
      <NuxtLink to="/" class="flex items-center gap-2 group">
        <span class="text-accent text-lg font-bold tracking-tight">ALL</span>
        <span class="text-sm uppercase tracking-widest font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Levels List</span>
      </NuxtLink>
      <nav class="flex items-center gap-1">
        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          active-class="text-zinc-100 bg-zinc-900"
        >
          {{ l.label }}
        </NuxtLink>

        <NuxtLink
          v-if="me?.role === 'admin' || me?.role === 'moderator'"
          to="/admin"
          class="px-3 py-1.5 rounded text-sm font-medium text-accent/80 hover:text-accent hover:bg-zinc-900 transition-colors"
          active-class="text-accent bg-zinc-900"
        >{{ me.role === 'admin' ? 'Admin' : 'Mod' }}</NuxtLink>

        <span class="w-px h-5 bg-zinc-800 mx-1" />

        <template v-if="me">
          <NuxtLink
            to="/account"
            class="px-3 py-1.5 rounded text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors flex items-center gap-2"
            active-class="text-zinc-100 bg-zinc-900"
          >
            <span
              v-if="me.has_avatar"
              class="w-5 h-5 rounded-full overflow-hidden bg-zinc-800"
            >
              <img :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
            </span>
            <span>{{ me.username }}</span>
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">Log in</NuxtLink>
          <NuxtLink to="/signup" class="px-3 py-1.5 rounded text-sm font-medium text-accent hover:bg-zinc-900 transition-colors">Sign up</NuxtLink>
        </template>

        <span class="w-px h-5 bg-zinc-800 mx-1" />
        <ThemeMenu />
      </nav>
    </div>
  </header>
</template>
