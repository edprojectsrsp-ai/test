import type { Metadata } from "next";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "../theme/tokens.css";
import "../theme/presets.css";
import "../theme/advanced-ui.css";
import AppSidebar from "../components/layout/AppSidebar";
import ContextBar from "../components/layout/ContextBar";
import AmbientFx from "../components/layout/AmbientFx";
import ProtectedRoute from "../components/layout/ProtectedRoute";
import AuthFetchBridge from "../components/layout/AuthFetchBridge";
import { MosProvider } from "../components/brain/MosContext";
import ThemeStudio from "../components/furnace/theme-studio";
import { ThemeProvider } from "../theme/ThemeProvider";
import { ToastHost } from "../ui";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Project Brain",
  description: "Intelligent Project Monitoring System",
};

/** Runs before paint so Ministry is the default even if old localStorage had dark skins. */
const MINISTRY_BOOT =
  "(function(){try{var t=localStorage.getItem('pb-theme');" +
  "if(t!=='dark'){document.documentElement.setAttribute('data-theme','light');" +
  "var p=localStorage.getItem('fz-preset');" +
  "if(!p||p==='midnight'||p==='furnace'||p==='controlroom'||p==='ember'){p='ministry';localStorage.setItem('fz-preset','ministry');localStorage.setItem('pb-theme','light');}" +
  "document.documentElement.setAttribute('data-fz-preset',p||'ministry');" +
  "if(!localStorage.getItem('fz-fx'))localStorage.setItem('fz-fx','flat');" +
  "if(!localStorage.getItem('fz-motion'))localStorage.setItem('fz-motion','calm');" +
  "}}catch(e){document.documentElement.setAttribute('data-theme','light');document.documentElement.setAttribute('data-fz-preset','ministry');}})();";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-fz-preset="ministry"
      data-fz-fx="flat"
      data-fz-motion="calm"
      suppressHydrationWarning
      className={`${dmSans.variable} ${fraunces.variable} ${jetbrains.variable}`}
    >
      <head>
        <Script id="ministry-boot" strategy="beforeInteractive">
          {MINISTRY_BOOT}
        </Script>
      </head>
      <body className={`${dmSans.className} overflow-hidden ministry-shell`} style={{ background: "#ffffff", color: "#0a0a0a" }}>
        <ThemeProvider defaultTheme="light">
          <AuthFetchBridge />
          <MosProvider>
            <AmbientFx />
            <div className="relative z-[1] flex h-screen w-full" style={{ background: "#ffffff" }}>
              <AppSidebar />
              <main className="ml-80 flex h-full flex-1 flex-col overflow-hidden" style={{ background: "#ffffff", color: "#0a0a0a" }}>
                <ContextBar />
                <div className="flex-1 overflow-y-auto p-6 md:p-8" style={{ background: "#ffffff", color: "#0a0a0a" }}>
                  <ProtectedRoute>{children}</ProtectedRoute>
                </div>
              </main>
              <ThemeStudio />
              <ToastHost />
            </div>
          </MosProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
