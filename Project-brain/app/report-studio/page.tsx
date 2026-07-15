"use client";
import { type CSSProperties, useState } from "react";
import ReportStudio from "../../components/report/ReportStudio";
import ReportDocument from "../../components/report/ReportDocument";
import TemplateDesigner from "./TemplateDesigner";
import WhatIfPanel from "./WhatIfPanel";
import KpiBuilder from "./KpiBuilder";

const NAMES: Record<string,string> = {
  "OXY-1000":"1000 TPD Oxygen Plant", "COB7-PKG2":"COB#7 Battery Proper (Pkg-2)",
  "TS2":"Treatment System-2", "PELLET-2MTPA":"2.0 MTPA Pellet Plant", "BF5-STOVE4":"BF-5 4th Stove",
};

export default function Page() {
  const [tab, setTab] = useState<"kpi"|"studio"|"document"|"designer"|"whatif">("kpi");
  const btn = (a: boolean): CSSProperties => ({
    border:"1px solid var(--line)", cursor:"pointer", padding:"7px 16px", borderRadius:9,
    fontSize:13, fontWeight:750, background:a?"var(--steel-soft)":"var(--panel)", color:a?"var(--steel)":"var(--ink-3)",
  });
  return (
    <div style={{ background:"var(--bg)", color:"var(--ink)", minHeight:"100vh" }}>
      <div style={{ display:"flex", gap:8, padding:"14px 24px 0" }}>
        <button style={btn(tab==="kpi")} onClick={()=>setTab("kpi")}>KPI Builder</button>
        <button style={btn(tab==="studio")} onClick={()=>setTab("studio")}>Ingest & Compose</button>
        <button style={btn(tab==="document")} onClick={()=>setTab("document")}>Report Document</button>
        <button style={btn(tab==="designer")} onClick={()=>setTab("designer")}>Template Designer</button>
        <button style={btn(tab==="whatif")} onClick={()=>setTab("whatif")}>What-If</button>
      </div>
      {tab==="kpi" ? <KpiBuilder/> :
       tab==="designer" ? <TemplateDesigner/> :
       tab==="whatif" ? <WhatIfPanel/> :
       tab==="studio" ? <ReportStudio/> :
        <ReportDocument project="COB7-PKG2" month="2026-06"
          allProjects={["OXY-1000","COB7-PKG2","TS2","PELLET-2MTPA","BF5-STOVE4"]} projectNames={NAMES}
          figuresCtx={{
            capex_heads:[["MEP",0,0,0,0],["AMR",238.70,122.70,802.33,391.70],["Capital Repair & Spares",2.20,17.30,2.20,53.30],["New Schemes",0,8.93,0,0],["Total",240.90,140.00,804.53,445.00]],
            pmc_discipline:[["Civil Work",65.84,64.68,5.55],["Structural Supply",77.62,53.15,13.55]],
            portfolio_status:[["On Schedule",41,6120],["Delay < 1 Yr",19,3480],["Delay > 1 Yr",8,2068]],
            milestones:[{name:"Silo Building Civil",orig:"12.11.2026",anticipated:"07.05.2027",reason:"Drawing delay"}],
          }}/>}
    </div>
  );
}
