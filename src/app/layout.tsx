import type { Metadata, Viewport } from "next";
import { Syne, DM_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/providers";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Chop with Rostty — Kitchen Command Center",
  description: "Enterprise order and inventory management for Chop with Rostty",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iOS Safari reads these dedicated tags rather than the web manifest for
  // "Add to Home Screen" title and status-bar styling.
  appleWebApp: {
    capable: true,
    title: "Rostty",
    statusBarStyle: "black-translucent",
  },
};

/**
 * `themeColor`/`colorScheme` MUST live on this separate `viewport` export, not
 * inside `metadata` — nesting them there was deprecated in Next.js 14 and now
 * silently no-ops rather than warning. Value approximates `--background`
 * (oklch(0.98 0.010 75) = warm cream), so the browser chrome and install
 * splash match the Tropical Sunrise light palette instead of flashing dark.
 */
export const viewport: Viewport = {
  themeColor: "#fdf9f3",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* First focusable element on the page — hidden until focused, then it
            jumps past the nav to the shell's <main id="main-content">. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
