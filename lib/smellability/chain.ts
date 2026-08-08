import {
  vaporPressureAntoine,
  vaporPressureClausiusClapeyron,
  diffusionVolumeFromMw,
  deltaHVapTrouton,
  signalRatioVsRef,
  type IncidentFluxInput,
} from "./transport"
import {
  AMBIENT_TEMP_C,
  AMBIENT_TEMP_K,
  CLASS_TERMS,
  DEFAULT_SENSOR_COUNT,
  MAX_SUBSTANCES,
  MOX_FLOOR_PPM,
  headspacePpmBand,
  volatilityLabel,
} from "./constants"
import { COMPOUND_BY_ID, REFERENCE_COMPOUND } from "./compounds"
import { COMPOSITE_BY_ID } from "./composites"
import { userDictionaryById } from "./user-dictionary"
import type {
  ChainStep,
  Chemical,
  Composite,
  ConstituentVerdict,
  CrossCheck,
  DataSource,
  FeasibilityVerdict,
  ResponseSpeed,
  SignalStrength,
  Verdict,
  VerdictConfidence,
} from "./types"

export interface ChainOptions {
  sensorCount?: number
  librarySubstances?: string[]
  tempC?: number
}

const WORST: Record<Verdict, number> = { green: 0, yellow: 1, red: 2 }

function worstVerdict(a: Verdict, b: Verdict): Verdict {
  return WORST[a] >= WORST[b] ? a : b
}

function signalScore(strength: SignalStrength): number {
  switch (strength) {
    case "strong":
      return 1
    case "moderate":
      return 0.6
    case "weak":
      return 0.3
    case "none":
      return 0
  }
}

function speedFromVolatility(pa: number | null, gas: boolean): ResponseSpeed {
  if (gas || (pa != null && pa >= 1000)) return "fast"
  if (pa != null && pa >= 100) return "medium"
  if (pa != null && pa >= 1) return "slow"
  return "unknown"
}

interface EffectiveVaporPressure {
  pa: number
  source: DataSource
}

export function effectiveVaporPressure(c: Chemical): EffectiveVaporPressure {
  if (c.props.vaporPressure25.value != null) {
    return { pa: c.props.vaporPressure25.value, source: c.props.vaporPressure25.source }
  }
  if (c.props.antoine) {
    const { a, b, c: cc } = c.props.antoine
    return { pa: vaporPressureAntoine(a, b, cc, AMBIENT_TEMP_C), source: "measured" }
  }
  if (c.props.gas) {
    return { pa: 101325, source: "measured" }
  }
  if (c.props.boilingPoint.value != null) {
    const tBoilK = c.props.boilingPoint.value + 273.15
    const pa = vaporPressureClausiusClapeyron(AMBIENT_TEMP_K, tBoilK, deltaHVapTrouton(tBoilK))
    return { pa, source: "estimated" }
  }
  return { pa: 0, source: "unknown" }
}

function signalRatio(c: Chemical): { ratio: number; source: DataSource } {
  const vp = effectiveVaporPressure(c)
  if (vp.source === "unknown" || vp.pa <= 0 || !REFERENCE_COMPOUND) {
    return { ratio: 0, source: vp.source }
  }
  const rvp = effectiveVaporPressure(REFERENCE_COMPOUND)
  const input = (chem: Chemical, pv: number): IncidentFluxInput => ({
    vaporPressurePa: pv,
    molWeightKg: chem.props.molecularWeight.value ? chem.props.molecularWeight.value / 1000 : 0.05,
    diffusionVolumeCm3: chem.props.molecularWeight.value
      ? diffusionVolumeFromMw(chem.props.molecularWeight.value)
      : 55,
  })
  const ratio = signalRatioVsRef(input(c, vp.pa), input(REFERENCE_COMPOUND, rvp.pa))
  const source: DataSource = vp.source === "measured" && rvp.source === "measured" ? "measured" : "estimated"
  return { ratio, source }
}

function headspacePpm(c: Chemical): { ppm: number | null; gas: boolean; source: DataSource } {
  const vp = effectiveVaporPressure(c)
  if (c.props.gas) return { ppm: null, gas: true, source: "measured" }
  if (vp.source === "unknown" || vp.pa <= 0) return { ppm: null, gas: false, source: "unknown" }
  return { ppm: (vp.pa / 101325) * 1e6, gas: false, source: vp.source }
}

function fmtPa(pa: number | null): string {
  if (pa == null) return "unknown"
  if (pa >= 100000) return `${(pa / 1000).toFixed(0)} kPa`
  if (pa >= 1000) return `${(pa / 1000).toFixed(2)} kPa`
  return `${pa.toFixed(0)} Pa`
}

