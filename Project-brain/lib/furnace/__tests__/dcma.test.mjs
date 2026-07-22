/**
 * DCMA 14-point engine tests.
 *
 * Runs without a test framework so it works in any environment:
 *   npx esbuild lib/furnace/cpmEngine.ts lib/furnace/dcma.ts --outdir=/tmp/dcma --format=esm
 *   node lib/furnace/__tests__/dcma.test.mjs
 * (adjust the imports below to point at the transpiled output)
 */
import { runCpm } from "./cpmEngine.js";
import { runDcma14, criticalPathTest, dcmaToCsv } from "./dcma.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra="") => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name, extra); } };

// A clean, well-formed network: chain of FS links, resourced, baselined.
const mk = (id, dur, o={}) => ({ id, code:id, name:id, duration:dur, progress:0, resourceCount:2, ...o });
const acts = [
  mk("A",10,{progress:100, actualStart:"2026-01-01", actualFinish:"2026-01-10", baselineFinish:"2026-01-10"}),
  mk("B",20,{progress:50,  actualStart:"2026-01-11", baselineFinish:"2026-02-01"}),
  mk("C",15,{baselineFinish:"2026-12-01"}),
  mk("D",5, {baselineFinish:"2026-12-20"}),
];
const links = [
  {pred:"A",succ:"B",type:"FS",lag:0},
  {pred:"B",succ:"C",type:"FS",lag:0},
  {pred:"C",succ:"D",type:"FS",lag:0},
];
const res = runCpm(acts, links);
const rep = runDcma14(acts, links, res, { dataDate: "2026-07-22" });

console.log("\n== healthy network ==");
ok("14 points returned", rep.points.length === 14, rep.points.length);
ok("no leads", rep.points[1].status === "pass");
ok("no lags", rep.points[2].status === "pass");
ok("all FS", rep.points[3].status === "pass");
ok("critical path test propagates", rep.points[11].status === "pass", JSON.stringify(rep.points[11]));
ok("CPLI computed", rep.points[12].value !== null, rep.points[12].value);
ok("BEI computed", rep.points[13].value !== null, rep.points[13].value);
ok("score is 0..100", rep.score >= 0 && rep.score <= 100, rep.score);
console.log("  score:", rep.score, "grade:", rep.grade, "pass/fail/na:", rep.passed, rep.failed, rep.notApplicable);

// Broken network: leads, lags, non-FS, hard constraint, long duration, no resources
console.log("\n== broken network ==");
const bad = [ mk("X",100,{resourceCount:0,cost:0}), mk("Y",10,{constraint:"MSO",resourceCount:0,cost:0}), mk("Z",10,{resourceCount:0,cost:0}) ];
const badLinks = [ {pred:"X",succ:"Y",type:"SS",lag:-5}, {pred:"Y",succ:"Z",type:"FF",lag:12} ];
const badRes = runCpm(bad, badLinks);
const badRep = runDcma14(bad, badLinks, badRes, { dataDate:"2026-07-22" });
ok("leads flagged", badRep.points[1].status === "fail");
ok("lags flagged", badRep.points[2].status === "fail");
ok("non-FS flagged", badRep.points[3].status === "fail");
ok("hard constraint flagged", badRep.points[4].status === "fail");
ok("long duration flagged", badRep.points[7].status === "fail");
ok("broken scores worse", badRep.score < rep.score, `${badRep.score} vs ${rep.score}`);

// N/A behaviour: no status data must not silently pass
console.log("\n== missing data must be N/A, not pass ==");
const bare = [ {id:"P",code:"P",name:"P",duration:5,progress:0}, {id:"Q",code:"Q",name:"Q",duration:5,progress:0} ];
const bareLinks = [{pred:"P",succ:"Q",type:"FS",lag:0}];
const bareRep = runDcma14(bare, bareLinks, runCpm(bare,bareLinks), {dataDate:"2026-07-22"});
ok("invalid dates = na", bareRep.points[8].status === "na");
ok("resources = na", bareRep.points[9].status === "na");
ok("missed tasks = na", bareRep.points[10].status === "na");
ok("BEI = na", bareRep.points[13].status === "na");
ok("na excluded from score", bareRep.passed + bareRep.failed + bareRep.notApplicable === 14);

// Invalid dates detection
console.log("\n== invalid dates ==");
const inv = [ mk("I",5,{progress:100, actualFinish:"2027-01-01"}), mk("J",5,{progress:50, actualFinish:"2026-02-01"}) ];
const invLinks=[{pred:"I",succ:"J",type:"FS",lag:0}];
const invRep = runDcma14(inv, invLinks, runCpm(inv,invLinks), {dataDate:"2026-07-22"});
ok("future actual + finish-on-incomplete flagged", invRep.points[8].status === "fail" && invRep.points[8].count === 2, JSON.stringify(invRep.points[8].offenders));

// CSV
console.log("\n== csv ==");
const csv = dcmaToCsv(rep);
ok("csv has header + 14 rows", csv.split("\n").length === 15, csv.split("\n").length);
ok("csv escapes commas", csv.includes('"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
