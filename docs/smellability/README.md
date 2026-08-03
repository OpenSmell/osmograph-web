# Smellability — Reading Guide (paper evaluation map)

This is the entry point to everything the Smellability engine is, how its math
works, where each formula lives in code, and which lab results constrain its
claims. Read it top to bottom, or jump to the layer you need.

---

## 1. The claims, in one line

> Smellability answers a physical question — *will this substance produce a
> detectable response on a MOX sensor array, and how strong/fast?* — with an
> explicit, citeable 4-step physics/chemistry chain that never fabricates
> missing data.

The judgment of *what the engine may claim* (and may not) is documented in
`calibration-lessons.md`, and it comes from **measured failures in the lab**, not
from the web implementation. That is the single most important fact for a paper
evaluation: the honesty rules are evidence-driven.

---

## 2. The documentation, in order

| Doc | What it covers |
|---|---|
| [`feasibility-chain.md`](feasibility-chain.md) | The 4-step physics chain: identity → volatility → headspace → MOX reactivity → array capacity. All equations, thresholds, and confidence semantics. |
| [`substance-profiles.md`](substance-profiles.md) | How everyday things (banana, cinnamon) become weighted composite mixtures; worked examples with full numbers; human-vs-MOX sensitivity asymmetry. |
| [`calibration-lessons.md`](calibration-lessons.md) | The measured lab evidence and how each finding became a constraint on what a web verdict may claim. |
| [`OPENSMELL_MASTER.md` §3](../../../opensmell/docs/OPENSMELL_MASTER.md) | The `.osmell` v1.1.0 container spec (ZIP + CSV + JSON), quality taxonomy, and manifest conventions. |

Start with `feasibility-chain.md` if you want the math, or
`calibration-lessons.md` if you want to know *why the design is shaped the way
it is*.

---

## 3. The math, and where it lives in code

All formulas in the docs have a one-to-one home in `lib/smellability/`:

| Physics / math | Code |
|---|---|
| Antoine: `log₁₀(P/mmHg) = A − B/(T/°C + C)`, → Pa | `transport.ts:7` `vaporPressureAntoine` |
| Clausius–Clapeyron from boiling point + Trouton ΔH_vap ≈ 88·T_boil | `transport.ts:12` / `transport.ts:48` `vaporPressureClausiusClapeyron`, `deltaHVapTrouton` |
| Evaporation flux (Hertz–Knudsen form) | `transport.ts:16` `evaporationFlux` |
| Fuller–Schettler–Giddings air diffusion + scenario-invariant flux ratio to ethanol | `transport.ts:20`, `transport.ts:58`, `transport.ts:63` |
| Saturated headspace `P_vap/P_atm × 10⁶` ppm vs ~1 ppm MOX floor | `chain.ts:110` `headspacePpm` |
| Volatility bands, headspace ppm bands, `MAX_SUBSTANCES` array-capacity table | `constants.ts` |
| Functional-group inference from SMILES (incl. Kekulé aromatic normalization) | `groups.ts` |
| The 4-step verdict chain + composite aggregation + capture guidance | `chain.ts` (`runChemicalVerdict`, `runCompositeVerdict`, `guidance`) |
| Percept mapping (which chemistry reads as what "kind") + MOX boundaries | `ontology.ts` |
| Live PubChem enrichment + boiling-point extraction (with `±` handling) | `enrichment.ts` |
| Provisional chemical builder (everything flagged `estimated`) | `provisional.ts` |
| Local tier-2 dictionary (your own saved resolutions, capped 200) | `user-dictionary.ts` |

The single best entry to the runtime logic is `chain.ts` — every step of the
chain is built as an explicit `ChainStep` with a reason string and per-value
data source, so the UI, the docs, and the math all describe the same object.

---

## 4. Tests proving it isn't a toy

`lib/smellability/__tests__/` — 90 assertions across 8 files, runnable with
`npx vitest run` from `osmograph-web/`:

| Test file | Proves |
|---|---|
| `chain.test.ts` | Verdicts for curated substances (ethanol green/strong/fast; cinnamaldehyde yellow/weak/slow; N₂ red non-redox) |
| `transport.test.ts` | Antoine vs Clausius–Clapeyron consistency, diffusion/flux math |
| `ontology.test.ts` | Percept mapping, low-volatility handling, boundary relevance |
| `groups.test.ts` | 24-fixture functional-group inference incl. Kekulé vs aromatic rings, phenol-vs-methoxy separation |
| `enrichment.test.ts` | Boiling-point parsing incl. `±` uncertainty, pug_view section-tree extraction |
| `provisional.test.ts` | Estimated-flag honesty, inorganic non-redox vs reducing-gas redox, VP-from-BP |
| `user-dictionary.test.ts` | localStorage store: save/dedupe/remove/map/200-cap |
| `live-resolution.test.ts` | End-to-end PubChem → provisional chemical → verdict → save (mocked, no network) |

---

## 5. The evidence base (in the parent repo)

The web engine's constraints are anchored to measured lab results. These live
outside `osmograph-web/`, referenced from `calibration-lessons.md`:

| Evidence | Path from this repo |
|---|---|
| Affine calibration failed 47% → 33% on real cross-device data; session-invariance proof (81.78% acc / 80.33% macro-F1) | `../../../OpenSmell-Legacy/TECHNICAL.md` |
| The calibration experiment artifacts themselves | `../../../research/calibration-experiments/` |
| Sensor theory: effective dimensionality, drift, batch ±20%, humidity common-mode | `../../../opensmell/docs/OPENSMELL_MASTER.md` §6 |
| Canonical array-capacity Table 2 and MOX-boundary Table 3 | `../../../interoperability/canonical_experiments/generate_tables.py` |
| Audit of the negative results | `../../../opensmell/docs/OPENSMELL_MASTER.md` §8 |

---

## 6. If you only read three things

1. `feasibility-chain.md` — the math and thresholds (Steps 2–3 are the physics).
2. `calibration-lessons.md` §7 — the is/is-not table: what a verdict means.
3. `../../../OpenSmell-Legacy/TECHNICAL.md` §4 — the lab evidence that shapes
   the honesty rules.