function fmtRatio(ratio: number): string {
  if (ratio >= 10) return `${ratio.toFixed(1)}× ethanol`
  if (ratio >= 1) return `${ratio.toFixed(2)}× ethanol`
  if (ratio >= 0.1) return `${(ratio * 100).toFixed(0)}% of ethanol`
  return `${(ratio * 100).toFixed(1)}% of ethanol`
}

function fmtPpm(ppm: number | null): string {
  if (ppm == null) return "unknown"
  if (ppm >= 10000) return `${(ppm / 1000).toFixed(0)}k`
  if (ppm >= 100) return `${Math.round(ppm)}`
  return `${ppm.toFixed(1)}`
}

export function runConstituentChain(c: Chemical): ConstituentVerdict {
  const vp = effectiveVaporPressure(c)

  const steps: ChainStep[] = []

  const mw = c.props.molecularWeight.value
  const bp = c.props.boilingPoint.value
  const odour = c.props.odorDescriptor ? ` Odour: ${c.props.odorDescriptor}.` : ""
  steps.push({
    id: "identity",
    label: "Identity & properties",
    verdict: "green",
    reason: `${c.name} resolved from the compound dictionary.`,
    detail: `${c.name}${c.cas ? ` (CAS ${c.cas})` : ""}. Molecular weight ${mw != null ? `${mw.toFixed(1)} g/mol` : "unknown"}, boiling point ${bp != null ? `${bp.toFixed(1)} °C` : "unknown"}.${odour}`,
    values: [
      { label: "Molecular weight", value: mw != null ? `${mw.toFixed(1)} g/mol` : "unknown", source: c.props.molecularWeight.source },
      { label: "Boiling point", value: bp != null ? `${bp.toFixed(1)} °C` : "unknown", source: c.props.boilingPoint.source },
      { label: "Vapor pressure @ 25 °C", value: fmtPa(vp.pa), source: vp.source },
    ],
  })

  const volLabel = volatilityLabel(vp.source === "unknown" ? null : vp.pa)
  let volVerdict: Verdict = "yellow"
  let volReason = "Vapor pressure unknown — volatility cannot be assessed."
  if (c.props.gas) {
    volVerdict = "green"
    volReason = `${c.name} is a gas at room temperature — it is already in the vapor phase.`
  } else if (vp.source !== "unknown") {
    if (volLabel === "very high" || volLabel === "high" || volLabel === "moderate") {
      volVerdict = "green"
      volReason = `${c.name} has ${volLabel} volatility (${fmtPa(vp.pa)} at 25 °C) — it readily enters the headspace.`
    } else if (volLabel === "low") {
      volVerdict = "yellow"
      volReason = `${c.name} has low volatility (${fmtPa(vp.pa)} at 25 °C) — expect a slow, weak headspace unless the sample is warmed.`
    } else {
      volVerdict = "red"
      volReason = `${c.name} is effectively non-volatile at room temperature (${fmtPa(vp.pa)}) — it will not reach the sensor without heating.`
    }
  }
  steps.push({
    id: "volatility",
    label: "Volatility",
    verdict: volVerdict,
    reason: volReason,
    detail:
      "Vapor pressure at 25 °C via Antoine equation where constants are curated, else Clausius-Clapeyron from the boiling point with Trouton's-rule enthalpy.",
    values: [{ label: "Volatility class", value: c.props.gas ? "gas" : volLabel, source: vp.source }],
  })

  const head = headspacePpm(c)
  const ratioInfo = signalRatio(c)
  const hsBand = head.gas ? "strong" : head.ppm != null ? headspacePpmBand(head.ppm) : "unknown"
  let sigVerdict: Verdict = "yellow"
  let sigReason = "Headspace concentration unknown — signal strength cannot be assessed."
  let signalStrength: SignalStrength = "none"
  if (hsBand !== "unknown") {
    if (hsBand === "strong" || hsBand === "moderate") {
      sigVerdict = "green"
      signalStrength = hsBand
      sigReason = head.gas
        ? `${c.name} is a gas — the vapor phase is available at full concentration, well above the ~${MOX_FLOOR_PPM} ppm MOX floor.`
        : `Saturated headspace is ≈ ${fmtPpm(head.ppm)} ppm — far above the ~${MOX_FLOOR_PPM} ppm MOX floor.`
    } else if (hsBand === "weak") {
      sigVerdict = "yellow"
      signalStrength = "weak"
      sigReason = `Saturated headspace is ≈ ${fmtPpm(head.ppm)} ppm — detectable, but only ${Math.max(1, Math.round((head.ppm ?? 0) / MOX_FLOOR_PPM))}× the MOX floor. Warm the sample and maximize surface area.`
    } else {
      sigVerdict = "red"
      signalStrength = hsBand === "marginal" ? "weak" : "none"
      sigReason = `Saturated headspace is ≈ ${fmtPpm(head.ppm)} ppm — within ${Math.max(1, Math.round((head.ppm ?? 0) / MOX_FLOOR_PPM))}× of the ~${MOX_FLOOR_PPM} ppm floor and unlikely to give a usable response.`
    }
  }
  steps.push({
    id: "signal",
    label: "Headspace concentration",
    verdict: sigVerdict,
    reason: sigReason,
    detail:
      "Saturated headspace is the mole fraction of the compound at its vapor pressure (p_vap / P_atm). It is the physical upper bound in an enclosed chamber and is compared against the practical MOX detection floor.",
    values: [
      {
        label: "Saturated headspace",
        value: head.gas ? "full vapor phase (gas)" : head.ppm != null ? `${fmtPpm(head.ppm)} ppm` : "unknown",
        source: head.source,
      },
      {
        label: "Relative to ethanol",
        value: ratioInfo.source === "unknown" ? "unknown" : fmtRatio(ratioInfo.ratio),
        source: ratioInfo.source,
      },
    ],
  })

  const groups = c.props.functionalGroups.length
    ? c.props.functionalGroups.join(", ")
    : "no recognized functional groups"
  let reactVerdict: Verdict = "yellow"
  let reactReason = `Reactivity of ${c.name} on MOX surfaces is not classified.`
  if (c.props.nonRedox) {
    reactVerdict = "red"
    reactReason = `${c.name} is not redox-active at MOX operating temperatures — it will not produce the surface reduction MOX sensors detect.`
  } else if (c.props.oxidizing) {
    reactVerdict = "green"
    reactReason = `${c.name} is an oxidizing gas — at the ~350 °C surface it oxidizes the sensing layer, producing the resistance rise a MOX array reads as a response (opposite sign to reducing VOCs).`
  } else if (c.props.redoxActive) {
    reactVerdict = "green"
    reactReason = `Contains ${groups}; these are oxidized at the ~350 °C sensor surface, producing the resistance change MOX arrays detect.`
  } else {
    reactReason = `${c.name} is not a reducing gas; any response is indirect (e.g. humidity/${c.name === "oxygen" ? "oxygen partial pressure" : "matrix effects"}).`
    if (c.id === "water") reactReason = "Water is not a reducing VOC, but humidity strongly modulates MOX baseline resistance — expect a baseline shift rather than an analyte response."
  }
  steps.push({
    id: "reactivity",
    label: "MOX reactivity",
    verdict: reactVerdict,
    reason: reactReason,
    detail:
      "MOX sensors respond to gases that undergo surface redox at operating temperature. Functional-group chemistry determines this; see the MOX boundaries in the science docs.",
    values: [{ label: "Functional groups", value: groups, source: c.props.functionalGroups.length ? "measured" : "estimated" }],
  })

  let verdict: Verdict = "green"
  for (const s of steps) verdict = worstVerdict(verdict, s.verdict)

  const speed = speedFromVolatility(vp.source === "unknown" ? null : vp.pa, !!c.props.gas)

  return {
    chemicalId: c.id,
    name: c.name,
    weightFraction: 1,
    weightSource: "measured",
    steps,
    verdict,
    signalStrength,
    responseSpeed: speed,
    signalScore: signalScore(signalStrength),
  }
}

