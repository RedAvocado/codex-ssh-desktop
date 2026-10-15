const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const computers=[{id:'studio',name:'Studio',origin:'https://studio.example.ts.net:8443',online:true},{id:'laptop',name:'Laptop',origin:'https://laptop.example.ts.net:8443',online:true}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({path='/',saved={},touch=true,holdFull=false,failFull=false,offlineInitial=[]}={}){
 let location=new URL(path,computers[0].origin),directory=computers.map(c=>({...c})),fails=false;
 for(const id of offlineInitial)directory.find(c=>c.id===id).online=false;
 let releaseFull;
 const fullReady=holdFull?new Promise(resolve=>{releaseFull=resolve;}):null;
 const requests=[];
 const events={},documentEvents={},storage=new Map(Object.entries(saved)),nodes={};
 const classes=new Set(),styles=new Map(),viewportEvents={};
 const root={clientHeight:844,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},style:{setProperty:(name,value)=>styles.set(name,value),removeProperty:name=>styles.delete(name)}};
 const viewport={height:844,offsetTop:0,scale:1,addEventListener:(name,callback)=>{viewportEvents[name]=callback;}};
 const document={documentElement:root,hidden:false,activeElement:null,getElementById:id=>nodes[id],addEventListener(name,callback){documentEvents[name]=callback;},createElement:tag=>new Element(tag)};
 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.hidden=false;if(tag==='iframe'){this.messages=[];this.contentWindow={postMessage:(data,origin)=>this.messages.push({data,origin})};}}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,callback){this.listeners[name]=callback;}
  focus(){document.activeElement=this;}
  querySelectorAll(){return this.children.flatMap(child=>[...(child.tag==='button'&&!child.disabled?[child]:[]),...child.querySelectorAll()]);}
  querySelector(){return this.querySelectorAll()[0];}
  contains(element){return element===this||this.children.some(child=>child.contains(element));}
 }
 for(const id of ['computer','computer-name','connection','computers','computer-options','availability','refresh','viewers','empty','empty-title','empty-help','retry','message'])nodes[id]=new Element(id==='computer'||id==='refresh'?'button':'div');
 nodes.computers.append(nodes['computer-options'],nodes.refresh);nodes.viewers.append(nodes.empty);
 const context={document,URL,AbortSignal,Map,JSON,console,matchMedia:()=>({matches:touch,addEventListener(){}}),setTimeout:()=>1,clearTimeout(){},get location(){return location;},history:{replaceState(_s,_t,path){location=new URL(path,location);}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},window:{visualViewport:viewport,addEventListener:(name,callback)=>{events[name]=callback;}},fetch:async url=>{
  const id=new URL(url,location).searchParams.get('id');requests.push(id);
  if(!id&&fullReady)await fullReady;
  if(fails||(!id&&failFull))throw Error('offline');
  const selected=id==='@self'?directory.filter(c=>c.origin===location.origin):id?directory.filter(c=>c.id===id):directory;
  return {ok:true,json:async()=>({computers:selected.map(c=>({...c}))})};
 }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/phone-shell.js'),'utf8'),context);
 await tick();await tick();
 if(!holdFull)for(let attempt=0;attempt<8&&nodes['computer-options'].children.length<directory.length;attempt++)await tick();
 return {nodes,events,documentEvents,document,storage,classes,styles,viewport,viewportEvents,requests,releaseFull,get location(){return location;},frames:()=>nodes.viewers.children.filter(c=>c.tag==='iframe'),options:()=>nodes['computer-options'].children,setOnline(id,value){directory.find(c=>c.id===id).online=value;},fail(){fails=true;},async refresh(){await nodes.refresh.onclick();await tick();},async select(id){nodes['computer-options'].children.find(c=>c.dataset.computer===id).onclick();await tick();await tick();}};
}
test('selected computer starts loading before another computer finishes its health probe',async()=>{
 const local=await fixture({holdFull:true});
 assert.deepEqual(local.requests,['@self',null]);
 assert.equal(local.frames().length,1);assert.equal(new URL(local.frames()[0].src).origin,computers[0].origin);
 assert.equal(local.options().length,1);
 local.releaseFull();await tick();await tick();assert.equal(local.options().length,2);
 const remote=await fixture({saved:{'codex-computer':'laptop'},holdFull:true});
 assert.deepEqual(remote.requests,['laptop',null]);
 assert.equal(remote.frames().length,1);assert.equal(new URL(remote.frames()[0].src).origin,computers[1].origin);
 remote.releaseFull();await tick();await tick();
});
test('a failed directory poll does not prevent a verified current host from loading',async()=>{
 const f=await fixture({failFull:true});
 assert.equal(f.frames().length,1);
 assert.equal(f.nodes.connection.textContent,'Availability unknown');
 assert.match(f.nodes.availability.textContent,/Cannot check availability/);
});
test('an offline saved computer falls back to another verified online host',async()=>{
 const f=await fixture({saved:{'codex-computer':'laptop'},offlineInitial:['laptop']});
 assert.equal(f.frames().length,1);
 assert.equal(new URL(f.frames()[0].src).origin,computers[0].origin);
 assert.equal(f.options().some(c=>c.dataset.computer==='laptop'),false);
});
test('phone keyboard resizes the visible shell and restores it on dismissal',async()=>{
 const f=await fixture(),frame=f.frames()[0];
 f.viewport.height=510;f.viewport.offsetTop=24;f.viewportEvents.resize();
 assert.ok(f.classes.has('phone-keyboard-open'));assert.equal(f.styles.get('--phone-visible-height'),'510px');assert.equal(f.styles.get('--phone-visible-top'),'24px');
 f.viewport.offsetTop=0;f.viewportEvents.scroll();assert.equal(f.styles.get('--phone-visible-top'),'0px');
 f.viewport.height=844;f.viewportEvents.resize();assert.equal(f.classes.has('phone-keyboard-open'),false);assert.equal(f.styles.size,0);assert.equal(f.frames()[0],frame);
});
test('browser chrome, pinch zoom and desktop sizing do not trigger phone keyboard layout',async()=>{
 const phone=await fixture();phone.viewport.height=770;phone.viewportEvents.resize();assert.equal(phone.classes.size,0);
 phone.viewport.height=422;phone.viewport.scale=2;phone.viewportEvents.resize();assert.equal(phone.classes.size,0);
 const desktop=await fixture({touch:false});desktop.viewport.height=500;desktop.viewportEvents.resize();assert.equal(desktop.classes.size,0);assert.equal(desktop.styles.size,0);
});
test('switching retains separate frame instances and never replaces a draft',async()=>{
 const f=await fixture(),first=f.frames()[0];first.draft='keep studio input';
 const before=f.requests.length;
 await f.select('laptop');const second=f.frames()[1];second.draft='keep laptop input';
 assert.deepEqual(f.requests.slice(before),['laptop'],'switching probes only the destination host');
 assert.equal(first.hidden,true);assert.equal(second.hidden,false);
 await f.select('studio');assert.equal(f.frames().length,2);assert.equal(f.frames()[0],first);assert.equal(first.draft,'keep studio input');assert.equal(second.draft,'keep laptop input');
 assert.equal(new URL(second.src).origin,computers[1].origin);
});
test('hidden and backgrounded computer frames park without discarding drafts',async()=>{
 const f=await fixture(),studio=f.frames()[0];studio.draft='unsent draft';
 const ready=(computer,frame)=>f.events.message({origin:computer.origin,source:frame.contentWindow,data:{type:'codex-computer-ready'}});
 const visibility=frame=>frame.messages.filter(message=>message.data.type==='codex-computer-visibility').map(message=>message.data.visible);
 ready(computers[0],studio);
 assert.deepEqual(visibility(studio),[true]);
 await f.select('laptop');const laptop=f.frames()[1];
 assert.deepEqual(visibility(studio),[true,false]);
 ready(computers[1],laptop);
 assert.deepEqual(visibility(laptop),[true]);
 f.document.hidden=true;await f.documentEvents.visibilitychange();
 assert.deepEqual(visibility(laptop),[true,false]);
 f.document.hidden=false;await f.documentEvents.visibilitychange();
 assert.deepEqual(visibility(laptop),[true,false,true]);
 f.events.pagehide();assert.equal(visibility(laptop).at(-1),false);
 f.events.pageshow();assert.equal(visibility(laptop).at(-1),true);
 await f.select('studio');
 assert.equal(visibility(laptop).at(-1),false);
 assert.equal(visibility(studio).at(-1),true);
 assert.equal(studio.draft,'unsent draft');
 for(const frame of f.frames())for(const message of frame.messages.filter(message=>message.data.type==='codex-computer-visibility'))
   assert.equal(message.origin,new URL(frame.src).origin,'visibility control stays on each configured origin');
});
test('offline choices disappear and a failed switch leaves the current view intact',async()=>{
 const f=await fixture(),first=f.frames()[0];
 f.setOnline('laptop',false);await f.select('laptop');
 assert.equal(f.frames().length,1);assert.equal(first.hidden,false);assert.equal(f.location.searchParams.get('computer'),'studio');
 assert.equal(f.options().some(c=>c.dataset.computer==='laptop'),false);
 f.setOnline('studio',false);await f.refresh();assert.equal(f.options()[0].disabled,true);assert.equal(f.nodes.connection.textContent,'Offline');assert.equal(first.hidden,false);
});
test('unchanged polling preserves menu buttons and an unreachable directory is distinguished from offline',async()=>{
 const f=await fixture(),option=f.options()[0];await f.refresh();assert.equal(f.options()[0],option);
 f.fail();await f.refresh();assert.equal(f.nodes.connection.textContent,'Availability unknown');assert.equal(f.frames()[0].hidden,false);
});
test('deep links override the saved computer and a selected task route survives reload',async()=>{
 const f=await fixture({path:'/thread/new-task',saved:{'codex-computer':'laptop','codex-computer-routes':JSON.stringify({studio:'/thread/old-task'})}});
 assert.equal(f.location.searchParams.get('computer'),'studio');assert.equal(new URL(f.frames()[0].src).searchParams.get('path'),'/thread/new-task');
 const first=f.frames()[0];f.events.message({origin:computers[0].origin,source:first.contentWindow,data:{type:'codex-computer-route',path:'/thread/current-task'}});
 assert.equal(f.location.searchParams.get('path'),'/thread/current-task');
 const restored=await fixture({path:f.location.pathname+f.location.search,saved:Object.fromEntries(f.storage)});
 assert.equal(new URL(restored.frames()[0].src).searchParams.get('path'),'/thread/current-task');
});
test('route messages require both the configured origin and that computer frame',async()=>{
 const f=await fixture(),first=f.frames()[0],before=f.location.href;
 for(const [origin,source] of [['https://evil.example',first.contentWindow],[computers[1].origin,first.contentWindow],[computers[0].origin,{}]])f.events.message({origin,source,data:{type:'codex-computer-route',path:'/thread/untrusted'}});
 assert.equal(f.location.href,before);
 f.events.message({origin:computers[0].origin,source:first.contentWindow,data:{type:'codex-computer-route',path:'//evil.example'}});
 assert.equal(f.location.searchParams.get('path'),'/');
});
test('computer menu messages require the selected configured frame',async()=>{
 const f=await fixture(),first=f.frames()[0];
 assert.equal(first.messages.length,0,'do not message an iframe before its viewer is ready');
 f.events.message({origin:computers[0].origin,source:first.contentWindow,data:{type:'codex-computer-ready'}});
 assert.ok(first.messages.some(message=>message.data.type==='codex-computer-state'&&message.data.name==='Studio'));
 for(const [origin,source] of [['https://evil.example',first.contentWindow],[computers[1].origin,first.contentWindow],[computers[0].origin,{}]])
  f.events.message({origin,source,data:{type:'codex-computer-menu',placement:'drawer'}});
 assert.equal(f.nodes.computers.hidden,true);
 f.events.message({origin:computers[0].origin,source:first.contentWindow,data:{type:'codex-computer-menu',placement:'drawer'}});
 assert.equal(f.nodes.computers.hidden,false);assert.equal(f.nodes.computers.dataset.placement,'drawer');assert.equal(first.inert,true);
 f.nodes.computer.onclick();
 await f.select('laptop');
 f.events.message({origin:computers[0].origin,source:first.contentWindow,data:{type:'codex-computer-menu',placement:'drawer'}});
 assert.equal(f.nodes.computers.hidden,true);
});
