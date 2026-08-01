# Osmograph Web — Consolidated Documentation (single-file reference)

**Purpose:** one self-contained document for analysis. It covers every
feature of `osmograph-web`, every formula and its code home, the `.osmell`
format spec, the Smellability engine, the lab evidence that constrains claims,
and the test map. Anything in this file can be verified against the code paths
listed next to it.

**Repo:** `osmograph-web/` · **App:** served at `mox.opensmell.xyz` · **Stack:**
Next.js 16 (App Router, Turbopack), TypeScript, Tailwind v4, shadcn/ui, jszip,
recharts, vitest.

**Entry points:** `/` renders `SuiteShell` (`app/page.tsx`); `/mox` redirects
to `/` (`app/mox/page.tsx`). Root layout: Geist fonts, `ThemeProvider`
default dark, storage key `opensmell-theme`, favicon `/opensmell_logo.png`.

---

## 1. The product at a glance

`osmograph-web` is the web analytics platform for MOX (metal-oxide
semiconductor) electronic-nose data. One shell (`components/suite/suite-shell.tsx`)
holds five views:

| View | Nav id | What it does |
|---|---|---|
| Library | `library` | All imported sessions, grouped by experiment (`groupId`); per-session quality badge, detail drawer, `.osmell` export |
| Import | `import` | Drop `.csv` / `.txt` / `.osmell` files (many at once); auto channel detection, baseline normalization, quality scoring, adds to library |
| Compare | `compare` | Overlay sessions normalized to their own R0 on a shared relative-time axis; pick channel; select via Library checkboxes |
| Train | `train` | Readiness-gated classifier trainer (per-class minimums); actual pipeline ships in a later slice |
| Smellability | `smellability` | Physics/chemistry verdict: will a substance be detectable on your array, how strong/fast, and can the array tell it apart from your library |

State: `SessionProvider` (`session-context.tsx`) holds the in-memory library;
nothing is persisted except localStorage keys listed in §10. No accounts, no
backend.

---

## 2. The `.osmell` format (spec v1.1.0)

Single source of truth: `OSMELL_FORMAT_SPEC.md` (648 lines). Summary:

### 2.1 Container

- `.osmell` file = a ZIP archive (magic `PK\x03\x04`).
- Required members: `manifest.json`, `data.csv`.
- Optional members: `baseline.csv`, `events.json`, `quality.json`.
- MIME: `application/vnd.opensmell.osmell`. Readers MUST preserve unknown
  members on round-trip. `formatVersion` major `1.*` is backward-readable.
- `.osm` is owned by OpenStreetMap, so the ecosystem name is `.osmell`.

### 2.2 Manifest schema (`manifest.json`)

- `osmell.formatVersion` (required, e.g. `"1.1.0"`), `specUrl` (optional).
- `sensor`: `sensorType` (`mox | miris | electrochemical | other | unknown`,
  required); `device.{model,serial,firmware}`; `channels[]` (required:
  `{id, unit, target?}`, `id` must match data.csv header exactly); `samplingRateHz`;
  `adcBits`; `adcMax` (12-bit → 4095; used as clipping bound); `timeColumn`
  (`timestamp_ms` | `elapsed_ms`, must be first CSV column).
- `session`: `role` (`baseline | exposure | single`, required), `label`,
  `groupId` (UUIDv4 linking baseline + exposures), `recordedAt` (ISO UTC),
  `durationMs`, `notes`.
- `baseline`: `source` (`explicit | auto | none`, required — MUST be set),
  `file` (when `explicit`), `r0Samples` (default 15).
- `software`: `recorder`, `importer`.

### 2.3 Data conventions (`data.csv`)

- UTF-8, no BOM, header first, time column first, integer ms, rows ascending.
- Non-finite values invalid; missing data = omitted rows, never sentinels.
- Channel `unit` SHOULD be `adc | volt | ohm | ppm | norm`. `mox` pipelines
  operate on `adc`/`ohm`; normalize after reading, never mutate the file.

### 2.4 Session protocol

- Recommended: separate explicit `baseline` + one `exposure` per sample,
  sharing a `groupId`. Never auto-detect phases.
- Import Wizard escape hatch: single continuous file → **human-confirmed**
  midpoint split into two `.osmell` files with shared `groupId`.
- Auto-R0: `R0` = median of first `r0Samples` (default 15, ~1.5 s @10 Hz).
  Declared as `baseline.source: "auto"` and MUST be flagged as weaker
  evidence (quality report flags it; §7.1.4 caps the credit in the spec).

