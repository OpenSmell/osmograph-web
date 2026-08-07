import { describe, expect, it } from "vitest"
import { inferFunctionalGroups, kekuleToAromatic } from "../groups"

const groups = (smiles: string) => inferFunctionalGroups(smiles).sort()
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify([...b].sort())

describe("Kekulé aromatic-ring detection (PubChem returns C1=CC=CC=C1, not c1ccccc1)", () => {
  it("normalises a linear Kekulé benzene ring", () => {
    expect(kekuleToAromatic("C1=CC=CC=C1")).toBe("c1ccccc1")
    expect(same(groups("C1=CC=CC=C1"), ["aromatic"])).toBe(true)
  })

  it("detects phenol with an OH straight on the ring", () => {
    expect(same(groups("OC1=CC=CC=C1"), ["aromatic", "phenol"])).toBe(true)
    expect(same(groups("C1=CC=C(C=C1)O"), ["aromatic", "phenol"])).toBe(true)
  })

  it("detects guaiacol as phenol + ether (methoxy AND phenol OH)", () => {
    expect(same(groups("COC1=CC=CC=C1O"), ["aromatic", "phenol", "ether"])).toBe(true)
  })

  it("does NOT mistake anisole's methoxy for a phenol", () => {
    expect(same(groups("COC1=CC=CC=C1"), ["aromatic", "ether"])).toBe(true)
  })

  it("vanillin (the live PubChem SMILES) reads as aromatic aldehyde phenol ether", () => {
    const g = groups("COC1=C(C=CC(=C1)C=O)O")
    expect(same(g, ["aromatic", "aldehyde", "phenol", "ether"])).toBe(true)
  })

  it("cinnamaldehyde keeps its real alkene and terminal aldehyde", () => {
    expect(same(groups("C1=CC=C(C=C1)/C=C/C=O"), ["aromatic", "aldehyde", "alkene"])).toBe(true)
  })

  it("benzaldehyde reads as aromatic aldehyde", () => {
    expect(same(groups("C1=CC=C(C=C1)C=O"), ["aromatic", "aldehyde"])).toBe(true)
  })

  it("eugenol (Kekulé form) reads as phenol + ether + alkene", () => {
    expect(same(groups("C=CCC1=CC(=C(C=C1)O)OC"), ["aromatic", "phenol", "ether", "alkene"])).toBe(true)
  })

  it("furfural reads as furan (five-membered O ring), no spurious ring alkene", () => {
    expect(same(groups("O=CC1=COC=C1"), ["aromatic", "aldehyde", "furan"])).toBe(true)
    const g = inferFunctionalGroups("O=CC1=COC=C1")
    expect(g).toContain("furan")
    expect(g).toContain("aromatic")
    expect(g).toContain("aldehyde")
    expect(g).not.toContain("alkene")
  })

  it("styrene keeps its vinyl alkene", () => {
    expect(same(groups("C=CC1=CC=CC=C1"), ["aromatic", "alkene"])).toBe(true)
  })
})

describe("non-aromatic rings must not be flagged aromatic", () => {
  it("limonene stays a terpene alkene, not aromatic", () => {
    const g = inferFunctionalGroups("CC1=CCC(CC1)C(C)=C")
    expect(g).not.toContain("aromatic")
    expect(g).toContain("alkene")
  })

  it("menthol's saturated ring is not aromatic", () => {
    expect(inferFunctionalGroups("CC1CCC(C(C1)O)C(C)C")).not.toContain("aromatic")
  })

  it("pinene's bicyclic ring is not aromatic", () => {
    expect(inferFunctionalGroups("CC1=CCC2CC1C2(C)C")).not.toContain("aromatic")
  })

  it("cyclohexene and cyclohexane are not aromatic", () => {
    expect(inferFunctionalGroups("C1CCC=CC1")).not.toContain("aromatic")
    expect(inferFunctionalGroups("C1CCCCC1")).not.toContain("aromatic")
  })
})

describe("curated (aromatic-form) SMILES still infer the same groups", () => {
  it("phenol / guaiacol / furfural in lowercase form", () => {
    expect(same(groups("Oc1ccccc1"), ["aromatic", "phenol"])).toBe(true)
    expect(same(groups("COc1ccccc1O"), ["aromatic", "phenol", "ether"])).toBe(true)
    expect(inferFunctionalGroups("O=Cc1ccco1")).toContain("furan")
  })

  it("eugenol in the curated form keeps phenol + ether + alkene", () => {
    expect(same(groups("COc1cc(CC=C)ccc1O"), ["aromatic", "phenol", "ether", "alkene"])).toBe(true)
  })

  it("cinnamaldehyde in the curated form reads the same", () => {
    expect(same(groups("O=C/C=C/c1ccccc1"), ["aromatic", "aldehyde", "alkene"])).toBe(true)
  })
})

