import {
  cpm, statusedForecast, asPlannedVsAsBuilt, impactedAsPlanned,
  collapsedAsBuilt, windowAnalysis, timeImpactAnalysis,
  type Activity, type Actuals, type DelayEvent,
} from "./delayAnalysis";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/* Reference network: A(10) → B(10) → C(10) chain = 30d critical,
   D(5) parallel (A → D → C) with 15d float on D. */
const ACTS: Activity[] = [
  { id: "A", name: "Enabling works", dur: 10 },
  { id: "B", name: "Civil raft", dur: 10, preds: [{ id: "A" }] },
  { id: "C", name: "Erection", dur: 10, preds: [{ id: "B" }, { id: "D" }] },
  { id: "D", name: "Vendor drawings", dur: 5, preds: [{ id: "A" }] },
];

console.log("── CPM core (full precedence) ──");
{
  const r = cpm(ACTS);
  ok("chain finish 30", near(r.finish, 30));
  ok("A,B,C critical; D float 5+10=15?", r.dates.A.critical && r.dates.B.critical
     && r.dates.C.critical && !r.dates.D.critical);
  ok("D total float 5", near(r.dates.D.tf, 5), `tf=${r.dates.D.tf}`);
  // SS + lag: X(5) —SS+2→ Y(4) → Y es 2, finish max(5, 6)=6
  const ss = cpm([
    { id: "X", dur: 5 },
    { id: "Y", dur: 4, preds: [{ id: "X", type: "SS", lag: 2 }] },
  ]);
  ok("SS+2 lag: Y starts at 2, finish 6", near(ss.dates.Y.es, 2) && near(ss.finish, 6));
  // FF + lag: X(5) —FF+3→ Y(4): Y ef >= 8 → es 4, finish 8
  const ff = cpm([
    { id: "X", dur: 5 },
    { id: "Y", dur: 4, preds: [{ id: "X", type: "FF", lag: 3 }] },
  ]);
  ok("FF+3 lag: Y finish 8", near(ff.dates.Y.ef, 8) && near(ff.finish, 8));
  // SF: X —SF+12→ Y(4): Y ef >= X.es+12 = 12 → es 8
  const sf = cpm([
    { id: "X", dur: 5 },
    { id: "Y", dur: 4, preds: [{ id: "X", type: "SF", lag: 12 }] },
  ]);
  ok("SF+12: Y ef 12", near(sf.dates.Y.ef, 12), `ef=${sf.dates.Y.ef}`);
  let threw = false;
  try { cpm([{ id: "P", dur: 1, preds: [{ id: "Q" }] } as Activity, { id: "Q", dur: 1, preds: [{ id: "P" }] }]); }
  catch { threw = true; }
  ok("cycle detection", threw);
}

/* As-built story (total slip 6):
   A 0→12   (own slip +2, contractor event E-A 2d @ day 5)
   B 12→25  (own slip +3, employer event E-B 3d @ day 18)
   C 25→36  (own slip +1, neutral event E-C 1d @ day 30)
   D 12→17  (on time, off-critical) */
const AB: Actuals = {
  A: { start: 0, finish: 12 },
  B: { start: 12, finish: 25 },
  C: { start: 25, finish: 36 },
  D: { start: 12, finish: 17 },
};
const EVENTS: DelayEvent[] = [
  { id: "E-A", name: "Late site handover", party: "contractor", activityId: "A", days: 2, atDay: 5 },
  { id: "E-B", name: "Dewatering failure", party: "employer", activityId: "B", days: 3, atDay: 18 },
  { id: "E-C", name: "Cyclone shutdown", party: "neutral", activityId: "C", days: 1, atDay: 30 },
];

console.log("── Method 1: As-Planned vs As-Built ──");
{
  const r = asPlannedVsAsBuilt(ACTS, AB);
  ok("project slip 6", near(r.projectSlip, 6), `slip=${r.projectSlip}`);
  ok("as-built chain A→B→C", r.drivingChain.join(">") === "A>B>C", r.drivingChain.join(">"));
  const b = r.rows.find(x => x.id === "B")!;
  ok("B own slip 3, finish var 5", near(b.ownSlip!, 3) && near(b.finishVar!, 5));
  ok("D off both critical paths", !r.rows.find(x => x.id === "D")!.asBuiltCritical);
  ok("narrative names top driver B", r.narrative.some(n => n.includes("Civil raft") && n.includes("3")));
}

