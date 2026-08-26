<script setup lang="ts">
import { gdUserUrl, isGdUsername } from '~/utils/gd-links'
import { profileChipClass } from '~/utils/profile-chips'
import { TIER_MAX_NUMBER } from '~/utils/tier-ordinal'
import { allCountries, normalizeCountry } from '~/utils/countries'
import { SOCIAL_LINKS, isValidSocialUrl } from '~/utils/social-links'
import { listPercent } from '~/utils/list-progress'

/** Every country, by name. Built once — see `utils/countries.ts`. */
const countryOptions = allCountries()

/**
 * The link fields, driven by one table rather than one block of markup each.
 *
 * Adding a service is a row in `utils/social-links.ts` — its field, its
 * validation, its icon and its chip all come from there, so the settings form
 * and the profile can't end up knowing about different sets of them.
 */
const SOCIAL_KEYS = SOCIAL_LINKS.map((s) => s.key)

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
  twitch_url: (me.value as any)?.twitch_url ?? '',
  twitter_url: (me.value as any)?.twitter_url ?? '',
  bluesky_url: (me.value as any)?.bluesky_url ?? '',
  gd_username: me.value?.gd_username ?? '',
})
const profileSaving = ref(false)
const profileError = ref<string | null>(null)
const profileSaved = ref(false)

watch(me, (val) => {
  if (val && !editing.value) {
    profile.bio = val.bio ?? ''
    // A value typed when this was a free-text box becomes its code, so the
    // picker opens on the country the profile already claims instead of blank.
    profile.country = normalizeCountry(val.country) ?? ''
    profile.subdivision = val.subdivision ?? ''
    profile.pronouns = val.pronouns ?? ''
    profile.discord_handle = val.discord_handle ?? ''
    profile.youtube_url = val.youtube_url ?? ''
    for (const k of SOCIAL_KEYS) profile[k] = (val as any)[k] ?? ''
    profile.gd_username = val.gd_username ?? ''
  }
}, { immediate: true })

function startEdit() {
  if (!me.value) return
  profile.bio = me.value.bio ?? ''
  profile.country = normalizeCountry(me.value.country) ?? ''
  profile.subdivision = me.value.subdivision ?? ''
  profile.pronouns = me.value.pronouns ?? ''
  profile.discord_handle = me.value.discord_handle ?? ''
  profile.youtube_url = me.value.youtube_url ?? ''
  for (const k of SOCIAL_KEYS) profile[k] = (me.value as any)[k] ?? ''
    profile.gd_username = me.value.gd_username ?? ''
  favoriteLevelId.value = me.value.favorite_level_id
  favoriteLevelDisplay.value = profileData.value?.favorite_level ?? null
  favoriteLevelNote.value = profileData.value?.favorite_level_note ?? ''
  hardestRecordId.value = me.value.hardest_record_id ?? null
  bannerChoice.value = me.value.banner_choice ?? 'hardest'
  bannerImageUrl.value = (me.value as any).banner_image_url ?? ''
  nameEmoji.value = (me.value as any).name_emoji ?? ''
  nameBadge.value = (me.value as any).name_badge ?? ''
  nameBadgeColor.value = (me.value as any).name_badge_color ?? ''
  bannerLevelId.value = me.value.banner_level_id ?? null
  bannerLevelDisplay.value = profileData.value?.banner_level ?? null
  profileError.value = null
  profileSaved.value = false
  editing.value = true
}
function cancelEdit() {
  if (me.value) {
    profile.bio = me.value.bio ?? ''
    profile.country = normalizeCountry(me.value.country) ?? ''
    profile.subdivision = me.value.subdivision ?? ''
    profile.pronouns = me.value.pronouns ?? ''
    profile.discord_handle = me.value.discord_handle ?? ''
    profile.youtube_url = me.value.youtube_url ?? ''
    for (const k of SOCIAL_KEYS) profile[k] = (me.value as any)[k] ?? ''
    profile.gd_username = me.value.gd_username ?? ''
    favoriteLevelId.value = me.value.favorite_level_id
    favoriteLevelDisplay.value = profileData.value?.favorite_level ?? null
    favoriteLevelNote.value = profileData.value?.favorite_level_note ?? ''
    hardestRecordId.value = me.value.hardest_record_id ?? null
    bannerChoice.value = me.value.banner_choice ?? 'hardest'
  bannerImageUrl.value = (me.value as any).banner_image_url ?? ''
  nameEmoji.value = (me.value as any).name_emoji ?? ''
  nameBadge.value = (me.value as any).name_badge ?? ''
  nameBadgeColor.value = (me.value as any).name_badge_color ?? ''
    bannerLevelId.value = me.value.banner_level_id ?? null
    bannerLevelDisplay.value = profileData.value?.banner_level ?? null
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
    // `bio` is deliberately stripped rather than merely absent from the form.
    //
    // `profile.bio` is still seeded from the account, so spreading it would
    // send whatever the bio was when this form was opened. Edit the bio in its
    // own card, then press Save here, and that stale copy would silently
    // overwrite what you just wrote. The endpoint leaves out-of-body fields
    // alone, so not sending it is the whole fix.
    const { bio: _bio, ...profileFields } = profile
    await $fetch('/api/account', { method: 'PATCH', body: {
      ...profileFields,
      favorite_level_id: favoriteLevelId.value ?? null,
      favorite_level_note: favoriteLevelNote.value.trim() || null,
      hardest_record_id: hardestRecordId.value ?? null,
      banner_choice: bannerChoice.value,
      // Sent only by staff. The server ignores them from anyone else, so this
      // is tidiness rather than the guard.
      ...(isStaffAccount.value ? {
        banner_image_url: bannerImageUrl.value.trim(),
        name_emoji: nameEmoji.value.trim(),
        name_badge: nameBadge.value.trim(),
        name_badge_color: nameBadgeColor.value.trim(),
      } : {}),
      banner_level_id: bannerLevelId.value ?? null,
    } })
    await refreshMe()
    await loadProfileData()
    profileSaved.value = true
    editing.value = false
    setTimeout(() => (profileSaved.value = false), 2500)
  } catch (e: any) {
    profileError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    profileSaving.value = false
  }
}

/**
 * The bio, on its own.
 *
 * It used to be the first field of a fourteen-box form, behind a disclosure,
 * inside a panel that also re-printed your country and pronouns — three layers
 * of chrome between somebody and the one line of text most people ever want to
 * change. That panel is gone (the header already shows everything it repeated),
 * and this is what replaced it.
 *
 * It saves *only* the bio. `/api/account` treats every field as optional and
 * falls back to the stored value for anything absent — `'bio' in body ? … :
 * me.bio` and so on for each — so a one-field PATCH cannot clear the rest. That
 * property is what makes this safe, and it is worth knowing it is deliberate
 * rather than luck: an earlier version of that endpoint used `?? null`, which
 * would have wiped a profile on every bio edit.
 */
/**
 * Confirming your email address.
 *
 * Shown as a banner rather than a page you have to find, because an unverified
 * account is one that cannot comment, post or submit anything — a state you
 * need telling about at the moment you notice something is missing, not one you
 * discover by reading settings.
 *
 * The address is editable here for the commonest reason a link never arrives:
 * it was typed wrong. Without that the account is stranded — it cannot verify,
 * and the address it cannot verify is the one blocking a second sign-up.
 */