describe("core functional groups (unchanged behaviour)", () => {
  it("alcohols, ketones, acids, esters", () => {
    expect(groups("CCO")).toContain("alcohol")
    expect(groups("CC(=O)C")).toContain("ketone")
    expect(groups("CC(=O)O")).toContain("carboxylic acid")
    expect(groups("CCOC(=O)C")).toContain("ester")
    expect(groups("CC(=O)C(C)=O")).toContain("diketone")
  })

  it("sulfur chemistry", () => {
    expect(groups("CS")).toContain("thiol")
    expect(groups("CSC")).toContain("thioether")
    expect(groups("CSC")).toContain("sulfur")
  })

  it("alkanes and hetero-atom-only molecules", () => {
    expect(groups("CCCCCC")).toContain("alkane")
    expect(groups("N")).toEqual(["amine"])
    expect(groups("S")).toEqual(["sulfur"])
  })

  it("empty or missing SMILES stays silent", () => {
    expect(inferFunctionalGroups(undefined)).toEqual([])
    expect(inferFunctionalGroups("")).toEqual([])
  })
})

describe("structural carbonyl / alcohol / ether inference (PubChem forms)", () => {
  it("branched, ring, and slash-marked ketones", () => {
    expect(groups("CC(C(=O)C)O")).toContain("ketone") // acetoin
    expect(groups("CC1=CCC(CC1=O)C(=C)C")).toContain("ketone") // cyclohexenone ring C1=O
    expect(groups("CC1(C2CCC1(C(=O)C2)C)C")).toContain("ketone") // camphor
  })

  it("aldehydes written with slash marks (citral)", () => {
    const g = groups("CC(=CCC/C(=C/C=O)/C)C")
    expect(g).toContain("aldehyde")
    expect(g).toContain("alkene")
  })

  it("slash-marked terpene alcohols (geraniol / nerol / patchouli alcohol)", () => {
    expect(groups("CC(=CCC/C(=C/CO)/C)C")).toContain("alcohol")
    expect(groups("CC(=CCC/C(=C\\CO)/C)C")).toContain("alcohol")
    expect(groups("C[C@H]1CCC[C@@]2([C@@]1(CCCC2)O)C")).toContain("alcohol")
  })

  it("benzyl / 2-phenylethanol keep alcohol despite the aromatic ring", () => {
    expect(groups("C1=CC=C(C=C1)CO")).toContain("alcohol")
    expect(groups("C1=CC=C(C=C1)CCO")).toContain("alcohol")
  })

  it("ring ether (eucalyptol's oxabicyclo O)", () => {
    expect(groups("CC1(C2CCC(O1)(CC2)C)C")).toContain("ether")
  })

  it("lactones read as ester, not ketone or acid", () => {
    expect(groups("CCCCCC1CCCC(=O)O1")).toContain("ester") // δ-decalactone
    expect(groups("C1=CC=C2C(=C1)C=CC(=O)O2")).toContain("ester") // coumarin
    expect(groups("C1=CC=C2C(=C1)C=CC(=O)O2")).not.toContain("ketone")
    expect(groups("C1=CC=C2C(=C1)C=CC(=O)O2")).not.toContain("carboxylic acid")
  })

  it("cyclic esters are still esters, straight-chain esters are not acids", () => {
    expect(groups("CCC(=O)OCC")).toContain("ester")
    expect(groups("CC(=O)OCC1=CC=CC=C1")).toContain("ester") // benzyl acetate
    expect(groups("CCC(=O)OCC")).not.toContain("carboxylic acid")
  })

  it("tertiary amines (trimethylamine) are amines", () => {
    expect(groups("CN(C)C")).toContain("amine")
  })

  it("terminal-sulfur thiols (ethanethiol, butanethiol, t-butyl mercaptan)", () => {
    expect(groups("CCS")).toContain("thiol")
    expect(groups("CCCCS")).toContain("thiol")
    expect(groups("CC(C)(C)S")).toContain("thiol")
  })

  it("sulfur dioxide is sulfur", () => {
    expect(groups("O=S=O")).toContain("sulfur")
  })

  it("azines (pyridine / pyrazine) are aromatic amines, not alkenes", () => {
    expect(groups("C1=CC=NC=C1")).toContain("aromatic")
    expect(groups("C1=CC=NC=C1")).toContain("amine")
    expect(groups("C1=CC=NC=C1")).not.toContain("alkene")
    expect(groups("CC1=CN=C(C(=N1)C)C")).toContain("aromatic")
    expect(groups("CC1=CN=C(C(=N1)C)C")).toContain("amine")
  })

  it("fused aromatics: naphthalene and indole get no spurious alkene", () => {
    expect(groups("C1=CC=C2C=CC=CC2=C1")).toContain("aromatic")
    expect(groups("C1=CC=C2C=CC=CC2=C1")).not.toContain("alkene")
    expect(groups("C1=CC=C2C(=C1)C=CN2")).toContain("aromatic")
    expect(groups("C1=CC=C2C(=C1)C=CN2")).toContain("amine")
    expect(groups("C1=CC=C2C(=C1)C=CN2")).not.toContain("alkene")
  })
})
