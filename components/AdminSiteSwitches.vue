<script setup lang="ts">
/**
 * Registration and site access, as two switches.
 *
 * They are the same kind of decision at two strengths: one stops new people
 * joining, the other stops everyone reading. In the situation where you reach
 * for either you want to see both, and they are the settings most worth
 * reaching in a hurry, so they sit on the Overview rather than at the top of
 * the account list.
 *
 * Both values come from `/api/auth/me`, which already reports them for the
 * login and signup pages, so these agree with what those pages do.
 */
const { data: meRes, refresh: refreshMe } = useCurrentUser()
const toast = useAdminToast()
const { confirm } = useConfirmDialog()

const signupsOpen = computed(() => !!meRes.value?.site?.signupsEnabled)
const siteOpen = computed(() => !meRes.value?.site?.adminOnly)
const busy = ref<'signups' | 'admin_only' | null>(null)

async function save(setting: 'signups' | 'admin_only', enabled: boolean) {
  busy.value = setting
  try {
    await $fetch('/api/admin/signups', { method: 'POST', body: { setting, enabled } })
    await refreshMe()
    return true
  } catch (e) {
    toast.fail(e, 'Could not change that.')
    return false
  } finally {
    busy.value = null
  }
}

async function setSignups(open: boolean) {
  if (busy.value || open === signupsOpen.value) return
  if (!open && !(await confirm({
    title: 'Close registration?',
    message: 'Nobody new will be able to make an account. Existing accounts still sign in.',
    confirmLabel: 'Close registration',
    tone: 'danger',
  }))) return
  if (await save('signups', open)) toast.ok(open ? 'Registration is open.' : 'Registration is closed.')
}

async function setSiteOpen(open: boolean) {
  if (busy.value || open === siteOpen.value) return
  if (!open && !(await confirm({
    title: 'Make the site staff-only?',
    message: 'Everyone else gets the locked page, signed in or not.',
    confirmLabel: 'Close the site',
    tone: 'danger',
  }))) return
  // The stored setting is `admin_only`, the inverse of "open".
  if (await save('admin_only', !open)) toast.ok(open ? 'The site is open to everyone.' : 'The site is staff-only.')
}

const signupsModel = computed({ get: () => signupsOpen.value, set: (v: boolean) => { setSignups(v) } })
const siteModel = computed({ get: () => siteOpen.value, set: (v: boolean) => { setSiteOpen(v) } })
</script>

<template>
  <ul class="card divide-y divide-zinc-800/80">
    <li class="flex items-center gap-3 px-4 py-3">
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-medium text-zinc-100">Site access</span>
        <span class="block text-xs text-zinc-500 mt-0.5">
          {{ siteOpen ? 'Anyone can read the site.' : 'Staff only. Everyone else sees the locked page.' }}
        </span>
      </span>
      <span class="text-xs font-medium" :class="siteOpen ? 'text-emerald-400' : 'text-amber-300'">
        {{ siteOpen ? 'Public' : 'Staff only' }}
      </span>
      <ToggleSwitch v-model="siteModel" aria-label="Site is public" :class="{ 'opacity-50 pointer-events-none': busy === 'admin_only' }" />
    </li>
    <li class="flex items-center gap-3 px-4 py-3">
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-medium text-zinc-100">Registration</span>
        <span class="block text-xs text-zinc-500 mt-0.5">
          {{ signupsOpen ? 'Anyone can make an account.' : 'Closed. Existing accounts still sign in.' }}
        </span>
      </span>
      <span class="text-xs font-medium" :class="signupsOpen ? 'text-emerald-400' : 'text-zinc-500'">
        {{ signupsOpen ? 'Open' : 'Closed' }}
      </span>
      <ToggleSwitch v-model="signupsModel" aria-label="Registration is open" :class="{ 'opacity-50 pointer-events-none': busy === 'signups' }" />
    </li>
  </ul>
</template>
