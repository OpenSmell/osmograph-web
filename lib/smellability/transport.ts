export const R = 8.314
export const N_A = 6.022e23
export const P_ATM = 101325

const MMHG_TO_PA = 133.322

export function vaporPressureAntoine(a: number, b: number, c: number, tempC: number): number {
  const pMmHg = Math.pow(10, a - b / (tempC + c))
  return pMmHg * MMHG_TO_PA
}

export function vaporPressureClausiusClapeyron(tempK: number, tBoilK: number, deltaHVap: number): number {
  return P_ATM * Math.exp(-(deltaHVap / R) * (1 / tempK - 1 / tBoilK))
}

export function evaporationFlux(pVap: number, molWeightKg: number, tempK: number): number {
  return pVap / Math.sqrt(2 * Math.PI * molWeightKg * R * tempK)
}

export function diffusionCoefficientFuller(
  molWeight: number,
  diffusionVolume: number,
  tempK: number,
  pressureAtm = 1,
): number {
  const M_air = 28.97
  const V_air = 20.1
  const dCm2 =
    (0.00143 * Math.pow(tempK, 1.75)) /
    (pressureAtm *
      Math.pow(Math.pow(V_air, 1 / 3) + Math.pow(diffusionVolume, 1 / 3), 2)) *
    Math.sqrt(1 / M_air + 1 / molWeight)
  return dCm2 * 1e-4
}

export function concentrationAtDistance(evapRate: number, d: number, distanceM: number): number {
  return evapRate / (4 * Math.PI * d * distanceM)
}

export function incidentFlux(concentration: number, molWeightKg: number, tempK: number): number {
  return concentration * Math.sqrt((R * tempK) / (2 * Math.PI * molWeightKg))
}

export function diffusionVolumeFromMw(molWeight: number): number {
  return 1.1 * molWeight
}

export function deltaHVapTrouton(tBoilK: number): number {
  return 88 * tBoilK
}

export interface IncidentFluxInput {
  vaporPressurePa: number
  molWeightKg: number
  diffusionVolumeCm3: number
}

export function incidentFluxProportional(input: IncidentFluxInput): number {
  const d = diffusionCoefficientFuller(input.molWeightKg * 1000, input.diffusionVolumeCm3, 298.15)
  return input.vaporPressurePa / (input.molWeightKg * d)
}

export function signalRatioVsRef(
  compound: IncidentFluxInput,
  reference: IncidentFluxInput,
): number {
  return incidentFluxProportional(compound) / incidentFluxProportional(reference)
}
