import type { Chemical, FeasibilityVerdict } from "./types"

export interface Percept {
  id: string
  label: string
  description: string
  groups: string[]
  keywords: string[]
}

export const PERCEPTS: Percept[] = [
  {
    id: "fruity-ester",
    label: "Fruity / sweet esters",
    description: "Volatile esters and small ketones — the chemistry behind ripe fruit.",
    groups: ["ester"],
    keywords: ["fruity", "banana", "pineapple", "sweet", "apricot", "apple", "pear"],
  },
  {
    id: "citrus-terpenic",
    label: "Citrus / terpenic",
    description: "Terpenes (limonene, pinene, myrcene) — peel oils and conifers.",
    groups: ["terpene"],
    keywords: ["citrus", "terpene", "lemon", "pine", "orange"],
  },
  {
    id: "green-leafy",
    label: "Green / leafy",
    description: "C6 aldehydes and alcohols (hexanal, hexenals) — freshly cut foliage.",
    groups: [],
    keywords: ["green", "grassy", "leaf", "leafy", "tallow"],
  },
  {
    id: "floral",
    label: "Floral",
    description: "Terpene alcohols and linalool-type aromatics.",
    groups: [],
    keywords: ["floral", "lavender", "rose", "violet"],
  },
  {
    id: "minty",
    label: "Minty / cooling",
    description: "Menthol-type cyclic alcohols and menthone ketones.",
    groups: [],
    keywords: ["mint", "menthol", "cooling"],
  },
  {
    id: "spicy-balsamic",
    label: "Spicy / balsamic",
    description: "Cinnamaldehyde and phenolic spices — low volatility, slow release.",
    groups: ["phenol"],
    keywords: ["cinnamon", "spicy", "clove"],
  },
  {
    id: "roasted-caramel",
    label: "Roasted / caramel",
    description: "Maillard products (furfural, diacetyl) — baked and roasted notes.",
    groups: [],
    keywords: ["roast", "caramel", "bakey", "butter", "toasted"],
  },
  {
    id: "smoky-phenolic",
    label: "Smoky / phenolic",
    description: "Phenol and guaiacol — pyrolysis signatures.",
    groups: ["phenol"],
    keywords: ["smoke", "smoky", "phenolic", "campfire", "creosote"],
  },
  {
    id: "sulfurous",
    label: "Sulfurous / rotten",
    description: "Thiols, sulfides, and H2S — the most potent MOX-reducing agents.",
    groups: ["thiol", "thioether", "sulfur"],
    keywords: ["sulfurous", "garlic", "sewer", "rotten", "skunk", "gas"],
  },
  {
    id: "ammoniacal",
    label: "Ammoniacal",
    description: "Ammonia and amines — sharp, basic headspace.",
    groups: ["amine"],
    keywords: ["ammonia", "fishy", "urine"],
  },
  {
    id: "solvent-industrial",
    label: "Solvent / industrial",
    description: "Aromatics (BTX) and alkanes — fuels, thinners, cleaning products.",
    groups: [],
    keywords: ["solvent", "gasoline", "paint", "fuel", "aromatic"],
  },
  {
    id: "alcoholic",
    label: "Alcoholic",
    description: "Small-chain alcohols — ethanol and relatives.",
    groups: ["alcohol"],
    keywords: ["alcohol", "alcoholic"],
  },
  {
    id: "sour-acidic",
    label: "Sour / acidic",
    description: "Carboxylic acids — vinegar and rancid notes.",
    groups: ["carboxylic acid"],
    keywords: ["vinegar", "sour", "rancid", "acidic"],
  },
  {
    id: "neutral-gas",
    label: "Odorless combustibles",
    description: "Methane, propane — low odor but strong MOX reducers when odorized.",
    groups: [],
    keywords: ["methane", "propane", "odorless"],
  },
]

const LOW_VOLATILITY = new Set(["spicy-balsamic", "smoky-phenolic"])

export function perceptsFor(chemical: Chemical): Percept[] {
  const groups = new Set(chemical.props.functionalGroups ?? [])
  const text = `${chemical.name} ${chemical.props.odorDescriptor ?? ""}`.toLowerCase()

  return PERCEPTS.filter((p) => {
    if (p.groups.some((g) => groups.has(g))) return true
    return p.keywords.some((k) => text.includes(k))
  })
}

export function topPercepts(chemical: Chemical, max = 3): Percept[] {
  return perceptsFor(chemical).slice(0, max)
}