### 2.5 Sensor-agnostic routing

`sensorType` selects the pipeline: `mox` → R0 normalization + kinetics;
`miris`/`electrochemical` reserved; `other`/`unknown` → pass-through with
basic quality only. Readers MUST NOT infer sensorType from channel names.

---

## 3. Normalization math (`lib/osmell/normalize.ts`)

For channel values `x[0..N-1]`:

```
R0 = median(baseline channel)                              // baseline.source == "explicit"
   = median(x[0..r0Samples-1])                             // baseline.source == "auto"  (r0Samples default 15)
normalized[i] = (x[i] − R0) / R0                           // unitless, session-invariant
cv = std(x) / R0                                           // R0 > 0
dead  ⟺  cv < 0.001                                        // DEAD_CV_THRESHOLD
```

- R0 fallback when median ≤ 0: mean of positive values, else 1.
- `normalize.ts:63` `baselineForChannel` returns `{r0, windowValues, cv}`.
- `normalize.ts:90` `channelStats` computes min/max/mean/std/cv/dead/span.
- `normalize.ts:85` `normalizedSeries` returns NaN series if R0 not finite/≤0.

---

## 4. Data-quality scoring

Two documents describe scoring. **The spec (§7) and the shipped implementation
differ — this is a real, currently-unreconciled discrepancy.**

### 4.1 Spec §7 (as written in OSMELL_FORMAT_SPEC.md)

Seven sub-scores, weights sum to 1.00:

| Sub-score | Weight | Formula |
|---|---|---|
| Continuity `C` | 0.15 | regular(k) ⟺ \|g[k] − T\| ≤ 0.10·T (T = 1000/samplingRateHz ms); C = 100·regular/(N−1); median-gap T if undeclared |
| Dynamic range `D` | 0.10 | span_k = (max−min)/adcMax; D_k = 100·clamp(span_k·10, 0, 1); mean over channels (dead excluded) |
| Saturation-free `S` | 0.10 | clipped_k = count(x ≥ adcMax OR x ≤ 0); S_k = 100·(1 − clipped/N); mean |
| Baseline stability `B` | 0.20 | cv_window = std(window)/R0; B = 100·clamp(1 − cv_window/0.05, 0, 1); **auto-R0 capped at 50**, reason `auto_r0`; no R0 → 0, reason `no_baseline` |
| Signal strength / SNR `G` | 0.20 | peak_k = max\|(x−R0)/R0\|; noise_k = std(window)/R0; SNR = peak/max(noise,1e-6); G_k = 100·clamp(SNR/10, 0, 1); G = max over channels; null unless role=exposure with R0 |
| Recovery completeness `R` | 0.15 | final_win_k = median of last 15 normalized; recovered = 1 − clamp(\|final_win\|/max(peak,1e-6), 0, 1); R_k = 100·recovered; mean; null unless exposure+R0 |
| Duration `T` | 0.10 | t_s = (N−1)/samplingRateHz; T = 100·clamp(t_s/60, 0, 1) |

Total: `score = round( Σ w_i·sub_i / Σ w_i )` over non-null sub-scores.
Badges: 90–100 Excellent, 75–89 Good, 50–74 Fair, 0–49 Poor.
Report shape includes `subscores`, `flags` (`deadSensors`, `unsortedRows`,
`nonFiniteSamples`, `usedDefaultAdcMax`, `usedMedianSamplingRate`), `reasons`,
`notes`.

### 4.2 Shipped implementation (`lib/osmell/quality.ts`, `session-cards.tsx`)

`computeQuality` scores **six** sub-scores — Recovery completeness is **not
implemented** — with these weights:

```
weights = { continuity: 0.20, dynamicRange: 0.15, saturationFree: 0.15,
            baselineStability: 0.20, signalStrength: 0.20, durationAdequacy: 0.10 }
```

Differences vs spec:
- No `recoveryCompleteness`; its 0.15 weight is redistributed to
  continuity (+0.05) and dynamicRange/saturationFree (+0.05 each).
- Baseline stability is **not capped at 50** for `auto` sources (spec says it
  must be; flags.noBaseline only drives a note and a 0 score when `none`).
- Duration uses `sampleCount / samplingRateHz` (not `(N−1)/rate`).
- Continuity returns 50 (reason `irregular_gaps` + note
  `no_sampling_rate_declared`) when no rate is declared, instead of using the
  median gap for full scoring.
