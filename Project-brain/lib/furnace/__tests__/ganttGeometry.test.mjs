import { buildTimeScale, barRect, varianceRect, dayDelta, toMs, DAY_MS } from "./ganttGeometry.js";
let pass=0,fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,x));};
const near=(a,b,t=0.01)=>Math.abs(a-b)<t;

console.log("== toMs ==");
ok("iso string", toMs("2026-01-01")===Date.UTC(2026,0,1));
ok("null", toMs(null)===null);
ok("empty string", toMs("")===null);
ok("garbage", toMs("not-a-date")===null);
ok("Date object", toMs(new Date("2026-01-01"))===Date.UTC(2026,0,1));
ok("number passthrough", toMs(12345)===12345);
ok("NaN rejected", toMs(NaN)===null);

console.log("== scale basics ==");
let s=buildTimeScale(["2026-01-01","2026-03-01"],"week",{padDays:0});
ok("min is start", s.min===Date.UTC(2026,0,1), new Date(s.min).toISOString());
ok("max is end", s.max===Date.UTC(2026,2,1));
ok("x(min)=0", s.x("2026-01-01")===0);
ok("width = span*pxPerDay", near(s.width, 59*7), s.width);
ok("x monotonic", s.x("2026-02-01") > s.x("2026-01-15"));

console.log("== padding ==");
s=buildTimeScale(["2026-01-15"],"week",{padDays:7});
ok("padded left", s.min===Date.UTC(2026,0,8), new Date(s.min).toISOString());
ok("single date gets usable span", s.max>s.min);

console.log("== degenerate input must not collapse to 1970 ==");
s=buildTimeScale([null,undefined,"","bad"],"week");
const now=Date.now();
ok("falls back near today", Math.abs(s.min-now) < 40*DAY_MS, new Date(s.min).toISOString());
ok("has positive width", s.width>0);
s=buildTimeScale([],"week");
ok("empty array safe", s.width>0 && s.min>0);

console.log("== zoom modes ==");
for (const m of ["day","week","month","quarter"]) {
  const sc=buildTimeScale(["2026-01-01","2027-01-01"],m,{padDays:0});
  ok(`${m}: positive width`, sc.width>0, sc.width);
  ok(`${m}: has ticks`, sc.ticks.length>0, sc.ticks.length);
  ok(`${m}: ticks within bounds`, sc.ticks.every(t=>t.x>=-1 && t.x<=sc.width+1));
  ok(`${m}: some major ticks`, sc.ticks.some(t=>t.major));
}
const dayS=buildTimeScale(["2026-01-01","2026-06-01"],"day",{padDays:0});
const qS=buildTimeScale(["2026-01-01","2026-06-01"],"quarter",{padDays:0});
ok("day zoom wider than quarter", dayS.width > qS.width);

console.log("== barRect ==");
s=buildTimeScale(["2026-01-01","2026-04-01"],"week",{padDays:0});
let r=barRect(s,"2026-01-01","2026-01-31");
ok("x at 0", r.x===0, r.x);
ok("width = 30d", near(r.width,30*7), r.width);
ok("not clipped", !r.clippedLeft && !r.clippedRight);

r=barRect(s,"2026-01-10","2026-01-10");
ok("zero-length milestone still visible", r.width>=3, r.width);

r=barRect(s,"2026-01-20","2026-01-10");
ok("reversed dates still render", r!==null && r.width>0);

r=barRect(s,"2025-06-01","2026-02-01");
ok("clipped left flagged", r.clippedLeft===true);
ok("clipped left starts at 0", r.x===0);

r=barRect(s,"2026-03-01","2027-01-01");
ok("clipped right flagged", r.clippedRight===true);
ok("clipped right within width", r.x+r.width<=s.width+0.01);

ok("entirely before window = null", barRect(s,"2020-01-01","2020-02-01")===null);
ok("entirely after window = null", barRect(s,"2030-01-01","2030-02-01")===null);
ok("both null = null", barRect(s,null,null)===null);

r=barRect(s,"2026-02-01",null);
ok("one-sided date renders", r!==null && r.width>=3);

console.log("== dayDelta ==");
ok("slip positive", dayDelta("2026-02-10","2026-02-01")===9);
ok("gain negative", dayDelta("2026-01-25","2026-02-01")===-7);
ok("same day zero", dayDelta("2026-02-01","2026-02-01")===0);
ok("null safe", dayDelta(null,"2026-02-01")===null);

console.log("== varianceRect ==");
let v=varianceRect(s,"2026-02-01","2026-02-15");
ok("slip direction", v.direction==="slip");
ok("slip width = 14d", near(v.width,14*7), v.width);
v=varianceRect(s,"2026-02-15","2026-02-01");
ok("gain direction", v.direction==="gain");
ok("gain spans same range", near(v.width,14*7), v.width);
ok("no variance = null", varianceRect(s,"2026-02-01","2026-02-01")===null);
ok("missing baseline = null", varianceRect(s,null,"2026-02-01")===null);

console.log("== alignment: bar and variance share the scale ==");
const bar=barRect(s,"2026-01-01","2026-02-01");
const varr=varianceRect(s,"2026-02-01","2026-02-20");
ok("variance starts where bar ends", near(varr.x, bar.x+bar.width, 0.5), `${varr.x} vs ${bar.x+bar.width}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
