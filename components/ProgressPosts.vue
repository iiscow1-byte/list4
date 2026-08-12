<script setup lang="ts">
/**
 * Progress somebody has posted on a level.
 *
 * Three things were wrong with the old panel, and the first one was expensive:
 *
 * - **Every post embedded a YouTube iframe on load.** A profile with a dozen
 *   posts opened a dozen third-party players before you had scrolled to any of
 *   them — each one its own document, its own scripts, its own cookies. They
 *   are click-to-play posters now: one image, and the iframe is created when
 *   somebody actually asks to watch.
 * - **`61% → 74%` was the whole story.** The interesting thing about progress is
 *   how far through the level it is and how much of a jump it was, and both are
 *   shapes rather than numbers. There is a bar now: the run so far in grey, the
 *   new stretch in the accent colour.
 * - **The box wasn't the same box as the rest of the profile.** It drew its own
 *   heading and its own padding beside four panels that share one shell.
 *
 * The form is unchanged in what it asks for, only in how it's laid out — the
 * two ways of naming a level are one field pair rather than two full-width
 * boxes stacked with no hint that they are alternatives.
 */
type ProgressPost = {
  id: number
  level_name: string
  level_position: number | null
  start_percent: number
  end_percent: number
  video_url: string | null
  created_at: string
}

const props = defineProps<{
  posts: ProgressPost[]
  canPost?: boolean
  open?: boolean
}>()

const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'update:open', open: boolean): void
}>()

const showForm = ref(props.open ?? false)
watch(() => props.open, (v) => {
  if (typeof v === 'boolean') showForm.value = v
})
watch(showForm, (v) => emit('update:open', v))
const submitting = ref(false)
const error = ref<string | null>(null)

const form = reactive({
  level_position: '' as string,
  level_name: '',
  start_percent: '' as string,
  end_percent: '' as string,
  video_url: '',
})

// Picker for an existing list level — same shape as the record submit form.
type LevelMatch = { position: number; name: string }
const levelSearch = ref('')
const levelSelected = ref<LevelMatch | null>(null)
const search = computed({
  get: () => levelSearch.value,
  set: (v) => { levelSearch.value = v },
})
const setSelected = (s: LevelMatch | null) => {
  levelSelected.value = s
  if (s) {
    form.level_position = String(s.position)
    form.level_name = s.name
  } else {
    form.level_position = ''
  }
}
const picker = useLevelPicker(search, levelSelected, setSelected)

function reset() {
  form.level_position = ''
  form.level_name = ''
  form.start_percent = ''
  form.end_percent = ''
  form.video_url = ''
  levelSelected.value = null
  levelSearch.value = ''
  error.value = null
}

async function submit() {
  if (submitting.value) return
  error.value = null
  submitting.value = true
  try {
    await $fetch('/api/account/progress', {
      method: 'POST',
      body: {
        level_position: form.level_position || undefined,
        level_name: form.level_name || undefined,
        start_percent: Number(form.start_percent),
        end_percent: Number(form.end_percent),
        video_url: form.video_url || undefined,
      },
    })
    reset()
    showForm.value = false
    emit('changed')
  } catch (e: any) {
    error.value = e?.statusMessage || e?.data?.statusMessage || 'Failed to post progress.'
  } finally {
    submitting.value = false
  }
}

async function remove(id: number) {
  if (!confirm('Delete this progress post?')) return
  try {
    await $fetch(`/api/account/progress/${id}`, { method: 'DELETE' })
    emit('changed')
  } catch (e: any) {
    alert(e?.statusMessage || 'Failed to delete.')
  }
}

function relative(at: string): string {
  const t = Date.parse(at)
  if (Number.isNaN(t)) return ''
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}

/**
 * The YouTube video ID behind a URL, or null.
 *
 * Split out from the embed URL because both the poster image and the iframe are
 * built from the ID, and deriving it twice from the same string is how the two
 * end up disagreeing about which video a post is showing.
 */
