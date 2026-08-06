# Smellability — Feasibility Chain

**What it answers:** *Will this substance produce a detectable response on a metal-oxide (MOX) sensor array, and how strong/fast will it be?*

The engine resolves any query (compound, food, product, class) into its volatile chemistry, then grades detectability through a 4-step physics/chemistry chain. Every step is explicit, citeable, and flags estimated values rather than fabricating data.

---

## Step 1 — Identity & properties

Each chemical carries a curated property set:

| Property | Meaning | Primary source |
|---|---|---|
| Molecular weight | g/mol | PubChem / NIST |
| Boiling point | °C | NIST Webbook |
| Vapor pressure @ 25 °C | Pa | Antoine constants (NIST) or estimation |
| Functional groups | chemical classes | curated from structure |
| Redox activity | can it undergo surface oxidation | MOX surface chemistry (see Step 4) |

## Step 2 — Volatility (does it leave the source?)

Vapor pressure at ambient temperature governs how much of the substance enters the headspace.

**Measured path:** Antoine equation in the form `log₁₀(P/mmHg) = A − B/(T/°C + C)`, then converted to Pa (`×133.322`).

**Estimated path (no Antoine constants):** Clausius–Clapeyron referenced to the boiling point:

```
P(T) = P_atm · exp[−(ΔH_vap/R)(1/T − 1/T_boil)]
```

with ΔH_vap from Trouton's rule (ΔH_vap ≈ 88·T_boil, J/mol). This is flagged `estimated`.

**Gases** (substances with boiling point below ambient) are treated as full-vapor-phase: they need no evaporation step.

Bands (Pa @ 25 °C): `≥10⁴` very high · `10³–10⁴` high · `10²–10³` moderate · `1–10²` low · `<1` negligible.

## Step 3 — Headspace concentration (how much reaches the sensor?)

The decisive number is the **saturated headspace mole fraction**, the physical upper bound in an enclosed chamber:

```
C_headspace ≈ P_vap / P_atm   (≈ P_vap/101325 × 10⁶ in ppm)
```

This is compared against a practical MOX detection floor of ~**1 ppm** for reducing VOCs (typical MQ-series spec floors; e.g. MQ2 LPG 200–10,000 ppm, MQ3 alcohol 25–5,000 ppm, MQ7 CO 20–2,000 ppm).

| Saturated headspace | Grade |
|---|---|
| ≥ 1000 ppm | strong |
| 100–1000 ppm | moderate |
| 10–100 ppm | weak |
| 1–10 ppm | marginal |
| < 1 ppm | none |

**Relative reference (informational only):** the ratio of incident molecular flux to ethanol, `flux ∝ P_vap / (M · D_air)`, where the air diffusion coefficient `D_air` uses the Fuller–Schettler–Giddings method. Because the geometry cancels in the ratio, it is scenario-invariant — but the verdict is driven by the *absolute* headspace ppm above, not this ratio.

> **Why absolute, not only relative:** ethanol is an extremely volatile reference. A compound at 5% of ethanol's headspace is still thousands of ppm and easily detected. Grading against ethanol alone would wrongly classify isoamyl acetate and cinnamaldehyde as undetectable. The absolute floor is the physically meaningful threshold.

## Step 4 — MOX reactivity (will the sensor react?)

MOX sensors detect gases that undergo surface redox at operating temperature (~300–400 °C). This follows from the sensor's operating mechanism: surface-adsorbed oxygen ions (O⁻, O²⁻) react with reducing gases, releasing electrons and lowering the metal-oxide resistance.

**Detectable classes** (reducing at the sensing surface): alcohols, aldehydes, ketones, esters, alkanes, alkenes, terpenes, aromatics, thiols, sulfides, amines, H₂, CO, and combustible gases generally.

**Hard stops** (not redox-active at MOX operating temperature): N₂, O₂ (not a *reducing* analyte), CO₂, noble gases — these do not produce the surface reduction MOX sensors measure. Carbon dioxide is a classic example: abundant in headspace, yet essentially invisible to MOX arrays.

**Boundary cases:** water is not a reducing VOC but modulates baseline resistance via humidity — an indirect, baseline-shifting response rather than an analyte signal.

See the `MOX boundaries` capability/inability map (Table 3) in `../../../interoperability/canonical_experiments/generate_tables.py`.

## Step 5 — Array capacity & cross-sensitivity (contextual)

Given `N` sensors, the array can resolve roughly this many distinct substances (from canonical experiments):

| Sensors | Distinguishable substances |
|---|---|
| 3 | 4–6 |
| 6 | 20–40 |
| 12 | 200–400 |
| 24 | 10,000+ |

This is a capacity bound, not a guarantee: distinguishing *this* substance from the ones already in your library is evaluated by label overlap and shared chemistry. A verdict is only as good as the baseline and labels you record against.

The engine's per-sensor-count constant (`MAX_SUBSTANCES` in `lib/smellability/constants.ts`) uses the upper end of each canonical range, with 4- and 5-sensor counts interpolated between the 3- and 6-sensor entries.

---

## Confidence semantics

- `high` — every property used was curated/measured.
- `medium` — some properties are estimates (flagged with amber dots).
- `low` — one or more properties unknown; the step is explicit about what it could not assess.

**We never fabricate missing data.** An unknown vapor pressure renders the volatility/signal steps "unknown" (yellow) rather than guessing a value.

---

## References

- Antoine equation constants: NIST Chemistry Webbook — https://webbook.nist.gov
- Fuller, Schettler & Giddings (1966), *A New Method for Prediction of Binary Gas-Phase Diffusion Coefficients*, Ind. Eng. Chem. 58(5), 19–27.
- Trouton's rule: Trouton (1884) *Phil. Mag.* 18, 54–57.
- MOX sensor operating principle: Korotcenkov (2007), *Metal oxides for solid-state gas sensors*, Mater. Sci. Eng. B 139, 1–23.
- Sensor ranges: Figaro / Hanwei MQ-series datasheets.
- Cross-device baseline evidence: `../../../research/calibration-experiments` and `../../../private/OPENSMELL_MASTER.md` §8.
