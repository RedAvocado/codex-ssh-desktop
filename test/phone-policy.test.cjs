const {test}=require('node:test'),assert=require('node:assert/strict');
const {validPhoneRequest,staticAsset,phoneConfiguration,acceptsGzip}=require('../desktop/phone-policy.cjs');
test('missing or wildcard interface settings cannot expose a gateway listener',()=>{
 const config={origin:'https://mac.example.ts.net:8443',bindAddress:'100.64.0.10',allowedPeers:['100.64.0.20']};
 assert.equal(phoneConfiguration(config).allowed.has('100.64.0.20'),true);
 for(const change of [{bindAddress:undefined},{bindAddress:'0.0.0.0'},{bindAddress:'::'},{bindAddress:'0:0:0:0:0:0:0:0'},{bindAddress:'::ffff:0.0.0.0'},{allowedPeers:[]},{allowedPeers:['phone']},{origin:'http://mac.example.ts.net'},{origin:'https://mac.example.ts.net/private'},{origin:'https://user:password@mac.example.ts.net'}])assert.throws(()=>phoneConfiguration({...config,...change}));
});
test('compression respects explicit quality values and wildcard fallback',()=>{
 for(const value of ['gzip','GZip;q=0.5','br, *;q=1'])assert.equal(acceptsGzip(value),true);
 for(const value of ['', 'br','gzip;q=0','gzip;q=0, *;q=1','gzip;q=invalid','gzip;q=2'])assert.equal(acceptsGzip(value),false);
});
test('legacy backend options cannot inject extra authentication cookies',()=>{
 const config={origin:'https://mac.example.ts.net:8443',bindAddress:'100.64.0.10',allowedPeers:['100.64.0.20'],legacyBackend:true,backendSessionCookie:'bbw_session'};
 assert.doesNotThrow(()=>phoneConfiguration(config));
 for(const change of [{legacyBackend:'false'},{backendSessionCookie:''},{backendSessionCookie:'session; other=value'},{backendSessionCookie:'session\r\nX-Test: value'}])assert.throws(()=>phoneConfiguration({...config,...change}));
});
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
