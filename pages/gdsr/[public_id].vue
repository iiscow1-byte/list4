<script setup lang="ts">
import { gdsrRequirementLabel } from '~/utils/gdsr-tiers'

/**
 * A GDSR, as everyone else sees it — its own page at its own address.
 *
 * It used to be read through `/lists/:id/packs`, which was a custom list's
 * pack view wearing GDSR wording: the URL said "packs", the page had no
 * leaderboard and no way to submit anything, and nothing about it was
 * shareable as a GDSR. This is the list's own page, and it presents the same
 * furniture a custom list does — banner, icon, accent, thumbnails, records —
 * because a GDSR is a list, just one sorted into tiers instead of ranked.
 */
const route = useRoute()
const publicId = computed(() => String(route.params.public_id))

type Item = {
  id: number
  name: string
  gd_id: number | null
  creator: string | null
  gddl_tier: string | null
  verification_url: string | null
  level_id: number | null
  position?: number | null
  unverified?: number | boolean
}
type Tier = { id: number; name: string; color: string | null; require_count: number | null; item_ids: number[] }
type ListPayload = {
  public_id: string
  title: string
  description: string | null
  kind: string
  is_public: number
  owner_username: string | null
  accent_color: string | null
  icon_url: string | null
  banner_url: string | null
  show_banner: number
  show_thumbnails: number
  show_tier: number
  show_level_links: number
  accepts_records: number
  items: Item[]
  gdsr_tiers: Tier[]
}

const { data, pending, error, refresh } = await useFetch<{ list: ListPayload }>(
  () => `/api/custom-lists/${publicId.value}`,
)
const list = computed(() => data.value?.list ?? null)
const itemById = computed(() => new Map((list.value?.items ?? []).map((i) => [i.id, i])))

/** Levels anybody can actually clear — unverified ones are drafts. */
const clearable = computed(() =>
  (list.value?.items ?? []).filter((i) => !i.unverified).length,
)

const accent = computed(() => list.value?.accent_color || null)

useHead(() => ({ title: list.value ? `${list.value.title} — GDSR` : 'GDSR' }))

// ------------------------------------------------------------- leaderboard
type LbRow = {
  rank: number
  player_name: string
  cleared?: number
  clearable?: number
  tiers_earned?: string[]
  account_username: string | null
  has_avatar: boolean
}
const { data: lbData, refresh: refreshLb } = await useFetch<{ leaderboard: LbRow[] }>(
  () => `/api/custom-lists/${publicId.value}/leaderboard`,
)
const leaderboard = computed(() => lbData.value?.leaderboard ?? [])

const tab = ref<'tiers' | 'leaderboard'>('tiers')

// ---------------------------------------------------------------- records
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

const submitOpen = ref(false)
const submitItem = ref<Item | null>(null)
const playerName = ref('')
const videoUrl = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submitDone = ref(false)

watch(me, (v) => { if (v && !playerName.value) playerName.value = v.claimed_player ?? v.username }, { immediate: true })

function openSubmit(item: Item) {
  submitItem.value = item
  submitError.value = null
  submitDone.value = false
  submitOpen.value = true
}

