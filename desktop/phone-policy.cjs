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
 return /^\/assets\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf)(?:\?.*)?$/.test(url || '') &&
  /^(?:text\/css|(?:text|application)\/javascript|application\/x-javascript|font\/|application\/font)/.test(String(contentType));
}
module.exports={validPhoneRequest,staticAsset};
