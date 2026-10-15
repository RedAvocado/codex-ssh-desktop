const browserProxy = Object.freeze({proxyRules:'socks5://127.0.0.1:18216',proxyBypassRules:'<-loopback>'});

function websiteURL(value) {
  if(typeof value!=='string'||value.length>16384)throw Error('Enter an HTTP or HTTPS website address.');
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP and HTTPS websites without embedded credentials can open here.');
  // Servers commonly print their listen address rather than a connect address.
  if(url.hostname==='0.0.0.0')url.hostname='127.0.0.1';
  if(url.hostname==='[::]')url.hostname='[::1]';
  return url.href;
}
function isViewerURL(value) {
  try{return new URL(value).origin==='http://127.0.0.1:18214';}catch{return false;}
}
module.exports={browserProxy,websiteURL,isViewerURL};
