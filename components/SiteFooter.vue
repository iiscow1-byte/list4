<script setup lang="ts">
import { SITE_VERSION, versionLabel } from '~/utils/site-updates'
import { SITE_SOCIALS } from '~/utils/site-nav'
import { ALL_SHEET_URL } from '~/utils/sheet'

const { t } = useLocale()
</script>

<template>
  <footer class="mt-16 border-t border-zinc-800">
    <div class="container-wide py-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between text-sm">
      <div class="space-y-1.5">
        <AllLogo :size="24" wordmark />
        <p class="text-zinc-500">
          List data by <span class="text-zinc-300">Cinder</span>.
          Website by <span class="text-zinc-300">GERG, cinnamings, Silk and Farm</span>.
        </p>
        <p class="text-zinc-600 text-xs">
          Not affiliated with RobTop Games.
          <NuxtLink to="/updates" class="hover:text-zinc-400" :title="t('List updates')">{{ versionLabel(SITE_VERSION) }}</NuxtLink>
        </p>
      </div>

      <div class="flex flex-col gap-3 sm:items-end">
        <nav class="flex flex-wrap gap-x-4 gap-y-1 text-zinc-400" aria-label="Footer">
          <NuxtLink to="/about" class="hover:text-zinc-100">{{ t('About') }}</NuxtLink>
          <NuxtLink to="/changelog" class="hover:text-zinc-100">{{ t('Changelog') }}</NuxtLink>
          <NuxtLink to="/updates" class="hover:text-zinc-100">{{ t('List updates') }}</NuxtLink>
          <a :href="ALL_SHEET_URL" target="_blank" rel="noopener noreferrer" class="hover:text-zinc-100">{{ t('The ALL sheet') }}</a>
        </nav>
        <div class="flex items-center gap-3">
          <a
            v-for="s in SITE_SOCIALS"
            :key="s.label"
            :href="s.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-zinc-500 hover:text-zinc-200 transition-colors"
            :aria-label="s.label"
            :title="s.label"
          ><SocialIcon :name="s.label" class="w-[18px] h-[18px]" /></a>
        </div>
      </div>
    </div>
  </footer>
</template>
