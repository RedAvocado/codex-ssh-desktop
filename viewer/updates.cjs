const repository='RedAvocado/codex-ssh-desktop';
const releasesUrl=`https://github.com/${repository}/releases`;

function parseVersion(value){
  const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if(!m)return null;
  const result=m.slice(1).map(Number);
  return result.every(Number.isSafeInteger)?result:null;
}
function compareVersions(a,b){
  const left=parseVersion(a),right=parseVersion(b);
  if(!left||!right)throw Error('The release uses an unsupported version format.');
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;
  return 0;
}
function validateRelease(release,arch=process.arch){
  if(!release||release.draft||release.prerelease||!parseVersion(release.tag_name))throw Error('GitHub returned an invalid stable release.');
  // Derive the URL locally rather than following links supplied in API content.
  const version=release.tag_name.replace(/^v/,'');
  const name=`Codex-SSH-Desktop-${version}-macos-${arch}.zip`;
  const matches=Array.isArray(release.assets)?release.assets.filter(asset=>asset.name===name):[];
  const candidate=matches.length===1?matches[0]:null;
  const asset=['arm64','x64'].includes(arch)&&candidate?.state==='uploaded'&&
    Number.isSafeInteger(candidate.size)&&candidate.size>0&&candidate.size<=1024**3&&
    /^sha256:[a-f0-9]{64}$/.test(candidate.digest||'')
    ?{name,size:candidate.size,sha256:candidate.digest.slice(7),
      url:`https://github.com/${repository}/releases/download/${release.tag_name}/${name}`}:null;
  return {version,url:`${releasesUrl}/tag/${release.tag_name}`,asset};
}
async function checkForUpdates(currentVersion,{fetchImpl=fetch,readPrivateRelease,arch=process.arch}={}){
  let response;
  try{
    response=await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`,{
      headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'codex-ssh-desktop'},
      signal:AbortSignal.timeout(12000),redirect:'error',
    });
  }catch{throw Error('Could not reach GitHub. Check your internet connection and try again.');}
  let raw;
  if(response.status===404&&readPrivateRelease){
    try{raw=await readPrivateRelease();}catch{throw Error('No published release is available, or this repository requires GitHub access.');}
  }else if(response.status===404){
    return {status:'unavailable',currentVersion,url:releasesUrl};
  }else if(response.status===403||response.status===429){
    throw Error('GitHub temporarily limited update checks. Please try again later.');
  }else if(!response.ok){throw Error(`GitHub update check failed (HTTP ${response.status}).`);}
  else {try{raw=await response.json();}catch{throw Error('GitHub returned an unreadable release response.');}}
  const release=validateRelease(raw,arch);
  return {...release,currentVersion,status:compareVersions(release.version,currentVersion)>0?'available':'current'};
}
module.exports={repository,releasesUrl,parseVersion,compareVersions,validateRelease,checkForUpdates};
