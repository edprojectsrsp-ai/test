import { analyseJoin, normaliseKey, isNullish, splitColumns, orphanRows } from "./dpmsJoin.js";
let pass=0,fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,x));};

const S=(rows,extra={})=>({child_table:"dpr",child_col:"scheme_id",
  parent_table:"scheme",parent_col:"id",
  child_preview_columns:["scheme_id","qty"],
  parent_preview_columns:["id","scheme_name"],rows,...extra});

console.log("== null detection ==");
for (const v of [null,undefined,"","  ","NULL","None","nan","N/A","-",NaN])
  ok(`nullish ${JSON.stringify(v)}`, isNullish(v)===true);
ok("0 is not nullish", isNullish(0)===false);
ok("'0' is not nullish", isNullish("0")===false);

console.log("== key normalisation (the CSV-dump problem) ==");
ok("leading zeros stripped", normaliseKey("00123")===normaliseKey("123"));
ok("whitespace trimmed", normaliseKey(" 123 ")===normaliseKey("123"));
ok("float coercion .0 stripped", normaliseKey("123.0")===normaliseKey("123"));
ok("number and string agree", normaliseKey(123)===normaliseKey("123"));
ok("case-insensitive text", normaliseKey("ABC-1")===normaliseKey("abc-1"));
ok("negatives preserved", normaliseKey("-007")==="-7");
ok("zero survives", normaliseKey("0")==="0");
ok("nullish -> empty", normaliseKey(null)==="");
ok("distinct stay distinct", normaliseKey("123")!==normaliseKey("124"));

console.log("== perfect join ==");
let h=analyseJoin(S([
  {scheme_id:"1",qty:10,id:"1",scheme_name:"A"},
  {scheme_id:"2",qty:20,id:"2",scheme_name:"B"},
  {scheme_id:"3",qty:30,id:"3",scheme_name:"C"},
]));
ok("all matched", h.matchedRows===3, h.matchedRows);
ok("no orphans", h.orphanRows===0);
ok("match rate 1", h.matchRate===1);
ok("verdict strong", h.verdict==="strong", h.verdict);
ok("cardinality 1:1", h.cardinality==="1:1", h.cardinality);

console.log("== orphans detected ==");
h=analyseJoin(S([
  {scheme_id:"1",qty:10,id:"1",scheme_name:"A"},
  {scheme_id:"9",qty:20,id:null,scheme_name:null},
  {scheme_id:"8",qty:30,id:"",scheme_name:""},
]));
ok("1 matched", h.matchedRows===1, h.matchedRows);
ok("2 orphans", h.orphanRows===2, h.orphanRows);
ok("verdict broken", h.verdict==="broken", `${h.verdict} @ ${h.matchRate}`);
ok("note explains", h.notes.some(n=>n.includes("half")), JSON.stringify(h.notes));

console.log("== empty keys are called out, not silently matched ==");
h=analyseJoin(S([
  {scheme_id:"",qty:10,id:null,scheme_name:null},
  {scheme_id:null,qty:20,id:null,scheme_name:null},
  {scheme_id:"1",qty:30,id:"1",scheme_name:"A"},
]));
ok("2 null keys", h.nullKeys===2, h.nullKeys);
ok("null keys excluded from rate", h.matchRate===1, h.matchRate);
ok("note warns about dropout", h.notes.some(n=>n.includes("empty key")));

console.log("== 1:N fanout ==");
h=analyseJoin(S([
  {scheme_id:"1",qty:10,id:"1",scheme_name:"A"},
  {scheme_id:"1",qty:20,id:"1",scheme_name:"A"},
  {scheme_id:"1",qty:30,id:"1",scheme_name:"A"},
  {scheme_id:"2",qty:40,id:"2",scheme_name:"B"},
]));
ok("fanout 3", h.maxFanout===3, h.maxFanout);
ok("distinct child keys 2", h.distinctChildKeys===2);
ok("cardinality N:1 (many dpr rows -> one scheme)", h.cardinality==="N:1", h.cardinality);

console.log("== 1:N — one child key reaching several parents, the dangerous case ==");
h=analyseJoin(S([
  {scheme_id:"1",qty:1,id:"1",scheme_name:"A"},
  {scheme_id:"2",qty:2,id:"2",scheme_name:"B"},
  {scheme_id:"3",qty:3,id:"3",scheme_name:"C"},
]));
ok("clean 1:1 baseline", h.cardinality==="1:1", h.cardinality);
h=analyseJoin(S([
  {scheme_id:"1",qty:1,id:"10",scheme_name:"A"},
  {scheme_id:"1",qty:1,id:"11",scheme_name:"B"},
  {scheme_id:"2",qty:2,id:"12",scheme_name:"C"},
  {scheme_id:"2",qty:2,id:"13",scheme_name:"D"},
]));
ok("cardinality N:N", h.cardinality==="N:N", h.cardinality);
ok("warns about multiplication", h.notes.some(n=>n.includes("multiplies")), JSON.stringify(h.notes));
ok("reports parents per child", h.maxParentsPerChild===2, h.maxParentsPerChild);

console.log("== verdict thresholds ==");
const mk=(matched,total)=>S(Array.from({length:total},(_,i)=>
  i<matched?{scheme_id:String(i),qty:1,id:String(i),scheme_name:"x"}
           :{scheme_id:String(1000+i),qty:1,id:null,scheme_name:null}));
ok("100% strong", analyseJoin(mk(20,20)).verdict==="strong");
ok("80% usable", analyseJoin(mk(16,20)).verdict==="usable", analyseJoin(mk(16,20)).verdict);
ok("40% weak", analyseJoin(mk(8,20)).verdict==="weak", analyseJoin(mk(8,20)).verdict);
ok("10% broken", analyseJoin(mk(2,20)).verdict==="broken");

console.log("== degenerate inputs ==");
h=analyseJoin(S([]));
ok("empty sample safe", h.sampleRows===0 && h.matchRate===null);
ok("verdict unknown", h.verdict==="unknown");
h=analyseJoin({child_table:"a",child_col:"x",parent_table:"b",parent_col:"y",rows:[{x:"1",y:"1"}]});
ok("missing preview columns still works", h.matchedRows===1, h.matchedRows);

console.log("== low parent coverage note ==");
h=analyseJoin(S([{scheme_id:"1",qty:1,id:"1",scheme_name:"A"}]),{parent_coverage:0.02});
ok("lookup-table note", h.notes.some(n=>n.includes("lookup")), JSON.stringify(h.notes));

console.log("== column splitting for side-by-side view ==");
const sp=splitColumns(S([{scheme_id:"1",qty:10,id:"1",scheme_name:"A",extra:"z"}]));
ok("child cols", JSON.stringify(sp.child)===JSON.stringify(["scheme_id","qty"]), JSON.stringify(sp.child));
ok("parent cols", JSON.stringify(sp.parent)===JSON.stringify(["id","scheme_name"]));
ok("unclassified kept", JSON.stringify(sp.other)===JSON.stringify(["extra"]));

console.log("== orphan rows surfaced ==");
const orph=orphanRows(S([
  {scheme_id:"1",qty:10,id:"1",scheme_name:"A"},
  {scheme_id:"9",qty:20,id:null,scheme_name:null},
]));
ok("one orphan returned", orph.length===1 && orph[0].scheme_id==="9", JSON.stringify(orph));
ok("limit respected", orphanRows(S(Array.from({length:50},(_,i)=>
  ({scheme_id:String(i),qty:1,id:null,scheme_name:null}))),5).length===5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
