const {test}=require('node:test'),assert=require('node:assert/strict');
const {validPhoneRequest,staticAsset}=require('../desktop/phone-policy.cjs');
const origin=new URL('https://mac.example.ts.net:8443');const allowed=new Set(['100.64.0.20']);
function request(peer='100.64.0.20'){return {method:'GET',socket:{encrypted:true,remoteAddress:peer},headers:{host:origin.host}}}
test('only the actual allowed peer can get pages or assets; forwarded headers cannot grant access',()=>{
 assert.equal(validPhoneRequest(request(),origin,allowed,'secret'),true);
 for(const ip of ['100.64.0.30','100.66.2.3','127.0.0.1']){
 const req=request(ip);req.headers['x-forwarded-for']='100.64.0.20';req.headers['tailscale-user-login']='owner@example.com';
 assert.equal(validPhoneRequest(req,origin,allowed,'secret'),false);}
});
test('WebSockets and mutations need matching origin and private cookie as well as peer identity',()=>{
 const req=request();assert.equal(validPhoneRequest(req,origin,allowed,'secret',true),false);
 req.headers.origin=origin.origin;req.headers.cookie='__Host-phone_session=secret';
 assert.equal(validPhoneRequest(req,origin,allowed,'secret',true),true);
 req.headers.origin='https://evil.example';assert.equal(validPhoneRequest(req,origin,allowed,'secret',true),false);
 req.headers.origin=origin.origin;req.headers['sec-fetch-site']='cross-site';assert.equal(validPhoneRequest(req,origin,allowed,'secret'),false);
});
test('only static code and fonts are cacheable, never task content or API data',()=>{
 assert.equal(staticAsset('/assets/app-abc.js','text/javascript'),true);
 assert.equal(staticAsset('/assets/preload.js','application/javascript'),true);
 for(const [url,type] of [['/thread/private','text/html'],['/__health','application/json'],['/assets/missing.js','text/html'],['/assets/account.json','application/json'],['/@fs/secret.js','text/javascript']])assert.equal(staticAsset(url,type),false);
});
