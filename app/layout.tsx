import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bayer',
  description: 'Bayer — заказы для закупок',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
  appleWebApp: {
    capable: true,
    title: 'Bayer',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    {media:'(prefers-color-scheme: light)',color:'#f5f5f7'},
    {media:'(prefers-color-scheme: dark)',color:'#000000'},
  ],
  colorScheme: 'light dark',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head><Script id="bayer-theme" strategy="beforeInteractive">{`try{const saved=localStorage.getItem('bayer:theme');const theme=saved==='dark'||saved==='light'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch{}`}</Script></head>
      <body>{children}</body>
    </html>
  )
}