- Dynamic range uses `clamp((span/adcMax) · (1/0.10), 0, 1)` — same as spec.
- Signal strength: `noise = max(base.cv, 1e-6)`; `G = max over channels`.
- Total: round of weighted mean over non-null; badge adds `"Unknown"` when
  total is null (non-exposure role).

The Library `QualityCard` renders the six implemented sub-scores with the
implemented weights (Continuity 20%, Dynamic range 15%, Saturation-free 15%,
Baseline stability 20%, Signal strength 20%, Duration 10%).

---

## 5. MOX feature extraction (`lib/osmell/processors.ts`)

`processMox(file)` per channel (dead channels excluded):

- `relativeAmplitude` = max\|normalized\|; `direction` = ±1 (sign of peak).
- `riseTimeMs` = time to cross from 10% to 90% of the response span.
- `auc` = trapezoidal integral of the normalized series over time.
- `decayTimeMs` reserved (always null). R0 and `dead` reported.

`runProcessor` routes by sensorType. `guessSensorType` maps a header to `mox`
when ≥2 of `[VOC, Alcohol, LPG, CO, NO2, C2H5OH]` appear. The spec's reference
framework extracts 187 features per recording (relative amplitude, rise/decay
time, AUC, saturation index, multi-exponential recovery fits); the web ships a
small subset for display.

CSV parser (`csv.ts`): quoted-field aware (`""` escape), trims rows, skips
`#` comments, requires `timestamp_ms`/`elapsed_ms`, counts non-finite values,
detects + re-sorts out-of-order rows, guesses sampling rate from median gap.

IO (`io.ts`): `parseOsmell` (jszip, validates header↔channels, reads
`events.json`), `buildOsmell` (writes manifest + csv + optional events,
DEFLATE), `defaultFileName` → `label_role_date.osmell`.

---

## 6. Smellability engine

### 6.1 The claim

> Will this substance produce a detectable response on a MOX array, and how
> strong/fast? Answered with an explicit 4-step physics/chemistry chain that
> never fabricates missing data.

It grades a **physical feasibility** (volatility × redox vs an array capacity
bound), not a calibrated measurement. Everything is built as explicit
`ChainStep` objects (reason string + per-value data source) so the UI, docs,
and math describe the same object (`chain.ts:138` `runConstituentChain`).

### 6.2 Physical constants (`lib/smellability/transport.ts`, `constants.ts`)

```
R = 8.314 J/(mol·K)         N_A = 6.022e23
P_ATM = 101325 Pa           1 mmHg = 133.322 Pa
AMBIENT_TEMP_C = 25          AMBIENT_TEMP_K = 298.15
MOX_FLOOR_PPM = 1            REFERENCE = ethanol
DEFAULT_SENSOR_COUNT = 6     DEFAULT_DISTANCE_M = 0.1
```

### 6.3 The four steps (`chain.ts`)

**Step 1 — Identity & properties.** Each chemical carries molecular weight,
boiling point, vapor pressure @25 °C, functional groups, redox activity, CAS,
SMILES, odor descriptor, source refs (`compounds.ts`, 46 curated compounds).

**Step 2 — Volatility.** Vapor pressure at ambient temp, precedence
(`chain.ts:73` `effectiveVaporPressure`):

1. Curated `vaporPressure25` (source `measured`).
2. Antoine equation (source `measured`):

   ```
   log10(P/mmHg) = A − B/(T/°C + C)          transport.ts:7
   P_Pa = 10^(A − B/(T+C)) × 133.322
   ```

3. Gas (boiling point below ambient): treated as full vapor phase,
   `pa = 101325`, source `measured`.
4. Otherwise Clausius–Clapeyron from boiling point + Trouton enthalpy
   (source `estimated`):

   ```
   P(T) = P_ATM · exp[−(ΔH_vap/R)(1/T − 1/T_boil)]     transport.ts:12
   ΔH_vap = 88 · T_boil  (J/mol, Trouton's rule)        transport.ts:48
   ```

5. Nothing known → `pa = 0`, source `unknown`.

Volatility bands (Pa @25 °C), `constants.ts:22`:

| Band | Range |
|---|---|
| very high | ≥ 10⁴ |
| high | 10³ – 10⁴ |
| moderate | 10² – 10³ |
| low | 1 – 10² |
| negligible | < 1 |

**Step 3 — Headspace concentration.** Saturated headspace mole fraction is the
physical upper bound in an enclosed chamber (`chain.ts:110`):

