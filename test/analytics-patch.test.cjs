const {test}=require('node:test'),assert=require('node:assert/strict');
test('private analytics patch disables events for either account preference while retaining feature configuration',async()=>{
 const {patchPrivateAnalytics}=await import('../desktop/analytics-patch.mjs');
 const factory='function options(e){let t={...base,enableLiveValuesAutoRefresh:!0,...e===!0?{}:{disableStorage:!0,loggingEnabled:`disabled`}};return t.networkConfig={...base.networkConfig,preventAllNetworkTraffic:!1,networkOverrideFunc:(e,n)=>network(e,n,t.loggingEnabled!==`disabled`)},t}';
 const source=factory+';async function guarded(e,t,n=!0){if(!n&&e===`https://ab.chatgpt.com/v1/sdk_exception`)return new Response(null,{status:204});return upstream(e,t)}';
 const make=text=>new Function('base','network',text+';return options')({networkConfig:{api:'/feature-config'}},(_url,_body,logging)=>logging);
 assert.equal(make(source)(true).loggingEnabled,undefined,'Reproduce the previously enabled logging default');
 const patched=patchPrivateAnalytics(source),options=make(patched);
 for(const preference of [true,false]){
  const value=options(preference);assert.equal(value.loggingEnabled,'disabled');assert.equal(value.disableStorage,true);
  assert.equal(value.enableLiveValuesAutoRefresh,true);assert.equal(value.networkConfig.preventAllNetworkTraffic,false);
  assert.equal(value.networkConfig.api,'/feature-config');assert.equal(value.networkConfig.networkOverrideFunc('/sdk_exception',{}),false);
 }
 assert.equal(patchPrivateAnalytics(patched),patched);
 assert.throws(()=>patchPrivateAnalytics('unknown renderer'),/expected one/);
 assert.throws(()=>patchPrivateAnalytics(source+source),/expected one/);
 const sent=[],guarded=new Function('upstream','Response',patched+';return guarded')((...args)=>{sent.push(args);return 'feature response'},Response);
 for(const url of ['https://ab.chatgpt.com/v1/sdk_exception','https://chatgpt.com/ces/v1/rgstr?fixture=1'])assert.equal((await guarded(url,{},false)).status,204);
 assert.equal(sent.length,0);
 assert.equal(await guarded('https://ab.chatgpt.com/v1/initialize',{},false),'feature response');assert.equal(sent.length,1);
});
