<script setup lang="ts">
const links = [
  { to: '/levels/1', label: 'List' },
  { to: '/leaderboard', label: 'Leaderboard' },
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
          to="/levels/submit"
          class="px-3 py-1.5 rounded text-sm font-medium bg-accent text-zinc-950 hover:bg-accent/90 transition-colors"
          active-class="bg-accent/90"
        >Submit level</NuxtLink>

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
        <a
          href="https://discord.gg/KfZvUpS3PB"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord"
          class="p-1.5 rounded text-zinc-400 hover:text-[#5865F2] hover:bg-zinc-900 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5" aria-hidden="true">
            <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.075.075 0 0 0-.079.037c-.34.602-.719 1.388-.984 2.005a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.997-2.005.078.078 0 0 0-.079-.037A19.74 19.74 0 0 0 5.171 4.37a.07.07 0 0 0-.032.027C2.144 8.84 1.32 13.179 1.724 17.46a.083.083 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.029.078.078 0 0 0 .085-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.075.075 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.075.075 0 0 1 .079.009c.12.099.245.198.372.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.106c.36.698.772 1.362 1.225 1.993a.077.077 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.029.077.077 0 0 0 .032-.054c.5-4.949-.838-9.252-3.549-13.064a.061.061 0 0 0-.031-.028zM8.02 14.852c-1.182 0-2.156-1.085-2.156-2.418 0-1.333.955-2.419 2.156-2.419 1.21 0 2.175 1.095 2.156 2.419 0 1.333-.955 2.418-2.156 2.418zm7.974 0c-1.182 0-2.156-1.085-2.156-2.418 0-1.333.955-2.419 2.156-2.419 1.21 0 2.175 1.095 2.156 2.419 0 1.333-.946 2.418-2.156 2.418z"/>
          </svg>
        </a>
        <ThemeMenu />
      </nav>
    </div>
  </header>
</template>
