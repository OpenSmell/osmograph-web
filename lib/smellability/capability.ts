import { MAX_SUBSTANCES } from "./constants"
import type { FeasibilityVerdict, SignalStrength, Verdict } from "./types"

// Rig-capability check: given a set of pinned verdicts and a sensor count, how
// well can the array actually tell them apart? The chain grades *detectability*
// per substance; this module grades *separability* between pairs by comparing
// their predicted response profiles.
//
// The model is deliberately qualitative — it compares the shape of the predicted
// response (which volatiles dominate, weighted by how strongly they signal),
// not a calibrated sensor measurement. Treat high-risk pairs as "verify with a
// labeled exposure", not as a hard verdict.

export interface ProfileVector {
  chemicals: string[]
  contributions: number[]
  signalScore: number
  signalStrength: SignalStrength
  verdict: Verdict
}

const STRENGTH_SCORE: Record<SignalStrength, number> = {
  strong: 1,
  moderate: 0.6,
  weak: 0.25,
  none: 0,
}

export function profileOf(v: FeasibilityVerdict): ProfileVector {
  if (v.constituents.length > 0) {
    const entries = v.constituents
      .map((c) => ({ id: c.chemicalId, w: c.weightFraction * c.signalScore }))
      .filter((e) => e.w > 0)
    const total = entries.reduce((s, e) => s + e.w, 0) || 1
    return {
      chemicals: entries.map((e) => e.id),
      contributions: entries.map((e) => e.w / total),
      signalScore: Math.max(0, Math.min(1, total)),
      signalStrength: v.signalStrength,
      verdict: v.verdict,
    }
  }
  // Class-level verdicts have no constituents — approximate the profile from
  // the coarse strength grade.
  return {
    chemicals: [v.entityId],
    contributions: [1],
    signalScore: STRENGTH_SCORE[v.signalStrength],
    signalStrength: v.signalStrength,
    verdict: v.verdict,
  }
}

// Weighted Jaccard overlap between two normalized contribution profiles: the
// shared volatile mass over the union. 1.0 = identical predicted profile,
// 0.0 = disjoint.
export function overlapBetween(a: ProfileVector, b: ProfileVector): number {
  let inter = 0
  let union = 0
  const aIds = new Set(a.chemicals)
  const bById = new Map(b.chemicals.map((c, i) => [c, b.contributions[i]]))
  for (let i = 0; i < a.chemicals.length; i++) {
    const id = a.chemicals[i]
    const cb = bById.get(id) ?? 0
    inter += Math.min(a.contributions[i], cb)
    union += a.contributions[i]
  }
  for (const [id, cb] of bById) {
    if (!aIds.has(id)) union += cb
  }
  return union > 0 ? inter / union : 0
}

export interface RigPair {
  a: string
  b: string
  overlap: number
  risk: "high" | "medium" | "low"
  note: string
}

export interface RigCapability {
  sensorCount: number
  maxDistinguishable: number
  pinned: number
  atCapacity: boolean
  pairs: RigPair[]
}

export function rigCapabilityCheck(bench: FeasibilityVerdict[], sensorCount: number): RigCapability {
  const maxDistinguishable = MAX_SUBSTANCES[sensorCount] ?? 40
  const pairs: RigPair[] = []

  for (let i = 0; i < bench.length; i++) {
    for (let j = i + 1; j < bench.length; j++) {
      const A = bench[i]
      const B = bench[j]
      const pa = profileOf(A)
      const pb = profileOf(B)
      const overlap = overlapBetween(pa, pb)

      const bothDead = pa.signalScore === 0 && pb.signalScore === 0
      const bothAlive = pa.verdict === "green" && pb.verdict === "green" && pa.signalStrength === pb.signalStrength

      let risk: RigPair["risk"]
      let note: string
      if (bothDead) {
        risk = "high"
        note = "Neither is expected to give a usable signal — the rig cannot tell these apart by smell."
      } else if (bothAlive && overlap >= 0.5) {
        risk = "high"
        note = "Predicted response profiles overlap heavily — expect confusable readings; verify with labeled exposures."
      } else if (overlap >= 0.35) {
        risk = "medium"
        note = "Profiles are similar — plan a labeled-exposure check before trusting separation."
      } else if (bothAlive && overlap >= 0.2) {
        risk = "medium"
        note = "Same signal grade with partial profile overlap — keep exposure labels distinct."
      } else if (overlap >= 0.2) {
        risk = "medium"
        note = "Moderate profile overlap — watch for cross-sensitivity."
      } else {
        risk = "low"
        note = "Distinct predicted response profiles — expected to separate well on this array."
      }

      pairs.push({ a: A.entityName, b: B.entityName, overlap: Math.round(overlap * 100), risk, note })
    }
  }

  return {
    sensorCount,
    maxDistinguishable,
    pinned: bench.length,
    atCapacity: bench.length > maxDistinguishable,
    pairs,
  }
}
