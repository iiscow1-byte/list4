<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Account — All Levels List' })

const { enabled: profanityFilterEnabled, setEnabled: setProfanityFilter } = useProfanityFilter()

const { data: meRes, refresh: refreshMe } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

// --- About-you edit state ---
const editing = ref(false)
const profile = reactive({
  bio: me.value?.bio ?? '',
  country: me.value?.country ?? '',
  subdivision: me.value?.subdivision ?? '',
  pronouns: me.value?.pronouns ?? '',
  discord_handle: me.value?.discord_handle ?? '',
  youtube_url: me.value?.youtube_url ?? '',
})
const profileSaving = ref(false)
const profileError = ref<string | null>(null)
const profileSaved = ref(false)

watch(me, (val) => {
  if (val && !editing.value) {
    profile.bio = val.bio ?? ''
    profile.country = val.country ?? ''
    profile.subdivision = val.subdivision ?? ''
    profile.pronouns = val.pronouns ?? ''
    profile.discord_handle = val.discord_handle ?? ''
    profile.youtube_url = val.youtube_url ?? ''
  }
}, { immediate: true })

function startEdit() {
  if (!me.value) return
  profile.bio = me.value.bio ?? ''
  profile.country = me.value.country ?? ''
  profile.subdivision = me.value.subdivision ?? ''
  profile.pronouns = me.value.pronouns ?? ''
  profile.discord_handle = me.value.discord_handle ?? ''
  profile.youtube_url = me.value.youtube_url ?? ''
  favoriteLevelId.value = me.value.favorite_level_id
  favoriteLevelDisplay.value = profileData.value?.favorite_level ?? null
  favoriteLevelNote.value = profileData.value?.favorite_level_note ?? ''
  profileError.value = null
  profileSaved.value = false
  editing.value = true
}
function cancelEdit() {
  if (me.value) {
    profile.bio = me.value.bio ?? ''
    profile.country = me.value.country ?? ''
    profile.subdivision = me.value.subdivision ?? ''
    profile.pronouns = me.value.pronouns ?? ''
    profile.discord_handle = me.value.discord_handle ?? ''
    profile.youtube_url = me.value.youtube_url ?? ''
    favoriteLevelId.value = me.value.favorite_level_id
    favoriteLevelDisplay.value = profileData.value?.favorite_level ?? null
    favoriteLevelNote.value = profileData.value?.favorite_level_note ?? ''
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
    await $fetch('/api/account', { method: 'PATCH', body: {
      ...profile,
      favorite_level_id: favoriteLevelId.value ?? null,
      favorite_level_note: favoriteLevelNote.value.trim() || null,
    } })
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
type PendingClaim = {
  id: number
  player_name: string
  source: 'all' | 'aredl' | null
  aredl_player_uuid: string | null
  created_at: string
}
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
const claimSource = ref<'all' | 'aredl'>('all')
const claimInput = ref('')
const claimAredlUuid = ref<string | null>(null)
const claimError = ref<string | null>(null)
const claimSubmitting = ref(false)

// Aredl autocomplete (only fetched when source = 'aredl')
type AredlSearchHit = { uuid: string; global_name: string; username: string; total_points: number; claimed_account_id: number | null }
const aredlSuggestions = ref<AredlSearchHit[]>([])
let aredlDebounce: ReturnType<typeof setTimeout> | null = null

watch([claimInput, claimSource], () => {
  if (aredlDebounce) clearTimeout(aredlDebounce)
  if (claimSource.value !== 'aredl' || !claimInput.value.trim()) {
    aredlSuggestions.value = []
    claimAredlUuid.value = null
    return
  }
  aredlDebounce = setTimeout(async () => {
    try {
      const res = await $fetch<{ items: AredlSearchHit[] }>('/api/aredl-players/search', {
        query: { q: claimInput.value.trim() },
      })
      aredlSuggestions.value = res.items
    } catch {
      aredlSuggestions.value = []
    }
  }, 200)
})

function pickAredlSuggestion(hit: AredlSearchHit) {
  claimInput.value = hit.global_name
  claimAredlUuid.value = hit.uuid
  aredlSuggestions.value = []
}

async function submitClaim() {
  if (claimSubmitting.value || !claimInput.value.trim()) return
  claimError.value = null
  claimSubmitting.value = true
  try {
    if (claimSource.value === 'aredl') {
      if (!claimAredlUuid.value) {
        // Resolve via search before submitting; user typed but didn't pick.
        const res = await $fetch<{ items: AredlSearchHit[] }>('/api/aredl-players/search', {
          query: { q: claimInput.value.trim() },
        })
        const exact = res.items.find((x) => x.global_name.toLowerCase() === claimInput.value.trim().toLowerCase())
        if (!exact) {
          claimError.value = 'Pick an AREDL player from the suggestions.'
          return
        }
        claimAredlUuid.value = exact.uuid
      }
      await $fetch('/api/account/claim', {
        method: 'POST',
        body: { source: 'aredl', aredl_player_uuid: claimAredlUuid.value },
      })
    } else {
      await $fetch('/api/account/claim', {
        method: 'POST',
        body: { source: 'all', player_name: claimInput.value.trim() },
      })
    }
    await loadPendingClaim()
    claimInput.value = ''
    claimAredlUuid.value = null
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

// --- Open-verification submission (collapsible box on the account page) ---
const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: 39 }, (_, i) => `Tier ${i + 1}`),
]
const OV_DIFFICULTY_OPTIONS = [
  '', 'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
]
const OV_SKILLSET_OPTIONS = [
  '', 'Wave', 'Memory', 'Timings', 'Ship', 'Solo 2P', 'Controlled Spam', 'Flow',
  'Nerve Control', 'Chokepoints', 'High CPS', 'Overall', 'Learny', 'Duals', 'Fast Paced',
  'Consistency', 'Swingcopter', 'Robot', 'Endurance', 'Cube', 'Straight Fly', 'UFO',
  'Ship Control', 'Ball', 'Spider', 'Spam', 'Framelocked',
]
const OV_TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const

const ovOpen = ref(false)
const ovGdId = ref('')
const ovName = ref('')
const ovFps = ref('any')
const ovGameVersion = ref('any')
const ovShowcaseUrl = ref('')
const ovVerifier = ref('')
const ovGddlTier = ref('')
const ovDifficulty = ref('')
const ovEnjoyment = ref('')
const ovSkillset = ref('')
const ovTagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
const ovNotes = ref('')

const ovSubmitting = ref(false)
const ovError = ref<string | null>(null)
const ovSuccess = ref(false)

function ovYoutubeId(url: string | null): string | null {
  if (!url) return null
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]!
  }
  return null
}
const ovShowcaseYt = computed(() => ovYoutubeId(ovShowcaseUrl.value.trim()))