```
C_headspace = P_vap / P_atm          in ppm: (P_vap / 101325) × 10⁶
```

Compared against `MOX_FLOOR_PPM = 1` (MQ-series spec floors; e.g. MQ2 LPG
200–10,000 ppm, MQ3 alcohol 25–5,000 ppm, MQ7 CO 20–2,000 ppm):

| Saturated headspace | Grade |
|---|---|
| ≥ 1000 ppm | strong |
| 100–1000 ppm | moderate |
| 10–100 ppm | weak |
| 1–10 ppm | marginal |
| < 1 ppm | none |

**Relative reference (informational only):** incident flux ratio to ethanol,

```
flux ∝ P_vap / (M_kg · D_air)
```

with D_air from Fuller–Schettler–Giddings (`transport.ts:20`):

```
M_air = 28.97,  V_air = 20.1
D_cm²/s = 0.00143 · T^1.75 / (P_atm · (V_air^(1/3) + V_i^(1/3))²) · sqrt(1/M_air + 1/M)
D_m²/s = D_cm²/s × 1e-4
V_i = diffusionVolumeFromMw(M) = 1.1 · M (g/mol)        transport.ts:44
```

The verdict is driven by **absolute** headspace ppm, not this ratio — ethanol
is so volatile that 5% of its headspace is still thousands of ppm.

Also present in `transport.ts` (unused by the chain verdict but tested):
Hertz–Knudsen evaporation flux `evaporationFlux = P_vap/√(2π·M_kg·R·T)`
(`transport.ts:16`); `concentrationAtDistance = evapRate/(4π·D·r)`
(`transport.ts:36`); `incidentFlux = conc·√(R·T/(2π·M_kg))`
(`transport.ts:40`); `incidentFluxProportional` (`transport.ts:58`);
`signalRatioVsRef` (`transport.ts:63`).

**Step 4 — MOX reactivity.** MOX detects gases that reduce the sensor surface
(O⁻/O²⁻ surface oxygen reacting with reducing gases at ~300–400 °C).
Redox-active classes: alcohols, aldehydes, ketones, esters, alkanes, alkenes,
terpenes, aromatics, thiols, sulfides, amines, H₂, CO, combustible gases.
Hard stops (nonRedox): N₂, O₂ (not a reducing analyte), CO₂, noble gases.
Boundary: water isn't a reducing VOC but modulates baseline (humidity).

**Step 5 — Array capacity & cross-sensitivity (contextual).** Capacity bound
(`MAX_SUBSTANCES`, `constants.ts:11`; from canonical Table 2):

| Sensors | Distinguishable substances |
|---|---|
| 3 | 6 |
| 4 | 12 (interpolated) |
| 5 | 20 (interpolated) |
| 6 | 40 |
| 12 | 200 |
| 24 | 10,000 |

`buildCrossCheck` (`chain.ts:281`) also scans the user's library labels for
name/synonym overlap and flags "possible overlap" substances. A verdict is only
as good as the labeled baseline/exposure sessions recorded against it.

### 6.4 Verdict semantics

- `verdict`: `green` (detectable) / `yellow` (partially detectable) / `red`
  (not detectable). Worst step wins (`worstVerdict`, severity green 0 < yellow
  1 < red 2).
- `signalStrength`: strong / moderate / weak / none.
- `responseSpeed` (`chain.ts:61`): gas or P_vap ≥ 1000 Pa → fast; ≥ 100 →
  medium; ≥ 1 → slow; else unknown.
- `confidence` (`chain.ts:274`): any source `unknown` → low; any `estimated` →
  medium; all `measured` → high. **Never fabricate missing data.**
- Guidance (`chain.ts:298`) prescribes baseline → exposure → recovery, tuned
  by expected signal: short 10–30 s exposures for strong/fast, maximized
  headspace + 60–120 s windows for weak, no dilution for weak, ≈1:10 dilution
  for strong/fast.

### 6.5 Composite (mixture) verdicts (`chain.ts:356`, `composites.ts`)

Everyday substances are weighted mixtures. `runCompositeVerdict`:

1. Run the full chain on every constituent.
2. Normalize weight fractions to sum 1.
3. `redWeight > 0.5` → red; `nonGreenWeight > 0.4` → yellow.
4. Signal/speed inherited from the **dominant** constituent (max
   `weightFraction × signalScore`) — a trace volatile member can't flip a
   low-volatility-dominant mixture (cinnamon stays weak despite 5% limonene).
