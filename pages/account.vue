<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Account — All Levels List' })

const { data: meRes, refresh: refreshMe } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

const profile = reactive({
  bio: me.value?.bio ?? '',
  country: me.value?.country ?? '',
  subdivision: me.value?.subdivision ?? '',
})
const profileSaving = ref(false)
const profileError = ref<string | null>(null)
const profileSaved = ref(false)

watch(me, (val) => {
  if (val) {
    profile.bio = val.bio ?? ''
    profile.country = val.country ?? ''
    profile.subdivision = val.subdivision ?? ''
  }
}, { immediate: true })

async function saveProfile() {
  if (profileSaving.value) return
  profileError.value = null
  profileSaved.value = false
  profileSaving.value = true
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { ...profile } })
    await refreshMe()
    profileSaved.value = true
    setTimeout(() => (profileSaved.value = false), 2500)
  } catch (e: any) {
    profileError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    profileSaving.value = false
  }
}

// --- Avatar ---
const avatarVersion = ref(0)
const avatarUrl = computed(() =>
  me.value?.has_avatar ? `/api/users/${encodeURIComponent(me.value.username)}/avatar?v=${avatarVersion.value}` : null,
)
const avatarError = ref<string | null>(null)
const avatarUploading = ref(false)

async function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  avatarError.value = null
  avatarUploading.value = true
  try {
    const fd = new FormData()
    fd.append('avatar', file)
    await $fetch('/api/account/avatar', { method: 'POST', body: fd })
    await refreshMe()
    avatarVersion.value++
  } catch (err: any) {
    avatarError.value = err?.data?.statusMessage ?? err?.statusMessage ?? 'Upload failed.'
  } finally {
    avatarUploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function removeAvatar() {
  await $fetch('/api/account/avatar', { method: 'DELETE' })
  await refreshMe()
  avatarVersion.value++
}

// --- Claim (client-only fetch — endpoint requires auth) ---
type PendingClaim = { id: number; player_name: string; created_at: string }
const pendingClaim = ref<PendingClaim | null>(null)

async function loadPendingClaim() {
  try {
    const res = await $fetch<{ pending: PendingClaim | null }>('/api/account/claim')
    pendingClaim.value = res.pending
  } catch {
    pendingClaim.value = null
  }
}
onMounted(loadPendingClaim)

const claimInput = ref('')
const claimError = ref<string | null>(null)
const claimSubmitting = ref(false)

async function submitClaim() {
  if (claimSubmitting.value || !claimInput.value.trim()) return
  claimError.value = null
  claimSubmitting.value = true
  try {
    await $fetch('/api/account/claim', { method: 'POST', body: { player_name: claimInput.value.trim() } })
    await loadPendingClaim()
    claimInput.value = ''
  } catch (e: any) {
    claimError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Claim failed.'
  } finally {
    claimSubmitting.value = false
  }
}

async function cancelClaim() {
  await $fetch('/api/account/claim', { method: 'DELETE' })
  await loadPendingClaim()
}

// --- Profile data (stats, completed, created) ---
type ProfileData = {
  account: { username: string; has_avatar: boolean }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
}
const profileData = ref<ProfileData | null>(null)

async function loadProfileData() {
  if (!me.value) return
  profileData.value = await $fetch<ProfileData>(`/api/users/${encodeURIComponent(me.value.username)}`)
}
onMounted(loadProfileData)
watch(() => me.value?.claimed_player, loadProfileData)

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshNuxtData('auth-me')
  await navigateTo('/login')
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>

<template>
  <div v-if="me" class="container-tight py-8 max-w-3xl space-y-8">
    <header class="flex items-start gap-4 flex-wrap">
      <div class="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0">
        <img v-if="avatarUrl" :src="avatarUrl" alt="avatar" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full flex items-center justify-center text-2xl text-zinc-600 font-bold">
          {{ me.username.charAt(0).toUpperCase() }}
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2 flex-wrap">
          <h1 class="text-3xl font-semibold tracking-tight">{{ me.username }}</h1>
          <span v-if="me.role !== 'user'" class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">{{ me.role }}</span>
        </div>
        <p class="text-xs text-zinc-500 mt-1">
          <NuxtLink :to="`/users/${me.username}`" class="hover:text-accent">View public profile ↗</NuxtLink>
          <span class="mx-2">·</span>
          <button class="hover:text-accent" @click="logout">Log out</button>
          <template v-if="me.role === 'admin'">
            <span class="mx-2">·</span>
            <NuxtLink to="/admin" class="hover:text-accent">Admin →</NuxtLink>
          </template>
        </p>
      </div>
    </header>

    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Profile picture</h2>
      <div class="flex items-center gap-3 flex-wrap">
        <label class="rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-sm font-medium px-3 py-1.5 cursor-pointer transition-colors">
          <span>{{ avatarUploading ? 'Uploading…' : 'Upload image' }}</span>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="onAvatarChange" />
        </label>
        <button
          v-if="me.has_avatar"
          type="button"
          class="rounded border border-zinc-800 hover:border-red-900 hover:text-red-400 text-sm px-3 py-1.5 transition-colors"
          @click="removeAvatar"
        >Remove</button>
        <span class="text-[11px] text-zinc-500">PNG, JPEG, GIF, or WebP — up to 1 MB.</span>
      </div>
      <p v-if="avatarError" class="text-xs text-red-400 mt-2">{{ avatarError }}</p>
    </section>

    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">About you</h2>
      <form class="space-y-4" @submit.prevent="saveProfile">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Bio</span>
          <textarea
            v-model="profile.bio"
            rows="3"
            maxlength="1000"
            placeholder="Tell people about yourself."
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Country</span>
            <input
              v-model="profile.country"
              maxlength="64"
              placeholder="e.g. United States"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">State / region</span>
            <input
              v-model="profile.subdivision"
              maxlength="64"
              placeholder="e.g. California"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>
        <div class="flex items-center gap-3">
          <button
            type="submit"
            :disabled="profileSaving"
            class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
          >{{ profileSaving ? 'Saving…' : 'Save' }}</button>
          <span v-if="profileSaved" class="text-xs text-emerald-400">Saved.</span>
          <span v-if="profileError" class="text-xs text-red-400">{{ profileError }}</span>
        </div>
      </form>
    </section>

    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Leaderboard claim</h2>
      <div v-if="me.claimed_player">
        <p class="text-sm text-zinc-300">
          You're claimed as <span class="font-medium text-accent">{{ me.claimed_player }}</span>.
        </p>
        <p class="text-[11px] text-zinc-500 mt-1">To change this, contact an admin.</p>
      </div>
      <div v-else-if="pendingClaim">
        <p class="text-sm text-zinc-300">
          Pending claim for <span class="font-medium">{{ pendingClaim.player_name }}</span> — waiting on an admin.
        </p>
        <button
          type="button"
          class="mt-2 text-xs text-zinc-500 hover:text-red-400 underline"
          @click="cancelClaim"
        >Cancel claim</button>
      </div>
      <form v-else class="flex flex-col sm:flex-row gap-2 sm:items-end" @submit.prevent="submitClaim">
        <label class="block flex-1">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Player name on the leaderboard</span>
          <input
            v-model="claimInput"
            placeholder="Exactly as it appears on the leaderboard"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <button
          type="submit"
          :disabled="claimSubmitting || !claimInput.trim()"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >Request claim</button>
      </form>
      <p v-if="claimError" class="text-xs text-red-400 mt-2">{{ claimError }}</p>
    </section>

    <section v-if="profileData?.player" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Player stats</h2>
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Total points</dt>
          <dd class="tabular-nums text-amber-300 text-base">{{ fmt(profileData.player.total_points) }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Skill points</dt>
          <dd class="tabular-nums text-zinc-100 text-base">{{ fmt(profileData.player.skill_points) }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Hardest</dt>
          <dd class="text-zinc-100 text-base truncate">{{ profileData.player.hardest ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Tier</dt>
          <dd class="text-zinc-100 text-base">{{ profileData.player.tier ?? '—' }}</dd>
        </div>
      </dl>
    </section>

    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <h2 class="text-sm font-medium text-zinc-100">Submit a record</h2>
        <p class="text-xs text-zinc-500 mt-0.5">Add a completion to be reviewed by a moderator.</p>
      </div>
      <NuxtLink
        to="/records/submit"
        class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-1.5 hover:bg-accent/90 transition-colors shrink-0"
      >Submit record</NuxtLink>
    </section>

    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <h2 class="text-sm font-medium text-zinc-100">Submit a new level</h2>
        <p class="text-xs text-zinc-500 mt-0.5">Suggest a level to add to the list. A moderator picks placement.</p>
      </div>
      <NuxtLink
        to="/levels/submit"
        class="rounded border border-accent/40 text-accent font-medium text-sm px-4 py-1.5 hover:bg-accent/10 transition-colors shrink-0"
      >Submit level</NuxtLink>
    </section>

    <ProfileLevelLists
      v-if="profileData"
      :completed="profileData.completedLevels"
      :created="profileData.createdLevels"
    />
  </div>
</template>
