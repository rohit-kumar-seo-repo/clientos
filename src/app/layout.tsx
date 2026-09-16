import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClientOS",
  description: "Client, billing, and work management for the agency.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased bg-neutral-50 text-neutral-900" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