5. Confidence: low if any constituent unknown, medium if any weight/property
   estimated, high only if all measured.

27 seeded composites: banana, cinnamon, coffee, garlic, peppermint, lemon,
orange, strawberry, apple, tomato, vinegar, wine, beer, bread, spoiled-milk,
gasoline, wood-smoke, paint-thinner, nail-polish-remover, hand-sanitizer,
natural-gas, propane-leak, sewer, rotten-egg, car-exhaust, ripe-fruit-gas
(ethylene). Each carries literature `sourceRefs` (FlavorDB, PubChem, GC-MS
studies). Weights are flagged `estimated` (ripeness/cultivar variance).

Worked examples:
- **Banana** — 7 constituents; isoamyl acetate 0.50 @700 Pa (≈6,900 ppm,
  strong) + isoamyl butyrate 0.15 (≈590 ppm) + butyl acetate 0.10 (≈13,100
  ppm) + isoamyl isovalerate 0.10 (≈390 ppm) + hexanal 0.05 (≈13,100 ppm) +
  (E)-2-hexenal 0.05 (≈5,900 ppm) + 1-hexanol 0.05 (≈1,300 ppm) → **green,
  strong, fast**; guidance: short exposures 10–30 s, enclosed chamber, start
  ≈1:10.
- **Cinnamon** — cinnamaldehyde 0.65 @1.3 Pa (≈13 ppm, weak) + eugenol 0.20
  @2.7 Pa (≈27 ppm, weak) + linalool 0.05 (≈260 ppm) + limonene 0.05 (≈2,000
  ppm) → **yellow, weak, slow**; guidance: maximize headspace (warm, more
  surface), 60–120 s, no dilution.

**Human vs MOX asymmetry:** human detection thresholds are ppb-level; the MOX
floor is ~1 ppm. A spice you smell clearly can still be `yellow` on the array.
The verdict grades the *instrument*, not the smell.

### 6.6 Class verdicts (`chain.ts:432`)

`runClassVerdict` for the 14 `CLASS_TERMS` (alcohol, aldehyde, ketone, ester,
carboxylic acid, alkane, alkene, terpene, thiol, sulfide, amine, phenol,
aromatic, ether). Always `yellow`, `low` confidence, `moderate`/`medium`, with
a note to resolve to a specific compound.

### 6.7 Percept mapping (`ontology.ts`)

14 percepts map chemistry → what the array "reads as" (fruity-ester,
citrus-terpenic, green-leafy, floral, minty, spicy-balsamic, roasted-caramel,
smoky-phenolic, sulfurous, ammoniacal, solvent-industrial, alcoholic,
sour-acidic, neutral-gas). `perceptsFor` matches by functional group or
keyword. Low-volatility percepts: `{spicy-balsamic, smoky-phenolic}`.

9 MOX boundaries (can: rough family, size ordering, volatility, redox activity;
cannot: exact structure/isomers, absolute ppm, non-redox gases, trace <1 ppm,
mixture decomposition). `relevantBoundaries` flags which "cannot" apply to a
given verdict; `perceptualSummary` phrases it for the UI.

---

## 7. Live resolution (PubChem) & provisional chemistry

### 7.1 Enrichment (`lib/smellability/enrichment.ts`)

- `lookupPubChem(query)` → property endpoint:
  `pug/compound/name/{q}/property/MolecularFormula,MolecularWeight,IUPACName,IsomericSMILES/JSON`.
  ~1.5 s cold. Cached in localStorage `osmell-pubchem-cache`, cap 200,
  LRU-by-order eviction. Requests throttled to ≥300 ms apart.
  Returns `{name, molecularFormula?, molecularWeight?, iupacName?, smiles?,
  source:"pubchem", fetchedAt}`. PubChem returns **Kekulé** SMILES (uppercase
  C with alternating `=` bonds), unlike the curated dictionary's lowercase
  aromatic `c1ccccc1`.
- `lookupPubChemBoilingPoint(query)` → resolves CID via the fast property
  endpoint (`CanonicalSMILES`), then:
  `pug_view/data/compound/{cid}/JSON?heading=Boiling%20Point`, 8 s abort
  timeout. ~7 s cold, 1.5–2.5 s warm. Recursively walks the section tree
  (`extractBoilingPointC`) and returns the first plausible °C value in
  (−200, 600).
- `parseBoilingPoint` regex handles PubChem's uncertainty notation:
  `"281.6±35.0 °C"` → 281.6 (value before the ±). Verified: ethanol 78.2 °C,
  vanillin 285 °C.

