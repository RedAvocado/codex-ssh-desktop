import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
if(process.platform!=='darwin')throw Error('Build the macOS app on a Mac.');
const electronBinary=require('electron');
const electronApp=path.resolve(electronBinary,'../../..');
if(!electronApp.endsWith('/Electron.app'))throw Error('Unexpected Electron distribution path.');
const name='Codex SSH Desktop';
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const viewerVersion=JSON.parse(fs.readFileSync(path.join(root,'viewer/package.json'),'utf8')).version;
if(version!==viewerVersion)throw Error('Root and viewer versions must match before release.');
const out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
const app=path.join(out,`${name}.app`);
if(fs.existsSync(app))fs.rmSync(app,{recursive:true});
execFileSync('/usr/bin/ditto',[electronApp,app]);
const resources=path.join(app,'Contents/Resources');
fs.rmSync(path.join(resources,'default_app.asar'),{force:true});
fs.cpSync(path.join(root,'viewer'),path.join(resources,'app'),{recursive:true,
  filter:source=>!source.split(path.sep).includes('__pycache__')&&!source.endsWith('.pyc')});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(resources,'PROJECT-LICENSE.txt'));
fs.copyFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(resources,'THIRD-PARTY-NOTICES.txt'));
fs.copyFileSync(path.join(root,'assets/codex-ssh-desktop.icns'),path.join(resources,'codex-ssh-desktop.icns'));
for(const file of ['LICENSE','LICENSES.chromium.html']){
 const source=path.join(path.dirname(electronApp),file);if(fs.existsSync(source))fs.copyFileSync(source,path.join(resources,file));
}
const plist=path.join(app,'Contents/Info.plist');
for(const [key,value] of Object.entries({CFBundleName:name,CFBundleDisplayName:name,CFBundleIdentifier:'com.dittodub.codex-ssh-desktop',CFBundleIconFile:'codex-ssh-desktop.icns',CFBundleShortVersionString:version,CFBundleVersion:version,NSHumanReadableCopyright:'Copyright 2026 Codex SSH Desktop contributors'}))execFileSync('/usr/bin/plutil',['-replace',key,'-string',value,plist]);
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const zip=path.join(out,`Codex-SSH-Desktop-${version}-macos-${process.arch}.zip`);
fs.rmSync(zip,{force:true});
execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]);
console.log(`Packaged ${zip}`);
