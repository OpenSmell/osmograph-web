# Smellability — Substance Profiles

**What this documents:** how everyday substances (foods, spices, products, activities) are represented as *weighted composite mixtures*, how those profiles are validated against the published literature, and what the feasibility chain does with them. This is the layer that makes Smellability usable by someone who cannot paste a SMILES string.

---

## 1. Why mixtures, not molecules

People smell things — bananas, cinnamon, gasoline, sewer gas — not single molecules. A banana is not "isoamyl acetate"; it is a mixture whose character is *dominated by* isoamyl acetate. The engine therefore models every everyday substance as a **composite**: a list of constituent chemicals with a weight fraction and an explicit data source for each weight.

| Concept | Representation |
|---|---|
| A single chemical | `Chemical` (curated properties, `lib/smellability/compounds.ts`) |
| An everyday substance | `Composite` (weighted constituents, `lib/smellability/composites.ts`) |
| A request at runtime | resolved → each constituent runs the chain → verdicts aggregated by weight |

Constituent weights are **literature estimates from GC-MS studies** and are flagged `estimated`. This is honest: the same banana at different ripeness, cultivar, and preparation steps has measurably different headspace composition.

## 2. How a verdict is aggregated

`runCompositeVerdict` in `lib/smellability/chain.ts`:

1. Runs the full feasibility chain (identity → volatility → headspace → reactivity) on every constituent.
2. Normalizes weight fractions (so partial profiles sum to 1).
3. Computes a weighted signal score; a constituent ≥50% red by weight forces `red`; ≥40% non-green by weight forces `yellow`.
4. Confidence is `low` if any constituent uses unknown properties, `medium` if any weight or property is estimated, `high` only when everything is measured.
5. Response speed is inherited from the dominant signal contributor.

The reference `signalRatioVsRef` compares the composite's constituents to ethanol but the *verdict* is driven by the absolute saturated headspace ppm of each constituent (see `feasibility-chain.md`, Step 3).

---

## 3. Worked example — Banana

Seed profile in `lib/smellability/composites.ts`:

| Constituent | Weight | Vapor pressure @ 25 °C | Saturated headspace | Signal grade |
|---|---|---|---|---|
| Isoamyl acetate | 0.50 | 700 Pa (est.) | ≈ 6,900 ppm | strong |
| Isoamyl butyrate | 0.15 | 60 Pa (est.) | ≈ 590 ppm | moderate |
| Butyl acetate | 0.10 | 1,330 Pa (est.) | ≈ 13,100 ppm | strong |
| Isoamyl isovalerate | 0.10 | 40 Pa (est.) | ≈ 390 ppm | moderate |
| Hexanal | 0.05 | 1,330 Pa (est.) | ≈ 13,100 ppm | strong |
| (E)-2-Hexenal | 0.05 | 600 Pa (est.) | ≈ 5,900 ppm | strong |
| 1-Hexanol | 0.05 | 133 Pa (est.) | ≈ 1,300 ppm | strong |

**Chain result:** green verdict — every constituent exceeds the ~1 ppm MOX floor by orders of magnitude, so even the minor aldehydes dominate the detector. Signal is fast (esters and aldehydes are volatile), so guidance is *keep exposures short (10–30 s), use an enclosed chamber, start diluted ≈1:10*.

**Science notes:**
- Isoamyl acetate is the character-impact compound (odor descriptor "banana, pear"); it contributes the largest single weight.
- Literature reports on the order of 50–100 VOCs per banana cultivar (Zhu et al. 2018, *Molecules*; Pino & Febles 2013; Sutikdja et al. 2012 — the `sourceRefs` carried in the profile).
- The green (unripe) stage is **aldehyde-heavy** (hexanal, (E)-2-hexenal dominate); the ripe stage is **ester-heavy**. The profile models the ripe headspace.
- Weights are estimates: ripeness, cultivar, and preparation move them substantially, which is why the confidence stays `medium` and why the profile notes the variance explicitly.

## 4. Worked example — Cinnamon

Seed profile in `lib/smellability/composites.ts`:

| Constituent | Weight | Vapor pressure @ 25 °C | Saturated headspace | Signal grade |
|---|---|---|---|---|
| Cinnamaldehyde | 0.65 | 1.3 Pa (est.) | ≈ 13 ppm | weak |
| Eugenol | 0.20 | 2.7 Pa (est.) | ≈ 27 ppm | weak |
| Linalool | 0.05 | 26 Pa (est.) | ≈ 260 ppm | moderate |
| Limonene | 0.05 | 200 Pa (est.) | ≈ 2,000 ppm | strong |

**Chain result:** yellow, slow — the dominant constituent cinnamaldehyde is only ≈13 ppm at saturation, just above the MOX floor, and eugenol is similar. The array will respond, but only after the headspace builds up and with a weak signal. Guidance becomes *maximize headspace (warm slightly, increase surface area), longer exposure window (60–120 s), avoid dilution*.

**Science notes:**
- Cinnamaldehyde is the character-impact compound of cinnamon bark; bark oil is ~65–90% cinnamaldehyde, with eugenol a secondary phenolic. This matches the 0.65 / 0.20 split.
- The low vapor pressures of cinnamaldehyde (≈1.3 Pa) and eugenol (≈2.7 Pa) are *exactly* why powdered cinnamon is a slow, weak target compared with a freshly volatile fruit ester — the chain's Step 2/Step 3 grades capture this without any special-casing.
- Ceylon vs cassia cinnamon differ measurably in coumarin and aldehyde content; the profile is a simplified bark-dominant model and says so in its notes.

## 5. Human vs MOX sensitivity — an important asymmetry

Human odor detection thresholds are in the **parts-per-billion** range for many esters (isoamyl acetate is widely reported near single-digit ppb in water). The MOX floor in this engine is **~1 ppm**:

- A ripe banana headspace of ~10,000 ppm esters is far above *both* thresholds → trivially detectable by nose and array.
- Cinnamaldehyde at ~13 ppm is still easily smelled (ppb-level detection); the **array** is the limiting detector here. The verdict grades the *instrument*, not the smell.
- The UI must therefore be explicit that "smells strongly to a human" ≠ "strong on the array" for low-volatility substances. The chain documents this asymmetry so users trust a `yellow` verdict on a spice they can smell clearly.

## 6. Licensing & attribution

- **FlavorDB** (Garg et al. 2018, *Nucleic Acids Res.*) is CC BY-NC-SA. It provided 25,595 flavor molecules, 936 ingredient profiles, and 2,254 ingredient-molecule associations used as *reference* for weight splits. We do not copy database content wholesale — we cite ingredient profiles as references (`sourceRefs`) and keep our own curated weight estimates.
- **NIST Chemistry Webbook** — public domain; used for boiling points and Antoine constants.
- **PubChem** — public; the enrichment client (`lib/smellability/enrichment.ts`) pulls formula / molecular weight / IUPAC name at contribution time, cached locally and attributed as "via PubChem".
- Every seeded profile carries `sourceRefs`; contributed entries must too.

## 7. Known gaps & honest limits

- Weights are GC-MS *literature* values, not gas-phase measurements of the exact sample. A real sample's headspace composition also depends on hydrophobicity and matrix effects, which a simple weight fraction cannot capture.
- Composite profiles are a representative subset, not the full 50–200 VOC inventory (e.g. coffee's 200+ VOCs reduce to five potent roast volatiles). Minor VOCs below the weight/volatility cut are dropped.
- Confidence downgrades to `medium`/`low` exactly when these estimates matter, and the verdict text says so rather than pretending precision.