async function submitRecord() {
  if (submitting.value || !submitItem.value) return
  submitting.value = true
  submitError.value = null
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/records`, {
      method: 'POST',
      body: {
        item_id: submitItem.value.id,
        player_name: playerName.value.trim(),
        percent: 100,
        video: videoUrl.value.trim() || null,
      },
    })
    submitDone.value = true
    videoUrl.value = ''
    await Promise.all([refresh(), refreshLb()])
  } catch (e: any) {
    submitError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not submit.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <p v-if="pending" class="container-tight py-16 text-sm text-zinc-500">Loading…</p>
    <p v-else-if="error || !list" class="container-tight py-16 text-sm text-red-400">
      This GDSR doesn't exist, or isn't public.
    </p>

    <template v-else>
      <!-- Banner, exactly as a custom list wears it. -->
      <div
        v-if="list.show_banner && list.banner_url"
        class="w-full h-40 sm:h-56 bg-cover bg-center border-b border-zinc-800"
        :style="{ backgroundImage: `url(${list.banner_url})` }"
      />

      <div class="container-tight py-6">
        <header class="flex items-start gap-4 mb-5">
          <img
            v-if="list.icon_url"
            :src="list.icon_url"
            alt=""
            class="w-14 h-14 rounded-lg object-cover border border-zinc-800 shrink-0"
          />
          <div
            v-else
            class="w-14 h-14 rounded-lg shrink-0 grid place-items-center text-lg font-semibold border border-zinc-800"
            :style="{ backgroundColor: accent ? `${accent}22` : undefined, color: accent || undefined }"
          >{{ list.title.slice(0, 2).toUpperCase() }}</div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-2xl font-semibold tracking-tight truncate">{{ list.title }}</h1>
              <span
                class="shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-widest"
                :style="{
                  borderColor: accent ? `${accent}66` : '#3f3f46',
                  color: accent || '#a1a1aa',
                }"
              >GDSR</span>
              <span v-if="!list.is_public" class="text-[11px] text-amber-400">private</span>
            </div>
            <p class="text-xs text-zinc-500 mt-0.5">
              <template v-if="list.owner_username">by {{ list.owner_username }} · </template>
              {{ list.gdsr_tiers.length }} tiers · {{ clearable }} clearable levels
            </p>
            <p v-if="list.description" class="text-sm text-zinc-400 mt-2 max-w-2xl">{{ list.description }}</p>
          </div>
        </header>

        <SegmentedControl
          v-model="tab"
          :options="[
            { value: 'tiers', label: 'Tiers' },
            { value: 'leaderboard', label: `Leaderboard ${leaderboard.length ? `(${leaderboard.length})` : ''}` },
          ]"
          class="mb-4"
        />

        <!-- ------------------------------------------------------- tiers -->
        <div v-if="tab === 'tiers'" class="space-y-4">
          <section
            v-for="t in list.gdsr_tiers"
            :key="t.id"
            class="card overflow-hidden"
            :style="{ borderColor: t.color ? `${t.color}55` : undefined }"
          >
            <header
              class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center gap-2.5"
              :style="{ backgroundColor: t.color ? `${t.color}12` : undefined }"
            >
              <span class="w-3 h-3 rounded-sm shrink-0" :style="{ backgroundColor: t.color || '#71717a' }" />
              <h2 class="text-sm font-semibold text-zinc-100">{{ t.name }}</h2>
              <span class="text-[11px] text-zinc-500">
                {{ gdsrRequirementLabel(t.require_count, t.item_ids.length) }}
              </span>
            </header>

            <ul class="divide-y divide-zinc-900/60">
              <li v-for="id in t.item_ids" :key="id">
                <div
                  v-if="itemById.get(id)"
                  class="relative overflow-hidden flex items-center gap-3 px-3 py-2 group"
                >
                  <LevelThumbBg
                    v-if="list.show_thumbnails"
                    :gd-id="itemById.get(id)!.gd_id"
                    :video-url="itemById.get(id)!.verification_url"
                    res="small"
                    img-class="opacity-20 group-hover:opacity-40"
                    overlay-class="bg-gradient-to-r from-zinc-950/90 via-zinc-950/60 to-zinc-950/25"
                  />
                  <component
                    :is="list.show_level_links && itemById.get(id)!.position ? 'NuxtLink' : 'span'"
                    :to="itemById.get(id)!.position ? `/levels/${itemById.get(id)!.position}` : undefined"
                    class="relative min-w-0 flex-1"
                  >
                    <span class="block text-sm text-zinc-100 truncate">
                      {{ itemById.get(id)!.name }}
                      <span
                        v-if="itemById.get(id)!.unverified"
                        class="ml-1.5 align-middle rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-px text-[9px] uppercase tracking-widest text-amber-300"
                      >Unverified</span>
                    </span>
                    <span class="block text-[11px] text-zinc-500 truncate">
                      <template v-if="itemById.get(id)!.creator">{{ itemById.get(id)!.creator }}</template>
                      <template v-if="list.show_tier && itemById.get(id)!.gddl_tier">
                        · {{ itemById.get(id)!.gddl_tier }}
                      </template>
                    </span>
                  </component>
                  <button
                    v-if="list.accepts_records && me && !itemById.get(id)!.unverified"
                    type="button"
                    class="relative btn btn-sm btn-ghost shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    @click="openSubmit(itemById.get(id)!)"
                  >Submit</button>
                </div>
              </li>
              <li v-if="!t.item_ids.length" class="px-3 py-4 text-xs text-zinc-600">No levels in this tier.</li>
            </ul>
          </section>

          <p v-if="!list.gdsr_tiers.length" class="card px-6 py-16 text-center text-sm text-zinc-400">
            This GDSR has no tiers yet.
          </p>
        </div>

        <!-- ------------------------------------------------- leaderboard -->
        <div v-else class="card overflow-hidden">
          <ol v-if="leaderboard.length" class="divide-y divide-zinc-900/60">
            <li v-for="p in leaderboard" :key="p.player_name" class="flex items-center gap-3 px-4 py-2.5">
              <span class="w-8 text-sm tabular-nums text-zinc-500 shrink-0">#{{ p.rank }}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm text-zinc-100 truncate">{{ p.player_name }}</span>
                <span v-if="p.tiers_earned?.length" class="flex flex-wrap gap-1 mt-1">
                  <span
                    v-for="name in p.tiers_earned"
                    :key="name"
                    class="rounded px-1.5 py-px text-[9px] uppercase tracking-widest border"
                    :style="{
                      borderColor: `${(list.gdsr_tiers.find((t) => t.name === name)?.color) || '#52525b'}66`,
                      color: (list.gdsr_tiers.find((t) => t.name === name)?.color) || '#a1a1aa',
                    }"
                  >{{ name }}</span>
                </span>
              </span>
              <span class="text-sm tabular-nums text-zinc-300 shrink-0">
                {{ p.cleared ?? 0 }}<span class="text-zinc-600"> / {{ p.clearable ?? clearable }}</span>
              </span>
            </li>
          </ol>
          <p v-else class="px-6 py-16 text-center text-sm text-zinc-400">
            Nobody has cleared anything on this GDSR yet.
          </p>
        </div>
      </div>
    </template>

    <!-- --------------------------------------------------- submit dialog -->
    <div
      v-if="submitOpen"
      class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      @click.self="submitOpen = false"
    >
      <div class="card w-full max-w-md p-5">
        <h2 class="text-base font-semibold mb-1">Submit a clear</h2>
        <p class="text-xs text-zinc-500 mb-4 truncate">{{ submitItem?.name }}</p>

        <template v-if="submitDone">
          <p class="text-sm text-emerald-400">Submitted — it will appear once a list moderator approves it.</p>
          <button type="button" class="btn btn-primary w-full mt-4" @click="submitOpen = false">Done</button>
        </template>
        <form v-else class="space-y-3" @submit.prevent="submitRecord">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Player name</span>
            <input v-model="playerName" type="text" maxlength="60" required class="field field-md w-full mt-1" />
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Video (optional)</span>
            <input v-model="videoUrl" type="url" placeholder="https://youtube.com/…" class="field field-md w-full mt-1" />
          </label>
          <p v-if="submitError" class="text-xs text-red-400">{{ submitError }}</p>
          <div class="flex gap-2 pt-1">
            <button type="button" class="btn btn-ghost flex-1" @click="submitOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary flex-1" :disabled="submitting">
              {{ submitting ? 'Submitting…' : 'Submit' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
