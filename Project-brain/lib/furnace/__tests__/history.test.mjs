import { History, historyShortcut } from "./history.js";
let pass=0,fail=0;
const ok=(n,c,x="")=>{c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,x));};

console.log("== empty history ==");
let h=new History();
ok("cannot undo", !h.canUndo);
ok("cannot redo", !h.canRedo);
ok("undo returns null", h.undo()===null);
ok("redo returns null", h.redo()===null);
ok("state null", h.state===null);

console.log("== basic push/undo/redo ==");
h=new History({v:0},"Initial");
ok("initial state", h.state.v===0);
ok("no undo yet", !h.canUndo);
h.push({v:1},"Edit 1");
h.push({v:2},"Edit 2");
ok("state is latest", h.state.v===2);
ok("can undo", h.canUndo);
ok("undo -> 1", h.undo().v===1);
ok("undo -> 0", h.undo().v===0);
ok("no more undo", !h.canUndo);
ok("undo at bottom = null", h.undo()===null);
ok("can redo", h.canRedo);
ok("redo -> 1", h.redo().v===1);
ok("redo -> 2", h.redo().v===2);
ok("no more redo", !h.canRedo);

console.log("== editing after undo discards the redo branch ==");
h=new History({v:0}); h.push({v:1},"a"); h.push({v:2},"b");
h.undo();
ok("redo available before edit", h.canRedo);
h.push({v:9},"c");
ok("redo branch discarded", !h.canRedo);
ok("state is new edit", h.state.v===9);
ok("undo goes to pre-branch", h.undo().v===1);

console.log("== coalescing: one drag = one undo step ==");
h=new History({x:0},"Initial",{coalesceMs:600});
let t=1000;
h.push({x:1},"Move A","drag:A",t);
h.push({x:2},"Move A","drag:A",t+100);
h.push({x:3},"Move A","drag:A",t+200);
ok("merged into one entry", h.depth===1, h.depth);
ok("state is final frame", h.state.x===3);
ok("undo jumps to before drag", h.undo().x===0);

console.log("== different keys do not merge ==");
h=new History({x:0},"Initial");
h.push({x:1},"Move A","drag:A",1000);
h.push({x:2},"Move B","drag:B",1050);
ok("separate entries", h.depth===2, h.depth);

console.log("== same key outside window does not merge ==");
h=new History({x:0},"Initial",{coalesceMs:600});
h.push({x:1},"Move A","drag:A",1000);
h.push({x:2},"Move A","drag:A",5000);
ok("separate entries", h.depth===2, h.depth);

console.log("== no mergeKey never merges ==");
h=new History({x:0},"Initial");
h.push({x:1},"e",undefined,1000);
h.push({x:2},"e",undefined,1010);
ok("separate entries", h.depth===2, h.depth);

console.log("== limit trims oldest ==");
h=new History({v:0},"Initial",{limit:3});
for(let i=1;i<=10;i++) h.push({v:i},`e${i}`);
ok("depth capped", h.depth===3, h.depth);
let steps=0; while(h.undo()!==null) steps++;
ok("only 3 undo steps", steps===3, steps);

console.log("== labels ==");
h=new History({v:0},"Initial");
h.push({v:1},"Move A010");
h.push({v:2},"Move A020");
ok("undoLabel is current edit", h.undoLabel==="Move A020", h.undoLabel);
h.undo();
ok("redoLabel after undo", h.redoLabel==="Move A020", h.redoLabel);
ok("undoLabel now prior", h.undoLabel==="Move A010", h.undoLabel);
ok("labels newest first", h.labels(3)[0]==="Move A010", JSON.stringify(h.labels(3)));

console.log("== reset ==");
h=new History({v:0}); h.push({v:1},"a"); h.push({v:2},"b");
h.reset({v:99},"Reloaded");
ok("history cleared", !h.canUndo && !h.canRedo);
ok("state replaced", h.state.v===99);

console.log("== push onto empty history sets origin ==");
h=new History();
h.push({v:5},"first");
ok("state set", h.state.v===5);
ok("no undo (it is the origin)", !h.canUndo);

console.log("== shortcuts ==");
const ev=(k,o={})=>({key:k,ctrlKey:false,metaKey:false,shiftKey:false,...o});
ok("ctrl+z undo", historyShortcut(ev("z",{ctrlKey:true}))==="undo");
ok("cmd+z undo", historyShortcut(ev("z",{metaKey:true}))==="undo");
ok("ctrl+shift+z redo", historyShortcut(ev("z",{ctrlKey:true,shiftKey:true}))==="redo");
ok("ctrl+y redo", historyShortcut(ev("y",{ctrlKey:true}))==="redo");
ok("uppercase Z works", historyShortcut(ev("Z",{ctrlKey:true}))==="undo");
ok("plain z ignored", historyShortcut(ev("z"))===null);
ok("ctrl+s ignored", historyShortcut(ev("s",{ctrlKey:true}))===null);
ok("input field ignored", historyShortcut({...ev("z",{ctrlKey:true}),target:{tagName:"INPUT"}})===null);
ok("textarea ignored", historyShortcut({...ev("z",{ctrlKey:true}),target:{tagName:"TEXTAREA"}})===null);
ok("contenteditable ignored", historyShortcut({...ev("z",{ctrlKey:true}),target:{isContentEditable:true}})===null);
ok("non-input target fine", historyShortcut({...ev("z",{ctrlKey:true}),target:{tagName:"DIV"}})==="undo");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
