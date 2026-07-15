"use client";

import dynamic from "next/dynamic";

// three.js + web-ifc touch window/WebGL — client-only.
const BimStudio = dynamic(() => import("./BimStudio"), { ssr: false });

export default function BimPage() {
  return <BimStudio />;
}
