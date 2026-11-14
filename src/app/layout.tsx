import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { RegisterSW } from "@/components/pwa";
import { THEME_BOOT } from "@/components/theme";

export const metadata: Metadata = {
  title: "Sampatti",
  description: "Family financial reminders, deadlines and records",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Sampatti", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f4ef" }, { media: "(prefers-color-scheme: dark)", color: "#111314" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <AppProviders>{children}</AppProviders>
        <RegisterSW />
      </body>
    </html>
  );
}
