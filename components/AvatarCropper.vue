<script setup lang="ts">
/**
 * The avatar cropper.
 *
 * ## The model, and why the last two didn't work
 *
 * Both previous versions stored the framing as *where the image sits on the
 * stage*: a top-left offset and a scale, in the pixels the stage happens to be
 * drawn at. Everything then depended on that number being right — the minimum
 * zoom, the pan limits, where the pointer is, and the region that gets saved —
 * and it frequently wasn't. The stage is `width: 320px; max-width: 100%`, so on
 * a narrow window it is not 320 wide; the second version measured it, which
 * fixed the arithmetic but meant every resize had to *rescale the stored state*
 * to match, and a `ResizeObserver` firing before or after the image load
 * reordered that against the initial framing. Zoom, pan and save were three
 * things agreeing about a fourth that kept moving.
 *
 * This version stores the crop in the **source image's own coordinates**, and
 * nothing else:
 *
 *   `view`     the side of the visible square, in natural image pixels
 *   `cx`, `cy` the centre of that square, in natural image pixels
 *
 * That is the crop. It is exactly what `drawImage` needs, it is what the
 * previews describe, and it is completely independent of how big the stage is
 * on screen — so resizing the window, rotating a phone or opening the dialog
 * before layout has settled cannot move it, because none of them are inputs to
 * it. The stage size is used in one direction only: to *draw* this state, and
 * to convert a pointer position into image coordinates.
 *
 * Zoom is a reading of the same number (`viewMax / view`), not a second piece
 * of state that could disagree with it.
 *
 * ## The square, and the circle
 *
 * The output is square because avatars render as a rounded square on a profile
 * and a circle everywhere else, and a square is the only thing that is right in
 * both. The circle is drawn as a *guide* — nothing is clipped when saving.
 * Clipping to a circle and encoding as JPEG, which has no alpha, is what used
 * to bake black corners into every avatar.
 */
const props = defineProps<{
  open: boolean
  /** A data URL for the picture being cropped. */
  src: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void
  (e: 'saved'): void
}>()

/** The saved image's edge, in px. */
const OUT = 512
/** How far in you can go: the visible square shrinks to a sixth of its widest. */
const MAX_ZOOM = 6
/** The widest the stage is drawn; it may be narrower on a small screen. */
const MAX_STAGE = 320

const imgEl = ref<HTMLImageElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)

/** Natural size of the loaded image. Zero until it loads. */
const natW = ref(0)
const natH = ref(0)

/** The crop, in natural image pixels. This is the whole of the state. */
const view = ref(0)
const cx = ref(0)
const cy = ref(0)

const dragging = ref(false)
const ready = computed(() => natW.value > 0 && natH.value > 0 && view.value > 0)

/**
 * The stage's drawn size. Rendering only — never an input to the crop.
 *
 * Seeded to the maximum so the first frame is sane, then measured. If it is
 * ever wrong the picture is drawn at a slightly wrong size for one frame; it
 * cannot make the saved crop wrong, which is the point of the whole design.
 */
const stage = ref(MAX_STAGE)
let observer: ResizeObserver | null = null

function measure() {
  const el = stageEl.value
  if (!el) return
  const w = el.getBoundingClientRect().width
  if (w > 0) stage.value = w
}

watch(stageEl, (el) => {
  observer?.disconnect()
  observer = null
  if (!el || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(measure)
  observer.observe(el)
  measure()
})
onBeforeUnmount(() => { observer?.disconnect(); observer = null })

/** Zoomed all the way out: the largest square that fits inside the image. */
const viewMax = computed(() => Math.min(natW.value || 1, natH.value || 1))
const viewMin = computed(() => viewMax.value / MAX_ZOOM)

/** Natural pixels per stage pixel. */
const scale = computed(() => (view.value > 0 ? stage.value / view.value : 1))

/** 1× is the whole square; MAX_ZOOM is as close as it goes. */
const zoom = computed(() => (view.value > 0 ? viewMax.value / view.value : 1))

/**
 * Keep the visible square inside the image.
 *
 * `view` never exceeds the shorter edge, so both ranges are always valid — the
 * square can be pushed against an edge but never off one, and there is no case
 * where the clamp has to give up and leave a gap.
 */
function clamp() {
  const half = view.value / 2
  cx.value = Math.min(natW.value - half, Math.max(half, cx.value))
  cy.value = Math.min(natH.value - half, Math.max(half, cy.value))
}

function reset() {
  view.value = viewMax.value
  cx.value = natW.value / 2
  cy.value = natH.value / 2
  clamp()
}

function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natW.value = img.naturalWidth
  natH.value = img.naturalHeight
  measure()
  reset()
}

/** A point on the stage, in natural image coordinates. */
function toImage(px: number, py: number) {
  const half = stage.value / 2
  return {
    x: cx.value + (px - half) / scale.value,
    y: cy.value + (py - half) / scale.value,
  }
}

/**
 * Zoom so that `(px, py)` on the stage keeps showing the same part of the
 * picture. Zooming from the centre instead walks your subject out of frame
 * every time you scroll.
 */
