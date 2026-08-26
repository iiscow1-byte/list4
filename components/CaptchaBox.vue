<script setup lang="ts">
/**
 * The captcha widget, if the site has one configured.
 *
 * Renders nothing when it doesn't — which is the normal state of a fresh
 * install and of local development — so the forms can include this
 * unconditionally rather than each deciding whether to.
 *
 * The provider's script is loaded on demand, once, and only on a page that
 * actually shows a widget. Putting it in the app's head would mean every reader
 * of the level list fetching a third-party script for a form they will visit
 * once.
 */
const emit = defineEmits<{ (e: 'update:token', token: string): void }>()

type Config = { enabled: boolean; provider: 'turnstile' | 'hcaptcha' | null; siteKey: string | null }

// Server-rendered so the widget is present in the first paint rather than
// popping in after hydration on a form somebody is already typing into.
const { data: config } = await useFetch<Config>('/api/site/captcha')

const container = ref<HTMLElement | null>(null)
const failed = ref(false)
const widgetId = ref<string | number | null>(null)

const SCRIPTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
} as const

/** Load a script once per page, and resolve when it is ready. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === '1') resolve()
      else {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('script failed')), { once: true })
      }
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.defer = true
    el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve() }, { once: true })
    el.addEventListener('error', () => reject(new Error('script failed')), { once: true })
    document.head.appendChild(el)
  })
}

onMounted(async () => {
  const cfg = config.value
  if (!cfg?.enabled || !cfg.provider || !cfg.siteKey || !container.value) return

  try {
    await loadScript(SCRIPTS[cfg.provider])
    // Both providers expose the same three methods under different globals.
    const api = (window as any)[cfg.provider === 'turnstile' ? 'turnstile' : 'hcaptcha']
    if (!api?.render) throw new Error('captcha api missing')

    widgetId.value = api.render(container.value, {
      sitekey: cfg.siteKey,
      theme: 'dark',
      callback: (token: string) => emit('update:token', token),
      // A token is single-use and short-lived. Clearing ours on expiry stops
      // the form submitting one the server will reject.
      'expired-callback': () => emit('update:token', ''),
      'error-callback': () => { failed.value = true; emit('update:token', '') },
    })
  } catch {
    failed.value = true
  }
})

/**
 * Throw the solved token away and ask for another.
 *
 * Called by the form after a failed submit: a token is spent whether or not the
 * request it accompanied succeeded, so retrying with the same one always fails.
 */
function reset() {
  const cfg = config.value
  if (!cfg?.provider || widgetId.value == null) return
  const api = (window as any)[cfg.provider === 'turnstile' ? 'turnstile' : 'hcaptcha']
  try {
    api?.reset?.(widgetId.value)
    emit('update:token', '')
  } catch { /* the widget will time out on its own */ }
}

defineExpose({ reset, enabled: computed(() => !!config.value?.enabled) })
</script>

<template>
  <div v-if="config?.enabled" class="space-y-1.5">
    <div ref="container" />
    <p v-if="failed" class="text-[11px] text-amber-400">
      Captcha didn't load. Check that nothing is blocking
      <span class="text-zinc-400">{{ config.provider === 'turnstile' ? 'challenges.cloudflare.com' : 'hcaptcha.com' }}</span>,
      then reload.
    </p>
  </div>
</template>
