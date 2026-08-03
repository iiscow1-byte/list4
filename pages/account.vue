<script setup lang="ts">
import { gdUserUrl, isGdUsername } from '~/utils/gd-links'
import { TIER_MAX_NUMBER } from '~/utils/tier-ordinal'
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
  gd_username: me.value?.gd_username ?? '',
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
    profile.gd_username = val.gd_username ?? ''
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
    profile.gd_username = me.value.gd_username ?? ''
  favoriteLevelId.value = me.value.favorite_level_id
  favoriteLevelDisplay.value = profileData.value?.favorite_level ?? null
  favoriteLevelNote.value = profileData.value?.favorite_level_note ?? ''
  hardestRecordId.value = me.value.hardest_record_id ?? null
  bannerChoice.value = me.value.banner_choice ?? 'hardest'
  bannerLevelId.value = me.value.banner_level_id ?? null
  bannerLevelDisplay.value = profileData.value?.banner_level ?? null
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
    profile.gd_username = me.value.gd_username ?? ''
    favoriteLevelId.value = me.value.favorite_level_id
    favoriteLevelDisplay.value = profileData.value?.favorite_level ?? null
    favoriteLevelNote.value = profileData.value?.favorite_level_note ?? ''
    hardestRecordId.value = me.value.hardest_record_id ?? null
    bannerChoice.value = me.value.banner_choice ?? 'hardest'
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
    await $fetch('/api/account', { method: 'PATCH', body: {
      ...profile,
      favorite_level_id: favoriteLevelId.value ?? null,
      favorite_level_note: favoriteLevelNote.value.trim() || null,
      hardest_record_id: hardestRecordId.value ?? null,
      banner_choice: bannerChoice.value,
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

// --- Avatar ---
const avatarVersion = ref(0)
const avatarUrl = computed(() =>
  me.value?.has_avatar ? `/api/users/${encodeURIComponent(me.value.username)}/avatar?v=${avatarVersion.value}` : null,
)
const avatarError = ref<string | null>(null)
const avatarUploading = ref(false)
const avatarHoverFileInput = ref<HTMLInputElement | null>(null)

/**
 * Avatar cropper.
 *
 * The stage is a square: avatars appear as circles in the header and feed but
 * as a rounded square on the profile, so a square is the only output that
 * looks right in both. The circle drawn over the stage is a *guide* — nothing
 * is clipped when saving. (Clipping to a circle and encoding as JPEG, which has
 * no alpha, is what used to bake black corners into every avatar.)
 *
 * Offsets are the image's top-left corner relative to the stage's top-left,
 * in display pixels. `cropScale` multiplies the natural size.
 */
const CROP_SIZE = 320   // px — stage edge on screen
const CROP_OUT = 512    // px — saved image edge
const CROP_MAX_ZOOM = 6

const cropOpen = ref(false)
const cropSrc = ref<string | null>(null)
const cropImgEl = ref<HTMLImageElement | null>(null)
const cropNaturalW = ref(0)
const cropNaturalH = ref(0)
const cropScale = ref(1)
const cropOffsetX = ref(0)
const cropOffsetY = ref(0)
const cropIsDragging = ref(false)

/** Smallest zoom that still covers the stage — never allow empty corners. */
const cropMinScale = computed(() => {
  const min = Math.min(cropNaturalW.value || 1, cropNaturalH.value || 1)
  return CROP_SIZE / min
})

function clampCropOffset() {
  const w = cropNaturalW.value * cropScale.value
  const h = cropNaturalH.value * cropScale.value
  cropOffsetX.value = Math.min(0, Math.max(CROP_SIZE - w, cropOffsetX.value))
  cropOffsetY.value = Math.min(0, Math.max(CROP_SIZE - h, cropOffsetY.value))
}

/** Centre the image at the current zoom. */
function centreCrop() {
  cropOffsetX.value = (CROP_SIZE - cropNaturalW.value * cropScale.value) / 2
  cropOffsetY.value = (CROP_SIZE - cropNaturalH.value * cropScale.value) / 2
  clampCropOffset()
}

function resetCrop() {
  cropScale.value = cropMinScale.value
  centreCrop()
}

function onCropImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  cropNaturalW.value = img.naturalWidth
  cropNaturalH.value = img.naturalHeight
  resetCrop()
}

/**
 * Zoom about a point on the stage, so whatever is under the cursor (or between
 * two fingers) stays there. Zooming from the corner instead — which is what it
 * used to do — walks your subject out of frame every time you scroll.
 */
function zoomAt(nextScale: number, stageX: number, stageY: number) {
  const from = cropScale.value
  const to = Math.max(cropMinScale.value, Math.min(CROP_MAX_ZOOM, nextScale))
  if (to === from) return
  cropOffsetX.value = stageX - (stageX - cropOffsetX.value) * (to / from)
  cropOffsetY.value = stageY - (stageY - cropOffsetY.value) * (to / from)
  cropScale.value = to
  clampCropOffset()
}

function stagePoint(e: { clientX: number; clientY: number }, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onCropWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  const p = stagePoint(e, el)
  // Proportional steps, so zooming feels the same whether you're at 1× or 5×.
  zoomAt(cropScale.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12), p.x, p.y)
}

// Pointer events cover mouse, pen and touch in one path — the old mouse-only
// handlers made this unusable on a phone.
const cropPointers = new Map<number, { x: number; y: number }>()
let cropPinchDist = 0
let cropDragStart = { x: 0, y: 0, ox: 0, oy: 0 }

function onCropPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture?.(e.pointerId)
  cropPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (cropPointers.size === 1) {
    cropIsDragging.value = true
    cropDragStart = { x: e.clientX, y: e.clientY, ox: cropOffsetX.value, oy: cropOffsetY.value }
  } else if (cropPointers.size === 2) {
    const [a, b] = [...cropPointers.values()]
    cropPinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    cropIsDragging.value = false
  }
}

