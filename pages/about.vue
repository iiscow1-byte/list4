<script setup lang="ts">
useHead({ title: 'About — All Levels List' })
</script>

<template>
  <div class="container-tight py-8 max-w-3xl">
    <h1 class="text-3xl font-semibold tracking-tight">About</h1>
    <p class="text-zinc-400 mt-2 text-sm">What this list is and how it works.</p>

    <div class="mt-8 space-y-6 text-sm leading-relaxed text-zinc-300">
      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">What is the All Levels List?</h2>
        <p>
          The All Levels List is a community-maintained ranking covering tens of thousands of levels.
          The goal is to extend the AREDL model — strict ranking, verified records, points-based leaderboard —
          beyond extreme demons to the entire spectrum of levels worth playing.
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">How are levels ranked?</h2>
        <p>
          Each level has a fixed position. The top of the list is the hardest; positions further down
          award proportionally fewer points. Position changes are decided by the list team based on
          submitted placement requests and discussion.
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">How is the leaderboard calculated?</h2>
        <p>
          Every verified 100% completion of a ranked level awards points based on that level's
          position. Your total is the sum of points from every ranked level you've beaten —
          completions on legacy levels (beyond the scoring cutoff) award no points but still count
          toward the level's record list.
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">Submitting a record</h2>
        <p>
          Records are submitted to the list team for verification. Every completion needs a video
          covering the entire run from the listed minimum percentage onward, and the player on the
          record must match their list-tracked account.
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">Credits</h2>
        <p>
          The list and its tooling are inspired by
          <a href="https://aredl.net" class="text-accent hover:underline">aredl.net</a>
          and the broader Geometry Dash list community.
          Source code lineage:
          <a href="https://github.com/All-Rated-Extreme-Demon-List" class="text-accent hover:underline">
            All-Rated-Extreme-Demon-List on GitHub
          </a>.
        </p>
      </section>
    </div>
  </div>
</template>
