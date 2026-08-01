import type { Metadata } from "next"
import MoxStudio from "@/components/mox/mox-studio"

export const metadata: Metadata = {
  title: "OpenSmell Studio — MOX sensor analytics",
  description:
    "Import MOX e-nose CSVs, normalize against a baseline, score data quality, and export .osmell files.",
}

export default function MoxPage() {
  return <MoxStudio />
}