function onCropPointerMove(e: PointerEvent) {
  if (!cropPointers.has(e.pointerId)) return
  cropPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const el = e.currentTarget as HTMLElement

  if (cropPointers.size >= 2) {
    const [a, b] = [...cropPointers.values()]
    const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    if (cropPinchDist > 0 && dist > 0) {
      const mid = stagePoint({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 }, el)
      zoomAt(cropScale.value * (dist / cropPinchDist), mid.x, mid.y)
    }
    cropPinchDist = dist
    return
  }

  if (!cropIsDragging.value) return
  cropOffsetX.value = cropDragStart.ox + (e.clientX - cropDragStart.x)
  cropOffsetY.value = cropDragStart.oy + (e.clientY - cropDragStart.y)
  clampCropOffset()
}

function onCropPointerUp(e: PointerEvent) {
  cropPointers.delete(e.pointerId)
  if (cropPointers.size < 2) cropPinchDist = 0
  if (cropPointers.size === 0) cropIsDragging.value = false
}

/** Arrow keys nudge; shift moves ten at a time. */
function onCropKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 1
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
  }
  const m = moves[e.key]
  if (m) {
    e.preventDefault()
    cropOffsetX.value += m[0]
    cropOffsetY.value += m[1]
    clampCropOffset()
    return
  }
  if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoomAt(cropScale.value * 1.12, CROP_SIZE / 2, CROP_SIZE / 2)
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    zoomAt(cropScale.value / 1.12, CROP_SIZE / 2, CROP_SIZE / 2)
  }
}

/**
 * Live preview: the same transform scaled down to a preview box, so you can see
 * what the avatar will look like at the sizes it's actually used.
 */
function cropPreviewStyle(size: number) {
  const r = size / CROP_SIZE
  return {
    position: 'absolute' as const,
    left: cropOffsetX.value * r + 'px',
    top: cropOffsetY.value * r + 'px',
    width: cropNaturalW.value * cropScale.value * r + 'px',
    height: cropNaturalH.value * cropScale.value * r + 'px',
    pointerEvents: 'none' as const,
  }
}

function openCropForFile(file: File) {
  const reader = new FileReader()
  reader.onload = (ev) => {
    cropSrc.value = ev.target?.result as string
    // Real values land in onCropImgLoad once the natural size is known.
    cropScale.value = 1
    cropOffsetX.value = 0
    cropOffsetY.value = 0
    cropOpen.value = true
  }
  reader.readAsDataURL(file)
}