function confidenceOf(v: ConstituentVerdict[]): VerdictConfidence {
  const sources = v.flatMap((c) => c.steps.flatMap((s) => s.values.map((x) => x.source)))
  if (sources.some((s) => s === "unknown")) return "low"
  if (sources.some((s) => s === "estimated")) return "medium"
  return "high"
}

function buildCrossCheck(sensorCount: number, library: string[], name: string, synonyms: string[]): CrossCheck {
  const maxDistinguishable = MAX_SUBSTANCES[sensorCount] ?? 40
  const lowerName = name.toLowerCase()
  const lowerSyns = synonyms.map((s) => s.toLowerCase())
  const confusable = library.filter((label) => {
    const l = label.toLowerCase()
    return l === lowerName || lowerSyns.includes(l) || l.includes(lowerName) || lowerName.includes(l)
  })
  const note =
    library.length === 0
      ? `At ${sensorCount} sensors the array is rated to resolve roughly ${maxDistinguishable} distinct substances. Cross-sensitivity to your library is unknown until you add labeled sessions.`
      : confusable.length > 0
        ? `At ${sensorCount} sensors the array is rated to resolve roughly ${maxDistinguishable} distinct substances. "${confusable.join('", "')}" in your library may overlap with this substance's response — verify with a labeled exposure.`
        : `At ${sensorCount} sensors the array is rated to resolve roughly ${maxDistinguishable} distinct substances. No exact label overlap found in your library.`
  return { sensorCount, maxDistinguishable, librarySubstances: library, confusable, note }
}

