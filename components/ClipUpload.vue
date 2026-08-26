<script setup lang="ts">
/**
 * "Upload a clip" beside a video URL field.
 *
 * Deliberately *beside* rather than instead of: the field it feeds is still a
 * plain text input, still accepts a pasted YouTube or Medal link, and still
 * holds nothing but a URL when this is used. All this does is put a URL there
 * that happens to point at this site — so nothing downstream (validation, the
 * submission payload, the review drawer, the level page) has to know an upload
 * happened at all.
 *
 * `XMLHttpRequest` rather than `$fetch`, for the one thing fetch still cannot
 * do: report upload progress. A large clip on a home connection is minutes of
 * silence otherwise, which is indistinguishable from a hung form — and the
 * commonest response to that is pressing the button again.
 */
const props = defineProps<{
  /** The URL field this control writes into. */
  modelValue: string
  disabled?: boolean
  /** Wording for the picker — "clip" reads oddly next to "Verification link". */
  label?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** `YYYY-MM-DD` read out of the clip's own metadata, when it has one. */
  (e: 'recorded-at', date: string): void
}>()

/**
 * A poster frame, drawn from the file before it is sent.
 *
 * The browser already has the file and a video decoder; the server has neither
 * without ffmpeg, which is a large dependency for one still. So the frame is
 * captured here — seek a second in, paint to a canvas, hand back a JPEG — and
 * posted alongside the clip.
 *
 * One second rather than zero because the first frame of a recording is very
 * often black, and a black thumbnail is worse than none. Everything here is
 * best-effort: a codec the browser cannot decode, a tainted canvas, a file that
 * never reaches `loadeddata` — all just mean no poster, and the clip uploads
 * exactly as it did before.
 */
const POSTER_SEEK_SEC = 1
const POSTER_MAX_W = 640

function capturePoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (blob: Blob | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(objectUrl)
      video.remove()
      resolve(blob)
    }
    // A video that never fires an event must not leave the upload waiting.
    const timer = setTimeout(() => done(null), 8000)

    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = objectUrl

    video.addEventListener('error', () => done(null))
    video.addEventListener('loadeddata', () => {
      // Never seek past the end — a clip shorter than the seek point would
      // otherwise never fire `seeked`.
      const target = Number.isFinite(video.duration) && video.duration > POSTER_SEEK_SEC
        ? POSTER_SEEK_SEC
        : 0
      if (video.currentTime === target) drawFrame()
      else {
        video.addEventListener('seeked', drawFrame, { once: true })
        try { video.currentTime = target } catch { done(null) }
      }
    })

    function drawFrame() {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return done(null)
        const scale = Math.min(1, POSTER_MAX_W / w)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return done(null)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => done(blob), 'image/jpeg', 0.78)
      } catch {
        done(null)
      }
    }
  })
}

/** Attach the poster to a clip that is already stored. Failure is silent. */
async function sendPoster(clipUrl: string, file: File) {
  try {
    const name = clipUrl.split('/').pop()
    if (!name) return
    const blob = await capturePoster(file)
    if (!blob) return
    await $fetch(`/api/uploads/poster?for=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    })
  } catch { /* a clip without a poster is fine */ }
}

/** Matches the server's ceiling, so an oversized file fails before it is sent. */
const MAX_BYTES = 1024 * 1024 * 1024
const MAX_LABEL = '1 GB'

const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const progress = ref(0)
const error = ref<string | null>(null)

/** Whether the field currently holds a clip that was uploaded here. */
const isUploaded = computed(() => props.modelValue.startsWith('/api/uploads/'))

function choose() {
  if (uploading.value || props.disabled) return
  input.value?.click()
}

function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0] ?? null
  // Cleared straight away so picking the same file twice still fires `change`.
  el.value = ''
  if (file) upload(file)
}

function upload(file: File) {
  error.value = null
  if (file.size > MAX_BYTES) {
    error.value = `That clip is larger than ${MAX_LABEL}.`
    return
  }

  /**
   * The file goes up as the raw request body, not as a multipart form.
   *
   * The server streams the body to disk a chunk at a time; a multipart body
   * would have to be buffered whole to be parsed, which at a gigabyte is enough
   * memory to kill the process. Nothing is lost by dropping the envelope — the
   * filename is discarded server-side anyway, and the type is read from the
   * bytes rather than from anything the request claims.
   */

  uploading.value = true
  progress.value = 0

  const xhr = new XMLHttpRequest()
  xhr.open('POST', '/api/uploads')
  xhr.upload.addEventListener('progress', (ev) => {
    if (ev.lengthComputable) progress.value = Math.round((ev.loaded / ev.total) * 100)
  })
  xhr.addEventListener('load', () => {
    uploading.value = false
    let payload: any = null
    // A rejection can come back as JSON from h3 or as an HTML error page from
    // something in front of it; neither should throw here.
    try { payload = JSON.parse(xhr.responseText) } catch { /* not JSON */ }
    if (xhr.status >= 200 && xhr.status < 300 && payload?.url) {
      progress.value = 100
      emit('update:modelValue', payload.url as string)
      // The date the file says it was recorded, for the verification field.
      if (typeof payload.recordedAt === 'string') emit('recorded-at', payload.recordedAt)
      // Not awaited: the clip is already usable, and the poster only affects a
      // thumbnail somewhere else later.
      void sendPoster(payload.url as string, file)
      return
    }
    error.value = payload?.statusMessage
      ?? payload?.message
      ?? (xhr.status === 413 ? `That clip is larger than ${MAX_LABEL}.` : `Upload failed (${xhr.status}).`)
  })
  xhr.addEventListener('error', () => {
    uploading.value = false
    error.value = 'Upload failed. Check your connection and try again.'
  })
  xhr.addEventListener('abort', () => { uploading.value = false })
  xhr.send(file)
}
</script>

<template>
  <div class="mt-1.5">
    <div class="flex items-center gap-2 flex-wrap">
      <input
        ref="input"
        type="file"
        accept="video/mp4,video/webm,.mp4,.webm"
        class="hidden"
        @change="onPick"
      />
      <button
        type="button"
        class="btn btn-sm btn-ghost"
        :disabled="uploading || disabled"
        @click="choose"
      >{{ uploading ? 'Uploading…' : (label ?? 'Upload a clip') }}</button>

      <span v-if="uploading" class="text-[11px] text-zinc-400 tabular-nums">{{ progress }}%</span>
      <span v-else-if="isUploaded" class="text-[11px] text-emerald-400">Clip uploaded — the link above points at it.</span>
      <span v-else class="text-[11px] text-zinc-600">MP4 or WebM, up to {{ MAX_LABEL }}.</span>
    </div>

    <!-- A determinate bar, because the percentage above is the only signal that
         a long upload is still moving. -->
    <div v-if="uploading" class="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
      <div
        class="h-full bg-accent transition-[width] duration-150"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <p v-if="error" class="mt-1.5 text-[11px] text-red-400">{{ error }}</p>
  </div>
</template>
