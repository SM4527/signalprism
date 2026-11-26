import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { loadConfig } from "@/lib/config";
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
  const sample = loadConfig().DATA_MODE === "mock";
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
        <main className="flex-1 p-6">{children}</main>
        <footer className="border-t border-border p-4 text-xs text-muted-foreground">
          SignalPrism is a personal research tool, not investment advice.
        </footer>
      </body>
    </html>
  );
}
