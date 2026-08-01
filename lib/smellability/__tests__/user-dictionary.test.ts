import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readUserDictionary, removeFromUserDictionary, saveToUserDictionary, userDictionaryById } from "../user-dictionary"
import type { Chemical } from "../types"

// The test runner uses node (no DOM), so provide a tiny in-memory localStorage.
const memoryStorage = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memoryStorage.set(k, String(v))
  },
  removeItem: (k: string) => {
    memoryStorage.delete(k)
  },
  clear: () => {
    memoryStorage.clear()
  },
  key: () => null,
  length: 0,
}

const chem = (id: string, name: string): Chemical => ({
  id,
  name,
  synonyms: [name],
  props: {
    molecularWeight: { value: 1, source: "measured" },
    boilingPoint: { value: null, source: "unknown" },
    vaporPressure25: { value: null, source: "unknown" },
    functionalGroups: ["aldehyde"],
    redoxActive: true,
  },
  sourceRefs: ["PubChem (live lookup)"],
})

describe("user dictionary (localStorage-backed)", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("starts empty", () => {
    expect(readUserDictionary()).toEqual([])
  })

  it("saves an entry and reads it back", () => {
    expect(saveToUserDictionary(chem("prov-vanillin", "Vanillin"))).toBe(true)
    const dict = readUserDictionary()
    expect(dict).toHaveLength(1)
    expect(dict[0].id).toBe("prov-vanillin")
  })

  it("rejects duplicate ids (returns false, does not add)", () => {
    saveToUserDictionary(chem("prov-x", "X"))
    expect(saveToUserDictionary(chem("prov-x", "X again"))).toBe(false)
    expect(readUserDictionary()).toHaveLength(1)
  })

  it("removes by id", () => {
    saveToUserDictionary(chem("prov-a", "A"))
    saveToUserDictionary(chem("prov-b", "B"))
    removeFromUserDictionary("prov-a")
    expect(readUserDictionary().map((c) => c.id)).toEqual(["prov-b"])
  })

  it("builds a lookup map by id", () => {
    saveToUserDictionary(chem("prov-a", "A"))
    const map = userDictionaryById()
    expect(map.get("prov-a")?.name).toBe("A")
    expect(map.has("prov-b")).toBe(false)
  })

  it("caps the dictionary at 200 entries", () => {
    for (let i = 0; i < 250; i++) saveToUserDictionary(chem(`prov-${i}`, `C${i}`))
    expect(readUserDictionary()).toHaveLength(200)
  })
})
