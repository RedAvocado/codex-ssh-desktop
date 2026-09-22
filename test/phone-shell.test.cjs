const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const computers=[{id:'studio',name:'Studio',origin:'https://studio.example.ts.net:8443',online:true},{id:'laptop',name:'Laptop',origin:'https://laptop.example.ts.net:8443',online:true}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({path='/',saved={}}={}){
 let location=new URL(path,computers[0].origin),directory=computers.map(c=>({...c})),fails=false;
 const events={},storage=new Map(Object.entries(saved)),nodes={};
 const document={hidden:false,activeElement:null,getElementById:id=>nodes[id],addEventListener(){},createElement:tag=>new Element(tag)};
 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.hidden=false;if(tag==='iframe')this.contentWindow={};}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(name,value){this.attrs[name]=value;}
  focus(){document.activeElement=this;}
  querySelectorAll(){return this.children.flatMap(child=>[...(child.tag==='button'&&!child.disabled?[child]:[]),...child.querySelectorAll()]);}
  querySelector(){return this.querySelectorAll()[0];}
  contains(element){return element===this||this.children.some(child=>child.contains(element));}
 }
 for(const id of ['computer','computer-name','connection','computers','computer-options','availability','refresh','viewers','empty','empty-title','empty-help','retry','message'])nodes[id]=new Element(id==='computer'||id==='refresh'?'button':'div');
 nodes.computers.append(nodes['computer-options'],nodes.refresh);nodes.viewers.append(nodes.empty);
 const context={document,URL,AbortSignal,Map,JSON,console,setTimeout:()=>1,clearTimeout(){},get location(){return location;},history:{replaceState(_s,_t,path){location=new URL(path,location);}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},window:{addEventListener:(name,callback)=>{events[name]=callback;}},fetch:async()=>{if(fails)throw Error('offline');return {ok:true,json:async()=>({computers:directory.map(c=>({...c}))})};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/phone-shell.js'),'utf8'),context);
 await tick();await tick();
 return {nodes,events,storage,get location(){return location;},frames:()=>nodes.viewers.children.filter(c=>c.tag==='iframe'),options:()=>nodes['computer-options'].children,setOnline(id,value){directory.find(c=>c.id===id).online=value;},fail(){fails=true;},async refresh(){await nodes.refresh.onclick();await tick();},async select(id){nodes['computer-options'].children.find(c=>c.dataset.computer===id).onclick();await tick();await tick();}};
}
test('switching retains separate frame instances and never replaces a draft',async()=>{
 const f=await fixture(),first=f.frames()[0];first.draft='keep studio input';
 await f.select('laptop');const second=f.frames()[1];second.draft='keep laptop input';
 assert.equal(first.hidden,true);assert.equal(second.hidden,false);
 await f.select('studio');assert.equal(f.frames().length,2);assert.equal(f.frames()[0],first);assert.equal(first.draft,'keep studio input');assert.equal(second.draft,'keep laptop input');
 assert.equal(new URL(second.src).origin,computers[1].origin);
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
