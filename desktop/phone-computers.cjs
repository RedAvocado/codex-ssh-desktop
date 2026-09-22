const https = require('node:https');
const {isIP} = require('node:net');

function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('Computer addresses must be HTTPS origins.');
  return url.origin;
}

function computerConfiguration(settings) {
  const own = httpsOrigin(settings.origin);
  const parents = settings.frameAncestors ?? [];
  if (!Array.isArray(parents) || parents.length > 8) throw Error('Invalid phone frame origins.');
  const frameAncestors = [...new Set([own, ...parents.map(httpsOrigin)])];
  const computers = settings.computers ?? [];
  if (!Array.isArray(computers) || computers.length > 8) throw Error('Configure at most eight computers.');
  const ids = new Set(), origins = new Set();
  for (const item of computers) {
    if (!item || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || /[\u0000-\u001f]/.test(item.name) ||
        (item.probeAddress !== undefined && (typeof item.probeAddress !== 'string' || !isIP(item.probeAddress))))
      throw Error('Each computer needs a unique ID, name, and HTTPS origin.');
    const origin = httpsOrigin(item.origin);
    if (ids.has(item.id) || origins.has(origin)) throw Error('Duplicate computer.');
    ids.add(item.id); origins.add(origin);
  }
  if (computers.length && !origins.has(own)) throw Error('The computer list must include this gateway.');
  return {frameAncestors, computers: computers.map(({id, name, origin, probeAddress}) => ({id, name: name.trim(), origin: httpsOrigin(origin), ...(probeAddress ? {probeAddress} : {})}))};
}

// Fixed, operator-configured origins only. Never follow redirects or accept a
// browser-supplied destination. A reachable TLS port alone is not readiness.
function probeComputer(origin, {timeout = 2500, ca, address} = {}) {
  return new Promise(resolve => {
    let done = false, timer;
    const finish = ready => {if (done) return; done = true; clearTimeout(timer); resolve(ready);};
    // Some hosts disable MagicDNS locally. Pin only the TCP destination while
    // retaining the configured hostname for Host, SNI and certificate checks.
    const lookup = address ? (_hostname, options, callback) => {
      const family = isIP(address);
      if (options.all) callback(null, [{address, family}]); else callback(null, address, family);
    } : undefined;
    const req = https.get(origin + '/__phone/health', {ca, ...(lookup ? {lookup} : {})}, res => {
      let body = '';
      res.on('data', chunk => {body += chunk; if (body.length > 4096) {finish(false); res.destroy();}});
      res.on('error', () => finish(false));
      res.on('end', () => {
        try {finish(res.statusCode === 200 && JSON.parse(body).ready === true);}
        catch {finish(false);}
      });
    });
    timer = setTimeout(() => {finish(false); req.destroy();}, timeout);
    req.on('error', () => finish(false));
  });
}

function computerDirectory(computers, ownOrigin, localReady, probe = probeComputer) {
  let pending, cached, expires = 0;
  return async () => {
    if (cached && Date.now() < expires) return cached;
    if (!pending) pending = Promise.all(computers.map(async computer => ({id:computer.id, name:computer.name, origin:computer.origin,
      online: await (computer.origin === ownOrigin ? localReady() : probe(computer.origin, {address:computer.probeAddress})).catch(() => false),
    }))).then(result => {cached = result; expires = Date.now() + 2000; return result;}).finally(() => {pending = undefined;});
    return pending;
  };
}

module.exports = {computerConfiguration, probeComputer, computerDirectory};
