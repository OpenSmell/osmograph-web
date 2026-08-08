import { inferFunctionalGroups } from "./groups"
import type { Chemical } from "./types"
import type { EnrichedBoilingPoint, EnrichedChemical } from "./enrichment"

// Builds a Chemical from a live PubChem enrichment. Everything derived here is
// flagged `estimated`: molecular weight and boiling point come from PubChem,
// vapor pressure is back-computed from the boiling point via Clausius–Clapeyron
// + Trouton (or left unknown when no boiling point was fetched), and functional
// groups are inferred structurally from SMILES. The chain and confidence layer
// already know how to surface `estimated` honestly.

export function buildProvisionalChemical(
  enriched: EnrichedChemical,
  bp: EnrichedBoilingPoint | null,
): Chemical {
  const id = `prov-${slug(enriched.name)}`

  const functionalGroups = inferFunctionalGroups(enriched.smiles)
  const name = enriched.name.trim().toLowerCase()
  const inorganic = /^(n2|o2|co2|ar|he|ne|kr|xe|rn)$/.test(name) || /^(n|o2?|co2|argon|helium|neon|krypton|xenon|radon|nitrogen|oxygen|carbon dioxide)$/.test(name)
  // Reducing gases (H2, CO, H2S, NH3) and organic molecules are redox-active at
  // MOX operating temperature; oxidizing gases (O3, Cl2, NO2) respond too — in
  // the opposite direction (resistance rises). True inerts (N2, O2, CO2, noble
  // gases) are not.
  const redoxActive = functionalGroups.length > 0 || /^(h2|co|h2s|nh3|hydrogen|hydrogen sulfide|carbon monoxide|ammonia)$/.test(name)
  const oxidizing = /^(o3|cl2|no2|no|chlorine|ozone|nitrogen dioxide|nitrogen monoxide|nitric oxide)$/.test(name)

  return {
    id,
    name: enriched.name,
    synonyms: [enriched.name],
    smiles: enriched.smiles,
    props: {
      molecularWeight: {
        value: enriched.molecularWeight ?? null,
        source: enriched.molecularWeight != null ? "measured" : "unknown",
        note: enriched.molecularWeight != null ? "PubChem" : undefined,
      },
      boilingPoint: bp ? { value: bp.valueC, source: "measured", note: bp.note } : { value: null, source: "unknown" },
      vaporPressure25: bp
        ? { value: estimateVaporPressureFromBoilingPoint(bp.valueC), source: "estimated", note: "Clausius–Clapeyron + Trouton from PubChem boiling point" }
        : { value: null, source: "unknown" },
      functionalGroups,
      redoxActive,
      nonRedox: inorganic ? true : undefined,
      oxidizing: oxidizing ? true : undefined,
      odorDescriptor: undefined,
    },
    sourceRefs: enriched.source === "pubchem" ? ["PubChem (live lookup)"] : [],
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

export function estimateVaporPressureFromBoilingPoint(boilC: number): number | null {
  // Clausius–Clapeyron from the normal boiling point with Trouton's-rule ΔH_vap.
  // Same path as the estimated branch in chain.effectiveVaporPressure.
  const R = 8.314
  const tBoilK = boilC + 273.15
  const deltaHVap = 88 * tBoilK
  const pPa = 101325 * Math.exp(-(deltaHVap / R) * (1 / 298.15 - 1 / tBoilK))
  return pPa > 0 ? pPa : null
}
