<script setup lang="ts">
/**
 * Discord messages, drawn roughly the way Discord draws them, from the exact
 * payloads the site would send.
 *
 * The markdown is parsed into pieces here rather than rendered as HTML: level
 * and player names are user text, and nothing from a payload is ever put on
 * the page as markup.
 */
type Field = { name: string; value: string; inline?: boolean }
type Embed = {
  author?: { name?: string; url?: string; icon_url?: string }
  title?: string
  url?: string
  description?: string
  color?: number
  fields?: Field[]
  thumbnail?: { url?: string }
  footer?: { text?: string; icon_url?: string }
  timestamp?: string
}
type Payload = { content?: string; embeds?: Embed[] }

defineProps<{ payloads: Payload[]; name?: string }>()

type Piece =
  | { t: 'text'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'bold' | 'strike' | 'code'; v: string }
  | { t: 'mention'; v: string }

const unescape = (s: string) => s.replace(/\\([\\*_~`|[\]<>])/g, '$1')
const TOKEN = /\[((?:\\.|[^\]\\])+)\]\((https?:\/\/[^)\s]+)\)|\*\*((?:\\.|[^*\\])+)\*\*|~~((?:\\.|[^~\\])+)~~|`([^`]+)`|<@&(\d+)>/g

function parse(line: string): Piece[] {
  const out: Piece[] = []
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ t: 'text', v: unescape(line.slice(last, m.index)) })
    if (m[1] != null) out.push({ t: 'link', v: unescape(m[1]), href: m[2]! })
    else if (m[3] != null) out.push({ t: 'bold', v: unescape(m[3]) })
    else if (m[4] != null) out.push({ t: 'strike', v: unescape(m[4]) })
    else if (m[5] != null) out.push({ t: 'code', v: m[5] })
    else if (m[6] != null) out.push({ t: 'mention', v: m[6] })
    last = m.index! + m[0].length
  }
  if (last < line.length) out.push({ t: 'text', v: unescape(line.slice(last)) })
  return out
}
const lines = (s: string | undefined) => (s ?? '').split('\n').map(parse)

const hex = (c: number | undefined) => (c == null ? '#4f545c' : `#${c.toString(16).padStart(6, '0')}`)
const when = (ts: string | undefined) => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
</script>

<template>
  <div class="space-y-4">
    <div v-for="(p, pi) in payloads" :key="pi" class="flex gap-3">
      <img src="/icon-180.png" alt="" class="w-10 h-10 rounded-full shrink-0 bg-zinc-800" />
      <div class="min-w-0 flex-1">
        <p class="text-sm">
          <span class="font-semibold text-zinc-100">{{ name || 'All Levels List' }}</span>
          <span class="ml-1.5 text-[10px] font-semibold px-1 py-px rounded bg-indigo-500 text-white align-middle">APP</span>
          <span v-if="payloads.length > 1" class="ml-2 text-[11px] text-zinc-500">message {{ pi + 1 }} of {{ payloads.length }}</span>
        </p>
        <p v-if="p.content" class="text-sm text-zinc-200 mt-0.5">
          <template v-for="(pc, i) in parse(p.content)" :key="i">
            <span v-if="pc.t === 'mention'" class="rounded px-0.5 bg-indigo-500/25 text-indigo-200 font-medium">@role {{ pc.v }}</span>
            <template v-else>{{ pc.v }}</template>
          </template>
        </p>

        <div
          v-for="(e, ei) in p.embeds ?? []"
          :key="ei"
          class="mt-1.5 max-w-[32rem] rounded border-l-4 bg-zinc-900 px-3 py-2.5 grid gap-x-3"
          :class="e.thumbnail?.url ? 'grid-cols-[minmax(0,1fr)_80px]' : 'grid-cols-1'"
          :style="{ borderLeftColor: hex(e.color) }"
        >
          <div class="min-w-0">
            <p v-if="e.author?.name" class="flex items-center gap-2 text-xs font-semibold text-zinc-100 mb-1">
              <img v-if="e.author.icon_url" :src="e.author.icon_url" alt="" class="w-5 h-5 rounded-full" referrerpolicy="no-referrer" />
              {{ e.author.name }}
            </p>
            <p v-if="e.title" class="text-sm font-semibold mb-1" :class="e.url ? 'text-sky-400' : 'text-zinc-100'">{{ e.title }}</p>
            <div v-if="e.description" class="text-[13px] leading-[1.35rem] text-zinc-300 break-words">
              <p v-for="(ln, li) in lines(e.description)" :key="li" class="min-h-[1.35rem]">
                <template v-for="(pc, i) in ln" :key="i">
                  <a v-if="pc.t === 'link'" :href="pc.href" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline">{{ pc.v }}</a>
                  <strong v-else-if="pc.t === 'bold'" class="font-semibold text-zinc-100">{{ pc.v }}</strong>
                  <s v-else-if="pc.t === 'strike'">{{ pc.v }}</s>
                  <code v-else-if="pc.t === 'code'" class="rounded bg-zinc-950 px-1 py-px text-[12px] font-mono text-zinc-200">{{ pc.v }}</code>
                  <template v-else>{{ pc.v }}</template>
                </template>
              </p>
            </div>
            <div v-if="e.fields?.length" class="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
              <div v-for="(f, fi) in e.fields" :key="fi" :class="f.inline ? '' : 'col-span-3'">
                <p class="text-xs font-semibold text-zinc-100">{{ f.name }}</p>
                <p class="text-[13px] text-zinc-300">
                  <template v-for="(pc, i) in parse(f.value)" :key="i">
                    <a v-if="pc.t === 'link'" :href="pc.href" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline">{{ pc.v }}</a>
                    <template v-else>{{ pc.v }}</template>
                  </template>
                </p>
              </div>
            </div>
            <p v-if="e.footer?.text || e.timestamp" class="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <img v-if="e.footer?.icon_url" :src="e.footer.icon_url" alt="" class="w-4 h-4 rounded-full" />
              <span>{{ e.footer?.text }}<template v-if="e.footer?.text && e.timestamp"> • </template>{{ when(e.timestamp) }}</span>
            </p>
          </div>
          <img v-if="e.thumbnail?.url" :src="e.thumbnail.url" alt="" class="w-20 h-20 rounded object-cover" loading="lazy" referrerpolicy="no-referrer" />
        </div>
      </div>
    </div>
  </div>
</template>