function closeCrop() {
  cropOpen.value = false
  cropSrc.value = null
  cropPointers.clear()
  cropIsDragging.value = false
}

function onHoverAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(e.target as HTMLInputElement).value = ''
  openCropForFile(file)
}

async function confirmCrop() {
  if (!cropImgEl.value) return
  avatarError.value = null
  avatarUploading.value = true
  const wasOpen = cropOpen.value
  cropOpen.value = false
  try {
    const ratio = CROP_OUT / CROP_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = CROP_OUT
    canvas.height = CROP_OUT
    const ctx = canvas.getContext('2d')!
    // Better downscaling than the default nearest-ish resampling — avatars are
    // almost always a large photo squeezed into 512px.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // JPEG has no alpha; without this, any gap would encode as black.
    ctx.fillStyle = '#18181b'
    ctx.fillRect(0, 0, CROP_OUT, CROP_OUT)
    ctx.drawImage(
      cropImgEl.value,
      cropOffsetX.value * ratio,
      cropOffsetY.value * ratio,
      cropNaturalW.value * cropScale.value * ratio,
      cropNaturalH.value * cropScale.value * ratio,
    )
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Crop failed.')
    const fd = new FormData()
    fd.append('avatar', blob, 'avatar.jpg')
    await $fetch('/api/account/avatar', { method: 'POST', body: fd })
    await refreshMe()
    avatarVersion.value++
    cropSrc.value = null
  } catch (err: any) {
    avatarError.value = err?.data?.statusMessage ?? err?.statusMessage ?? 'Upload failed.'
    // Keep the crop up so the chosen framing isn't lost to a failed upload.
    if (wasOpen) cropOpen.value = true
  } finally {
    avatarUploading.value = false
  }
}

