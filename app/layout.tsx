import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "https://trading-command-center.invalid",
  ),
  title: "Trading Command Center",
  description:
    "Private paper-trading operations and risk-controlled research dashboard.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Trade Center",
    statusBarStyle: "black-translucent",
  },
  themeColor: "#07100d",
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
  openGraph: {
    title: "Trading Command Center",
    description: "Paper operations. Risk controlled.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Command Center",
    description: "Paper operations. Risk controlled.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
