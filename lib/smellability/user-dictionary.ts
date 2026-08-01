import type { Chemical } from "./types"

// A small localStorage-backed dictionary of chemicals the user has resolved
// live and chosen to keep. It sits beside the curated dictionary: search and
// resolution consult it, but entries are always visibly marked as provisional
// (estimated) rather than curated. No network, no account — it is the user's
// own growing lab notebook.

const DICT_KEY = "osmell-user-dictionary"

export function readUserDictionary(): Chemical[] {
  try {
    const raw = localStorage.getItem(DICT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Chemical[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveToUserDictionary(chemical: Chemical): boolean {
  const dict = readUserDictionary()
  if (dict.some((c) => c.id === chemical.id)) return false
  const next = [...dict, chemical].slice(-200)
  try {
    localStorage.setItem(DICT_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function removeFromUserDictionary(id: string): void {
  const dict = readUserDictionary().filter((c) => c.id !== id)
  try {
    localStorage.setItem(DICT_KEY, JSON.stringify(dict))
  } catch {
    /* storage unavailable — ignore */
  }
}

export function userDictionaryById(): Map<string, Chemical> {
  return new Map(readUserDictionary().map((c) => [c.id, c]))
}