async function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(e.target as HTMLInputElement).value = ''
  openCropForFile(file)
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
    : '\n\nThe records it brought here are removed from your profile. They stay on '
      + `${CLAIM_LABELS[kind]} — claiming again brings them back.`
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
      : 'Nothing new — your profile already has every record those accounts carry that the ALL list has.'
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
const bannerChoice = ref<'hardest' | 'favorite' | 'level' | 'none'>('hardest')

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
  banner_choice: 'hardest' | 'favorite' | 'level' | 'none'
  banner_level: ShowcaseLevel | null
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
const bannerLevel = computed<ShowcaseLevel | null>(() => {
  const d = profileData.value
  if (!d) return null
  const choice = editing.value ? bannerChoice.value : d.banner_choice
  if (choice === 'none') return null
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

const joined = computed(() => {
  const at = profileData.value?.account.created_at
  if (!at) return null
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
})

/** Same four headline numbers the public profile prints. */
const headlineStats = computed(() => {
  const d = profileData.value
  if (!d) return []
  return [
    { label: 'Points', value: d.player ? fmt(d.player.total_points) : '—', tone: 'text-amber-300' },
    { label: 'Completions', value: d.completedLevels.length.toLocaleString(), tone: 'text-zinc-100' },
    { label: 'Followers', value: d.follow.followerCount.toLocaleString(), tone: 'text-zinc-100', opens: 'followers' as const },
    { label: 'Following', value: (d.follow.followingCount ?? 0).toLocaleString(), tone: 'text-zinc-100', opens: 'following' as const },
  ]
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
    <!-- Cover header. Deliberately the same construction as /users/:name — this
         page is where you build that profile, so it should show you the thing
         you're editing rather than a different-looking settings screen. The
         backdrop follows the edit form live. -->
    <header class="relative">
      <div class="relative h-44 sm:h-56 overflow-hidden bg-zinc-900">
        <LevelThumbBg
          v-if="bannerLevel"
          :key="bannerLevel.gd_id ?? bannerLevel.name"
          :gd-id="bannerLevel.gd_id"
          :video-url="bannerLevel.video ?? bannerLevel.verification_url"
          res="high"
          priority
          img-class="opacity-60 scale-105"
          overlay-class="bg-gradient-to-b from-zinc-950/40 via-zinc-950/70 to-zinc-950"
        />
        <div
          v-else
          class="absolute inset-0 bg-[radial-gradient(80%_140%_at_50%_0%,theme(colors.zinc.800),theme(colors.zinc.950))]"
          aria-hidden="true"
        />
        <div class="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950 to-transparent" aria-hidden="true" />

        <NuxtLink
          v-if="bannerLevel?.position"
          :to="`/levels/${bannerLevel.position}`"
          class="absolute top-3 right-3 sm:top-4 sm:right-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 backdrop-blur px-2.5 py-1 text-[11px] text-zinc-200 hover:border-accent/50 hover:text-accent transition-colors"
        >
          <span class="tabular-nums text-zinc-400">#{{ bannerLevel.sheet_placement ?? bannerLevel.position }}</span>
          <span class="truncate max-w-[10rem]">{{ bannerLevel.name }}</span>
        </NuxtLink>
      </div>

      <div class="container-tight max-w-5xl">
        <div class="relative -mt-14 sm:-mt-16 flex items-end gap-4 flex-wrap">
          <label
            class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-zinc-900 ring-4 ring-zinc-950 overflow-hidden shrink-0 shadow-xl shadow-black/50 cursor-pointer group"
            title="Change profile picture"
          >
            <img v-if="avatarUrl" :src="avatarUrl" alt="" class="w-full h-full object-cover" />
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

          <div class="flex-1 min-w-0 pb-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ me.username }}</h1>
              <span
                v-if="me.role !== 'user'"
                class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded"
                :class="roleBadgeClass(me.role)"
              >{{ me.role }}</span>
              <span v-if="me.pronouns" class="text-xs text-zinc-500">{{ me.pronouns }}</span>
            </div>
            <p class="text-[11px] text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span v-if="me.claimed_player">
                playing as <span class="text-zinc-300">{{ me.claimed_player }}</span>
              </span>
              <span v-if="me.subdivision || me.country">
                <span v-if="me.subdivision">{{ me.subdivision }}, </span>{{ me.country }}
              </span>
              <span v-if="joined">joined {{ joined }}</span>
            </p>
          </div>

          <div class="pb-1 flex items-center gap-2 shrink-0">
            <span v-if="me.discord_handle" class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400">
              <svg viewBox="0 0 127.14 96.36" fill="currentColor" class="w-3.5 h-3.5 shrink-0 text-[#5865F2]" aria-hidden="true">
                <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
              </svg>
              {{ me.discord_handle }}
            </span>
            <a
              v-if="me.youtube_url"
              :href="me.youtube_url"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400 hover:text-red-400 hover:border-red-900/60 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube
            </a>
            <a
              v-if="gdProfileUrl"
              :href="gdProfileUrl"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400 hover:text-accent hover:border-accent/50 transition-colors"
              :title="`${me.gd_username} on gdbrowser`"
            >
              <GdCubeIcon class="w-3.5 h-3.5 shrink-0" />
              {{ me.gd_username }}
            </a>
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
              class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >View public ↗</NuxtLink>
          </div>
        </div>

        <dl v-if="profileData" class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden bg-zinc-800/70 border border-zinc-800">
          <component
            :is="s.opens ? 'button' : 'div'"
            v-for="s in headlineStats"
            :key="s.label"
            :type="s.opens ? 'button' : undefined"
            class="bg-zinc-950 px-3 py-2.5 text-left"
            :class="s.opens ? 'hover:bg-zinc-900 transition-colors cursor-pointer group' : ''"
            @click="s.opens && openFollowList(s.opens)"
          >
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500" :class="s.opens ? 'group-hover:text-accent transition-colors' : ''">{{ s.label }}</dt>
            <dd class="tabular-nums text-lg font-semibold" :class="s.tone">{{ s.value }}</dd>
          </component>
        </dl>
        <FollowListModal
          v-if="profileData"
          v-model:open="followListOpen"
          :target="profileData.follow.target"
          :mode="followListMode"
          :count="followListMode === 'followers' ? profileData.follow.followerCount : (profileData.follow.followingCount ?? 0)"
          :who="me.username"
        />
      </div>
    </header>

    <div class="container-tight max-w-5xl py-6">
    <div class="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
      <!-- Main column: same shape as the public profile -->
      <main class="space-y-6 min-w-0">
        <!-- Showcase cards, exactly as they appear to visitors -->
        <section v-if="profileData?.hardest_completion || profileData?.favorite_level" class="grid gap-3 sm:grid-cols-2">
          <article
            v-if="profileData?.hardest_completion"
            class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 group"
          >
            <LevelThumbBg
              :gd-id="profileData.hardest_completion.gd_id"
              :video-url="profileData.hardest_completion.video ?? profileData.hardest_completion.verification_url"
              res="high"
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 620px"
              img-class="opacity-25 group-hover:opacity-40"
              overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
            />
            <div class="relative p-4">
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Hardest completion</h2>
              <NuxtLink :to="`/levels/${profileData.hardest_completion.position}`" class="mt-1.5 block">
                <span class="text-lg font-bold text-zinc-50 hover:text-accent transition-colors">{{ profileData.hardest_completion.name }}</span>
              </NuxtLink>
              <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span class="tabular-nums rounded px-1.5 py-0.5 bg-zinc-900 text-zinc-300 border border-zinc-800">
                  #{{ profileData.hardest_completion.sheet_placement ?? profileData.hardest_completion.position }}
                </span>
                <span
                  v-if="profileData.hardest_completion.percent != null && profileData.hardest_completion.percent < 100"
                  class="tabular-nums text-zinc-400"
                >{{ profileData.hardest_completion.percent }}%</span>
              </div>
            </div>
          </article>

          <article
            v-if="profileData?.favorite_level"
            class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 group"
          >
            <LevelThumbBg
              :gd-id="profileData.favorite_level.gd_id"
              :video-url="profileData.favorite_level.verification_url"
              res="high"
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 620px"
              img-class="opacity-25 group-hover:opacity-40"
              overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
            />
            <div class="relative p-4">
              <h2 class="text-[10px] uppercase tracking-widest text-pink-400 font-semibold">Favourite level</h2>
              <NuxtLink :to="`/levels/${profileData.favorite_level.position}`" class="mt-1.5 block">
                <span class="text-lg font-bold text-zinc-50 hover:text-accent transition-colors">{{ profileData.favorite_level.name }}</span>
              </NuxtLink>
              <p v-if="profileData.favorite_level_note" class="mt-2 text-xs text-zinc-400 whitespace-pre-wrap">{{ profileData.favorite_level_note }}</p>
            </div>
          </article>
        </section>

        <!-- About: always-visible display + collapsible edit dropdown below -->
        <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
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
              <div v-if="me.gd_username">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Geometry Dash</dt>
                <dd>
                  <a :href="gdProfileUrl!" target="_blank" rel="noopener" class="text-accent hover:underline text-sm">{{ me.gd_username }} ↗</a>
                </dd>
              </div>
              <div v-if="me.youtube_url" class="col-span-2">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">YouTube</dt>
                <dd><a :href="me.youtube_url" target="_blank" rel="noopener" class="text-accent hover:underline text-sm">YouTube ↗</a></dd>
              </div>
            </dl>
            <!-- The hardest completion and the favourite live in the showcase
                 cards above now, the same way visitors see them. -->
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
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Pronouns</span>
                  <input
                    v-model="profile.pronouns"
                    maxlength="64"
                    placeholder="e.g. they/them"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Discord</span>
                  <input
                    v-model="profile.discord_handle"
                    maxlength="64"
                    placeholder="e.g. username or username#1234"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">YouTube channel <span class="text-zinc-600 normal-case">full URL</span></span>
                  <input
                    v-model="profile.youtube_url"
                    type="url"
                    maxlength="500"
                    placeholder="https://www.youtube.com/@yourhandle"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    :class="{ 'border-red-800': profile.youtube_url.trim() && !youtubeUrlValid }"
                  />
                  <span v-if="profile.youtube_url.trim() && !youtubeUrlValid" class="text-[11px] text-red-400 mt-1 block">
                    Must be a YouTube channel URL, e.g. https://www.youtube.com/@handle
                  </span>
                </label>
                <label class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                    Geometry Dash username
                    <span class="text-zinc-600 normal-case">— links to your gdbrowser profile</span>
                  </span>
                  <input
                    v-model="profile.gd_username"
                    maxlength="20"
                    placeholder="your in-game name"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    :class="{ 'border-red-800': !gdUsernameValid }"
                  />
                  <span v-if="!gdUsernameValid" class="text-[11px] text-red-400 mt-1 block">
                    Letters, numbers, spaces, dots, dashes and underscores, up to 20 characters.
                  </span>
                  <span v-else-if="profile.gd_username.trim()" class="text-[11px] text-zinc-600 mt-1 block truncate">
                    gdbrowser.com/u/{{ profile.gd_username.trim() }}
                  </span>
                </label>
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
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>

                <div class="block sm:col-span-2">
                  <span class="text-[11px] uppercase tracking-widest text-zinc-500">Hardest completion</span>
                  <p class="text-[11px] text-zinc-600 mt-0.5">
                    Pick one of your approved records to headline your profile.
                  </p>
                  <select
                    v-model="hardestRecordId"
                    class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
                  <div class="mt-1.5 inline-flex rounded-lg border border-zinc-800 overflow-hidden flex-wrap">
                    <button
                      v-for="opt in [
                        { v: 'hardest', l: 'Hardest completion' },
                        { v: 'favorite', l: 'Favourite level' },
                        { v: 'level', l: 'Any level' },
                        { v: 'none', l: 'Plain' },
                      ]"
                      :key="opt.v"
                      type="button"
                      class="px-3 py-1.5 text-[11px] font-medium transition-colors border-l border-zinc-800 first:border-l-0"
                      :class="bannerChoice === opt.v ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
                      @click="bannerChoice = opt.v as any"
                    >{{ opt.l }}</button>
                  </div>

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
                </div>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  type="submit"
                  :disabled="profileSaving || !gdUsernameValid || !youtubeUrlValid"
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

        <section v-if="profileData?.player" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
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
        <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
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
            <fieldset class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Showcase</legend>

              <label class="block">
                <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                  Showcase link <span class="text-zinc-600 normal-case">a layout / preview clip, embedded in place of verification</span>
                </span>
                <input
                  v-model="ovShowcaseUrl"
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=…"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </fieldset>

            <!-- Difficulty opinion -->
            <fieldset class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty opinion</legend>
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
            <fieldset class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Extra info</legend>
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
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Notes for the mods</span>
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
          @refresh="loadProfileData()"
        />

        <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Comments on your profile</h2>
          <CommentSection kind="profile" :target-id="me.id" />
        </section>
      </main>

      <!-- Right panel: actions -->
      <aside class="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
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
                Their completions become records on your ALL profile, for the levels this list carries.
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
              class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-accent/50"
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
                class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
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

        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
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

        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs space-y-1">
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

        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
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
    hint="Click a level to paint your profile header with its art."
    @confirm="(lvl) => {
      bannerLevelId = lvl.id ?? null
      bannerLevelDisplay = lvl.id
        ? { id: lvl.id, position: lvl.position, sheet_placement: lvl.sheet_placement ?? null, name: lvl.name, gddl_tier: lvl.gddl_tier, gd_id: lvl.gd_id ?? null, verification_url: lvl.verification_url ?? null }
        : null
    }"
  />

  <!-- Avatar crop modal -->
  <Teleport to="body">
    <div
      v-if="cropOpen"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      @click.self="closeCrop"
      @keydown.esc="closeCrop"
    >
      <div class="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 w-full max-w-md space-y-4 shadow-2xl" @click.stop>
        <div>
          <h2 class="text-sm font-semibold text-zinc-100">Crop profile picture</h2>
          <p class="text-[11px] text-zinc-500 mt-0.5">
            Drag to reposition · scroll or pinch to zoom · arrow keys to nudge
          </p>
        </div>

        <!-- Stage. Square, because avatars render as a rounded square on
             profiles and a circle everywhere else; the ring is only a guide. -->
        <div
          class="relative mx-auto bg-black overflow-hidden select-none touch-none rounded-2xl ring-1 ring-zinc-700 focus:outline-none focus:ring-2 focus:ring-accent"
          :style="{ width: CROP_SIZE + 'px', height: CROP_SIZE + 'px', maxWidth: '100%' }"
          :class="cropIsDragging ? 'cursor-grabbing' : 'cursor-grab'"
          tabindex="0"
          role="application"
          aria-label="Crop area — drag to reposition, arrow keys to nudge"
          @pointerdown="onCropPointerDown"
          @pointermove="onCropPointerMove"
          @pointerup="onCropPointerUp"
          @pointercancel="onCropPointerUp"
          @wheel.prevent="onCropWheel"
          @keydown="onCropKeydown"
        >
          <img
            v-if="cropSrc"
            ref="cropImgEl"
            :src="cropSrc"
            alt=""
            draggable="false"
            :style="{
              position: 'absolute',
              left: cropOffsetX + 'px',
              top: cropOffsetY + 'px',
              width: cropNaturalW * cropScale + 'px',
              height: cropNaturalH * cropScale + 'px',
              userSelect: 'none',
              pointerEvents: 'none',
            }"
            @load="onCropImgLoad"
          />

          <!-- Circle guide: shows what the round contexts will keep, without
               removing the corners the square contexts still show. A circular
               element with a large *outward* shadow dims everything outside it;
               the stage's own overflow-hidden clips the shadow to the square. -->
          <div
            class="absolute inset-0 rounded-full ring-2 ring-accent/70 pointer-events-none"
            style="box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45)"
            aria-hidden="true"
          />
          <!-- Rule-of-thirds guides, faint, only while dragging -->
          <div v-if="cropIsDragging" class="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div class="absolute inset-y-0 left-1/3 w-px bg-white/20" />
            <div class="absolute inset-y-0 left-2/3 w-px bg-white/20" />
            <div class="absolute inset-x-0 top-1/3 h-px bg-white/20" />
            <div class="absolute inset-x-0 top-2/3 h-px bg-white/20" />
          </div>
        </div>

        <!-- Live previews at the sizes avatars are actually used -->
        <div class="flex items-center justify-center gap-4">
          <div class="flex flex-col items-center gap-1">
            <div class="relative w-16 h-16 rounded-full overflow-hidden bg-black ring-1 ring-zinc-700">
              <img v-if="cropSrc" :src="cropSrc" alt="" :style="cropPreviewStyle(64)" draggable="false" />
            </div>
            <span class="text-[9px] uppercase tracking-widest text-zinc-600">Feed</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="relative w-16 h-16 rounded-full overflow-hidden bg-black ring-2 ring-zinc-950 outline outline-1 outline-zinc-700">
              <img v-if="cropSrc" :src="cropSrc" alt="" :style="cropPreviewStyle(64)" draggable="false" />
            </div>
            <span class="text-[9px] uppercase tracking-widest text-zinc-600">Profile</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="relative w-7 h-7 rounded-full overflow-hidden bg-black ring-1 ring-zinc-700">
              <img v-if="cropSrc" :src="cropSrc" alt="" :style="cropPreviewStyle(28)" draggable="false" />
            </div>
            <span class="text-[9px] uppercase tracking-widest text-zinc-600">Header</span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <label class="flex-1">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Zoom</span>
            <input
              type="range"
              :min="cropMinScale"
              :max="CROP_MAX_ZOOM"
              step="0.01"
              :value="cropScale"
              class="w-full mt-1 accent-accent"
              @input="(e) => zoomAt(Number((e.target as HTMLInputElement).value), CROP_SIZE / 2, CROP_SIZE / 2)"
            />
          </label>
          <button
            type="button"
            class="mt-4 shrink-0 rounded-lg border border-zinc-700 text-zinc-300 text-xs px-2.5 py-1.5 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            title="Fit the whole picture and centre it"
            @click="resetCrop"
          >Reset</button>
        </div>

        <p v-if="avatarError" class="text-xs text-red-400">{{ avatarError }}</p>

        <div class="flex gap-2 pt-1">
          <button
            type="button"
            :disabled="avatarUploading"
            class="flex-1 rounded-lg bg-accent text-zinc-950 font-semibold text-sm py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
            @click="confirmCrop"
          >{{ avatarUploading ? 'Saving…' : 'Save picture' }}</button>
          <button
            type="button"
            class="px-4 rounded-lg border border-zinc-700 text-sm py-2 hover:bg-zinc-800 transition-colors"
            @click="closeCrop"
          >Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
