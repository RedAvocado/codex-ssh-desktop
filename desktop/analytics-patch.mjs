// Keep feature configuration and account capabilities working while opting the
// copied browser interface out of optional analytics and SDK error reporting.
export function patchPrivateAnalytics(source) {
  const marker='/* private viewer analytics disabled */';
  if(!source.includes(marker)){
    const pattern=/\.\.\.\w+===!0\?\{\}:\{disableStorage:!0,loggingEnabled:`disabled`\}/g;
    const matches=[...source.matchAll(pattern)];
    if(matches.length!==1)throw Error(`Private analytics: expected one renderer options factory, found ${matches.length}`);
    source=source.replace(pattern,`disableStorage:!0,loggingEnabled:\`disabled\`${marker}`);
  }
  // Also cover a batch already queued before SDK initialization/consent updates.
  // Feature-configuration requests still use the original network path.
  const networkMarker='/* private viewer analytics network guard */';
  if(source.includes(networkMarker))return source;
  const guard=/if\(!([\w$]+)&&([\w$]+)===`https:\/\/ab\.chatgpt\.com\/v1\/sdk_exception`\)return new Response\(null,\{status:204\}\)/g;
  if([...source.matchAll(guard)].length!==1)throw Error('Private analytics: expected one SDK network guard');
  return source.replace(guard,(_match,enabled,url)=>`if(!${enabled}&&(${url}===\`https://ab.chatgpt.com/v1/sdk_exception\`||${url}.split(\`?\`)[0]===\`https://chatgpt.com/ces/v1/rgstr\`))return new Response(null,{status:204})${networkMarker}`);
}
