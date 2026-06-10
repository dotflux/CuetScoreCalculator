import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CUET Score Evaluator | Calculate Your CUET UG 2026 Score",
  description: "Upload your NTA response sheets and answer keys to calculate your CUET UG 2026 subject scores and custom combinations. Fully client-side and secure.",
  keywords: ["CUET 2026", "CUET Score Calculator", "CUET Evaluator", "NTA Score Calculator", "CUET response sheet parser"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
      <Analytics/>
    </html>
  );
}
