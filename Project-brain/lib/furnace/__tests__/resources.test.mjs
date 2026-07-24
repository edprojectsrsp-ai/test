import { runCpm } from "./cpmEngine.js";
import { buildHistogram, buildAllHistograms, levelResources, hasOverallocation, startsFromCpm } from "./resources.js";
let pass=0,fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,x));};
const A=(id,dur,o={})=>({id,code:id,name:id,duration:dur,progress:0,...o});

console.log("== histogram basics ==");
let acts=[A("X",5),A("Y",5)];
let res={id:"crew",name:"Crew",capacity:10};
let assigns=[{activityId:"X",resourceId:"crew",perDay:4},{activityId:"Y",resourceId:"crew",perDay:3}];
let h=buildHistogram(acts,{X:0,Y:0},assigns,res);
ok("overlapping demand sums", h.buckets[0].demand===7, h.buckets[0].demand);
ok("peak correct", h.peak===7, h.peak);
ok("no overallocation at cap 10", h.overallocatedUnits===0);
ok("total resource-days", h.totalDemand===35, h.totalDemand);
ok("span = 5 units", h.buckets.length===5, h.buckets.length);

console.log("== overallocation detection ==");
res={id:"crew",name:"Crew",capacity:5};
h=buildHistogram(acts,{X:0,Y:0},assigns,res);
ok("over flagged", h.buckets[0].over===true);
ok("all 5 units over", h.overallocatedUnits===5, h.overallocatedUnits);
ok("names the culprits", h.buckets[0].activityIds.length===2, JSON.stringify(h.buckets[0].activityIds));
h=buildHistogram(acts,{X:0,Y:5},assigns,res);
ok("sequential = no overallocation", h.overallocatedUnits===0);

console.log("== milestones and unassigned consume nothing ==");
h=buildHistogram([A("M",0),A("X",5)],{M:0,X:0},[{activityId:"M",resourceId:"crew",perDay:99}],res);
ok("zero-duration milestone ignored", h.peak===0, h.peak);

console.log("== levelling resolves overallocation ==");
acts=[A("A",5),A("B",5),A("C",5)];
assigns=[{activityId:"A",resourceId:"crew",perDay:4},{activityId:"B",resourceId:"crew",perDay:4},{activityId:"C",resourceId:"crew",perDay:4}];
res={id:"crew",name:"Crew",capacity:8};
let links=[];
let r=runCpm(acts,links);
ok("before: overallocated", hasOverallocation(acts,startsFromCpm(r),assigns,[res])===true);
let lev=levelResources(acts,links,r,assigns,[res]);
ok("after: no overallocation", hasOverallocation(acts,lev.starts,assigns,[res])===false, JSON.stringify(lev.starts));
ok("project extended", lev.leveledDuration>lev.originalDuration, `${lev.originalDuration}->${lev.leveledDuration}`);
ok("something moved", lev.movedCount>0, lev.movedCount);
ok("nothing unresolved", lev.unresolved.length===0, JSON.stringify(lev.unresolved));

console.log("== levelling NEVER violates logic ==");
acts=[A("P",5),A("Q",5),A("R",5)];
links=[{pred:"P",succ:"Q",type:"FS",lag:0},{pred:"Q",succ:"R",type:"FS",lag:0}];
assigns=[{activityId:"P",resourceId:"crew",perDay:6},{activityId:"Q",resourceId:"crew",perDay:6},{activityId:"R",resourceId:"crew",perDay:6}];
r=runCpm(acts,links);
lev=levelResources(acts,links,r,assigns,[{id:"crew",name:"Crew",capacity:6}]);
ok("Q starts after P finishes", lev.starts.Q>=lev.starts.P+5, JSON.stringify(lev.starts));
ok("R starts after Q finishes", lev.starts.R>=lev.starts.Q+5, JSON.stringify(lev.starts));

console.log("== SS/FF/lag logic respected under levelling ==");
acts=[A("S1",10),A("S2",10)];
links=[{pred:"S1",succ:"S2",type:"SS",lag:3}];
assigns=[{activityId:"S1",resourceId:"crew",perDay:2},{activityId:"S2",resourceId:"crew",perDay:2}];
r=runCpm(acts,links);
lev=levelResources(acts,links,r,assigns,[{id:"crew",name:"Crew",capacity:10}]);
ok("SS+3 honoured", lev.starts.S2>=lev.starts.S1+3, JSON.stringify(lev.starts));

