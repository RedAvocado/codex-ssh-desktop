const fs=require('node:fs'),path=require('node:path');
const origin='http://127.0.0.1:18214';
function pagePath(value){
  try{const url=new URL(value,origin);if(url.origin!==origin||url.username||url.password)return null;
    if(url.pathname==='/'||/^\/thread\/[a-zA-Z0-9-]+$/.test(url.pathname))return url.pathname;
  }catch{}return null;
}
function readPages(directory){try{const pages=JSON.parse(fs.readFileSync(path.join(directory,'last-pages.json'),'utf8'));if(pages&&typeof pages==='object'&&!Array.isArray(pages))return pages;}catch{}return {};}
function restorePage(directory,host){return pagePath(readPages(directory)[host])||'/';}
function rememberPage(directory,host,url){const page=pagePath(url);if(!host||!page)return;
  const pages=readPages(directory);if(pages[host]===page)return;pages[host]=page;
  fs.writeFileSync(path.join(directory,'last-pages.json'),JSON.stringify(pages),{mode:0o600});
}
module.exports={restorePage,rememberPage,pagePath};
