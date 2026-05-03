<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Account — All Levels List' })

const { data: meRes, refresh: refreshMe } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

// --- About-you edit state ---
const editing = ref(false)
const profile = reactive({
  bio: me.value?.bio ?? '',
  country: me.value?.country ?? '',
  subdivision: me.value?.subdivision ?? '',
})
const profileSaving = ref(false)
const profileError = ref<string | null>(null)
const profileSaved = ref(false)

watch(me, (val) => {
  if (val && !editing.value) {
    profile.bio = val.bio ?? ''
    profile.country = val.country ?? ''
    profile.subdivision = val.subdivision ?? ''
  }
}, { immediate: true })

function startEdit() {
  if (!me.value) return
  profile.bio = me.value.bio ?? ''
  profile.country = me.value.country ?? ''
  profile.subdivision = me.value.subdivision ?? ''
  profileError.value = null
  profileSaved.value = false
  editing.value = true
}
function cancelEdit() {
  if (me.value) {
    profile.bio = me.value.bio ?? ''
    profile.country = me.value.country ?? ''
    profile.subdivision = me.value.subdivision ?? ''
  }
  profileError.value = null
  editing.value = false
}
async function saveProfile() {
  if (profileSaving.value) return
  profileError.value = null
  profileSaved.value = false
  profileSaving.value = true
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { ...profile } })
    await refreshMe()
    profileSaved.value = true
    editing.value = false
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

const claimOpen = ref(false)
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
    claimOpen.value = false
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

// --- Profile data (stats, completed, created, progress) ---
type ProfileData = {
  account: {
    username: string; role: 'user'|'moderator'|'admin'
    bio: string | null; country: string | null; subdivision: string | null
    claimed_player: string | null; has_avatar: boolean
  }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
  verifiedLevels: any[]
  progressPosts: any[]
  follow: { target: string; followed: boolean; followerCount: number; isSelf: boolean; canFollow: boolean }
}
const profileData = ref<ProfileData | null>(null)

async function loadProfileData() {
  if (!me.value) return
  profileData.value = await $fetch<ProfileData>(`/api/users/${encodeURIComponent(me.value.username)}`)
}
onMounted(loadProfileData)
watch(() => me.value?.claimed_player, loadProfileData)
watch(() => me.value?.bio, loadProfileData)

