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
 * do: report upload progress. A 64 MB clip on a home connection is a minute of
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

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

/** Matches the server's ceiling, so an oversized file fails before it is sent. */
const MAX_BYTES = 64 * 1024 * 1024

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
    error.value = 'That clip is larger than 64 MB.'
    return
  }

  const body = new FormData()
  body.append('file', file, file.name)

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
      return
    }
    error.value = payload?.statusMessage
      ?? payload?.message
      ?? (xhr.status === 413 ? 'That clip is larger than 64 MB.' : `Upload failed (${xhr.status}).`)
  })
  xhr.addEventListener('error', () => {
    uploading.value = false
    error.value = 'Upload failed. Check your connection and try again.'
  })
  xhr.addEventListener('abort', () => { uploading.value = false })
  xhr.send(body)
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
      <span v-else class="text-[11px] text-zinc-600">MP4 or WebM, up to 64 MB.</span>
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
