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
          The All Levels List (the ALL) is a demonlist made by
          <a href="https://discord.com" class="text-accent hover:underline">@shindadokunoroi</a>
          on Discord that combines many demonlists to create a general idea of what a list with everything
          combined would look like. This site mirrors the public spreadsheet — over 50,000 levels — into a
          searchable AREDL-style interface.
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">How are levels ranked?</h2>
        <p>
          Each level has a fixed global placement and a points value. The top of the list (Extreme Demons,
          Tier 39+) carries six-figure points; lower tiers are flat-pointed inside their bracket. The
          underlying source list is shown on every level page (Global, EDI, GDDL, LoERL, etc.).
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">Where does the data come from?</h2>
        <p>
          Data is pulled directly from the public Google Sheet that maintains the list. Each tab on the
          sheet (Extreme Demons, Tier 4 Demons, Subtier 5 Harder, etc.) is imported as a slice of the
          global ranking. Re-running the importer refreshes everything in place.
        </p>
      </section>

      <section>
        <h2 class="text-lg font-mono text-zinc-100 mb-2">Credits</h2>
        <p>
          List and tooling inspired by
          <a href="https://aredl.net" class="text-accent hover:underline">aredl.net</a>
          and the broader Geometry Dash list community. Source code lineage:
          <a href="https://github.com/All-Rated-Extreme-Demon-List" class="text-accent hover:underline">
            All-Rated-Extreme-Demon-List on GitHub
          </a>.
        </p>
      </section>
    </div>
  </div>
</template>
