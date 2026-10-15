function validPhoneRequest(req, origin, allowedPeers, csrf, upgrade=false) {
 if(req.headers.host!==origin.host || !req.socket.encrypted || !allowedPeers.has(req.socket.remoteAddress))return false;
 if(req.headers.origin && req.headers.origin!==origin.origin)return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 if(upgrade || !['GET','HEAD'].includes(req.method)){
  if(req.headers.origin!==origin.origin)return false;
  if(!req.headers.cookie?.split(';').some(c=>c.trim()===`__Host-phone_session=${csrf}`))return false;
 }
 return true;
}
function staticAsset(url, contentType) {
 const source = String(url || ''), type = String(contentType);
 // Never assign a long-lived cache header to a path that can escape /assets/.
 // Decode each segment as well so encoded dot segments stay excluded if the
 // asset filename grammar changes later.
 for (const segment of source.split('?', 1)[0].split('/')) {
  let decoded;
  try {decoded = decodeURIComponent(segment);} catch {return false;}
  if (decoded === '.' || decoded === '..') return false;
 }
 const assetSource=source.replace(/^\/assets-v[a-f0-9]{24}\//,'/assets/');
 return (/^\/assets\/[A-Za-z0-9_./@-]+\.(?:js|css|woff2?|ttf)(?:\?.*)?$/.test(assetSource) &&
   /^(?:text\/css|(?:text|application)\/javascript|application\/x-javascript|font\/|application\/font)/.test(type)) ||
  (/^\/assets\/[A-Za-z0-9_./@-]+-[a-f0-9]{8,}\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?.*)?$/.test(assetSource) &&
   /^image\/(?:avif|gif|jpeg|png|svg\+xml|webp)(?:;|$)/.test(type));
}
function immutableStaticAsset(url, contentType) {
 return staticAsset(url,contentType) && /-[a-f0-9]{8,}\.(?:js|css|woff2?|ttf|avif|gif|jpe?g|png|svg|webp)(?:\?.*)?$/.test(url || '');
}
module.exports={validPhoneRequest,staticAsset,immutableStaticAsset,phoneConfiguration,acceptsGzip};
const {isIP}=require('node:net');
function phoneConfiguration(settings) {
 const origin=new URL(settings?.origin);
 const bind=typeof settings?.bindAddress==='string'?settings.bindAddress:'';
 const wildcard=bind==='0.0.0.0'||(isIP(bind)===6&&['[::]','[::ffff:0:0]'].includes(new URL(`http://[${bind}]`).hostname));
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
   !isIP(bind)||wildcard||
   !Array.isArray(settings.allowedPeers)||!settings.allowedPeers.length||settings.allowedPeers.some(peer=>typeof peer!=='string'||!isIP(peer))||
   (settings.legacyBackend!==undefined&&typeof settings.legacyBackend!=='boolean')||
   (settings.backendSessionCookie!==undefined&&(typeof settings.backendSessionCookie!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(settings.backendSessionCookie))))
  throw Error('Private phone configuration needs an HTTPS origin, a specific bind address, and allowed device addresses.');
 return {origin,allowed:new Set(settings.allowedPeers)};
}
function acceptsGzip(value='') {
 const entries=String(value).split(',').map(part=>part.trim().match(/^(gzip|\*)(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/i)).filter(Boolean);
 const explicit=entries.filter(entry=>entry[1].toLowerCase()==='gzip');
 return (explicit.length?explicit:entries).some(entry=>Number(entry[2]??1)>0);
}
