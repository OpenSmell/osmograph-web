import type { Metadata } from "next"
import { SuiteShell } from "@/components/suite/suite-shell"

export const metadata: Metadata = {
  title: "Osmograph Web — MOX sensor analytics",
  description:
    "The web suite for MOX e-nose data: import recordings, build a session library, compare normalized responses, and train classifiers.",
}

export default function Home() {
  return <SuiteShell />
}