### 7.2 Provisional chemical builder (`lib/smellability/provisional.ts`)

`buildProvisionalChemical(enriched, bp)` → `Chemical` where:
- molecularWeight + boilingPoint from PubChem → `measured` (PubChem).
- vapor pressure back-computed from BP via Clausius–Clapeyron + Trouton →
  `estimated` (or `unknown` when no BP).
- functional groups inferred structurally from SMILES (see §8).
- `redoxActive`: true when groups exist or it's a reducing gas
  (H₂/CO/H₂S/NH₃); `nonRedox: true` for inerts (N₂, O₂, CO₂, Ar, He, Ne).
- id: `prov-{slug}`, sourceRefs `["PubChem (live lookup)"]`.

The chain + confidence layer already surface `estimated` honestly. UI shows an
amber banner: "Provisional — resolved live from PubChem. Amber dots mark
estimated properties; we never fabricate missing data."

### 7.3 Local tier-2 dictionary (`user-dictionary.ts`)

localStorage `osmell-user-dictionary`, cap 200, dedupe by id. Entries join the
search surface clearly marked `my dictionary · estimated` (score −5 penalty).
No network, no account — "the user's own growing lab notebook." Contribute
requests queue in localStorage `osmell-contributions`.

---

## 8. Functional-group inference from SMILES (`groups.ts`)

A deliberately conservative structural heuristic (not a full SMILES parser),
so live-fetched chemicals run through the same chain as curated ones.

