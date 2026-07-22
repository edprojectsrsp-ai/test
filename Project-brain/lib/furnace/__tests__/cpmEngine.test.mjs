import { runCpm } from "./cpmEngine.js";
let pass=0,fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,x));};
const DD="2026-01-01";
const A=(id,dur,o={})=>({id,code:id,name:id,duration:dur,progress:0,...o});

console.log("== baseline: no constraints ==");
let acts=[A("A",10),A("B",10)], links=[{pred:"A",succ:"B",type:"FS",lag:0}];
let r=runCpm(acts,links,{dataDate:DD});
ok("chain ES", r.es.B===10, r.es.B);
ok("project duration", r.projectDuration===20, r.projectDuration);

console.log("== SNET pushes ES forward ==");
acts=[A("A",10),A("B",10,{constraint:"SNET",constraintDate:"2026-02-01"})];
r=runCpm(acts,links,{dataDate:DD});
ok("B starts at constraint (day 31), not 10", r.es.B===31, r.es.B);
ok("project extended", r.projectDuration===41, r.projectDuration);

console.log("== SNET earlier than logic is ignored ==");
acts=[A("A",10),A("B",10,{constraint:"SNET",constraintDate:"2026-01-03"})];
r=runCpm(acts,links,{dataDate:DD});
ok("logic wins over weaker SNET", r.es.B===10, r.es.B);

console.log("== FNLT creates negative float ==");
acts=[A("A",10),A("B",10,{constraint:"FNLT",constraintDate:"2026-01-15"})];
r=runCpm(acts,links,{dataDate:DD});
ok("B finishes day 20 but must finish day 14", r.ef.B===20, r.ef.B);
ok("negative total float", r.tf.B===-6, r.tf.B);

console.log("== FNLT met = no negative float ==");
acts=[A("A",10),A("B",10,{constraint:"FNLT",constraintDate:"2026-03-01"})];
r=runCpm(acts,links,{dataDate:DD});
ok("float not negative", r.tf.B>=0, r.tf.B);

console.log("== MSO pins hard, both directions ==");
acts=[A("A",10),A("B",10,{constraint:"MSO",constraintDate:"2026-01-21"})];
r=runCpm(acts,links,{dataDate:DD});
ok("pinned ES=20", r.es.B===20, r.es.B);
ok("zero float at pin", r.tf.B===0, r.tf.B);

console.log("== MSO earlier than logic still pins (hard) ==");
acts=[A("A",10),A("B",10,{constraint:"MSO",constraintDate:"2026-01-06"})];
r=runCpm(acts,links,{dataDate:DD});
ok("hard pin overrides logic, ES=5", r.es.B===5, r.es.B);

console.log("== FNET pushes finish forward ==");
acts=[A("A",10),A("B",10,{constraint:"FNET",constraintDate:"2026-02-10"})];
r=runCpm(acts,links,{dataDate:DD});
ok("EF at least day 40", r.ef.B===40, r.ef.B);
ok("ES pushed to 30", r.es.B===30, r.es.B);

console.log("== SNLT pulls LS down ==");
acts=[A("A",10),A("B",10,{constraint:"SNLT",constraintDate:"2026-01-06"})];
r=runCpm(acts,links,{dataDate:DD});
ok("LS capped at 5", r.ls.B===5, r.ls.B);
ok("negative float", r.tf.B===-5, r.tf.B);

console.log("== safety: no dataDate = constraints ignored, not applied at day 0 ==");
acts=[A("A",10),A("B",10,{constraint:"SNET",constraintDate:"2026-02-01"})];
r=runCpm(acts,links);
ok("unchanged without dataDate", r.es.B===10, r.es.B);

console.log("== safety: bad date ignored ==");
acts=[A("A",10),A("B",10,{constraint:"SNET",constraintDate:"not-a-date"})];
r=runCpm(acts,links,{dataDate:DD});
ok("garbage date ignored", r.es.B===10, r.es.B);

console.log("== constraint feeds DCMA negative-float check ==");
const { runDcma14 } = await import("./dcma.js");
acts=[A("A",10),A("B",10,{constraint:"FNLT",constraintDate:"2026-01-15"})];
r=runCpm(acts,links,{dataDate:DD});
const rep=runDcma14(acts,links,r,{dataDate:DD});
ok("DCMA #7 now fails as it should", rep.points[6].status==="fail", JSON.stringify(rep.points[6].count));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