function zoomTo(nextView: number, px = stage.value / 2, py = stage.value / 2) {
  if (!ready.value) return
  const target = Math.min(viewMax.value, Math.max(viewMin.value, nextView))
  if (target === view.value) return
  const anchor = toImage(px, py)
  const half = stage.value / 2
  view.value = target
  // Put the anchor back under the same stage point at the new scale.
  cx.value = anchor.x - (px - half) / (stage.value / target)
  cy.value = anchor.y - (py - half) / (stage.value / target)
  clamp()
}

/** The zoom slider works in zoom, which is the reciprocal of `view`. */
const zoomModel = computed({
  get: () => zoom.value,
  set: (z: number) => zoomTo(viewMax.value / Math.max(1, z)),
})

function stagePoint(e: { clientX: number; clientY: number }, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  const p = stagePoint(e, el)
  // Proportional steps, so a scroll feels the same at 1× as at 5×.
  zoomTo(view.value * (e.deltaY < 0 ? 1 / 1.12 : 1.12), p.x, p.y)
}

// Pointer events cover mouse, pen and touch in one path.
const pointers = new Map<number, { x: number; y: number }>()
let pinchDist = 0
let dragFrom = { x: 0, y: 0, cx: 0, cy: 0 }

function onPointerDown(e: PointerEvent) {
  if (!ready.value) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) {
    dragging.value = true
    dragFrom = { x: e.clientX, y: e.clientY, cx: cx.value, cy: cy.value }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    dragging.value = false
  }
}

function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId) || !ready.value) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const el = e.currentTarget as HTMLElement

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    if (pinchDist > 0 && dist > 0) {
      const mid = stagePoint({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 }, el)
      zoomTo(view.value * (pinchDist / dist), mid.x, mid.y)
    }
    pinchDist = dist
    return
  }

  if (!dragging.value) return
  // Dragging right moves the picture right, which moves the *window over it*
  // left — hence the subtraction. Distances convert through the current scale,
  // so a drag tracks the pointer exactly at any zoom.
  cx.value = dragFrom.cx - (e.clientX - dragFrom.x) / scale.value
  cy.value = dragFrom.cy - (e.clientY - dragFrom.y) / scale.value
  clamp()
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchDist = 0
  if (pointers.size === 0) dragging.value = false
}

/** Arrow keys nudge by a stage pixel; shift moves ten. `0` resets. */
function onKeydown(e: KeyboardEvent) {
  if (!ready.value) return
  const step = (e.shiftKey ? 10 : 1) / scale.value
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
  }
  const m = moves[e.key]
  if (m) {
    e.preventDefault()
    cx.value += m[0]
    cy.value += m[1]
    clamp()
    return
  }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(view.value / 1.12) }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(view.value * 1.12) }
  else if (e.key === '0') { e.preventDefault(); reset() }
}

function onDoubleClick(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const p = stagePoint(e, el)
  // Back to fit once you are all the way in, so a double-click always does
  // something rather than silently hitting the ceiling.
  if (zoom.value >= MAX_ZOOM - 0.01) reset()
  else zoomTo(view.value / 2, p.x, p.y)
}

/**
 * How the image is drawn on the stage: derived from the crop, every time.
 *
 * There is no second copy of the framing to keep in step — this *is* the state,
 * read through the current stage size.
 */
const imageStyle = computed(() => {
  const s = scale.value
  const half = stage.value / 2
  return {
    position: 'absolute' as const,
    left: `${half - cx.value * s}px`,
    top: `${half - cy.value * s}px`,
    width: `${natW.value * s}px`,
    height: `${natH.value * s}px`,
    userSelect: 'none' as const,
    pointerEvents: 'none' as const,
  }
})

/** The same framing at a preview's size — one shared derivation, one truth. */
function previewStyle(size: number) {
  const s = view.value > 0 ? size / view.value : 1
  return {
    position: 'absolute' as const,
    left: `${size / 2 - cx.value * s}px`,
    top: `${size / 2 - cy.value * s}px`,
    width: `${natW.value * s}px`,
    height: `${natH.value * s}px`,
    pointerEvents: 'none' as const,
  }
}

// --- Saving ---
const uploading = ref(false)
const error = ref<string | null>(null)

function close() {
  if (uploading.value) return
  emit('update:open', false)
}

async function save() {
  const img = imgEl.value
  if (!img || !ready.value || uploading.value) return
  uploading.value = true
  error.value = null

  // Read the framing before anything can re-render. The <img> lives inside the
  // dialog's `v-if`, so closing first and reading after is one microtask away
  // from drawing a detached node.
  const v = view.value
  const sx = cx.value - v / 2
  const sy = cy.value - v / 2

  try {
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // JPEG has no alpha; without this any gap would encode as black.
    ctx.fillStyle = '#18181b'
    ctx.fillRect(0, 0, OUT, OUT)
    // The crop is already in the image's own pixels, so this is a direct read
    // with no display size anywhere in it.
    ctx.drawImage(img, sx, sy, v, v, 0, 0, OUT, OUT)

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Could not read that picture.')

    const fd = new FormData()
    fd.append('avatar', blob, 'avatar.jpg')
    await $fetch('/api/account/avatar', { method: 'POST', body: fd })
    emit('saved')
    emit('update:open', false)
  } catch (e: any) {
    // The dialog stays open, so a failed upload doesn't lose the framing.
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Upload failed.'
  } finally {
    uploading.value = false
  }
}

