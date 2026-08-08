export const AMBIENT_TEMP_C = 25
export const AMBIENT_TEMP_K = 298.15

export const DEFAULT_SENSOR_COUNT = 6
export const DEFAULT_DISTANCE_M = 0.1

export const MOX_FLOOR_PPM = 1

export const REFERENCE_CHEMICAL_ID = "ethanol"

export const MAX_SUBSTANCES: Record<number, number> = {
  3: 6,
  4: 12,
  5: 20,
  6: 40,
  12: 200,
  24: 10000,
}

export const SENSOR_COUNT_OPTIONS = [3, 4, 5, 6, 12, 24]

export const VOLATILITY_BANDS: { min: number; max: number; label: string }[] = [
  { min: 10000, max: Infinity, label: "very high" },
  { min: 1000, max: 10000, label: "high" },
  { min: 100, max: 1000, label: "moderate" },
  { min: 1, max: 100, label: "low" },
  { min: 0, max: 1, label: "negligible" },
]

export const HEADSPACE_PPM_BANDS: { min: number; max: number; label: "strong" | "moderate" | "weak" | "marginal" | "none" }[] = [
  { min: 1000, max: Infinity, label: "strong" },
  { min: 100, max: 1000, label: "moderate" },
  { min: 10, max: 100, label: "weak" },
  { min: MOX_FLOOR_PPM, max: 10, label: "marginal" },
  { min: 0, max: MOX_FLOOR_PPM, label: "none" },
]

export const SIGNAL_RATIO_BANDS: { min: number; max: number; label: "strong" | "moderate" | "weak" | "marginal" | "none" }[] = [
  { min: 1, max: Infinity, label: "strong" },
  { min: 0.1, max: 1, label: "moderate" },
  { min: 0.01, max: 0.1, label: "weak" },
  { min: 0.001, max: 0.01, label: "marginal" },
  { min: 0, max: 0.001, label: "none" },
]

type SignalBand = "strong" | "moderate" | "weak" | "marginal" | "none"

export function volatilityLabel(pVapPa: number | null): string {
  if (pVapPa == null) return "unknown"
  for (const band of VOLATILITY_BANDS) {
    if (pVapPa >= band.min && pVapPa < band.max) return band.label
  }
  return "unknown"
}

export function headspacePpmBand(ppm: number): SignalBand {
  for (const band of HEADSPACE_PPM_BANDS) {
    if (ppm >= band.min && ppm < band.max) return band.label
  }
  return "none"
}

export function signalBandLabel(ratio: number): SignalBand {
  for (const band of SIGNAL_RATIO_BANDS) {
    if (ratio >= band.min && ratio < band.max) return band.label
  }
  return "none"
}

export const CLASS_TERMS: Record<string, { label: string; functionalGroups: string[] }> = {
  alcohol: { label: "Alcohols", functionalGroups: ["alcohol"] },
  aldehyde: { label: "Aldehydes", functionalGroups: ["aldehyde"] },
  ketone: { label: "Ketones", functionalGroups: ["ketone"] },
  ester: { label: "Esters", functionalGroups: ["ester"] },
  "carboxylic acid": { label: "Carboxylic acids", functionalGroups: ["carboxylic acid"] },
  alkane: { label: "Alkanes", functionalGroups: ["alkane"] },
  alkene: { label: "Alkenes", functionalGroups: ["alkene"] },
  terpene: { label: "Terpenes", functionalGroups: ["terpene"] },
  thiol: { label: "Thiols / mercaptans", functionalGroups: ["thiol"] },
  sulfide: { label: "Organic sulfides", functionalGroups: ["thioether", "sulfur"] },
  amine: { label: "Amines", functionalGroups: ["amine"] },
  phenol: { label: "Phenols", functionalGroups: ["phenol"] },
  aromatic: { label: "Aromatic hydrocarbons", functionalGroups: ["aromatic"] },
  ether: { label: "Ethers", functionalGroups: ["ether"] },
  disulfide: { label: "Disulfides", functionalGroups: ["thioether", "sulfur"] },
  furan: { label: "Furans", functionalGroups: ["furan", "aromatic"] },
  lactone: { label: "Lactones", functionalGroups: ["ester"] },
  alkyne: { label: "Alkynes", functionalGroups: ["alkyne"] },
  amide: { label: "Amides", functionalGroups: ["amide"] },
  "nitro compound": { label: "Nitro compounds", functionalGroups: ["nitro"] },
  "aromatic compound": { label: "Aromatic compounds", functionalGroups: ["aromatic"] },
  "sulfur compound": { label: "Sulfur compounds", functionalGroups: ["sulfur", "thiol"] },
  "nitrogen compound": { label: "Nitrogen compounds", functionalGroups: ["amine"] },
  "volatile organic compound": { label: "Volatile organic compounds (VOC)", functionalGroups: [] },
  "chlorinated compound": { label: "Chlorinated compounds", functionalGroups: [] },
  halogen: { label: "Halogen compounds", functionalGroups: [] },
  sweetener: { label: "Sweeteners", functionalGroups: [] },
}