const verifyEmailDraft = ref('')
const verifySending = ref(false)
const verifyNotice = ref<string | null>(null)
const verifyError = ref<string | null>(null)
const verifyEditing = ref(false)

const needsVerification = computed(() => {
  const a = me.value as { email?: string | null; email_verified_at?: string | null } | null
  // Only meaningful once we know there is an address to confirm: an install
  // with no mail provider gives every account a null email and no banner.
  return !!a && !!a.email && !a.email_verified_at
})

watch(me, (val) => {
  const a = val as { email?: string | null; pending_email?: string | null } | null
  if (a && !verifyEditing.value) verifyEmailDraft.value = a.pending_email || a.email || ''
}, { immediate: true })

async function resendVerification() {
  if (verifySending.value) return
  verifySending.value = true
  verifyNotice.value = null
  verifyError.value = null
  try {
    const res = await $fetch<{ email: string }>('/api/account/resend-verification', {
      method: 'POST',
      // Only sent when they have actually changed it, so an unchanged address
      // is not rewritten on every resend.
      body: verifyEditing.value ? { email: verifyEmailDraft.value.trim() } : {},
    })
    verifyNotice.value = `Sent to ${res.email}. It can take a minute.`
    verifyEditing.value = false
    await refreshMe()
  } catch (e: any) {
    verifyError.value = e?.data?.statusMessage ?? 'Could not send that.'
  } finally {
    verifySending.value = false
  }
}

const BIO_MAX = 1000
const bioDraft = ref('')
const bioEditing = ref(false)
const bioSaving = ref(false)
const bioError = ref<string | null>(null)
const bioSaved = ref(false)

/** Kept in step with the account until somebody starts typing into it. */
watch(me, (val) => {
  if (val && !bioEditing.value) bioDraft.value = val.bio ?? ''
}, { immediate: true })

const bioDirty = computed(() => bioDraft.value.trim() !== (me.value?.bio ?? '').trim())
const bioRemaining = computed(() => BIO_MAX - bioDraft.value.length)

function startBioEdit() {
  bioDraft.value = me.value?.bio ?? ''
  bioError.value = null
  bioSaved.value = false
  bioEditing.value = true
}

function cancelBioEdit() {
  bioDraft.value = me.value?.bio ?? ''
  bioError.value = null
  bioEditing.value = false
}

async function saveBio() {
  if (bioSaving.value || !bioDirty.value) return
  bioSaving.value = true
  bioError.value = null
  bioSaved.value = false
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { bio: bioDraft.value.trim() } })
    await refreshMe()
    bioEditing.value = false
    bioSaved.value = true
    setTimeout(() => (bioSaved.value = false), 2500)
  } catch (e: any) {
    bioError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not save that.'
  } finally {
    bioSaving.value = false
  }
}

// --- Avatar ---
const avatarVersion = ref(0)
const avatarUrl = computed(() =>
  me.value?.has_avatar ? `/api/users/${encodeURIComponent(me.value.username)}/avatar?v=${avatarVersion.value}` : null,
)
const avatarError = ref<string | null>(null)
const avatarHoverFileInput = ref<HTMLInputElement | null>(null)

/**
 * Cropping a new picture.
 *
 * The cropper itself is `components/AvatarCropper.vue` — a dialog that owns the
 * framing, the previews and the upload. This page's job is only to turn a
 * chosen file into something it can display and to refresh the avatar once it
 * has saved.
 *
 * It used to be three hundred lines here, tangled through the settings form,
 * which is part of why it was hard to get right: the state that decided what
 * got saved was interleaved with state about a completely different form.
 */
const cropOpen = ref(false)
const cropSrc = ref<string | null>(null)

function openCropForFile(file: File) {
  const reader = new FileReader()
  reader.onload = (ev) => {
    cropSrc.value = ev.target?.result as string
    cropOpen.value = true
  }
  reader.onerror = () => { avatarError.value = 'Could not read that file.' }
  reader.readAsDataURL(file)
}

async function onAvatarSaved() {
  await refreshMe()
  avatarVersion.value++
  cropSrc.value = null
  avatarError.value = null
}

/** Both file inputs — the one in the form and the one on the avatar itself. */
function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) openCropForFile(file)
}
const onHoverAvatarChange = onAvatarChange


async function removeAvatar() {
  await $fetch('/api/account/avatar', { method: 'DELETE' })
  await refreshMe()
  avatarVersion.value++
}

