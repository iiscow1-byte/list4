/**
 * Color maps for the additional-stats boxes on the landing page,
 * lifted from the source sheet's CSS so the front page stays visually
 * consistent with the spreadsheet.
 */

export const YEAR_COLORS: Record<string, string> = {
  '2013': '#c0faff',
  '2014': '#b3e7f1',
  '2015': '#a6d4e3',
  '2016': '#99c1d5',
  '2017': '#8caec7',
  '2018': '#7f9bb9',
  '2019': '#7288ab',
  '2020': '#64749c',
  '2021': '#57618e',
  '2022': '#4a4e80',
  '2023': '#3d3b72',
  '2024': '#302864',
  '2025': '#231556',
  '2026': '#160248',
}

export const DIFFICULTY_COLORS: Record<string, string> = {
  'Auto':           '#fff472',
  'Easy':           '#00ddff',
  'Normal':         '#00ff44',
  'Hard':           '#ffee00',
  'Harder':         '#ff7700',
  'Insane':         '#ff77dd',
  'Easy Demon':     '#8844ff',
  'Medium Demon':   '#cc33cc',
  'Hard Demon':     '#ff3355',
  'Insane Demon':   '#ee2222',
  'Extreme Demon':  '#aa0000',
  'Official Demon': '#aa0000',
}

export const RATING_COLORS: Record<string, string> = {
  'Mythic':    '#9fc5e8',
  'Legendary': '#a64d79',
  'Epic':      '#6aa84f',
  'Featured':  '#f1c232',
  'Rated':     '#e69138',
  'Unrated':   '#cc0000',
  'Challenge': '#85200c',
  'Official':  '#674ea7',
  'Banned':    '#999999',
}

const NEUTRAL = '#27272a' // zinc-800
export function yearColor(year: string | null | undefined)       { return year ? (YEAR_COLORS[year] ?? NEUTRAL) : NEUTRAL }
export function difficultyColor(name: string | null | undefined) { return name ? (DIFFICULTY_COLORS[name] ?? NEUTRAL) : NEUTRAL }
export function ratingColor(name: string | null | undefined)     { return name ? (RATING_COLORS[name] ?? NEUTRAL) : NEUTRAL }