async function submitOpenVerification() {
  if (ovSubmitting.value) return
  ovError.value = null
  if (!ovGdId.value.trim() || !/^\d+$/.test(ovGdId.value.trim())) {
    ovError.value = 'A numeric level ID is required.'
    return
  }
  if (!ovName.value.trim()) {
    ovError.value = 'A level name is required.'
    return
  }
  ovSubmitting.value = true
  try {
    await $fetch('/api/open-verifications/submit', {
      method: 'POST',
      body: {
        gd_id: ovGdId.value.trim(),
        name: ovName.value.trim(),
        fps: ovFps.value.trim() || 'any',
        game_version: ovGameVersion.value.trim() || 'any',
        showcase_url: ovShowcaseUrl.value.trim() || null,
        verifier: ovVerifier.value.trim() || null,
        gddl_tier: ovGddlTier.value || null,
        difficulty: ovDifficulty.value || null,
        enjoyment: ovEnjoyment.value !== '' ? Number(ovEnjoyment.value) : null,
        main_skillset: ovSkillset.value || null,
        tags: OV_TAGS.filter((t) => ovTagSet[t]),
        notes: ovNotes.value.trim() || null,
      },
    })
    ovSuccess.value = true
    ovGdId.value = ''; ovName.value = ''; ovShowcaseUrl.value = ''
    ovVerifier.value = ''; ovGddlTier.value = ''; ovDifficulty.value = ''
    ovEnjoyment.value = ''; ovSkillset.value = ''; ovNotes.value = ''
    for (const t of OV_TAGS) ovTagSet[t] = false
    setTimeout(() => (ovSuccess.value = false), 6000)
  } catch (e: any) {
    ovError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    ovSubmitting.value = false
  }
}

// --- Favorite level ---
type FavLevel = { id: number; position: number; name: string; gddl_tier: string | null }
const favoriteLevelId = ref<number | null>(null)
const favoriteLevelDisplay = ref<FavLevel | null>(null)
const favoriteLevelNote = ref('')
const favoriteLevelPickerOpen = ref(false)

