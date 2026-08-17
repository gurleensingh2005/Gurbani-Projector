import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Gurmukhi, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/store/store-provider";
import { SettingsProvider } from "@/shared/context/settings.context";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const gurmukhi = Noto_Sans_Gurmukhi({
  variable: "--font-gurmukhi",
  weight: ["400", "500", "700"],
  subsets: ["gurmukhi"],
});

const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  weight: ["400", "500", "700"],
  subsets: ["devanagari"],
});

export const metadata: Metadata = {
  title: "Gurbani Search",
  description: "Advanced Gurbani Projection System",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#fffafa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${gurmukhi.variable} ${devanagari.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <StoreProvider>
          <SettingsProvider>
            {children}
          </SettingsProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
