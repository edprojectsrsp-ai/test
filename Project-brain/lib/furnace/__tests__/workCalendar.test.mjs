import { WorkCalendar, parseDate, DAY_MS } from "./workCalendar.js";
let pass=0,fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,x));};
const iso=(d)=>new Date(d).toISOString().slice(0,10);

// 2026-01-05 is a Monday
console.log("== working day predicate ==");
let c=WorkCalendar.standard5Day();
ok("Monday works", c.isWorkingDay("2026-01-05"));
ok("Friday works", c.isWorkingDay("2026-01-09"));
ok("Saturday off", !c.isWorkingDay("2026-01-10"));
ok("Sunday off", !c.isWorkingDay("2026-01-11"));

console.log("== holidays and exceptions ==");
c=new WorkCalendar({holidays:["2026-01-26"], exceptionsWork:["2026-01-10"]});
ok("holiday off (Republic Day Mon)", !c.isWorkingDay("2026-01-26"));
ok("exception forces Saturday on", c.isWorkingDay("2026-01-10"));
ok("exception beats holiday", new WorkCalendar({holidays:["2026-03-02"],exceptionsWork:["2026-03-02"]}).isWorkingDay("2026-03-02"));

console.log("== 6-day and 7-day calendars ==");
const six=new WorkCalendar({workingWeekdays:[1,2,3,4,5,6]});
ok("6-day: Saturday works", six.isWorkingDay("2026-01-10"));
ok("6-day: Sunday off", !six.isWorkingDay("2026-01-11"));
const cont=WorkCalendar.continuous();
ok("7-day: Sunday works", cont.isWorkingDay("2026-01-11"));

console.log("== unit -> date (backend convention) ==");
c=WorkCalendar.standard5Day(); c.setAnchor("2026-01-05"); // Monday
ok("unit 0 = Mon 05", iso(c.msForUnit(0))==="2026-01-05", iso(c.msForUnit(0)));
ok("unit 4 = Fri 09", iso(c.msForUnit(4))==="2026-01-09", iso(c.msForUnit(4)));
ok("unit 5 skips weekend -> Mon 12", iso(c.msForUnit(5))==="2026-01-12", iso(c.msForUnit(5)));
ok("unit 9 = Fri 16", iso(c.msForUnit(9))==="2026-01-16", iso(c.msForUnit(9)));
ok("unit 10 = Mon 19", iso(c.msForUnit(10))==="2026-01-19", iso(c.msForUnit(10)));

console.log("== anchor snaps forward to a working day ==");
c=WorkCalendar.standard5Day(); c.setAnchor("2026-01-10"); // Saturday
ok("Sat anchor -> Mon 12", iso(c.msForUnit(0))==="2026-01-12", iso(c.msForUnit(0)));

console.log("== negative units go backwards ==");
c=WorkCalendar.standard5Day(); c.setAnchor("2026-01-12"); // Monday
ok("unit -1 = Fri 09", iso(c.msForUnit(-1))==="2026-01-09", iso(c.msForUnit(-1)));
ok("unit -3 = Wed 07", iso(c.msForUnit(-3))==="2026-01-07", iso(c.msForUnit(-3)));

console.log("== date -> unit is inverse of unit -> date ==");
c=WorkCalendar.standard5Day(); c.setAnchor("2026-01-05");
let roundtripOk=true;
for(let u=-10;u<=120;u++){ if(c.unitForDate(c.msForUnit(u))!==u){roundtripOk=false;console.log("   mismatch at",u,c.unitForDate(c.msForUnit(u)));break;} }
ok("roundtrip units -10..120", roundtripOk);
ok("weekend date maps to prior unit-ish", c.unitForDate("2026-01-10")===4, c.unitForDate("2026-01-10"));

console.log("== holidays shift units ==");
c=new WorkCalendar({holidays:["2026-01-07"]}); c.setAnchor("2026-01-05");
ok("Wed holiday: unit 2 = Thu 08", iso(c.msForUnit(2))==="2026-01-08", iso(c.msForUnit(2)));

console.log("== workingDaysBetween (inclusive) ==");
c=WorkCalendar.standard5Day();
ok("Mon..Fri = 5", c.workingDaysBetween("2026-01-05","2026-01-09")===5, c.workingDaysBetween("2026-01-05","2026-01-09"));
ok("Mon..Mon = 1", c.workingDaysBetween("2026-01-05","2026-01-05")===1);
ok("Fri..Mon = 2 (weekend skipped)", c.workingDaysBetween("2026-01-09","2026-01-12")===2, c.workingDaysBetween("2026-01-09","2026-01-12"));
ok("reversed is negative", c.workingDaysBetween("2026-01-09","2026-01-05")===-5);
ok("Sat..Sun = 0", c.workingDaysBetween("2026-01-10","2026-01-11")===0);

console.log("== addWorkingDays ==");
ok("Mon +0 = Mon", iso(c.addWorkingDays("2026-01-05",0))==="2026-01-05");
ok("Mon +1 = Tue", iso(c.addWorkingDays("2026-01-05",1))==="2026-01-06");
ok("Fri +1 = Mon", iso(c.addWorkingDays("2026-01-09",1))==="2026-01-12");
ok("Mon -1 = prior Fri", iso(c.addWorkingDays("2026-01-12",-1))==="2026-01-09");

console.log("== the actual bug: calendar days vs working days ==");
c=WorkCalendar.standard5Day(); c.setAnchor("2026-01-05");
const naive=iso(Date.parse("2026-01-05")+100*DAY_MS);
const real=iso(c.msForUnit(100));
ok("100 units != 100 calendar days", naive!==real, `naive ${naive} vs calendar ${real}`);
ok("100 units = 140 calendar days", (c.msForUnit(100)-Date.parse("2026-01-05"))/DAY_MS===140, (c.msForUnit(100)-Date.parse("2026-01-05"))/DAY_MS);

console.log("== bar end: Friday finish stops at Saturday ==");
c=WorkCalendar.standard5Day(); c.setAnchor("2026-01-05");
ok("ef unit 5 (last worked Fri 09) -> bar ends Sat 10", iso(c.barEndForUnit(5))==="2026-01-10", iso(c.barEndForUnit(5)));

console.log("== safety ==");
ok("empty weekdays falls back to Mon-Fri", new WorkCalendar({workingWeekdays:[]}).isWorkingDay("2026-01-05"));
ok("bad date -> null", parseDate("nope")===null);
ok("null -> null", parseDate(null)===null);
ok("unitForDate(null) = null", c.unitForDate(null)===null);
const allOff=new WorkCalendar({workingWeekdays:[]});
ok("no infinite loop on odd calendar", typeof allOff.msForUnit(3)==="number");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
