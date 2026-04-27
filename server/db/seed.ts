import { getDb, pointsForPosition } from './index.ts'

const LEVEL_COUNT = 500
const PLAYER_COUNT = 120
const RECORDS_PER_PLAYER_AVG = 18

const ADJECTIVES = ['Crimson', 'Azure', 'Hollow', 'Silent', 'Ember', 'Frost', 'Ivory', 'Obsidian', 'Solar', 'Lunar', 'Verdant', 'Cobalt', 'Phantom', 'Glacial', 'Radiant', 'Static', 'Vivid', 'Sable', 'Stellar', 'Arcane']
const NOUNS = ['Sanctum', 'Requiem', 'Cascade', 'Apex', 'Genesis', 'Eclipse', 'Vortex', 'Paragon', 'Citadel', 'Reverie', 'Bastion', 'Helix', 'Inferno', 'Mirage', 'Nexus', 'Odyssey', 'Pulse', 'Quasar', 'Rift', 'Spire']
const SUFFIXES = ['', ' II', ' III', ' Reborn', ' Redux', ' Zero', ' Prime', ' X']
const CREATORS = ['Knobbelboy', 'Quasar', 'Spu7nix', 'Pennutoh', 'Wabbit', 'Aeonair', 'Trick', 'Cobalt', 'TheRealSailent', 'Optical', 'Diamond', 'Riot', 'Zoink', 'GD Jose', 'Serponge', 'TrusTa', 'Glittershroom', 'Mulpan', 'Findexi', 'CastriX']
const COUNTRIES = ['US', 'CA', 'GB', 'DE', 'FR', 'PL', 'BR', 'JP', 'KR', 'AU', 'NL', 'SE', 'NO', 'FI', 'CL', 'AR', 'MX', 'ES', 'IT', 'RU', 'UA', 'CZ', 'TR']

function rand(seed: { v: number }) {
  let t = (seed.v += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function pick<T>(rng: { v: number }, arr: T[]): T {
  return arr[Math.floor(rand(rng) * arr.length)]!
}
function int(rng: { v: number }, min: number, max: number) {
  return Math.floor(rand(rng) * (max - min + 1)) + min
}

function uniqueLevelNames(rng: { v: number }, n: number): string[] {
  const used = new Set<string>()
  const out: string[] = []
  while (out.length < n) {
    const name = `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}${pick(rng, SUFFIXES)}`
    if (!used.has(name)) {
      used.add(name)
      out.push(name)
    }
  }
  return out
}

function uniquePlayerNames(rng: { v: number }, n: number): string[] {
  const used = new Set<string>()
  const out: string[] = []
  const handles = ['gd', 'pro', 'xX', 'the', 'lil', 'real', 'mr', 'dr']
  while (out.length < n) {
    const base = `${pick(rng, ADJECTIVES)}${pick(rng, NOUNS)}`
    const handle = rand(rng) < 0.4 ? pick(rng, handles) : ''
    const num = rand(rng) < 0.5 ? String(int(rng, 1, 999)) : ''
    const name = `${handle}${base}${num}`
    if (!used.has(name)) {
      used.add(name)
      out.push(name)
    }
  }
  return out
}

function main() {
  const db = getDb()
  const existing = db.prepare('SELECT COUNT(*) as n FROM levels').get() as { n: number }
  if (existing.n > 0) {
    console.log(`Database already has ${existing.n} levels. Skipping seed. (Delete data/list.db to re-seed.)`)
    return
  }

  const rng = { v: 1337 }
  const levelNames = uniqueLevelNames(rng, LEVEL_COUNT)
  const playerNames = uniquePlayerNames(rng, PLAYER_COUNT)

  const insertLevel = db.prepare(
    `INSERT INTO levels (id, position, name, creator, verifier, verification, song, gd_id, min_percent, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertPlayer = db.prepare(`INSERT INTO players (id, name, country) VALUES (?, ?, ?)`)
  const getMinPercent = db.prepare('SELECT min_percent FROM levels WHERE id = ?')
  const insertRecord = db.prepare(
    `INSERT OR IGNORE INTO records (level_id, player_id, percent, hz, video, verified)
     VALUES (?, ?, ?, ?, ?, 1)`,
  )

  db.exec('BEGIN')
  try {
    for (let i = 0; i < LEVEL_COUNT; i++) {
      insertLevel.run(
        i + 1,
        i + 1,
        levelNames[i]!,
        pick(rng, CREATORS),
        pick(rng, playerNames),
        `https://youtu.be/dQw4w9Wg${(1000 + i).toString(36).padStart(3, '0').slice(0, 3)}`,
        `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)} - ${pick(rng, CREATORS)}`,
        80_000_000 + i,
        i < 50 ? 100 : i < 200 ? int(rng, 60, 100) : int(rng, 40, 100),
        JSON.stringify([pick(rng, ['Memory', 'Tight Spaces', 'Wave', 'Speed', 'Boss Fight', 'Long', 'Fingerbuster'])]),
      )
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      insertPlayer.run(i + 1, playerNames[i]!, pick(rng, COUNTRIES))
    }
    for (let pid = 1; pid <= PLAYER_COUNT; pid++) {
      const count = Math.max(1, Math.round(RECORDS_PER_PLAYER_AVG * (0.3 + rand(rng) * 1.4)))
      const seen = new Set<number>()
      for (let k = 0; k < count; k++) {
        const lvl = Math.min(LEVEL_COUNT, 1 + Math.floor(Math.pow(rand(rng), 0.6) * LEVEL_COUNT))
        if (seen.has(lvl)) continue
        seen.add(lvl)
        const min = getMinPercent.get(lvl) as { min_percent: number }
        const percent = rand(rng) < 0.55 ? 100 : int(rng, min.min_percent, 100)
        insertRecord.run(lvl, pid, percent, pick(rng, [60, 120, 144, 165, 240]), `https://youtu.be/r${pid}_${lvl}`)
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  const levelN = (db.prepare('SELECT COUNT(*) as n FROM levels').get() as { n: number }).n
  const playerN = (db.prepare('SELECT COUNT(*) as n FROM players').get() as { n: number }).n
  const recordN = (db.prepare('SELECT COUNT(*) as n FROM records').get() as { n: number }).n
  console.log(`Seeded ${levelN} levels, ${playerN} players, ${recordN} records.`)
  console.log(`Top of list scores ~${pointsForPosition(1, { listSize: levelN })} points; rank ${levelN} scores ~${pointsForPosition(levelN, { listSize: levelN })}.`)
}

main()
