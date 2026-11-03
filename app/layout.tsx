import type { Metadata, Viewport } from 'next'
import { Source_Serif_4 } from 'next/font/google'
import './globals.css'

// Display serif for headings and the score: lining, tabular figures with a plain zero.
const display = Source_Serif_4({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: 'Survivors — Mutation testing lab',
  description: 'One function. Every mutant. Only the survivors matter.',
  metadataBase: new URL('https://survivors.local'),
  openGraph: { title: 'Survivors', description: 'One function. Every mutant. Only the survivors matter.', type: 'website' },
  icons: { icon: '/icon.svg' },
}
export const viewport: Viewport = { themeColor: '#f2f1ec', width: 'device-width', initialScale: 1 }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className={display.variable}><body>{children}</body></html> }