function guidance(signal: SignalStrength, speed: ResponseSpeed): { exposure: string; dilution: string } {
  const base = "Capture a 30-60 s clean-air baseline first; record the exposure, then a recovery window."
  if (signal === "strong" && speed === "fast") {
    return {
      exposure: `${base} Signal is expected fast and strong — keep exposures short (10-30 s) and use an enclosed chamber or gentle airflow for repeatability.`,
      dilution: "Start diluted (≈1:10 in clean air) and reduce dilution only if the response is small.",
    }
  }
  if (signal === "strong") {
    return {
      exposure: `${base} Strong signal expected — an enclosed chamber and moderate exposure (20-40 s) will keep you out of saturation.`,
      dilution: "A mild dilution (≈1:5) helps stay in the linear response region.",
    }
  }
  if (signal === "moderate") {
    return {
      exposure: `${base} Moderately detectable — allow 30-60 s of exposure; a small chamber or gentle airflow improves repeatability.`,
      dilution: "A mild dilution (≈1:3) may help stay in the linear region.",
    }
  }
  if (signal === "weak") {
    return {
      exposure: `${base} Weak signal expected — maximize headspace (increase surface area, slightly warm the sample) and use a longer exposure window (60-120 s).`,
      dilution: "Avoid dilution — you need the maximum headspace concentration.",
    }
  }
  return {
    exposure: `${base} No usable signal is expected under normal conditions.`,
    dilution: "N/A — not expected to be detectable.",
  }
}

export function runChemicalVerdict(chemical: Chemical, opts: ChainOptions = {}): FeasibilityVerdict {
  const sensorCount = opts.sensorCount ?? DEFAULT_SENSOR_COUNT
  const c = runConstituentChain(chemical)
  const library = opts.librarySubstances ?? []
  const crossCheck = buildCrossCheck(sensorCount, library, chemical.name, chemical.synonyms)
  const confidence = confidenceOf([c])
  const g = guidance(c.signalStrength, c.responseSpeed)
  return {
    entityId: chemical.id,
    entityName: chemical.name,
    kind: "chemical",
    verdict: c.verdict,
    confidence,
    signalStrength: c.signalStrength,
    responseSpeed: c.responseSpeed,
    constituents: [c],
    steps: c.steps,
    exposureGuidance: g.exposure,
    dilutionGuidance: g.dilution,
    crossCheck,
    computedAt: new Date().toISOString(),
    sensorCount,
    notes: [],
  }
}