console.log("── Method 2: Impacted As-Planned ──");
{
  const r = impactedAsPlanned(ACTS, EVENTS);
  ok("impacted finish 36", near(r.impactedFinish, 36), `got ${r.impactedFinish}`);
  ok("total impact 6", near(r.totalImpact, 6));
  ok("byParty E5?no → employer 3, contractor 2, neutral 1",
     near(r.byParty.employer, 3) && near(r.byParty.contractor, 2) && near(r.byParty.neutral, 1),
     JSON.stringify(r.byParty));
  ok("steps ordered by atDay", r.steps[0].event.id === "E-A" && r.steps[2].event.id === "E-C");
  // float absorption: event on D (float 5) of 4 days → zero impact
  const r2 = impactedAsPlanned(ACTS, [{ id: "E-D", name: "Drawing hold", party: "employer", activityId: "D", days: 4, atDay: 3 }]);
  ok("event inside float → 0 impact", near(r2.totalImpact, 0), `got ${r2.totalImpact}`);
  ok("float absorption noted in narrative", r2.narrative.some(n => n.includes("absorbed by float")));
}

console.log("── Method 3: Collapsed As-Built ──");
{
  const r = collapsedAsBuilt(ACTS, AB, EVENTS);
  ok("as-built model finish 36", near(r.asBuiltFinish, 36));
  ok("but-for employer saves 3", near(r.byParty.employer, 3), JSON.stringify(r.byParty));
  ok("but-for contractor saves 2", near(r.byParty.contractor, 2));
  ok("but-for neutral saves 1", near(r.byParty.neutral, 1));
  const all = r.scenarios.find(s => s.removedParty === "all")!;
  ok("removing all events collapses to baseline 30", near(all.collapsedFinish, 30));
  ok("narrative confirms full explanation", r.narrative.some(n => n.includes("matches the baseline")));
}

console.log("── Method 4: Window analysis ──");
{
  const r = windowAnalysis(ACTS, AB, EVENTS, [0, 15, 30, 40]);
  ok("3 windows", r.windows.length === 3);
  const [w1, w2, w3] = r.windows;
  ok("w1 slip 2 (A's overrun revealed)", near(w1.slip, 2), `w1=${w1.slip}`);
  ok("w2 slip 3 (B's overrun revealed)", near(w2.slip, 3), `w2=${w2.slip}`);
  ok("w3 slip 1 (C's overrun revealed)", near(w3.slip, 1), `w3=${w3.slip}`);
  ok("forecast walks 30→32→35→36",
     near(w1.forecastAtStart, 30) && near(w1.forecastAtEnd, 32)
     && near(w2.forecastAtEnd, 35) && near(w3.forecastAtEnd, 36));
  ok("w1 attributed to contractor E-A 2d", near(w1.byParty.contractor, 2) && near(w1.unexplained, 0),
     JSON.stringify(w1.byParty));
  ok("w2 attributed to employer E-B 3d", near(w2.byParty.employer, 3) && near(w2.unexplained, 0));
  ok("w3 attributed to neutral E-C 1d", near(w3.byParty.neutral, 1) && near(w3.unexplained, 0));
  ok("total slip 6 fully attributed", near(r.totalSlip, 6) && near(r.unexplained, 0));
  // window with no event → unexplained
  const r2 = windowAnalysis(ACTS, AB, [], [0, 15]);
  ok("no events → slip flagged unexplained", near(r2.windows[0].unexplained, 2));
}

console.log("── Method 5: Time Impact Analysis ──");
{
  const frag: DelayEvent = { id: "F1", name: "SEB power cut", party: "employer", activityId: "C", days: 4, atDay: 15 };
  const r = timeImpactAnalysis(ACTS, AB, frag, 15);
  ok("forecast at DD15 is 32", near(r.forecastWithout, 32), `got ${r.forecastWithout}`);
  ok("with fragnet 36 → impact 4", near(r.forecastWith, 36) && near(r.impact, 4),
     `with=${r.forecastWith}`);
  ok("EOT language in narrative", r.narrative.some(n => n.includes("EOT")));
  // fragnet on floated D at DD0: dur D 5+? float 5 → 4d absorbed
  const r2 = timeImpactAnalysis(ACTS, {}, { id: "F2", name: "hold", party: "employer", activityId: "D", days: 4 }, 0);
  ok("fragnet inside float → 0 impact", near(r2.impact, 0), `impact=${r2.impact}`);
}

console.log("── Statused forecast edge cases ──");
{
  const s0 = statusedForecast(ACTS, AB, 0);
  ok("t=0 forecast = baseline 30", near(s0.finish, 30));
  const s40 = statusedForecast(ACTS, AB, 40);
  ok("t=end forecast = as-built 36", near(s40.finish, 36));
  const s20 = statusedForecast(ACTS, AB, 20);
  // at 20: A actual 12; B in progress since 12, elapsed 8, remaining 2 → EF 22; C 10 → 32
  ok("t=20 in-progress statusing → 32", near(s20.finish, 32), `got ${s20.finish}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
