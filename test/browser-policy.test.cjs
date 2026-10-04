const {test}=require('node:test'),assert=require('node:assert/strict');
const {websiteURL,isViewerURL,browserProxy}=require('../viewer/browser-policy.cjs');
test('remote website addresses preserve ports, queries, fragments and IPv6',()=>{
 for(const url of ['http://localhost:3000/path?q=1#section','https://example.com/','http://[::1]:8000/','http://127.0.0.2:4000/'])assert.equal(websiteURL(url),url);
 assert.equal(websiteURL('http://0.0.0.0:3000/test'),'http://127.0.0.1:3000/test');
 assert.equal(websiteURL('http://[::]:3000/test'),'http://[::1]:3000/test');
});
test('website browser does not accept file, script or credential-bearing URLs',()=>{
 for(const url of ['javascript:alert(1)','file:///etc/passwd','data:text/html,test','https://user:pass@example.com','codex://test','http://'])assert.throws(()=>websiteURL(url));
 assert.equal(isViewerURL('http://127.0.0.1:18214.evil.test/'),false);
 assert.equal(isViewerURL('http://127.0.0.1:18214/thread/x'),true);
});
test('proxy has no direct fallback and explicitly tunnels loopback',()=>{
 assert.equal(browserProxy.proxyRules,'socks5://127.0.0.1:18216');assert.equal(browserProxy.proxyBypassRules,'<-loopback>');
});
