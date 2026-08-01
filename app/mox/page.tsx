import type { Metadata } from "next"
import MoxWeb from "@/components/mox/mox-web"

export const metadata: Metadata = {
  title: "Osmograph Web — MOX sensor analytics",
  description:
    "Import MOX e-nose CSVs, normalize against a baseline, score data quality, and export .osmell files.",
}

export default function MoxPage() {
  return <MoxWeb />
}