console.log("== float absorbs delay before project extends ==");
// Critical chain CA -FS+10-> CB leaves units 10..19 free of critical work.
// D floats and competes for the same crew; it should slide into that gap
// rather than pushing the project end out.
acts=[A("CA",10),A("CB",10),A("D",5)];
links=[{pred:"CA",succ:"CB",type:"FS",lag:10}];
assigns=[{activityId:"CA",resourceId:"crew",perDay:5},{activityId:"CB",resourceId:"crew",perDay:5},{activityId:"D",resourceId:"crew",perDay:5}];
r=runCpm(acts,links);
lev=levelResources(acts,links,r,assigns,[{id:"crew",name:"Crew",capacity:5}]);
ok("critical work not delayed", lev.delays.CA===0 && lev.delays.CB===0, `${lev.delays.CA}/${lev.delays.CB}`);
ok("floating activity slid into the gap", lev.starts.D>=10 && lev.starts.D<=15, lev.starts.D);
ok("project not extended", lev.extensionUnits===0, `${lev.originalDuration}->${lev.leveledDuration}`);
ok("no overallocation after levelling", !hasOverallocation(acts,lev.starts,assigns,[{id:"crew",name:"Crew",capacity:5}]));

console.log("== when float genuinely cannot absorb, project extends ==");
// same crew, but critical work runs continuously: D cannot fit inside
acts=[A("CA",10),A("CB",10),A("D",5)];
links=[{pred:"CA",succ:"CB",type:"FS",lag:0}];
r=runCpm(acts,links);
lev=levelResources(acts,links,r,assigns,[{id:"crew",name:"Crew",capacity:5}]);
ok("extension reported honestly", lev.extensionUnits===5, `${lev.originalDuration}->${lev.leveledDuration}`);
ok("delay exceeds float, flagged as new driver", lev.criticalDelays.includes("D"), JSON.stringify(lev.criticalDelays));

console.log("== multiple resources ==");
acts=[A("M1",5),A("M2",5)];
const crane={id:"crane",name:"Crane",capacity:1}, crew={id:"crew",name:"Crew",capacity:20};
assigns=[{activityId:"M1",resourceId:"crane",perDay:1},{activityId:"M2",resourceId:"crane",perDay:1},
         {activityId:"M1",resourceId:"crew",perDay:5},{activityId:"M2",resourceId:"crew",perDay:5}];
r=runCpm(acts,[]);
lev=levelResources(acts,[],r,assigns,[crane,crew]);
ok("crane forces sequence", Math.abs(lev.starts.M1-lev.starts.M2)>=5, JSON.stringify(lev.starts));
ok("no crane overallocation", !hasOverallocation(acts,lev.starts,assigns,[crane]));
const hs=buildAllHistograms(acts,lev.starts,assigns,[crane,crew]);
ok("one histogram per resource", hs.length===2);

console.log("== impossible demand reported, not looped forever ==");
acts=[A("Big",5)];
assigns=[{activityId:"Big",resourceId:"crew",perDay:100}];
r=runCpm(acts,[]);
lev=levelResources(acts,[],r,assigns,[{id:"crew",name:"Crew",capacity:5}]);
ok("reported unresolved", lev.unresolved.includes("Big"), JSON.stringify(lev.unresolved));
ok("kept its CPM start rather than vanishing", lev.starts.Big===0, lev.starts.Big);

console.log("== unknown resource does not constrain ==");
acts=[A("U",5)];
assigns=[{activityId:"U",resourceId:"ghost",perDay:999}];
r=runCpm(acts,[]);
lev=levelResources(acts,[],r,assigns,[{id:"crew",name:"Crew",capacity:1}]);
ok("placed at earliest", lev.starts.U===0);
ok("not unresolved", lev.unresolved.length===0);

console.log("== idempotence: levelling an already-level plan changes nothing ==");
acts=[A("I1",5),A("I2",5)];
assigns=[{activityId:"I1",resourceId:"crew",perDay:2},{activityId:"I2",resourceId:"crew",perDay:2}];
r=runCpm(acts,[]);
const first=levelResources(acts,[],r,assigns,[{id:"crew",name:"Crew",capacity:10}]);
ok("no delay when capacity ample", first.movedCount===0, first.movedCount);
ok("duration unchanged", first.leveledDuration===first.originalDuration);

console.log("== empty inputs ==");
ok("no activities safe", levelResources([],[],runCpm([],[]),[],[]).movedCount===0);
ok("no resources safe", levelResources([A("Z",5)],[],runCpm([A("Z",5)],[]),[],[]).unresolved.length===0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