/** A new picture starts fresh rather than inheriting the last one's framing. */
watch(() => props.src, () => {
  natW.value = 0
  natH.value = 0
  view.value = 0
  error.value = null
  pointers.clear()
  dragging.value = false
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Crop your profile picture"
      @click.self="close"
    >
      <div class="modal-panel p-5 w-full max-w-md space-y-4">
        <div>
          <h2 class="text-sm font-semibold text-zinc-100">Profile picture</h2>
          <p class="text-[11px] text-zinc-500 mt-0.5">
            Drag to reposition · scroll or pinch to zoom · double-click to zoom in
          </p>
        </div>

        <!-- The stage.
             `aspect-ratio` rather than a fixed height: the width is capped but
             can be smaller on a narrow window, and a fixed height would make
             this a rectangle while the crop it displays is a square. -->
        <div
          ref="stageEl"
          class="relative mx-auto bg-black overflow-hidden select-none touch-none rounded-2xl ring-1 ring-zinc-700 focus:outline-none focus:ring-2 focus:ring-accent"
          :style="{ width: MAX_STAGE + 'px', maxWidth: '100%', aspectRatio: '1 / 1' }"
          :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
          tabindex="0"
          role="application"
          aria-label="Crop area. Drag to reposition, arrow keys to nudge, plus and minus to zoom"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
          @dblclick="onDoubleClick"
          @keydown="onKeydown"
        >
          <img
            v-if="src"
            ref="imgEl"
            :src="src"
            alt=""
            draggable="false"
            :style="ready ? imageStyle : { opacity: 0 }"
            @load="onImgLoad"
          />

          <!-- Circle guide: what the round contexts will keep, without removing
               the corners the square ones still show. A circular element with a
               large outward shadow dims everything outside it; the stage's own
               overflow-hidden clips that shadow to the square. -->
          <div
            class="absolute inset-0 rounded-full ring-2 ring-accent/70 pointer-events-none"
            style="box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45)"
            aria-hidden="true"
          />
          <div v-if="dragging" class="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div class="absolute inset-y-0 left-1/3 w-px bg-white/20" />
            <div class="absolute inset-y-0 left-2/3 w-px bg-white/20" />
            <div class="absolute inset-x-0 top-1/3 h-px bg-white/20" />
            <div class="absolute inset-x-0 top-2/3 h-px bg-white/20" />
          </div>
        </div>

        <!-- Live previews at the sizes avatars are actually used. Drawn from
             the same crop, so they cannot disagree with what gets saved. -->
        <div v-if="ready" class="flex items-center justify-center gap-4">
          <div class="flex flex-col items-center gap-1">
            <div class="relative w-16 h-16 rounded-full overflow-hidden bg-black ring-1 ring-zinc-700">
              <img :src="src!" alt="" :style="previewStyle(64)" draggable="false" />
            </div>
            <span class="text-[9px] uppercase tracking-widest text-zinc-600">Feed</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="relative w-16 h-16 rounded-xl overflow-hidden bg-black ring-1 ring-zinc-700">
              <img :src="src!" alt="" :style="previewStyle(64)" draggable="false" />
            </div>
            <span class="text-[9px] uppercase tracking-widest text-zinc-600">Profile</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="relative w-7 h-7 rounded-full overflow-hidden bg-black ring-1 ring-zinc-700">
              <img :src="src!" alt="" :style="previewStyle(28)" draggable="false" />
            </div>
            <span class="text-[9px] uppercase tracking-widest text-zinc-600">Header</span>
          </div>
        </div>

        <div class="flex items-end gap-3">
          <label class="flex-1 min-w-0">
            <span class="flex items-baseline justify-between text-[11px] uppercase tracking-widest text-zinc-500">
              Zoom
              <span class="tabular-nums normal-case tracking-normal text-zinc-600">{{ zoom.toFixed(1) }}×</span>
            </span>
            <!-- Bound to zoom, which is a reading of the crop rather than a
                 second copy of it — so the thumb cannot drift out of step with
                 what a scroll or a pinch just did. -->
            <input
              v-model.number="zoomModel"
              type="range"
              :min="1"
              :max="MAX_ZOOM"
              step="0.01"
              :disabled="!ready"
              class="w-full mt-1 accent-accent"
              aria-label="Zoom"
            />
          </label>
          <button
            type="button"
            :disabled="!ready"
            class="btn btn-sm btn-ghost shrink-0"
            title="Reset zoom and position"
            @click="reset"
          >Reset</button>
        </div>

        <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

        <div class="flex gap-2 pt-1">
          <button
            type="button"
            :disabled="uploading || !ready"
            class="btn btn-md btn-primary flex-1"
            @click="save"
          >{{ uploading ? 'Saving…' : 'Save picture' }}</button>
          <button
            type="button"
            :disabled="uploading"
            class="btn btn-md btn-ghost"
            @click="close"
          >Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
