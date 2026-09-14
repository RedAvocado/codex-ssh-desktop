// Isolated local Updates UI. No network requests, SSH, credentials or real app installation.
const {app,BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'updates-ui-'));
app.setPath('userData',directory);
const {createUpdateControls}=require('../viewer/update-window.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
setTimeout(()=>{console.error('Updates UI test timed out.');app.exit(1);},30000).unref();
async function waitFor(window,expression){for(let n=0;n<150;n++){if(await window.webContents.executeJavaScript(expression))return;await sleep(20);}throw Error(`Updates UI did not reach: ${expression}`);}
let finishDownload,aborted=false,installed=0,quit=0,block=false;
app.whenReady().then(async()=>{
  const controls=createUpdateControls({version:'0.3.0',userData:directory,getTarget:()=>'/Applications/Codex SSH Desktop.app',
    check:async()=>({status:'available',version:'0.4.0',asset:{},url:'https://github.com/RedAvocado/codex-ssh-desktop/releases/tag/v0.4.0'}),
    prepare:async(_release,{signal,onProgress})=>new Promise((resolve,reject)=>{
      onProgress(.42);finishDownload=()=>resolve({version:'0.4.0',jobDirectory:directory});
      signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));});
    }),
    install:async()=>{installed++;},quit:()=>{quit++;},discard:async()=>{},blocksInstall:()=>block});
  controls.show();let window=BrowserWindow.getAllWindows()[0];
  await waitFor(window,'document.querySelector("#primary").textContent === "Download Update"');
  await window.webContents.executeJavaScript('document.querySelector("#primary").click()');
  await waitFor(window,'document.querySelector("#detail").textContent.includes("42%")');
  await window.webContents.executeJavaScript('setTimeout(()=>document.querySelector("#cancel").click(),10);void 0');
  await sleep(50);assert.equal(aborted,true);assert.equal(installed,0);
  controls.show();window=BrowserWindow.getAllWindows()[0];
  await waitFor(window,'document.querySelector("#primary").textContent === "Download Update"');
  await window.webContents.executeJavaScript('document.querySelector("#primary").click()');
  await waitFor(window,'document.querySelector("#detail").textContent.includes("42%")');finishDownload();
  await waitFor(window,'document.querySelector("#primary").textContent === "Install and Restart"');
  await window.webContents.executeJavaScript('setTimeout(()=>document.querySelector("#cancel").click(),10);void 0');
  await sleep(50);
  assert.equal(installed,0);controls.show();window=BrowserWindow.getAllWindows()[0];
  await waitFor(window,'document.querySelector("#primary").textContent === "Install and Restart"');
  block=true;await window.webContents.executeJavaScript('document.querySelector("#primary").click()');
  await waitFor(window,'document.querySelector("#error").textContent.includes("account operation")');assert.equal(installed,0);
  block=false;await window.webContents.executeJavaScript('document.querySelector("#primary").click()');
  await waitFor(window,'document.querySelector("#title").textContent === "Installing update…"');
  assert.equal(installed,1);assert.equal(quit,1);assert.equal(controls.blocksAccounts(),true);
  console.log('Updates UI passed: download, progress, cancel, deferred install, account-operation guard, and one restart handoff.');
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
app.on('window-all-closed',()=>{});
app.on('will-quit',()=>fs.rmSync(directory,{recursive:true,force:true}));
