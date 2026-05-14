import type { Metadata } from "next";
import "./globals.css";
import AppSidebar from "../components/layout/AppSidebar";
import MiniMos from "../components/brain/MiniMos";
import { MosProvider } from "../components/brain/MosContext";

export const metadata: Metadata = {
  title: "Project Brain • Mini MOS",
  description: "Intelligent Project Monitoring System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="neural-bg text-white overflow-hidden">
        <MosProvider>
          <div className="relative flex h-screen w-full">
            <AppSidebar />
            <main className="ml-80 h-full flex-1 overflow-y-auto p-12">{children}</main>
            <MiniMos />
          </div>
        </MosProvider>
      </body>
    </html>
  );
}