// --- Profile data (stats, completed, created, progress) ---
type ProfileData = {
  account: {
    username: string; role: 'user'|'moderator'|'admin'|'owner'|'developer'
    bio: string | null; country: string | null; subdivision: string | null
    claimed_player: string | null; has_avatar: boolean
    pronouns: string | null; discord_handle: string | null; youtube_url: string | null
  }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
  verifiedLevels: any[]
  progressPosts: any[]
  follow: { target: string; followed: boolean; followerCount: number; isSelf: boolean; canFollow: boolean }
  favorite_level: FavLevel | null
  favorite_level_note: string | null
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
              <span v-if="me.role !== 'user'" class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded" :class="roleBadgeClass(me.role)">{{ me.role }}</span>
            </div>
            <p v-if="me.claimed_player" class="text-xs text-zinc-500 mt-1">
              Claimed as <span class="text-zinc-300">{{ me.claimed_player }}</span>
            </p>
            <p v-if="me.country || me.subdivision" class="text-xs text-zinc-500 mt-0.5">
              <span v-if="me.subdivision">{{ me.subdivision }}, </span>
              <span v-if="me.country">{{ me.country }}</span>
            </p>
          </div>
        </header>

        <!-- About: always-visible display + collapsible edit dropdown below -->
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">About</h2>

          <!-- Read-only display — always visible -->
          <div>
            <p v-if="me.bio" class="text-sm text-zinc-200 whitespace-pre-wrap">{{ me.bio }}</p>
            <p v-else class="text-sm text-zinc-600 italic">No bio yet.</p>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
              <div v-if="me.country">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Country</dt>
                <dd class="text-zinc-100">{{ me.country }}</dd>
              </div>
              <div v-if="me.subdivision">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">State / region</dt>
                <dd class="text-zinc-100">{{ me.subdivision }}</dd>
              </div>
              <div v-if="me.pronouns">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Pronouns</dt>
                <dd class="text-zinc-100">{{ me.pronouns }}</dd>
              </div>
              <div v-if="me.discord_handle">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Discord</dt>
                <dd class="text-zinc-100">{{ me.discord_handle }}</dd>
              </div>
              <div v-if="me.youtube_url" class="col-span-2">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">YouTube</dt>
                <dd><a :href="me.youtube_url" target="_blank" rel="noopener" class="text-accent hover:underline text-sm">YouTube ↗</a></dd>
              </div>
            </dl>
            <div v-if="profileData?.favorite_level" class="mt-3 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <p class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Favorite Level</p>
              <NuxtLink :to="`/levels/${profileData.favorite_level.position}`" class="text-sm text-accent hover:underline font-medium">
                #{{ profileData.favorite_level.position }} {{ profileData.favorite_level.name }}
              </NuxtLink>
              <p v-if="profileData.favorite_level_note" class="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">{{ profileData.favorite_level_note }}</p>
            </div>
            <p v-if="profileSaved" class="text-xs text-emerald-400 mt-2">Saved.</p>
          </div>

          <!-- Edit dropdown -->
          <details :open="editing" class="group" @toggle="(e) => { if (!(e.target as HTMLDetailsElement).open && editing) cancelEdit() }">
            <summary
              class="cursor-pointer select-none list-none flex items-center justify-between gap-2 rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
              @click.prevent="editing ? cancelEdit() : startEdit()"
            >
              <span>{{ editing ? 'Editing profile…' : 'Edit profile' }}</span>
              <span class="text-zinc-600 group-open:rotate-180 transition-transform">▾</span>
            </summary>

            <form class="space-y-4 pt-4" @submit.prevent="saveProfile">
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
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Pronouns <span class="text-zinc-600 normal-case">— optional</span></span>
                  <input
                    v-model="profile.pronouns"
                    maxlength="64"
                    placeholder="e.g. they/them"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Discord <span class="text-zinc-600 normal-case">— optional</span></span>
                  <input
                    v-model="profile.discord_handle"
                    maxlength="64"
                    placeholder="e.g. username or username#1234"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">YouTube channel <span class="text-zinc-600 normal-case">— optional, full URL</span></span>
                  <input
                    v-model="profile.youtube_url"
                    type="url"
                    maxlength="500"
                    placeholder="https://www.youtube.com/@yourhandle"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <div class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Favorite level <span class="text-zinc-600 normal-case">— optional</span></span>
                  <div class="mt-1 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      class="rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                      @click="favoriteLevelPickerOpen = true"
                    >{{ favoriteLevelDisplay ? 'Change…' : 'Pick a level…' }}</button>
                    <span v-if="favoriteLevelDisplay" class="text-xs text-zinc-200 truncate">#{{ favoriteLevelDisplay.position }} {{ favoriteLevelDisplay.name }}</span>
                    <button
                      v-if="favoriteLevelDisplay"
                      type="button"
                      class="text-[11px] text-zinc-500 hover:text-red-400"
                      @click="favoriteLevelId = null; favoriteLevelDisplay = null; favoriteLevelNote = ''"
                    >clear</button>
                  </div>
                </div>
                <label v-if="favoriteLevelId" class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note about your favorite level <span class="text-zinc-600 normal-case">— optional</span></span>
                  <textarea
                    v-model="favoriteLevelNote"
                    rows="2"
                    maxlength="500"
                    placeholder="Why do you love it?"
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
          </details>
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

        <!-- Open-verification submission -->
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">Submit open verification</h2>
              <p class="text-[11px] text-zinc-600 mt-0.5">
                Submit an unverified level. A moderator reviews each submission before it appears on the open verifications list.
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 text-xs px-2 py-1 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 border border-violet-500/30 transition-colors"
              @click="ovOpen = !ovOpen"
            >{{ ovOpen ? 'Close' : 'Open form' }}</button>
          </div>

          <form v-if="ovOpen" class="space-y-5 mt-4" @submit.prevent="submitOpenVerification">
            <!-- Level ID + name -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label class="block sm:col-span-1">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID <span class="text-red-400">*</span></span>
                <input
                  v-model="ovGdId"
                  inputmode="numeric"
                  placeholder="e.g. 12345678"
                  required
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
              <label class="block sm:col-span-2">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name <span class="text-red-400">*</span></span>
                <input
                  v-model="ovName"
                  required
                  placeholder="Level name"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </div>

            <!-- FPS + Version -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">FPS</span>
                <input
                  v-model="ovFps"
                  placeholder="any"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Game version</span>
                <input
                  v-model="ovGameVersion"
                  placeholder="any"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </div>

            <!-- Showcase (replaces verification) -->
            <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Showcase <span class="text-zinc-600 normal-case">— optional</span></legend>

              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                  Showcase link <span class="text-zinc-600 normal-case">— a layout / preview clip, embedded in place of verification</span>
                </span>
                <input
                  v-model="ovShowcaseUrl"
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=…"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>

              <div v-if="ovShowcaseYt" class="aspect-video rounded-md border border-zinc-800 bg-black overflow-hidden">
                <iframe
                  :src="`https://www.youtube.com/embed/${ovShowcaseYt}`"
                  class="w-full h-full"
                  title="Showcase preview"
                  frameborder="0"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                  referrerpolicy="strict-origin-when-cross-origin"
                />
              </div>

              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Intended verifier <span class="text-zinc-600 normal-case">— optional</span></span>
                <input
                  v-model="ovVerifier"
                  placeholder="Player name"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </fieldset>

            <!-- Difficulty opinion -->
            <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty opinion <span class="text-zinc-600 normal-case">— optional</span></legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
                  <select
                    v-model="ovGddlTier"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
                  </select>
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Demon level</span>
                  <select
                    v-model="ovDifficulty"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option v-for="d in OV_DIFFICULTY_OPTIONS" :key="d" :value="d">{{ d || '— none —' }}</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <!-- Optional metadata -->
            <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Extra info <span class="text-zinc-600 normal-case">— optional</span></legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">0–10</span></span>
                  <input
                    v-model="ovEnjoyment"
                    type="number" min="0" max="10" step="0.1" inputmode="decimal"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
                  <select
                    v-model="ovSkillset"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option v-for="s in OV_SKILLSET_OPTIONS" :key="s" :value="s">{{ s || '— none —' }}</option>
                  </select>
                </label>
              </div>
              <div>
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Tags</span>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  <label
                    v-for="t in OV_TAGS" :key="t"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
                    :class="ovTagSet[t]
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input v-model="ovTagSet[t]" type="checkbox" class="sr-only" />
                    {{ t === 'uldm' ? 'ULDM' : t }}
                  </label>
                </div>
              </div>
            </fieldset>

            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Notes for the mods <span class="text-zinc-600 normal-case">— optional</span></span>
              <textarea
                v-model="ovNotes"
                rows="3"
                maxlength="4000"
                placeholder="Anything the moderator should know."
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <div class="flex items-center gap-3 pt-1">
              <button
                type="submit"
                :disabled="ovSubmitting"
                class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
              >{{ ovSubmitting ? 'Submitting…' : 'Submit for review' }}</button>
              <span v-if="ovSuccess" class="text-xs text-emerald-400">Submitted — pending review.</span>
              <span v-if="ovError" class="text-xs text-red-400">{{ ovError }}</span>
            </div>
          </form>
        </section>

        <ProfileLevelLists
          v-if="profileData"
          :completed="profileData.completedLevels"
          :created="profileData.createdLevels"
          :verified="profileData.verifiedLevels"
        />

        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Comments on your profile</h2>
          <CommentSection kind="profile" :target-id="me.id" />
        </section>
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
            >Edit profile</button>

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
              v-if="(!me.claimed_player || !me.claimed_aredl_uuid) && !pendingClaim"
              type="button"
              class="text-left text-sm px-3 py-1.5 rounded border border-zinc-800 text-zinc-200 hover:bg-zinc-900 transition-colors"
              @click="claimOpen = !claimOpen"
            >Claim an account</button>
          </div>

          <!-- Claim status / inline form -->
          <div v-if="me.claimed_player || me.claimed_aredl_uuid" class="mt-3 px-1 text-xs text-zinc-500 space-y-1">
            <p v-if="me.claimed_player">
              ALL list: <span class="text-accent font-medium">{{ me.claimed_player }}</span>
            </p>
            <p v-if="me.claimed_aredl_uuid">
              AREDL: <span class="text-accent font-medium">claimed</span>
            </p>
            <p class="text-zinc-600">Contact an admin to change.</p>
          </div>
          <div v-else-if="pendingClaim" class="mt-3 px-1 text-xs text-zinc-400">
            <p>
              Pending {{ pendingClaim.source === 'aredl' ? 'AREDL' : 'ALL' }} claim for
              <span class="text-zinc-200 font-medium">{{ pendingClaim.player_name }}</span>.
            </p>
            <button
              type="button"
              class="mt-1 text-zinc-500 hover:text-red-400 underline"
              @click="cancelClaim"
            >Cancel</button>
          </div>
          <form v-else-if="claimOpen" class="mt-3 space-y-2" @submit.prevent="submitClaim">
            <select
              v-model="claimSource"
              class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-accent/50"
            >
              <option value="all">Claim legacy ALL</option>
              <option value="aredl">Claim AREDL</option>
            </select>
            <div class="relative">
              <input
                v-model="claimInput"
                :placeholder="claimSource === 'aredl' ? 'Search AREDL player name…' : 'Exact leaderboard name'"
                class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
                autocomplete="off"
                @input="claimAredlUuid = null"
              />
              <ul
                v-if="claimSource === 'aredl' && aredlSuggestions.length"
                class="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 text-xs shadow-lg"
              >
                <li
                  v-for="hit in aredlSuggestions"
                  :key="hit.uuid"
                  class="px-2 py-1.5 cursor-pointer hover:bg-zinc-800 flex justify-between gap-2"
                  :class="hit.claimed_account_id ? 'opacity-60 cursor-not-allowed' : ''"
                  @click="hit.claimed_account_id ? null : pickAredlSuggestion(hit)"
                >
                  <span class="truncate">
                    {{ hit.global_name }}
                    <span v-if="hit.username !== hit.global_name" class="text-zinc-500">@{{ hit.username }}</span>
                  </span>
                  <span class="tabular-nums text-zinc-500 shrink-0">
                    {{ hit.claimed_account_id ? 'claimed' : `${hit.total_points} pts` }}
                  </span>
                </li>
              </ul>
            </div>
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

        <div class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs space-y-1">
          <NuxtLink :to="`/users/${me.username}`" class="block text-zinc-400 hover:text-accent transition-colors">View public profile ↗</NuxtLink>
          <template v-if="me.role !== 'user'">
            <NuxtLink to="/admin" class="block text-zinc-400 hover:text-accent transition-colors">{{ me.role === 'moderator' ? 'Mod' : 'Admin' }} panel →</NuxtLink>
          </template>
          <button
            type="button"
            class="block text-zinc-500 hover:text-red-400 transition-colors"
            @click="logout"
          >Log out</button>
        </div>

        <div class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2">Preferences</h2>
          <label class="flex items-center gap-2 cursor-pointer select-none px-1">
            <input
              type="checkbox"
              :checked="profanityFilterEnabled"
              class="accent-accent w-3.5 h-3.5"
              @change="setProfanityFilter(($event.target as HTMLInputElement).checked)"
            />
            <span class="text-xs text-zinc-300">Profanity filter</span>
          </label>
        </div>
      </aside>
    </div>
  </div>

  <LevelComparisonDrawer
    v-model:open="favoriteLevelPickerOpen"
    :confirm-on-pick="true"
    title="Pick favorite level"
    hint="Click a level to set it as your favorite."
    @confirm="(lvl) => { favoriteLevelId = lvl.id ?? null; favoriteLevelDisplay = lvl.id ? { id: lvl.id, position: lvl.position, name: lvl.name, gddl_tier: lvl.gddl_tier } : null }"
  />
</template>
