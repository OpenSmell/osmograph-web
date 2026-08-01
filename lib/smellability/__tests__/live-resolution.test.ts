import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { lookupPubChem, lookupPubChemBoilingPoint } from "../enrichment"
import { buildProvisionalChemical } from "../provisional"
import { runChemicalVerdict } from "../chain"
import { readUserDictionary, saveToUserDictionary } from "../user-dictionary"

// Node test env has no DOM — provide a tiny in-memory localStorage so the
// enrichment cache and user dictionary work exactly like in the browser.
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

const propertyJson = (cid: number, name: string, formula: string, mw: number, smiles: string) => ({
  PropertyTable: {
    Properties: [{ CID: cid, IUPACName: name, MolecularFormula: formula, MolecularWeight: mw, IsomericSMILES: smiles }],
  },
})

function mockPubChem(bpString: string | null) {
  return vi.fn((input: unknown) => {
    const url = String(input)
    if (url.includes("/pug_view/")) {
      const body = bpString
        ? { Record: { Section: [{ TOCHeading: "Boiling Point", Information: [{ Value: { StringWithMarkup: [{ String: bpString }] } }] }] } }
        : { Record: { Section: [{ TOCHeading: "Density", Information: [{ Value: { String: "0.88 g/cm³" } }] }] } }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }
    if (url.includes("/property/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify(propertyJson(31253, "myrcene", "C10H16", 136.234, "CC(=CCCC(=C)C=C)C")),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response("not found", { status: 404 }))
  }) as unknown as typeof fetch
}

describe("live PubChem resolution → provisional verdict (no real network)", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("resolves a novel substance, grades it through the chain, and saves it to the dictionary", async () => {
    globalThis.fetch = mockPubChem("167.0 °C")

    const enriched = await lookupPubChem("myrcene")
    expect(enriched).not.toBeNull()
    expect(enriched?.molecularFormula).toBe("C10H16")

    const bp = await lookupPubChemBoilingPoint("myrcene")
    expect(bp?.valueC).toBe(167)

    const chem = buildProvisionalChemical(enriched!, bp)
    expect(chem.id).toMatch(/^prov-myrcene$/)
    expect(chem.sourceRefs).toContain("PubChem (live lookup)")

    const verdict = runChemicalVerdict(chem)
    expect(verdict.kind).toBe("chemical")
    expect(verdict.entityName).toBe("myrcene")
    expect(["green", "yellow", "red"]).toContain(verdict.verdict)
    // Estimated vapor pressure and inferred groups make this honestly "medium".
    expect(verdict.confidence).toBe("medium")

    expect(saveToUserDictionary(chem)).toBe(true)
    expect(readUserDictionary()).toHaveLength(1)
    expect(readUserDictionary()[0].id).toBe("prov-myrcene")
    expect(saveToUserDictionary(chem)).toBe(false)
  })

  it("keeps vapor pressure unknown when PubChem has no boiling point, and says so in confidence", async () => {
    globalThis.fetch = mockPubChem(null)

    const enriched = await lookupPubChem("myrcene")
    expect(enriched).not.toBeNull()
    const bp = await lookupPubChemBoilingPoint("myrcene")
    expect(bp).toBeNull()

    const chem = buildProvisionalChemical(enriched!, bp)
    expect(chem.props.boilingPoint.value).toBeNull()
    expect(chem.props.vaporPressure25.value).toBeNull()
    expect(chem.props.vaporPressure25.source).toBe("unknown")

    const verdict = runChemicalVerdict(chem)
    expect(verdict.confidence).toBe("low")
  })
})
