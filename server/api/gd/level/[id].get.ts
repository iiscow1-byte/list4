export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid level id' })
  }

  let raw: any
  try {
    raw = await $fetch(`https://gdbrowser.com/api/level/${id}`, {
      headers: { 'User-Agent': 'all-levels-list/1.0' },
      timeout: 8000,
    })
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: 'Geometry Dash API unavailable' })
  }

  if (!raw || raw === '-1' || typeof raw !== 'object') {
    throw createError({ statusCode: 404, statusMessage: 'Level not found on GD servers' })
  }

  const customSong = Number(raw.customSong) || 0
  const song = customSong
    ? [raw.songName, raw.songAuthor].filter(Boolean).join(' — ') || null
    : (raw.officialSong || null)

  const passwordRaw = String(raw.password ?? '')
  const password = passwordRaw && passwordRaw !== '0' ? passwordRaw : null

  const stars = Number(raw.stars) || 0
  const featured = !!raw.featured
  const epicNum = Number(raw.epic) || 0
  const isEpic = epicNum >= 1 || raw.epic === true
  const isLegendary = !!raw.legendary || epicNum === 2
  const isMythic = !!raw.mythic || epicNum === 3
  // GD rated tier — 0=Unrated, 1=Rated, 2=Featured, 3=Epic, 4=Legendary, 5=Mythic
  let score = 0
  if (isMythic) score = 5
  else if (isLegendary) score = 4
  else if (isEpic) score = 3
  else if (featured) score = 2
  else if (stars > 0) score = 1

  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')

  return {
    id: Number(raw.id) || id,
    name: raw.name ?? null,
    author: raw.author ?? null,
    description: typeof raw.description === 'string' ? raw.description : null,
    downloads: Number(raw.downloads) || 0,
    likes: Number(raw.likes) || 0,
    length: raw.length ?? null,
    objects: Number(raw.objects) || 0,
    objectsApprox: !!raw.large,
    coins: Number(raw.coins) || 0,
    verifiedCoins: !!raw.verifiedCoins,
    score,
    song: {
      name: song,
      id: customSong || null,
      custom: !!customSong,
    },
    password,
  }
})
