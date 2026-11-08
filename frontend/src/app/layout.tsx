import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "StackSmith — AI advisors for small business",
  description: "A team of AI advisors that finds, compares and helps small businesses adopt the right AI tools, with real ROI.",
};

export const viewport: Viewport = { themeColor: "#fafaf7", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${display.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
