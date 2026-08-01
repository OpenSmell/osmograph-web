import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "Osmograph Web — mox.opensmell.xyz",
  description:
    "Osmograph Web is the web platform for MOX e-nose sensor data. Import loose CSVs, normalize baseline, score data quality, and export the .osmell format.",
  icons: {
    icon: "/opensmell_logo.png",
    apple: "/opensmell_logo.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey="opensmell-theme"
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