function ytId(raw: string | null): string | null {
  if (!raw) return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  const host = u.hostname.replace(/^www\./, '')
  let id: string | null = null
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0] ?? null
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] ?? null
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2] ?? null
  }
  return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null
}

/**
 * Which posts have been asked to play.
 *
 * A set rather than a single id: somebody comparing two attempts should not
 * have the first one torn out from under them to show the second.
 */
const playing = ref(new Set<number>())
function play(id: number) {
  playing.value = new Set(playing.value).add(id)
}

/**
 * The stretch a post covers, as a bar.
 *
 * `start` is where the run had already reached and `end` is where it got to, so
 * the gained part is what the post is *about* — it gets the accent, and the
 * ground already held is grey behind it. Clamped because a post is user input
 * and a 120% run would otherwise draw outside its own box.
 */
function bar(p: ProgressPost) {
  const clamp = (n: number) => Math.max(0, Math.min(100, Number(n) || 0))
  const start = clamp(p.start_percent)
  const end = Math.max(start, clamp(p.end_percent))
  return { start: `${start}%`, gained: `${end - start}%`, isRun: end > start }
}
</script>

<template>
  <ProfilePanel
    title="Progress"
    :note="`${posts.length} post${posts.length === 1 ? '' : 's'}`"
    flush
  >
    <template #action>
      <button
        v-if="canPost"
        type="button"
        class="text-[11px] px-2 py-1 rounded-lg border transition-colors"
        :class="showForm
          ? 'border-accent/60 text-accent bg-accent/10'
          : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'"
        @click="showForm = !showForm"
      >{{ showForm ? 'Cancel' : 'Post progress' }}</button>
    </template>

    <form v-if="canPost && showForm" class="px-4 pb-3.5 space-y-3 border-b border-zinc-900" @submit.prevent="submit">
      <!-- Two ways to name a level, side by side, so it reads as a choice
           rather than as two things that both need filling in. -->
      <fieldset class="rounded-lg border border-zinc-800/80 p-3 space-y-2">
        <legend class="px-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Which level</legend>
        <div class="relative">
          <input
            v-model="search"
            type="text"
            placeholder="Search the list…"
            autocomplete="off"
            class="field field-md"
            @focus="picker.openIfHasMatches()"
            @blur="picker.scheduleClose()"
          />
          <div
            v-if="picker.open.value && picker.matches.value.length"
            :ref="(el) => picker.setScrollEl(el as Element | null)"
            class="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto popover"
            @scroll="picker.onScroll()"
          >
            <button
              v-for="m in picker.matches.value"
              :key="m.position"
              type="button"
              class="w-full text-left px-2 py-1.5 text-sm hover:bg-zinc-900 transition-colors"
              :class="picker.isExactMatch(m) ? 'text-accent' : 'text-zinc-200'"
              @mousedown.prevent="picker.pick(m)"
            >
              <span class="text-xs text-zinc-500 tabular-nums">#{{ m.position }}</span>
              {{ m.name }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-widest text-zinc-600 shrink-0">or</span>
          <input
            v-model="form.level_name"
            type="text"
            placeholder="Type a name, for a level not on the list"
            class="field field-sm flex-1 min-w-0"
          />
        </div>
      </fieldset>

      <div class="grid grid-cols-2 sm:grid-cols-[1fr_1fr_2fr] gap-2">
        <label class="block">
          <span class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">From %</span>
          <input
            v-model="form.start_percent"
            type="number" min="0" max="100" required
            class="field field-md tabular-nums"
          />
        </label>
        <label class="block">
          <span class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">To %</span>
          <input
            v-model="form.end_percent"
            type="number" min="0" max="100" required
            class="field field-md tabular-nums"
          />
        </label>
        <label class="block col-span-2 sm:col-span-1">
          <span class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Video <span class="normal-case text-zinc-600">optional</span></span>
          <input
            v-model="form.video_url"
            type="url"
            placeholder="https://…"
            class="field field-md"
          />
        </label>
      </div>

      <div class="flex items-center gap-2">
        <p v-if="error" class="text-xs text-red-400 flex-1">{{ error }}</p>
        <button
          type="submit"
          :disabled="submitting"
          class="btn btn-md btn-primary ml-auto"
        >{{ submitting ? 'Posting…' : 'Post' }}</button>
      </div>
    </form>

    <p v-if="posts.length === 0" class="px-4 py-5 text-xs text-zinc-600">
      No progress posts yet.<template v-if="canPost"> Post one and it shows up here with a bar and, if you link it, the run.</template>
    </p>

    <ul v-else class="divide-y divide-zinc-900">
      <li v-for="p in posts" :key="p.id" class="px-4 py-3">
        <div class="flex items-baseline gap-2 flex-wrap">
          <NuxtLink
            v-if="p.level_position"
            :to="`/levels/${p.level_position}`"
            class="text-sm font-medium text-zinc-100 hover:text-accent transition-colors"
          >{{ p.level_name }}</NuxtLink>
          <span v-else class="text-sm font-medium text-zinc-100">{{ p.level_name }}</span>

          <span class="tabular-nums text-xs text-zinc-400">
            {{ p.start_percent }}<span class="text-zinc-600">%</span>
            <span class="text-zinc-600 mx-0.5">→</span>
            <span class="text-accent font-semibold">{{ p.end_percent }}<span class="text-accent/70">%</span></span>
          </span>

          <span class="ml-auto text-[11px] text-zinc-600 tabular-nums">{{ relative(p.created_at) }}</span>
          <button
            v-if="canPost"
            type="button"
            class="text-xs text-zinc-700 hover:text-red-400 transition-colors"
            @click="remove(p.id)"
            aria-label="Delete progress post"
          >×</button>
        </div>

        <!-- The run so far, and the part this post added. -->
        <div
          class="mt-2 h-1.5 rounded-full bg-zinc-900 overflow-hidden flex"
          :title="`${p.start_percent}% → ${p.end_percent}%`"
        >
          <span class="h-full bg-zinc-700" :style="{ width: bar(p).start }" />
          <span class="h-full bg-accent" :style="{ width: bar(p).gained }" />
        </div>

        <div v-if="p.video_url" class="mt-2.5">
          <!-- Click to play. An iframe per post meant a profile opened a dozen
               YouTube players nobody had asked for. -->
          <div
            v-if="ytId(p.video_url)"
            class="w-64 max-w-full aspect-video rounded-lg overflow-hidden border border-zinc-800 bg-black relative"
          >
            <iframe
              v-if="playing.has(p.id)"
              :src="`https://www.youtube.com/embed/${ytId(p.video_url)}?autoplay=1`"
              class="w-full h-full"
              loading="lazy"
              referrerpolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
            />
            <button
              v-else
              type="button"
              class="group absolute inset-0 w-full h-full"
              :aria-label="`Play the run on ${p.level_name}`"
              @click="play(p.id)"
            >
              <img
                :src="`https://i.ytimg.com/vi/${ytId(p.video_url)}/mqdefault.jpg`"
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                class="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
              />
              <span class="absolute inset-0 flex items-center justify-center">
                <span class="w-10 h-10 rounded-full bg-black/70 border border-white/25 flex items-center justify-center group-hover:bg-black/85 group-hover:scale-105 transition-all">
                  <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-white ml-0.5" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </button>
          </div>
          <a
            v-else
            :href="p.video_url"
            target="_blank"
            rel="noopener"
            class="text-xs text-accent hover:underline break-all"
          >{{ p.video_url }}</a>
        </div>

        <CommentSection kind="progress" :target-id="p.id" />
      </li>
    </ul>
  </ProfilePanel>
</template>