export function runCompositeVerdict(composite: Composite, opts: ChainOptions = {}): FeasibilityVerdict {
  const sensorCount = opts.sensorCount ?? DEFAULT_SENSOR_COUNT
  const constituents = composite.constituents
    .map((c) => {
      const chemical = COMPOUND_BY_ID.get(c.chemicalId)
      if (!chemical) return null
      const v = runConstituentChain(chemical)
      v.weightFraction = c.weightFraction.value ?? 0
      v.weightSource = c.weightFraction.source
      return v
    })
    .filter((v): v is ConstituentVerdict => v !== null)

  let totalWeight = 0
  for (const v of constituents) totalWeight += v.weightFraction
  if (totalWeight > 0) {
    for (const v of constituents) v.weightFraction /= totalWeight
  }

  let redWeight = 0
  let nonGreenWeight = 0
  for (const v of constituents) {
    if (v.verdict === "red") redWeight += v.weightFraction
    if (v.verdict !== "green") nonGreenWeight += v.weightFraction
  }

  let verdict: Verdict = "green"
  if (redWeight > 0.5) verdict = "red"
  else if (nonGreenWeight > 0.4) verdict = "yellow"

  // The dominant constituent defines the character of the headspace: the grade
  // follows the constituent that contributes the most expected signal, so a
  // trace volatile member cannot flip a low-volatility-dominant mixture to a
  // stronger grade (cinnamon stays weak despite 5% limonene).
  let dominant: ConstituentVerdict | null = null
  let bestContribution = -1
  for (const v of constituents) {
    const contribution = v.weightFraction * v.signalScore
    if (contribution > bestContribution) {
      bestContribution = contribution
      dominant = v
    }
  }
  const signalStrength: SignalStrength = dominant?.signalStrength ?? "none"
  const responseSpeed: ResponseSpeed = dominant?.responseSpeed ?? "unknown"

  const confidence = confidenceOf(constituents)
  const library = opts.librarySubstances ?? []
  const crossCheck = buildCrossCheck(sensorCount, library, composite.name, composite.synonyms)
  const g = guidance(signalStrength, responseSpeed)

  const notes: string[] = []
  if (constituents.some((v) => v.weightSource === "estimated")) {
    notes.push("Constituent abundances are literature estimates (GC-MS studies) and vary with ripeness, cultivar, and preparation.")
  }
  if (composite.notes) notes.push(composite.notes)

  return {
    entityId: composite.id,
    entityName: composite.name,
    kind: "composite",
    verdict,
    confidence,
    signalStrength,
    responseSpeed,
    constituents,
    steps: [],
    exposureGuidance: g.exposure,
    dilutionGuidance: g.dilution,
    crossCheck,
    computedAt: new Date().toISOString(),
    sensorCount,
    notes,
    reaction: composite.reaction,
    hazard: composite.hazard,
  }
}

export function runClassVerdict(classKey: string, opts: ChainOptions = {}): FeasibilityVerdict {
  const term = CLASS_TERMS[classKey]
  const sensorCount = opts.sensorCount ?? DEFAULT_SENSOR_COUNT
  const label = term.label
  const steps: ChainStep[] = [
    {
      id: "identity",
      label: "Identity",
      verdict: "green",
      reason: `You asked about the ${label} class of compounds.`,
      detail: `Many individual compounds fall in this class; resolve to a specific compound for a precise verdict.`,
      values: [{ label: "Class", value: label, source: "measured" }],
    },
    {
      id: "volatility",
      label: "Volatility",
      verdict: "yellow",
      reason: `Volatility varies across the ${label.toLowerCase()} — small members are volatile, larger ones much less so.`,
      detail: "Grade depends on molecular weight and functional groups.",
      values: [{ label: "Vapor pressure @ 25 °C", value: "varies by compound", source: "unknown" }],
    },
    {
      id: "signal",
      label: "Headspace signal",
      verdict: "yellow",
      reason: `Expected to be detectable if a sufficiently volatile member is exposed.`,
      detail: "Use the specific-compound path for a numeric signal grade.",
      values: [{ label: "Signal vs ethanol", value: "varies by compound", source: "unknown" }],
    },
    {
      id: "reactivity",
      label: "MOX reactivity",
      verdict: "green",
      reason: `${label} are oxidized at the ~350 °C MOX surface — class-level chemistry is redox-active.`,
      detail: "MOX sensors respond to these functional groups (see science docs).",
      values: [{ label: "Redox active", value: "yes", source: "measured" }],
    },
  ]
  const library = opts.librarySubstances ?? []
  return {
    entityId: `class:${classKey}`,
    entityName: label,
    kind: "class",
    verdict: "yellow",
    confidence: "low",
    signalStrength: "moderate",
    responseSpeed: "medium",
    constituents: [],
    steps,
    exposureGuidance: guidance("moderate", "medium").exposure,
    dilutionGuidance: guidance("moderate", "medium").dilution,
    crossCheck: buildCrossCheck(sensorCount, library, label, []),
    computedAt: new Date().toISOString(),
    sensorCount,
    notes: ["Class-level verdict only — resolve to a specific compound for a precise, actionable result."],
  }
}

export function resolveAndRun(entityId: string, kind: "chemical" | "composite" | "class", opts: ChainOptions = {}): FeasibilityVerdict | null {
  if (kind === "chemical") {
    const c = COMPOUND_BY_ID.get(entityId) ?? userDictionaryById().get(entityId)
    return c ? runChemicalVerdict(c, opts) : null
  }
  if (kind === "composite") {
    const comp = COMPOSITE_BY_ID.get(entityId)
    return comp ? runCompositeVerdict(comp, opts) : null
  }
  if (kind === "class") {
    const key = entityId.replace(/^class:/, "")
    if (CLASS_TERMS[key]) return runClassVerdict(key, opts)
    return null
  }
  return null
}
