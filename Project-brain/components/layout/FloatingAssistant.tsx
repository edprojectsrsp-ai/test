"use client";

import { usePathname } from "next/navigation";
import NeuralAssistant from "@/components/NeuralAssistant";

/**
 * Renders the floating Neural Assistant on every page EXCEPT /ai
 * (which is already a full-page AI chat — the widget would be redundant).
 */
export default function FloatingAssistant() {
  const path = usePathname();
  if (path === "/ai") return null;
  return <NeuralAssistant />;
}
