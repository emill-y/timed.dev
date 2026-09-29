import type { Metadata, Viewport } from "next";
import { Anton, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const disp = Anton({ weight: "400", subsets: ["latin"], variable: "--font-disp" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "timed.dev — prompt. ship. beat the clock.",
  description:
    "Real-time coding duels. Same ticket, same clock, any tools. First to all-green wins.",
};

export const viewport: Viewport = { themeColor: "#0a0c12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${disp.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