- `scanSmiles`: lightweight scanner (bonds `=`, `#`, `-`, `/`, `\`; branches
  `()`; ring closures by digit and `%nn`; bracket atoms). Recognizes both
  lowercase aromatic `c1ccccc1` (curated) and Kekulé `C1=CC=CC=C1` (PubChem).
- Kekulé ring detection: 6-ring must be all C with exactly 3 non-adjacent
  double bonds; 5-ring must be 4 C + 1 hetero (O/N/S) with 2 separated doubles.
  `kekuleToAromatic` rewrites ring atoms to lowercase.
- **Phenol vs methoxy:** connectivity-based — an O-H single-bonded to a ring
  carbon is a phenol; Ar–O–CH₃ is an ether. A text pattern alone cannot
  separate them.
- Inferred groups: `aromatic, sulfur, amine, carboxylic acid, ester, ketone,
  diketone, aldehyde, phenol, alcohol, ether, thiol, thioether, alkene, furan,
  alkane`. Terpene is deliberately NOT inferable from SMILES (keyword/odor
  matching only).
- 24 test fixtures prove group inference incl. Kekulé vs aromatic rings and
  phenol-vs-methoxy separation.

---

## 9. Search (`lib/smellability/search.ts`)

- `normalizeQuery`: lowercase, collapse whitespace, trim.
- Field scoring: exact = 100, starts-with (len ≥2) = 75, contains (len ≥2) =
  55, all query tokens contained = 65; CAS exact = 95; SMILES exact = 90;
  user-dictionary entries −5. Threshold ≥ 40, top-8 sorted.
- Sources searched: 46 compounds, user dictionary, 27 composites, 14 classes.
- `exactResolve` only accepts a perfect (≥100) match — used for
  name-first resolution.
- Smellability UI triggers suggestions at `query.trim().length >= 2`; at zero
  candidates it offers **"Not in the dictionary — resolve live via PubChem"**,
  plus a "request one" curation dialog.

---

## 10. Client-side storage keys

| Key | Purpose | Cap |
|---|---|---|
| `osmell-bench` | Pinned Smellability verdicts (bench) | 12 entries, LRU |
| `osmell-user-dictionary` | Saved provisional chemicals | 200 |
| `osmell-pubchem-cache` | Enriched PubChem lookups | 200 |
| `osmell-contributions` | Curation request queue | unbounded |
| `opensmell-theme` | Theme (`dark` default) | — |

Sessions are in-memory only (React context); refreshing clears the library.

---

## 11. Import (multi-file)

`import-view.tsx` accepts `.csv`, `.txt`, `.osmell`, **multiple at once**,
with drag-and-drop. Sequential processing loop (per-file `addSession`, atomic,
so a failed file never blocks the rest) shows "Parsing and scoring N of M…"
progress, then a results list: per-file quality badge for successes, inline
error per failure; a single successful file shows the full `SessionDetail`
view with Export `.osmell`.

For loose CSVs it builds a manifest: `formatVersion "1.0.0"`, `sensorType
"mox"`, channels `unit:"adc"`, `adcBits 12`, `adcMax 4095`, `samplingRateHz`
from median gap (or undefined), `role "exposure"`, label from filename,
`baseline.source "auto"`, `r0Samples 15`. `.osmell` files are parsed as-is and
rescored.

---

## 12. Compare (overlay)

`compare-view.tsx` plots each selected session's normalized response
`(R − R0)/R0` for one channel on a shared relative-time axis (`t = i/10` s),
R0 from explicit baseline or auto-R0 (first 15). Recharts line chart; channel
selector; note explains R0 provenance. Selection happens via Library
checkboxes (`selectedIds`). Compare view itself is the suite's "session-level"
comparison; the Smellability bench is the "verdict-level" comparison (see §14).

---

## 13. Train (readiness gate)

`train-view.tsx` implements a per-class gate — **not a flat count**:

```
MIN_PER_CLASS = 5
MIN_CLASSES = 2
ready ⟺ ≥2 distinct labels AND every label has ≥5 labeled exposures
```

Rationale (documented in code): with ~7 features per channel across an array
the feature vector is high-dimensional while a MOX response is dominated by a
handful of variance sources (analyte chemistry, batch sensitivity ±20%,
humidity common-mode). Fewer than 5 sessions per label cannot hold one out in
cross-validation without the model having seen every sample of that label —
below it, training would fit drift, not chemistry.

UI: stat cards (labeled exposures, distinct labels, readiness), per-label
progress bars (amber below threshold, green at/above), amber warning naming
the deficient labels, and a blocked message explaining the memorization trap.
The actual training pipeline (187-feature extraction per session, split by
label, fit, cross-validated accuracy) is declared "coming in the next slice."

---

## 14. Smellability UI + bench (`smellability-view.tsx`, 1479 lines)

- Search box with suggestion dropdown (compounds/composites/classes/user
  dict) and live-resolve fallback; example chips; curation dialog.
- Curated result card: verdict chip (Detectable/Partially/Not detectable),
  signal chip, speed, confidence; expandable `StepsList` (4 steps, each with
  reason/detail/values and measured/estimated/unknown source dots);
  constituents list with weight bars; recommended protocol card
  (exposure/dilution); "Array & cross-sensitivity" card (sensor-count select,
  `≈ maxDistinguishable`, possible library overlap badges); "What MOX can &
  can't tell you" boundaries card; "Method" explainer; **Pin to bench**;
  Export report (JSON).
- Live result card (`LiveResultCard`): amber "Provisional" banner, provenance
  panel (VP estimated from BP via CC+Trouton, groups inferred structurally,
  MW & BP from PubChem measured), Add-to-dictionary (tier-2), Contribute,
  Pin-to-bench, Clear. "Resolving…" card during cold lookups; resolve-failure
  card offers curation request.
- **Bench:** pinned verdicts persist via `osmell-bench`; sortable columns
  (name/verdict/signal/speed/confidence, cycle asc/desc); row click opens a
  snapshot detail card (key facts + steps); checkboxes select 2–4 for
  **side-by-side** verdict comparison columns.
- `librarySubstances` = labels of imported sessions, fed into the cross-check.

---

## 15. The honesty rules (evidence-driven)

The web verdicts' limits come from **measured lab failures**, documented in
`docs/smellability/calibration-lessons.md`:

1. **Affine calibration failed** on real cross-device data (47% → 33%
   accuracy); root cause: assumed a linear form between devices. → Engine
   never claims calibrated ppm; headspace ppm is a thermodynamic estimate.
   (`OpenSmell-Legacy/TECHNICAL.md` §4.1, `research/calibration-experiments/`.)
2. **Pure-anchor calibration can't cover odorant space** — six pure compounds
   cover ~0.1% of 4,565 odorants (convex-hull analysis). → Ship a
   *contribution* loop (labeled exposures grow a community dataset), not a
   "calibrate me to these bottles" flow.
   (`Chemoprint/validation/convex_hull.py`, `Chemoprint/README.md` §6.)
3. **Session invariance comes from learning** — universal encoder 1D-CNN on
   held-out measurement sessions: **81.78% accuracy / 80.33% macro-F1** vs
   pre-registered >70% (random baseline 2%). Latent space is session-invariant
   for *trained* substances; NOT zero-shot generalizable. → Capacity table is
   a bound assuming labeled sessions.
   (`OpenSmell-Legacy/TECHNICAL.md` §4.2.)
4. **Effective dimensionality ≪ sensor count** — two same-family MOX sensors
   ~1 dim, three ~1.5–2, four ~2–3; humidity is common-mode across SnO₂
   channels. → `MAX_SUBSTANCES` uses conservative top-of-range values;
   distinguishing isomers (limonene vs pinene) is out of scope.
   (`opensmell/docs/SENSOR_THEORY.md`.)
5. **Drift / batch ±20% / humidity set the capture rules** — guidance always
   prescribes clean-air baseline → exposure → recovery; text varies with
   expected signal. This is the closest the web can get to "calibration"
   without hardware assumptions.
6. **Normalization finding** — z-scores beat Rs/R₀ for encoder input; paradigm
   features outperform statistical features cross-device. → `.osmell` must
   preserve raw + baseline structure so any client picks its normalization.
   (`research/calibration-experiments/README.md`, `run_rsr0.py`,
   `run_ablation.py`.)

### Is / is-not table

| The verdict **is** | The verdict **is not** |
|---|---|
| Physical feasibility (volatility × redox) | A calibrated concentration |
| A capacity grade within your labeled library | A guarantee of mixture decomposition |
| Honest uncertainty (low/medium when estimated) | A promise across unseen devices/sessions |
| Actionable capture guidance | A replacement for the recorder protocol |

---

## 16. Docs already in the repo

- `OSMELL_FORMAT_SPEC.md` — v1.1.0, the single source of truth for `.osmell`.
- `docs/smellability/README.md` — reading guide / paper-evaluation map
  (doc → code line → test → lab evidence).
- `docs/smellability/feasibility-chain.md` — the 4-step chain + thresholds.
- `docs/smellability/substance-profiles.md` — composite worked examples.
- `docs/smellability/calibration-lessons.md` — lab evidence → constraints.

External evidence (parent repo): `OpenSmell-Legacy/TECHNICAL.md`,
`research/calibration-experiments/`, `opensmell/docs/SENSOR_THEORY.md`,
`interoperability/canonical_experiments/generate_tables.py` (Table 2 capacity,
Table 3 MOX boundaries), `AUDIT_REPORT.md`.

---

## 17. Test map (`lib/smellability/__tests__/` — 8 files, 90 assertions)

Run with `npx vitest run` from `osmograph-web/`.

| File | Proves |
|---|---|
| `chain.test.ts` | Verdicts for curated substances (ethanol green/strong/fast; cinnamaldehyde yellow/weak/slow; N₂ red non-redox) |
| `transport.test.ts` | Antoine vs Clausius–Clapeyron consistency, diffusion/flux math |
| `ontology.test.ts` | Percept mapping, low-volatility handling, boundary relevance |
| `groups.test.ts` | 24-fixture functional-group inference incl. Kekulé vs aromatic, phenol-vs-methoxy |
| `enrichment.test.ts` | Boiling-point parsing incl. `±` uncertainty, pug_view section-tree extraction |
| `provisional.test.ts` | Estimated-flag honesty, inorganic non-redox vs reducing-gas redox, VP-from-BP |
| `user-dictionary.test.ts` | localStorage store: save/dedupe/remove/map/200-cap |
| `live-resolution.test.ts` | End-to-end PubChem → provisional chemical → verdict → save (mocked, no network) |

Quality gates: `npm run build` passes; `npx tsc --noEmit` clean; `npm run
lint` at documented baseline (5 errors, 3 warnings — pre-existing: shadcn
set-state-in-effect ×3, `use-toast` actionTypes, `resolveAndRun` impure render
warning, `groups.ts` unused `d`).

---

## 18. Known gaps / next slices (honest)

- Quality scoring implementation diverges from spec §7 (6 sub-scores vs 7;
  auto-R0 cap missing; median-gap continuity; duration uses N not N−1) — see
  §4.2. Reconcile before publishing spec-v1.1.0-claims.
- Train pipeline not implemented (gate ships; 187-feature extraction + fit +
  cross-validated accuracy deferred).
- `decayTimeMs` always null; multi-exponential recovery fits not shipped.
- Composite profiles are representative subsets (coffee 200+ VOCs → 5), not
  full inventories.
- Verdicts are physical feasibility, never calibrated measurements.
- GitHub remote reported moved to `https://github.com/OpenSmell/osmograph-web.git`
  (capital O); `origin` still points at the lowercase URL.