export function dominantPercept(chemical: Chemical): Percept | null {
  const ps = perceptsFor(chemical)
  if (ps.length === 0) return null
  const groupHit = ps.filter((p) => p.groups.some((g) => (chemical.props.functionalGroups ?? []).includes(g)))
  return (groupHit[0] ?? ps[0]) ?? null
}

export function isLowVolatilityPercept(percept: Percept | null): boolean {
  return percept != null && LOW_VOLATILITY.has(percept.id)
}

export interface MoxBoundary {
  id: string
  domain: string
  capability: boolean
  statement: string
  implication: string
}

export const MOX_BOUNDARIES: MoxBoundary[] = [
  {
    id: "functional-groups",
    domain: "Identity",
    capability: true,
    statement: "Rough chemical family (esters, aldehydes, terpenes, thiols…)",
    implication: "You can read the *kind* of chemistry — the hat — but not the exact molecule.",
  },
  {
    id: "molecular-size",
    domain: "Identity",
    capability: true,
    statement: "Small vs large volatile molecules",
    implication: "Size ordering is visible in kinetics; exact mass is not.",
  },
  {
    id: "vapor-pressure",
    domain: "Identity",
    capability: true,
    statement: "Volatility / how readily it reaches the sensor",
    implication: "The engine's headspace estimate is the physical upper bound, not a reading.",
  },
  {
    id: "redox",
    domain: "Reactivity",
    capability: true,
    statement: "Redox activity — will it reduce the sensor surface",
    implication: "Reducing VOCs respond; the response is proportional to total reducing power.",
  },
  {
    id: "structure",
    domain: "Identity",
    capability: false,
    statement: "Exact molecular structure (isomers, chirality)",
    implication: "Limonene vs pinene, L- vs D-carvone: indistinguishable to MOX.",
  },
  {
    id: "concentration",
    domain: "Concentration",
    capability: false,
    statement: "Absolute concentration (ppm)",
    implication: "No calibration → relative response only. Treat any ppm as an estimate.",
  },
  {
    id: "non-redox",
    domain: "Reactivity",
    capability: false,
    statement: "Non-redox-active gases (N2, O2, CO2, noble gases)",
    implication: "CO2 is abundant in headspace yet invisible to a MOX array.",
  },
  {
    id: "trace",
    domain: "Sensitivity",
    capability: false,
    statement: "Trace concentrations below ~1 ppm",
    implication: "Below the practical MOX floor, regardless of how strong the smell is.",
  },
  {
    id: "mixture",
    domain: "Composition",
    capability: false,
    statement: "Decomposing complex mixtures into components",
    implication: "A 50/50 blend can look like a pure substance to the array.",
  },
]

export function describeBoundaries(): { can: MoxBoundary[]; cannot: MoxBoundary[] } {
  const can = MOX_BOUNDARIES.filter((b) => b.capability)
  const cannot = MOX_BOUNDARIES.filter((b) => !b.capability)
  return { can, cannot }
}

export function relevantBoundaries(verdict: FeasibilityVerdict): string[] {
  const hits: string[] = []
  const reactivity = verdict.steps.find((s) => s.id === "reactivity")
  const signal = verdict.steps.find((s) => s.id === "signal")
  if (reactivity?.verdict === "red") hits.push("non-redox")
  if (verdict.signalStrength === "none" && signal?.values.some((v) => v.value.includes("ppm"))) hits.push("trace")
  if (verdict.kind === "composite") hits.push("mixture")
  if (verdict.kind === "class") hits.push("structure")
  return hits
}

export function perceptualSummary(
  verdict: FeasibilityVerdict,
  percepts: Percept[],
): string {
  const hat = percepts.length > 0 ? percepts.map((p) => p.label.toLowerCase()).join("; ") : "unclassified chemistry"
  const base = `${verdict.entityName} reads as ${hat}.`
  if (verdict.verdict === "red") {
    if (verdict.steps.some((s) => s.id === "reactivity" && s.verdict === "red")) {
      return `${base} The array cannot confirm it: the chemistry is not redox-active at MOX operating temperatures (beyond-MOX boundary).`
    }
    return `${base} The array is unlikely to register a usable signal under normal conditions.`
  }
  if (verdict.confidence === "low") {
    return `${base} The array should respond, but key properties are unknown — treat the strength estimate as a guess until verified.`
  }
  if (isLowVolatilityPercept(percepts[0] ?? null)) {
    return `${base} Expect a weak, slow signal — this family is low-volatility, so the headspace builds slowly and stays small. The exact identity and ppm are beyond MOX.`
  }
  return `${base} Expect a clear reducing response — the family is volatile and redox-active. The exact molecule and ppm are beyond MOX; what you get is the kind.`
}