// --- Progress post composer (inline) ---
const showProgress = ref(false)

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
  <div v-if="me" class="container-tight py-8 max-w-5xl">
    <div class="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-6">
      <!-- Main column: same shape as the public profile -->
      <main class="space-y-6 min-w-0">
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
            <p v-if="me.claimed_player" class="text-xs text-zinc-500 mt-1">
              Claimed as <span class="text-zinc-300">{{ me.claimed_player }}</span>
            </p>
            <p v-if="!editing && (me.country || me.subdivision)" class="text-xs text-zinc-500 mt-0.5">
              <span v-if="me.subdivision">{{ me.subdivision }}, </span>
              <span v-if="me.country">{{ me.country }}</span>
            </p>
          </div>
        </header>

        <!-- About: read-only display, switches to a form when editing -->
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-center justify-between gap-2 mb-3">
            <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">About</h2>
            <button
              v-if="!editing"
              type="button"
              class="text-xs px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
              @click="startEdit"
            >Edit</button>
          </div>

          <template v-if="!editing">
            <p v-if="me.bio" class="text-sm text-zinc-200 whitespace-pre-wrap">{{ me.bio }}</p>
            <p v-else class="text-sm text-zinc-600 italic">No bio yet.</p>
            <dl v-if="me.country || me.subdivision" class="grid grid-cols-2 gap-4 text-sm mt-3">
              <div v-if="me.country">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Country</dt>
                <dd class="text-zinc-100">{{ me.country }}</dd>
              </div>
              <div v-if="me.subdivision">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">State / region</dt>
                <dd class="text-zinc-100">{{ me.subdivision }}</dd>
              </div>
            </dl>
            <p v-if="profileSaved" class="text-xs text-emerald-400 mt-2">Saved.</p>
          </template>

          <form v-else class="space-y-4" @submit.prevent="saveProfile">
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
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="submit"
                :disabled="profileSaving"
                class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
              >{{ profileSaving ? 'Saving…' : 'Save' }}</button>
              <button
                type="button"
                class="rounded border border-zinc-800 text-zinc-300 text-sm px-3 py-1.5 hover:bg-zinc-900 transition-colors"
                @click="cancelEdit"
              >Cancel</button>
              <span v-if="profileError" class="text-xs text-red-400">{{ profileError }}</span>
            </div>
          </form>
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
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Tier of hardest</dt>
              <dd class="text-zinc-100 text-base">{{ profileData.player.tier ?? '—' }}</dd>
            </div>
          </dl>
        </section>

        <ProgressPosts
          v-if="profileData"
          v-model:open="showProgress"
          :posts="profileData.progressPosts"
          :can-post="true"
          @changed="loadProfileData()"
        />

        <ProfileLevelLists
          v-if="profileData"
          :completed="profileData.completedLevels"
          :created="profileData.createdLevels"
          :verified="profileData.verifiedLevels"
        />
      </main>

      <!-- Right panel: actions -->
      <aside class="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2">Actions</h2>
          <div class="flex flex-col gap-1.5">
            <button
              type="button"
              class="text-left text-sm px-3 py-1.5 rounded bg-accent text-zinc-950 font-medium hover:bg-accent/90 transition-colors"
              @click="startEdit"
            >{{ editing ? 'Editing profile…' : 'Edit profile' }}</button>

            <button
              type="button"
              class="text-left text-sm px-3 py-1.5 rounded bg-accent/15 text-accent font-medium hover:bg-accent/25 transition-colors"
              @click="showProgress = !showProgress"
            >Post progress</button>

            <NuxtLink
              to="/records/submit"
              class="block text-sm px-3 py-1.5 rounded border border-zinc-800 text-zinc-200 hover:bg-zinc-900 transition-colors"
            >Submit record</NuxtLink>

            <NuxtLink
              to="/levels/submit"
              class="block text-sm px-3 py-1.5 rounded border border-zinc-800 text-zinc-200 hover:bg-zinc-900 transition-colors"
            >Submit level</NuxtLink>

            <button
              v-if="!me.claimed_player && !pendingClaim"
              type="button"
              class="text-left text-sm px-3 py-1.5 rounded border border-zinc-800 text-zinc-200 hover:bg-zinc-900 transition-colors"
              @click="claimOpen = !claimOpen"
            >Claim leaderboard player</button>
          </div>

          <!-- Claim status / inline form -->
          <div v-if="me.claimed_player" class="mt-3 px-1 text-xs text-zinc-500">
            Claimed as <span class="text-accent font-medium">{{ me.claimed_player }}</span>.
            <p class="mt-0.5 text-zinc-600">Contact an admin to change.</p>
          </div>
          <div v-else-if="pendingClaim" class="mt-3 px-1 text-xs text-zinc-400">
            <p>Pending claim for <span class="text-zinc-200 font-medium">{{ pendingClaim.player_name }}</span>.</p>
            <button
              type="button"
              class="mt-1 text-zinc-500 hover:text-red-400 underline"
              @click="cancelClaim"
            >Cancel</button>
          </div>
          <form v-else-if="claimOpen" class="mt-3 space-y-2" @submit.prevent="submitClaim">
            <input
              v-model="claimInput"
              placeholder="Exact leaderboard name"
              class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
            />
            <div class="flex gap-2">
              <button
                type="submit"
                :disabled="claimSubmitting || !claimInput.trim()"
                class="flex-1 rounded bg-accent text-zinc-950 text-xs font-medium py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
              >Request</button>
              <button
                type="button"
                class="px-2 py-1.5 rounded border border-zinc-800 text-zinc-400 text-xs hover:bg-zinc-900 transition-colors"
                @click="claimOpen = false"
              >Cancel</button>
            </div>
            <p v-if="claimError" class="text-xs text-red-400">{{ claimError }}</p>
          </form>
        </div>

        <div class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2">Profile picture</h2>
          <div class="flex items-center gap-2 flex-wrap">
            <label class="rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium px-2.5 py-1 cursor-pointer transition-colors">
              <span>{{ avatarUploading ? 'Uploading…' : 'Upload' }}</span>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="onAvatarChange" />
            </label>
            <button
              v-if="me.has_avatar"
              type="button"
              class="rounded border border-zinc-800 hover:border-red-900 hover:text-red-400 text-xs px-2.5 py-1 transition-colors"
              @click="removeAvatar"
            >Remove</button>
          </div>
          <p class="text-[10px] text-zinc-600 mt-2">PNG/JPEG/GIF/WebP, ≤1 MB.</p>
          <p v-if="avatarError" class="text-xs text-red-400 mt-1">{{ avatarError }}</p>
        </div>

        <div class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
          <NuxtLink :to="`/users/${me.username}`" class="block text-zinc-400 hover:text-accent transition-colors">View public profile ↗</NuxtLink>
          <template v-if="me.role === 'admin' || me.role === 'moderator'">
            <NuxtLink to="/admin" class="block mt-1 text-zinc-400 hover:text-accent transition-colors">{{ me.role === 'admin' ? 'Admin' : 'Mod' }} panel →</NuxtLink>
          </template>
          <button
            type="button"
            class="block mt-1 text-zinc-500 hover:text-red-400 transition-colors"
            @click="logout"
          >Log out</button>
        </div>
      </aside>
    </div>
  </div>
</template>
