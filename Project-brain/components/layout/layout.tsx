import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppSidebar from "@/components/layout/AppSidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Project Brain - AI Project Command Center",
  description: "Intelligent Project Monitoring System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <div className="flex">
          <AppSidebar />
          <main className="flex-1 ml-72 min-h-screen bg-zinc-950">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}