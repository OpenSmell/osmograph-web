export type DataSource = "measured" | "estimated" | "unknown"

export interface Property<T> {
  value: T | null
  source: DataSource
  note?: string
}

export interface AntoineCoeffs {
  a: number
  b: number
  c: number
}

export interface ChemicalProperties {
  molecularWeight: Property<number>
  boilingPoint: Property<number>
  vaporPressure25: Property<number>
  antoine?: AntoineCoeffs
  functionalGroups: string[]
  redoxActive: boolean
  nonRedox?: boolean
  gas?: boolean
  odorDescriptor?: string
}

export interface Chemical {
  id: string
  name: string
  synonyms: string[]
  cas?: string
  smiles?: string
  props: ChemicalProperties
  sourceRefs: string[]
}

export type CompositeKind =
  | "food"
  | "beverage"
  | "spice"
  | "material"
  | "product"
  | "activity"
  | "other"

export interface CompositeConstituent {
  chemicalId: string
  weightFraction: Property<number>
}

export interface Composite {
  id: string
  name: string
  kind: CompositeKind
  synonyms: string[]
  constituents: CompositeConstituent[]
  notes?: string
  sourceRefs: string[]
}

export type Verdict = "green" | "yellow" | "red"
export type VerdictConfidence = "high" | "medium" | "low"
export type SignalStrength = "strong" | "moderate" | "weak" | "none"
export type ResponseSpeed = "fast" | "medium" | "slow" | "unknown"

export interface ChainValue {
  label: string
  value: string
  source: DataSource
}

export interface ChainStep {
  id: string
  label: string
  verdict: Verdict
  reason: string
  detail: string
  values: ChainValue[]
}

export interface ConstituentVerdict {
  chemicalId: string
  name: string
  weightFraction: number
  weightSource: DataSource
  steps: ChainStep[]
  verdict: Verdict
  signalStrength: SignalStrength
  responseSpeed: ResponseSpeed
  signalScore: number
}

export interface CrossCheck {
  sensorCount: number
  maxDistinguishable: number
  librarySubstances: string[]
  confusable: string[]
  note: string
}

export type ResolvedEntityKind = "chemical" | "composite" | "class"

export interface ResolvedEntity {
  kind: ResolvedEntityKind
  id: string
  name: string
  displayName: string
  matchHint: string
}

export interface FeasibilityVerdict {
  entityId: string
  entityName: string
  kind: ResolvedEntityKind
  verdict: Verdict
  confidence: VerdictConfidence
  signalStrength: SignalStrength
  responseSpeed: ResponseSpeed
  constituents: ConstituentVerdict[]
  steps: ChainStep[]
  exposureGuidance: string
  dilutionGuidance: string
  crossCheck?: CrossCheck
  computedAt: string
  sensorCount: number
  notes: string[]
}

export interface SearchCandidate extends ResolvedEntity {
  score: number
}