// --- Claim (client-only fetch — endpoint requires auth) ---
type PendingClaim = {
  id: number
  player_name: string
  source: 'all' | 'aredl' | 'pointercrate' | 'gdl' | null
  aredl_player_uuid: string | null
  pointercrate_player_id: number | null
  gdl_player_id: number | null
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
const claimSource = ref<'all' | 'aredl' | 'pointercrate' | 'gdl'>('all')
const claimInput = ref('')
const claimAredlUuid = ref<string | null>(null)
const claimPcId = ref<number | null>(null)
const claimGdlId = ref<number | null>(null)
const claimError = ref<string | null>(null)
const claimSubmitting = ref(false)

// External-list autocomplete (Aredl, Pointercrate, GDL share the same UI shape).
type AredlSearchHit = { uuid: string; global_name: string; username: string; total_points: number; claimed_account_id: number | null }
type PcSearchHit = { pc_id: number; name: string; nationality: string | null; score: number; claimed_account_id: number | null }
type GdlSearchHit = { gdl_id: number; name: string; country: string | null; points: number; claimed_account_id: number | null }
const aredlSuggestions = ref<AredlSearchHit[]>([])
const pcSuggestions = ref<PcSearchHit[]>([])
const gdlSuggestions = ref<GdlSearchHit[]>([])
let claimDebounce: ReturnType<typeof setTimeout> | null = null

watch([claimInput, claimSource], () => {
  if (claimDebounce) clearTimeout(claimDebounce)
  aredlSuggestions.value = []
  pcSuggestions.value = []
  gdlSuggestions.value = []
  claimAredlUuid.value = null
  claimPcId.value = null
  claimGdlId.value = null
  if (claimSource.value === 'all' || !claimInput.value.trim()) return
  const src = claimSource.value
  claimDebounce = setTimeout(async () => {
    try {
      if (src === 'aredl') {
        const res = await $fetch<{ items: AredlSearchHit[] }>('/api/aredl-players/search', {
          query: { q: claimInput.value.trim() },
        })
        aredlSuggestions.value = res.items
      } else if (src === 'pointercrate') {
        const res = await $fetch<{ items: PcSearchHit[] }>('/api/pointercrate-players/search', {
          query: { q: claimInput.value.trim() },
        })
        pcSuggestions.value = res.items
      } else if (src === 'gdl') {
        const res = await $fetch<{ items: GdlSearchHit[] }>('/api/gdl-players/search', {
          query: { q: claimInput.value.trim() },
        })
        gdlSuggestions.value = res.items
      }
    } catch { /* ignore */ }
  }, 200)
})

function pickAredlSuggestion(hit: AredlSearchHit) {
  claimInput.value = hit.global_name
  claimAredlUuid.value = hit.uuid
  aredlSuggestions.value = []
}
function pickPcSuggestion(hit: PcSearchHit) {
  claimInput.value = hit.name
  claimPcId.value = hit.pc_id
  pcSuggestions.value = []
}
function pickGdlSuggestion(hit: GdlSearchHit) {
  claimInput.value = hit.name
  claimGdlId.value = hit.gdl_id
  gdlSuggestions.value = []
}

async function submitClaim() {
  if (claimSubmitting.value || !claimInput.value.trim()) return
  claimError.value = null
  claimSubmitting.value = true
  try {
    if (claimSource.value === 'aredl') {
      if (!claimAredlUuid.value) {
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
    } else if (claimSource.value === 'gdl') {
      if (!claimGdlId.value) {
        const res = await $fetch<{ items: GdlSearchHit[] }>('/api/gdl-players/search', {
          query: { q: claimInput.value.trim() },
        })
        const exact = res.items.find((x) => x.name.toLowerCase() === claimInput.value.trim().toLowerCase())
        if (!exact) {
          claimError.value = 'Pick a GDL player from the suggestions.'
          return
        }
        claimGdlId.value = exact.gdl_id
      }
      await $fetch('/api/account/claim', {
        method: 'POST',
        body: { source: 'gdl', gdl_player_id: claimGdlId.value },
      })
    } else if (claimSource.value === 'pointercrate') {
      if (!claimPcId.value) {
        const res = await $fetch<{ items: PcSearchHit[] }>('/api/pointercrate-players/search', {
          query: { q: claimInput.value.trim() },
        })
        const exact = res.items.find((x) => x.name.toLowerCase() === claimInput.value.trim().toLowerCase())
        if (!exact) {
          claimError.value = 'Pick a Pointercrate player from the suggestions.'
          return
        }
        claimPcId.value = exact.pc_id
      }
      await $fetch('/api/account/claim', {
        method: 'POST',
        body: { source: 'pointercrate', pointercrate_player_id: claimPcId.value },
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
    claimPcId.value = null
    claimGdlId.value = null
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

// --- Releasing an approved claim, and pulling its records in ---
type ClaimKind = 'player' | 'aredl' | 'gdl' | 'pointercrate'
const CLAIM_LABELS: Record<ClaimKind, string> = {
  player: 'ALL list', aredl: 'AREDL', gdl: 'GDL', pointercrate: 'Pointercrate',
}
const claimBusy = ref<ClaimKind | 'sync' | null>(null)
const claimNote = ref<string | null>(null)

/** The external claims, which are the ones that carry records. */
const externalClaims = computed<ClaimKind[]>(() => {
  const a = meRes.value?.account
  if (!a) return []
  const out: ClaimKind[] = []
  if (a.claimed_aredl_uuid) out.push('aredl')
  if (a.claimed_pointercrate_id) out.push('pointercrate')
  if (a.claimed_gdl_id) out.push('gdl')
  return out
})

async function unclaim(kind: ClaimKind) {
  const what = kind === 'player' ? 'your ALL leaderboard name' : `your ${CLAIM_LABELS[kind]} player`
  const extra = kind === 'player'
    ? ''
    : `\n\nIts records will be removed from your profile. They stay on ${CLAIM_LABELS[kind]}, and claiming again brings them back.`
  if (!confirm(`Unclaim ${what}?${extra}`)) return
  claimBusy.value = kind
  claimNote.value = null
  claimError.value = null
  try {
    const res = await $fetch<{ name: string | null; records_removed: number }>(
      '/api/account/claim', { method: 'DELETE', query: { source: kind } },
    )
    claimNote.value = res.records_removed
      ? `Unclaimed${res.name ? ` ${res.name}` : ''}. ${res.records_removed} record(s) removed from your profile.`
      : `Unclaimed${res.name ? ` ${res.name}` : ''}.`
    await refreshMe()
    await loadProfileData()
  } catch (e: any) {
    claimError.value = e?.data?.statusMessage ?? 'Could not unclaim that.'
  } finally { claimBusy.value = null }
}

async function syncClaimedRecords() {
  claimBusy.value = 'sync'
  claimNote.value = null
  claimError.value = null
  try {
    const res = await $fetch<{ added: number }>('/api/account/claim/records', { method: 'POST' })
    claimNote.value = res.added
      ? `${res.added} record(s) added to your profile.`
      : 'Nothing new to import.'
    await loadProfileData()
  } catch (e: any) {
    claimError.value = e?.data?.statusMessage ?? 'Could not import those records.'
  } finally { claimBusy.value = null }
}

// --- Open-verification submission (collapsible box on the account page) ---
const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: TIER_MAX_NUMBER }, (_, i) => `Tier ${i + 1}`),
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
const favoriteLevelId = ref<number | null>(null)
const favoriteLevelDisplay = ref<ShowcaseLevel | null>(null)
const favoriteLevelNote = ref('')
const favoriteLevelPickerOpen = ref(false)

// --- Hardest completion + which pick paints the profile header ---
// Chosen from the account's own approved records, so the options are exactly
// what the server will accept — no free-text level id to get wrong.
const hardestRecordId = ref<number | null>(null)
const bannerChoice = ref<'hardest' | 'favorite' | 'level' | 'none' | 'custom'>('hardest')
const bannerChoiceModel = computed({
  get: () => bannerChoice.value as string,
  set: (v: string) => { bannerChoice.value = v as typeof bannerChoice.value },
})

/**
 * Staff decorations. Only shown to staff, and only *accepted* from staff — the
 * server checks the role, because hiding a control is not a permission check.
 */
const isStaffAccount = computed(() => {
  const r = me.value?.role
  return r === 'admin' || r === 'owner' || r === 'developer'
})
const bannerImageUrl = ref('')
const nameEmoji = ref('')
const nameBadge = ref('')
const nameBadgeColor = ref('')

// A free-choice header level. Separate from the favourite and the hardest
// completion because those two say something about the account — a backdrop
// shouldn't require claiming a completion or declaring a favourite.
const bannerLevelId = ref<number | null>(null)
const bannerLevelDisplay = ref<ShowcaseLevel | null>(null)
const bannerLevelPickerOpen = ref(false)

/** Own completions, hardest (lowest list position) first. */
const completionOptions = computed(() => {
  const rows = profileData.value?.completedLevels ?? []
  return rows
    .filter((r: any) => r.record_id)
    .slice()
    .sort((a: any, b: any) => a.position - b.position)
})
const hardestPick = computed(() =>
  completionOptions.value.find((r: any) => r.record_id === hardestRecordId.value) ?? null,
)

// --- Profile data (stats, completed, created, progress) ---
/** Any level shown as a card or a header backdrop. */
type ShowcaseLevel = {
  id?: number
  record_id?: number
  position: number
  sheet_placement?: number | null
  name: string
  gd_id?: number | null
  gddl_tier: string | null
  creator?: string | null
  points?: number | null
  percent?: number | null
  video?: string | null
  verification_url?: string | null
}
type ProfileData = {
  account: {
    id: number
    username: string; role: 'user'|'moderator'|'admin'|'owner'|'developer'
    bio: string | null; country: string | null; subdivision: string | null
    claimed_player: string | null; has_avatar: boolean; created_at: string
    pronouns: string | null; discord_handle: string | null; youtube_url: string | null
    gd_username?: string | null
    clan?: { tag: string; name: string; color: string | null } | null
  }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
  verifiedLevels: any[]
  progressPosts: any[]
  follow: {
    target: string; followed: boolean; followerCount: number; followingCount: number
    isSelf: boolean; canFollow: boolean
  }
  publicLists?: { public_id: string; title: string; likes: number; is_public: number; item_count: number }[]
  favorite_level: ShowcaseLevel | null
  favorite_level_note: string | null
  hardest_completion: ShowcaseLevel | null
  banner_choice: 'hardest' | 'favorite' | 'level' | 'none' | 'custom'
  banner_image_url?: string | null
  name_emoji?: string | null
  name_badge?: string | null
  name_badge_color?: string | null
  banner_level: ShowcaseLevel | null
  profileViews?: number
  totalLevels?: number
}
/**
 * Fetched during SSR, not in `onMounted`. This page renders the same cover
 * header as the public profile, and the banner art comes out of this payload —
 * loading it client-side only meant the header painted plain and then popped.
 */
const { data: profileData, refresh: refreshProfileData } = await useAsyncData<ProfileData | null>(
  'account-profile',
  () => me.value
    ? $fetch<ProfileData>(`/api/users/${encodeURIComponent(me.value.username)}`)
    : Promise.resolve(null),
  { watch: [() => me.value?.username] },
)

async function loadProfileData() {
  await refreshProfileData()
}
watch(() => me.value?.claimed_player, loadProfileData)
watch(() => me.value?.bio, loadProfileData)

/**
 * The header backdrop, resolved exactly the way `/users/:name` resolves it —
 * this page is a preview of that one, so a difference here would be a lie.
 * While the edit form is open it follows the draft, so picking a banner shows
 * you the result before you save.
 */
/** The staff cover image, when that's the chosen banner. Live while editing. */
const bannerImage = computed<string | null>(() => {
  const d = profileData.value
  if (!d) return null
  const choice = editing.value ? bannerChoice.value : d.banner_choice
  if (choice !== 'custom') return null
  const url = editing.value ? bannerImageUrl.value.trim() : (d.banner_image_url ?? '')
  return /^https?:\/\//i.test(url) ? url : null
})

const bannerLevel = computed<ShowcaseLevel | null>(() => {
  const d = profileData.value
  if (!d) return null
  const choice = editing.value ? bannerChoice.value : d.banner_choice
  if (choice === 'none' || choice === 'custom') return null
  if (choice === 'level') {
    return editing.value
      ? (bannerLevelDisplay.value as ShowcaseLevel | null)
      : d.banner_level
  }
  if (choice === 'favorite') {
    return editing.value ? (favoriteLevelDisplay.value as ShowcaseLevel | null) : d.favorite_level
  }
  return d.hardest_completion ?? d.favorite_level
})


/** Same four headline numbers the public profile prints. */
const headlineStats = computed(() => {
  const d = profileData.value
  if (!d) return []
  return [
    { label: 'Points', value: d.player ? fmt(d.player.total_points) : '—', tone: 'text-amber-300' },
    { label: 'Completions', value: d.completedLevels.length.toLocaleString(), tone: 'text-zinc-100' },
    // The same tile the public profile shows — see `listPercent` there.
    {
      label: 'Of the list',
      value: listPercent(d.completedLevels.length, d.totalLevels ?? 0),
      tone: 'text-zinc-100',
      hint: `${d.completedLevels.length.toLocaleString()} of ${(d.totalLevels ?? 0).toLocaleString()} levels`,
      progress: (d.totalLevels ?? 0) > 0 ? d.completedLevels.length / (d.totalLevels ?? 1) : null,
    },
    { label: 'Followers', value: d.follow.followerCount.toLocaleString(), tone: 'text-zinc-100', opens: 'followers' as const },
    { label: 'Following', value: (d.follow.followingCount ?? 0).toLocaleString(), tone: 'text-zinc-100', opens: 'following' as const },
  ]
})

/**
 * The account, as the shared header wants it — with the edit form's values
 * applied while the form is open.
 *
 * This page is where the profile is built, so the header has to answer to the
 * form rather than to the saved row: choosing a country, typing a pronoun or
 * pasting a Twitch link should show up in the thing you are editing, not after
 * you press Save. Everything not in the form comes straight off the account.
 */
const headerAccount = computed<Record<string, any>>(() => {
  // `/api/auth/me` is the session, not the profile, so the clan comes from the
  // same endpoint the public page reads — which is also what keeps the tag
  // here identical to the tag a visitor sees.
  // `created_at` is on the profile payload rather than on the session — the
  // header prints "joined March 2026" from it, and without this the account
  // page was the one profile on the site that didn't say when it started.
  const base = {
    ...(me.value ?? {}),
    clan: profileData.value?.account?.clan ?? null,
    created_at: profileData.value?.account?.created_at ?? null,
  } as Record<string, any>
  if (!editing.value) return base
  return {
    ...base,
    country: profile.country,
    subdivision: profile.subdivision,
    pronouns: profile.pronouns,
    discord_handle: profile.discord_handle,
    youtube_url: profile.youtube_url,
    twitch_url: profile.twitch_url,
    twitter_url: profile.twitter_url,
    bluesky_url: profile.bluesky_url,
    gd_username: profile.gd_username,
    name_emoji: nameEmoji.value,
    name_badge: nameBadge.value,
    name_badge_color: nameBadgeColor.value,
  }
})

// The same dialog the public profile opens — this page shows the same numbers,
// so it answers the same click.
const followListOpen = ref(false)
const followListMode = ref<'followers' | 'following'>('followers')
function openFollowList(mode: 'followers' | 'following') {
  followListMode.value = mode
  followListOpen.value = true
}

// --- Progress post composer (inline) ---
const showProgress = ref(false)

const youtubeUrlValid = computed(() => {
  const url = profile.youtube_url.trim()
  if (!url) return true
  return /^https?:\/\/(www\.)?youtube\.com\/((@|channel\/|c\/|user\/)[^/?&#\s]+)/i.test(url)
})

/**
 * The same host check the server applies, run as you type.
 *
 * Deliberately a second copy of the rule rather than the only one: the server
 * refuses a bad link whatever the form does, and this exists so you find out
 * before pressing Save instead of after.
 */
function socialValid(key: string): boolean {
  const url = String((profile as Record<string, string>)[key] ?? '').trim()
  return !url || isValidSocialUrl(key, url)
}
const allSocialsValid = computed(() => SOCIAL_KEYS.every((k) => socialValid(k)))

// The in-game name is stored bare and turned into a gdbrowser link on the way
// out, so it's checked here for the same reason the server checks it: a value
// that isn't a username produces a link that goes nowhere.
const gdUsernameValid = computed(() => !profile.gd_username.trim() || isGdUsername(profile.gd_username))
const gdProfileUrl = computed(() => gdUserUrl(me.value?.gd_username))

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
  <div v-if="me">
    <!-- The same header the public profile draws, from the same component.
         This page is where you build that profile, so it has to *be* it: two
         hand-written copies had already drifted, and the account one had lost
         the country flag, the banner level link and half the social chips.
         Everything editable follows the form live, so the header shows what
         you are choosing while you choose it. -->
    <ProfileHeader
      :account="headerAccount"
      :banner-level="bannerLevel"
      :banner-image="bannerImage"
      :stats="headlineStats"
      @open-list="openFollowList"
    >
      <!-- The avatar is a control here rather than a picture: this is the page
           you change it on, so it opens the picker instead of doing nothing. -->
      <template #avatar>
        <label class="absolute inset-0 cursor-pointer group" title="Change profile picture">
          <img v-if="avatarUrl" :src="avatarUrl" alt="" decoding="async" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-3xl text-zinc-600 font-black">
            {{ me.username.charAt(0).toUpperCase() }}
          </div>
          <div class="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-6 h-6 text-white">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span class="text-[9px] uppercase tracking-widest text-white/80">Change</span>
          </div>
          <input ref="avatarHoverFileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="onHoverAvatarChange" />
        </label>
      </template>

      <template #meta>
        <!-- Always, on your own page. A count that only appears once it is
             interesting is a count you can't check. -->
        <span
          v-if="profileData"
          :class="profileChipClass()"
          title="Views from other people. Your own visits don't count."
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 shrink-0 text-zinc-600" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
          </svg>
          <span><span class="tabular-nums">{{ profileData.profileViews.toLocaleString() }}</span> profile view{{ profileData.profileViews === 1 ? '' : 's' }}</span>
        </span>
      </template>

      <template #actions>
        <button
          type="button"
          class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          :class="editing
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-700 text-zinc-200 hover:border-accent/60 hover:text-accent'"
          @click="editing ? cancelEdit() : startEdit()"
        >{{ editing ? 'Editing…' : 'Edit profile' }}</button>
        <NuxtLink
          :to="`/users/${me.username}`"
          class="btn btn-sm btn-ghost"
        >View public ↗</NuxtLink>
      </template>
    </ProfileHeader>

    <!-- Confirm your address.
         Directly under the header and above everything else, because until it
         is done the account cannot comment, post or submit — and every one of
         those failures otherwise arrives as an unexplained refusal somewhere
         else on the site. -->
    <div v-if="needsVerification" class="container-tight max-w-5xl pt-4">
      <div class="rounded-xl border border-amber-900/60 bg-amber-950/25 px-4 py-3 space-y-2">
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 text-amber-400 shrink-0" aria-hidden="true">✉</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-amber-100">Confirm your email address</p>
            <p class="text-[11px] text-amber-200/70 mt-0.5">
              We sent a link to
              <span class="text-amber-100">{{ (me as any).pending_email || (me as any).email }}</span>.
              You can't comment, post or submit until you click it.
            </p>
          </div>
        </div>

        <!-- Correcting a typo is the commonest reason a link never arrives. -->
        <div v-if="verifyEditing" class="flex flex-wrap items-center gap-2">
          <input
            v-model="verifyEmailDraft"
            type="email"
            autocomplete="email"
            class="field field-sm flex-1 min-w-[14rem] text-xs"
          />
          <button
            type="button"
            :disabled="verifySending || !verifyEmailDraft.trim()"
            class="btn btn-sm btn-primary"
            @click="resendVerification"
          >{{ verifySending ? 'Sending…' : 'Save and send' }}</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="verifyEditing = false">Cancel</button>
        </div>
        <div v-else class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            :disabled="verifySending"
            class="btn btn-sm btn-ghost hover:border-amber-700 hover:text-amber-200"
            @click="resendVerification"
          >{{ verifySending ? 'Sending…' : 'Resend the link' }}</button>
          <button
            type="button"
            class="text-[11px] text-amber-200/70 hover:text-amber-100 transition-colors"
            @click="verifyEditing = true"
          >Wrong address?</button>
        </div>

        <p v-if="verifyNotice" class="text-[11px] text-emerald-400">{{ verifyNotice }}</p>
        <p v-if="verifyError" class="text-[11px] text-red-400">{{ verifyError }}</p>
      </div>
    </div>

    <FollowListModal
      v-if="profileData"
      v-model:open="followListOpen"
      :target="profileData.follow.target"
      :mode="followListMode"
      :count="followListMode === 'followers' ? profileData.follow.followerCount : (profileData.follow.followingCount ?? 0)"
      :who="me.username"
    />

    <div class="container-tight max-w-5xl py-6">
    <div class="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
      <!-- Main column: same shape as the public profile -->
      <main class="space-y-6 min-w-0">
        <!-- The same cards visitors see, from the same component. -->
        <ProfileShowcase
          v-if="profileData"
          :hardest="profileData.hardest_completion"
          :favorite="profileData.favorite_level"
          :favorite-note="profileData.favorite_level_note"
          is-self
        />

        <!-- Your bio, and nothing else.
             The panel that used to be here re-printed your country, pronouns
             and clan under the heading "About" — all three of which the profile
             header above already draws as chips, and which the public profile
             has never shown twice. It was a summary of the thing directly above
             it, and it pushed the one field people actually edit down behind a
             disclosure. So: the bio gets the card, and everything else is in
             the full form below. -->
        <section class="card p-4 space-y-3">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">Bio</h2>
            <div class="flex items-center gap-3 shrink-0">
              <span v-if="bioSaved" class="text-[11px] text-emerald-400">Saved.</span>
              <button
                v-if="!bioEditing"
                type="button"
                class="text-[11px] text-zinc-500 hover:text-accent transition-colors"
                @click="startBioEdit"
              >{{ me.bio ? 'Edit' : 'Add one' }}</button>
            </div>
          </div>

          <!-- Reading it. `whitespace-pre-wrap` because a bio with line breaks
               in it was written with line breaks in it. -->
          <template v-if="!bioEditing">
            <p v-if="me.bio" class="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{{ me.bio }}</p>
            <button
              v-else
              type="button"
              class="w-full rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-600 hover:border-zinc-700 hover:text-zinc-400 transition-colors"
              @click="startBioEdit"
            >
              Say something about yourself.
            </button>
          </template>

          <!-- Writing it. Saves on its own, so changing one line is one action
               rather than opening a form with fourteen fields in it. -->
          <template v-else>
            <textarea
              v-model="bioDraft"
              rows="5"
              :maxlength="BIO_MAX"
              autofocus
              placeholder="What you play, what you're grinding, whatever you like."
              class="field field-md w-full resize-y"
              @keydown.esc="cancelBioEdit"
            />
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                :disabled="bioSaving || !bioDirty"
                class="btn btn-sm btn-primary"
                @click="saveBio"
              >{{ bioSaving ? 'Saving…' : 'Save bio' }}</button>
              <button
                type="button"
                :disabled="bioSaving"
                class="btn btn-sm btn-ghost"
                @click="cancelBioEdit"
              >Cancel</button>
              <!-- Only once it is close to mattering: a counter that reads
                   "1000 left" from the first keystroke is noise. -->
              <span
                v-if="bioRemaining < 200"
                class="ml-auto text-[11px] tabular-nums"
                :class="bioRemaining < 20 ? 'text-amber-400' : 'text-zinc-600'"
              >{{ bioRemaining }} left</span>
              <span v-if="bioError" class="text-[11px] text-red-400">{{ bioError }}</span>
            </div>
          </template>
        </section>

        <!-- Everything else about your profile. Its own section rather than a
             disclosure inside a display panel — it is the longest thing on the
             page and it was two clicks down. -->
        <section class="card p-4">
          <details :open="editing" class="group" @toggle="(e) => { if (!(e.target as HTMLDetailsElement).open && editing) cancelEdit() }">
            <summary
              class="cursor-pointer select-none list-none flex items-center justify-between gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              @click.prevent="editing ? cancelEdit() : startEdit()"
            >
              <span class="uppercase tracking-widest font-medium">
                {{ editing ? 'Editing profile…' : 'Profile details' }}
                <span v-if="!editing" class="normal-case tracking-normal text-zinc-600">
                  — country, pronouns, links, showcase
                </span>
              </span>
              <span class="text-zinc-600 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <p v-if="profileSaved" class="text-xs text-emerald-400 pt-3">Saved.</p>

            <!-- The form, in the order somebody fills it in: who you are,
                 where you are, where else to find you, then what the profile
                 shows off. It was one flat run of fourteen boxes where a bio
                 sat next to a Discord handle next to a banner picker. -->
            <form class="pt-4 space-y-4" @submit.prevent="saveProfile">
              <fieldset class="rounded-xl border border-zinc-800/80 p-3.5 space-y-3">
                <legend class="px-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">You</legend>
                <!-- The bio is not here. It has its own card above, which saves
                     on its own — two editors bound to the same field would let
                     an old draft in this form overwrite a bio saved from there
                     the next time somebody pressed Save. -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="block">
                    <span class="text-[11px] uppercase tracking-widest text-zinc-500">Pronouns</span>
                    <input v-model="profile.pronouns" maxlength="64" placeholder="e.g. they/them" class="field field-md mt-1" />
                  </label>
                  <!-- A list rather than a text box: the value draws a flag and
                       is meant to be comparable between profiles. -->
                  <label class="block">
                    <span class="text-[11px] uppercase tracking-widest text-zinc-500">Country</span>
                    <div class="mt-1 flex items-center gap-2">
                      <CountryFlag v-if="profile.country" :country="profile.country" class="shrink-0" />
                      <select v-model="profile.country" class="flex-1 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent">
                        <option value="">— none —</option>
                        <option v-for="c in countryOptions" :key="c.code" :value="c.code">{{ c.name }}</option>
                      </select>
                    </div>
                  </label>
                  <label class="block sm:col-span-2">
                    <span class="text-[11px] uppercase tracking-widest text-zinc-500">State / region</span>
                    <input v-model="profile.subdivision" maxlength="64" placeholder="e.g. California" class="field field-md mt-1" />
                  </label>
                </div>
              </fieldset>

              <fieldset class="rounded-xl border border-zinc-800/80 p-3.5 space-y-3">
                <legend class="px-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Where else to find you</legend>
                <p class="text-[11px] text-zinc-600 -mt-1">
                  These show as chips on your profile.
                </p>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Discord <span class="text-zinc-600 normal-case">— a handle, not a link</span></span>
                  <input v-model="profile.discord_handle" maxlength="64" placeholder="e.g. username" class="field field-md mt-1" />
                </label>
                <label v-for="link in SOCIAL_LINKS" :key="link.key" class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">{{ link.label }}</span>
                  <input
                    v-model="profile[link.key]"
                    type="url"
                    maxlength="500"
                    :placeholder="link.example"
                    class="field field-md mt-1"
                    :class="{ 'border-red-800': profile[link.key].trim() && !socialValid(link.key) }"
                  />
                  <span v-if="profile[link.key].trim() && !socialValid(link.key)" class="text-[11px] text-red-400 mt-1 block">
                    Should look like {{ link.example }}
                  </span>
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                    Geometry Dash username
                    <span class="text-zinc-600 normal-case">— links to your gdbrowser profile</span>
                  </span>
                  <input
                    v-model="profile.gd_username"
                    maxlength="20"
                    placeholder="your in-game name"
                    class="field field-md mt-1"
                    :class="{ 'border-red-800': !gdUsernameValid }"
                  />
                  <span v-if="!gdUsernameValid" class="text-[11px] text-red-400 mt-1 block">
                    Letters, numbers, spaces, dots, dashes and underscores, up to 20 characters.
                  </span>
                  <span v-else-if="profile.gd_username.trim()" class="text-[11px] text-zinc-600 mt-1 block truncate">
                    gdbrowser.com/u/{{ profile.gd_username.trim() }}
                  </span>
                </label>
              </fieldset>

              <fieldset class="rounded-xl border border-zinc-800/80 p-3.5 space-y-3">
                <legend class="px-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Showcase</legend>
                <p class="text-[11px] text-zinc-600 -mt-1">
                  The two levels and the header art at the top of your profile.
                </p>
                <div class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Favorite level</span>
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
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note about your favorite level</span>
                  <textarea
                    v-model="favoriteLevelNote"
                    rows="2"
                    maxlength="500"
                    placeholder="Why do you love it?"
                    class="field field-md mt-1"
                  />
                </label>

                <div class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Hardest completion</span>
                  <p class="text-[11px] text-zinc-600 mt-0.5">
                    Pick one of your approved records to headline your profile.
                  </p>
                  <select
                    v-model="hardestRecordId"
                    class="field field-md mt-1"
                  >
                    <option :value="null">— none —</option>
                    <option v-for="r in completionOptions" :key="r.record_id" :value="r.record_id">
                      #{{ r.sheet_placement ?? r.position }} · {{ r.name }}<template v-if="r.percent != null && r.percent < 100"> ({{ r.percent }}%)</template>
                    </option>
                  </select>
                  <p v-if="!completionOptions.length" class="text-[11px] text-zinc-600 mt-1">
                    You don't have any approved records yet —
                    <NuxtLink to="/records/submit" class="text-accent hover:underline">submit one</NuxtLink>.
                  </p>
                  <p v-else-if="hardestPick" class="text-[11px] text-zinc-400 mt-1 truncate">
                    Showing <span class="text-zinc-200">{{ hardestPick.name }}</span> on your profile.
                  </p>
                </div>

                <div class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Profile banner</span>
                  <p class="text-[11px] text-zinc-600 mt-0.5">
                    Which level's art sits behind your name. The header above updates as you choose.
                  </p>
                  <SegmentedControl
                    v-model="bannerChoiceModel"
                    class="mt-1.5"
                    aria-label="What sits behind your name"
                    :options="[
                      { value: 'hardest', label: 'Hardest completion' },
                      { value: 'favorite', label: 'Favourite level' },
                      { value: 'level', label: 'Any level' },
                      ...(isStaffAccount ? [{ value: 'custom', label: 'Image' }] : []),
                      { value: 'none', label: 'Plain' },
                    ]"
                  />

                  <!-- "Any level" is the one option that needs a level of its
                       own, so its picker sits directly under the choices. -->
                  <div v-if="bannerChoice === 'level'" class="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                    <div class="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        class="rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                        @click="bannerLevelPickerOpen = true"
                      >{{ bannerLevelDisplay ? 'Change…' : 'Pick a level…' }}</button>
                      <span v-if="bannerLevelDisplay" class="text-xs text-zinc-200 truncate">
                        #{{ bannerLevelDisplay.position }} {{ bannerLevelDisplay.name }}
                      </span>
                      <span v-else class="text-[11px] text-amber-300/90">Pick one, or the header stays plain.</span>
                      <button
                        v-if="bannerLevelDisplay"
                        type="button"
                        class="text-[11px] text-zinc-500 hover:text-red-400"
                        @click="bannerLevelId = null; bannerLevelDisplay = null"
                      >clear</button>
                    </div>
                    <p class="text-[11px] text-zinc-600 mt-1.5">
                      Any level on the list — you don't need a record on it.
                    </p>
                  </div>

                  <!-- Staff only, and enforced on the server rather than by
                       this v-if. -->
                  <div
                    v-if="isStaffAccount && bannerChoice === 'custom'"
                    class="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5"
                  >
                    <input
                      v-model="bannerImageUrl"
                      type="url"
                      placeholder="https://…/background.png"
                      class="field field-md"
                    />
                    <p class="text-[11px] text-zinc-600 mt-1.5">
                      A direct image link. Wide works best — the header is about 1500&times;220.
                    </p>
                  </div>
                </div>

              </fieldset>

              <!-- Name decorations, staff only -->
              <fieldset v-if="isStaffAccount" class="rounded-xl border border-zinc-800/80 p-3.5">
                <legend class="px-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Name decorations</legend>
                <div class="block">
                  <p class="text-[11px] text-zinc-600">
                    Shown beside your name wherever it appears. Staff only.
                  </p>
                  <div class="mt-1.5 grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                    <label class="block">
                      <span class="text-[10px] uppercase tracking-widest text-zinc-600">Emoji</span>
                      <input
                        v-model="nameEmoji"
                        maxlength="16"
                        placeholder="👑"
                        class="field field-md mt-0.5"
                      />
                    </label>
                    <label class="block">
                      <span class="text-[10px] uppercase tracking-widest text-zinc-600">Badge</span>
                      <input
                        v-model="nameBadge"
                        maxlength="24"
                        placeholder="Founder"
                        class="field field-md mt-0.5"
                      />
                    </label>
                    <label class="block">
                      <span class="text-[10px] uppercase tracking-widest text-zinc-600">Colour</span>
                      <input
                        :value="nameBadgeColor || '#f4c430'"
                        type="color"
                        class="mt-0.5 h-[34px] w-14 rounded border border-zinc-800 bg-zinc-900 cursor-pointer"
                        @input="nameBadgeColor = ($event.target as HTMLInputElement).value"
                      />
                    </label>
                  </div>
                  <div class="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-zinc-600">
                    <span>Preview:</span>
                    <UserName
                      :username="me?.username ?? 'you'"
                      :emoji="nameEmoji"
                      :badge="nameBadge"
                      :badge-color="nameBadgeColor"
                      :role="me?.role !== 'user' ? me?.role : null"
                      :clan="profileData?.account?.clan ?? null"
                    />
                    <button
                      v-if="nameEmoji || nameBadge"
                      type="button"
                      class="text-zinc-600 hover:text-red-400 transition-colors"
                      @click="nameEmoji = ''; nameBadge = ''"
                    >clear</button>
                  </div>
                </div>
              </fieldset>

              <!-- Sticky, because the form is now four sections tall and Save
                   was at the bottom of all of them. -->
              <div class="sticky bottom-0 -mx-3.5 px-3.5 py-3 bg-zinc-950/90 backdrop-blur border-t border-zinc-800/80 flex items-center gap-2 flex-wrap">
                <button
                  type="submit"
                  :disabled="profileSaving || !gdUsernameValid || !youtubeUrlValid || !allSocialsValid"
                  class="btn btn-md btn-primary"
                >{{ profileSaving ? 'Saving…' : 'Save' }}</button>
                <button
                  type="button"
                  class="rounded-lg border border-zinc-800 text-zinc-300 text-sm px-3 py-1.5 hover:bg-zinc-900 transition-colors"
                  @click="cancelEdit"
                >Cancel</button>
                <span v-if="profileError" class="text-xs text-red-400">{{ profileError }}</span>
              </div>
            </form>
          </details>
        </section>

        <ProfilePanel v-if="profileData?.player" title="Player stats">
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
        </ProfilePanel>

        <!-- Your friends are part of your profile rather than a page of the
             site: two thirds of the panel is pending requests, which are
             nobody else's business, and the rest is a fact about you. -->
        <ProfileFriends />

        <ProgressPosts
          v-if="profileData"
          v-model:open="showProgress"
          :posts="profileData.progressPosts"
          :can-post="true"
          @changed="loadProfileData()"
        />

        <!-- Open-verification submission -->
        <section class="card p-4">
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
                  class="field field-md mt-1"
                />
              </label>
              <label class="block sm:col-span-2">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name <span class="text-red-400">*</span></span>
                <input
                  v-model="ovName"
                  required
                  placeholder="Level name"
                  class="field field-md mt-1"
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
                  class="field field-md mt-1"
                />
              </label>
              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Game version</span>
                <input
                  v-model="ovGameVersion"
                  placeholder="any"
                  class="field field-md mt-1"
                />
              </label>
            </div>

            <!-- Showcase (replaces verification) -->
            <fieldset class="card p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Showcase</legend>

              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                  Showcase link <span class="text-zinc-600 normal-case">a layout or preview clip</span>
                </span>
                <input
                  v-model="ovShowcaseUrl"
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=…"
                  class="field field-md mt-1"
                />
              </label>

              <div v-if="ovShowcaseYt" class="aspect-video rounded-xl border border-zinc-800 bg-black overflow-hidden">
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
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">Intended verifier</span>
                <input
                  v-model="ovVerifier"
                  placeholder="Player name"
                  class="field field-md mt-1"
                />
              </label>
            </fieldset>

            <!-- Difficulty opinion -->
            <fieldset class="card p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty opinion</legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
                  <select
                    v-model="ovGddlTier"
                    class="field field-md mt-1"
                  >
                    <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
                  </select>
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Demon level</span>
                  <select
                    v-model="ovDifficulty"
                    class="field field-md mt-1"
                  >
                    <option v-for="d in OV_DIFFICULTY_OPTIONS" :key="d" :value="d">{{ d || '— none —' }}</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <!-- Optional metadata -->
            <fieldset class="card p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Extra info</legend>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">0–10</span></span>
                  <input
                    v-model="ovEnjoyment"
                    type="number" min="0" max="10" step="0.1" inputmode="decimal"
                    class="field field-md mt-1"
                  />
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
                  <select
                    v-model="ovSkillset"
                    class="field field-md mt-1"
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
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Notes for the mods</span>
              <textarea
                v-model="ovNotes"
                rows="3"
                maxlength="4000"
                placeholder="Anything the moderator should know."
                class="field field-md mt-1"
              />
            </label>

            <div class="flex items-center gap-3 pt-1">
              <button
                type="submit"
                :disabled="ovSubmitting"
                class="btn btn-md btn-primary"
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
          @refresh="loadProfileData()"
        />

        <section class="card overflow-hidden">
          <CommentSection
            kind="profile"
            :target-id="me.id"
            variant="open"
            title="Comments on your profile"
          />
        </section>
      </main>

      <!-- Right panel: actions -->
      <aside class="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div class="card p-3">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2">Actions</h2>
          <div class="flex flex-col gap-1.5">
            <button
              type="button"
              class="btn btn-md btn-primary justify-start"
              @click="startEdit"
            >Edit profile</button>

            <button
              type="button"
              class="text-left text-sm px-3 py-1.5 rounded bg-accent/15 text-accent font-medium hover:bg-accent/25 transition-colors"
              @click="showProgress = !showProgress"
            >Post progress</button>

            <!-- Submit record / Submit level deliberately absent: both live in
                 the header's Submit menu, on every page including this one.
                 What's left here is what only this page offers. -->
            <button
              v-if="(!me.claimed_player || !me.claimed_aredl_uuid || !me.claimed_pointercrate_id || !me.claimed_gdl_id) && !pendingClaim"
              type="button"
              class="text-left text-sm px-3 py-1.5 rounded border border-zinc-800 text-zinc-200 hover:bg-zinc-900 transition-colors"
              @click="claimOpen = !claimOpen"
            >Claim an account</button>
          </div>

          <!-- Claim status / inline form -->
          <div v-if="me.claimed_player || me.claimed_aredl_uuid || me.claimed_pointercrate_id || me.claimed_gdl_id" class="mt-3 px-1 text-xs text-zinc-500 space-y-1.5">
            <div v-if="me.claimed_player" class="flex items-center gap-2">
              <span class="flex-1 min-w-0 truncate">
                ALL list: <span class="text-accent font-medium">{{ me.claimed_player }}</span>
              </span>
              <button
                type="button" :disabled="!!claimBusy"
                class="shrink-0 text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                @click="unclaim('player')"
              >Unclaim</button>
            </div>
            <div
              v-for="kind in externalClaims"
              :key="kind"
              class="flex items-center gap-2"
            >
              <span class="flex-1 min-w-0 truncate">
                {{ CLAIM_LABELS[kind] }}: <span class="text-accent font-medium">claimed</span>
              </span>
              <button
                type="button" :disabled="!!claimBusy"
                class="shrink-0 text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                @click="unclaim(kind)"
              >Unclaim</button>
            </div>

            <!-- Records follow the claim. Approving one imports them; this is
                 the same thing on demand, for claims made before the site did
                 it and for records the mirrors have picked up since. -->
            <div v-if="externalClaims.length" class="pt-1 border-t border-zinc-900">
              <button
                type="button" :disabled="!!claimBusy"
                class="text-accent hover:underline disabled:opacity-40 transition-colors"
                @click="syncClaimedRecords"
              >{{ claimBusy === 'sync' ? 'Importing…' : 'Import records from my claimed accounts' }}</button>
              <p class="text-zinc-600 mt-0.5 leading-snug">
                Adds their completions to your profile for levels on the ALL list.
              </p>
            </div>

            <p v-if="claimNote" class="text-emerald-400">{{ claimNote }}</p>
            <p v-if="claimError" class="text-red-400">{{ claimError }}</p>
          </div>
          <div v-else-if="pendingClaim" class="mt-3 px-1 text-xs text-zinc-400">
            <p>
              Pending
              {{ pendingClaim.source === 'aredl' ? 'AREDL' : pendingClaim.source === 'pointercrate' ? 'Pointercrate' : pendingClaim.source === 'gdl' ? 'GDL' : 'ALL' }}
              claim for
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
              class="field field-md"
            >
              <option value="all">Claim legacy ALL</option>
              <option value="aredl">Claim AREDL</option>
              <option value="pointercrate">Claim Pointercrate</option>
              <option value="gdl">Claim GDL</option>
            </select>
            <div class="relative">
              <input
                v-model="claimInput"
                :placeholder="claimSource === 'aredl' ? 'Search AREDL player name…' : claimSource === 'pointercrate' ? 'Search Pointercrate player name…' : claimSource === 'gdl' ? 'Search GDL player name…' : 'Exact leaderboard name'"
                class="field field-md"
                autocomplete="off"
                @input="claimAredlUuid = null; claimPcId = null; claimGdlId = null"
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
              <ul
                v-if="claimSource === 'gdl' && gdlSuggestions.length"
                class="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 text-xs shadow-lg"
              >
                <li
                  v-for="hit in gdlSuggestions"
                  :key="hit.gdl_id"
                  class="px-2 py-1.5 cursor-pointer hover:bg-zinc-800 flex justify-between gap-2"
                  :class="hit.claimed_account_id ? 'opacity-60 cursor-not-allowed' : ''"
                  @click="hit.claimed_account_id ? null : pickGdlSuggestion(hit)"
                >
                  <span class="truncate">
                    {{ hit.name }}
                    <span v-if="hit.country" class="text-zinc-500">{{ hit.country }}</span>
                  </span>
                  <span class="tabular-nums text-zinc-500 shrink-0">
                    {{ hit.claimed_account_id ? 'claimed' : `${Math.round(hit.points)} pts` }}
                  </span>
                </li>
              </ul>
              <ul
                v-if="claimSource === 'pointercrate' && pcSuggestions.length"
                class="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 text-xs shadow-lg"
              >
                <li
                  v-for="hit in pcSuggestions"
                  :key="hit.pc_id"
                  class="px-2 py-1.5 cursor-pointer hover:bg-zinc-800 flex justify-between gap-2"
                  :class="hit.claimed_account_id ? 'opacity-60 cursor-not-allowed' : ''"
                  @click="hit.claimed_account_id ? null : pickPcSuggestion(hit)"
                >
                  <span class="truncate">
                    {{ hit.name }}
                    <span v-if="hit.nationality" class="text-zinc-500 uppercase">{{ hit.nationality }}</span>
                  </span>
                  <span class="tabular-nums text-zinc-500 shrink-0">
                    {{ hit.claimed_account_id ? 'claimed' : `${Math.round(hit.score)} pts` }}
                  </span>
                </li>
              </ul>
            </div>
            <div class="flex gap-2">
              <button
                type="submit"
                :disabled="claimSubmitting || !claimInput.trim()"
                class="btn btn-sm btn-primary flex-1"
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

        <div class="card p-3">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2">Profile picture</h2>
          <div class="flex items-center gap-2 flex-wrap">
            <label class="rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium px-2.5 py-1 cursor-pointer transition-colors">
              <!-- Choosing a file opens the cropper; the upload happens from
                   there, and reports its own progress. -->
              <span>{{ me.has_avatar ? 'Change' : 'Upload' }}</span>
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

        <div class="card p-3 text-xs space-y-1">
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

        <div class="card p-3">
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
  </div>

  <LevelComparisonDrawer
    v-model:open="favoriteLevelPickerOpen"
    :confirm-on-pick="true"
    title="Pick favorite level"
    hint="Click a level to set it as your favorite."
    @confirm="(lvl) => {
      favoriteLevelId = lvl.id ?? null
      favoriteLevelDisplay = lvl.id
        ? { id: lvl.id, position: lvl.position, sheet_placement: lvl.sheet_placement ?? null, name: lvl.name, gddl_tier: lvl.gddl_tier, gd_id: lvl.gd_id ?? null, verification_url: lvl.verification_url ?? null }
        : null
    }"
  />

  <LevelComparisonDrawer
    v-model:open="bannerLevelPickerOpen"
    :confirm-on-pick="true"
    title="Pick a banner level"
    hint="Click a level to use its art as your header."
    @confirm="(lvl) => {
      bannerLevelId = lvl.id ?? null
      bannerLevelDisplay = lvl.id
        ? { id: lvl.id, position: lvl.position, sheet_placement: lvl.sheet_placement ?? null, name: lvl.name, gddl_tier: lvl.gddl_tier, gd_id: lvl.gd_id ?? null, verification_url: lvl.verification_url ?? null }
        : null
    }"
  />

  <!-- The cropper is its own dialog now. It holds the framing in the picture's
       own coordinates, which is what makes what you save match what you saw —
       see components/AvatarCropper.vue. -->
  <AvatarCropper
    v-model:open="cropOpen"
    :src="cropSrc"
    @saved="onAvatarSaved"
  />
</template>
