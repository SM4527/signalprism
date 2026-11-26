import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt } from "@/lib/format";
import { getPollStatus } from "@/lib/poll/poll-all";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SignalPrism",
  description: "Form 4 insider-buy tracker for a personal watch list",
};

// Read DATA_MODE at request time, not build time.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  const config = loadConfig();
  const sample = config.DATA_MODE === "mock";
  const pausedUntil = getPollStatus(getDb(config.DB_PATH), new Date()).pausedUntil;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {sample && (
          <div className="bg-yellow-400 text-black text-center text-sm font-semibold py-1">
            SAMPLE DATA
          </div>
        )}
        {pausedUntil && (
          <div role="alert" className="bg-red-600 text-white text-center text-sm font-semibold py-1">
            SEC polling is paused until {formatEt(pausedUntil)} after repeated 403 responses.
          </div>
        )}
        <Nav />
        <main className="flex-1 p-6">{children}</main>
        <footer className="border-t border-border p-4 text-xs text-muted-foreground">
          SignalPrism is a personal research tool, not investment advice.
        </footer>
      </body>
    </html>
  );
}
