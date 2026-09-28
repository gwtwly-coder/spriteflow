// Independent reviewer evidence runner. Does not modify application, fixtures or CI.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
const root = 'D:/projects/new_project1';
const out = `${root}/docs/acceptance/evidence/integration-r4`;
process.env.PLAYWRIGHT_BROWSERS_PATH = `${out}/runtime`;
const require = createRequire(`${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`);
const { chromium } = require('playwright');
const { unzipSync } = require(`${root}/node_modules/.pnpm/fflate@0.8.3/node_modules/fflate`);
await mkdir(`${out}/videos`, {recursive:true});
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report = {startedAt:new Date().toISOString(),baseUrl:'https://spriteflow-doa.pages.dev/',browser:browser.version(),viewport:{width:1440,height:1000},alphaThreshold:0.01,themeInterpretation:'OS/browser dark/light preference; application remains M1 dark-only',tests:[]};
const sha = data => createHash('sha256').update(data).digest('hex');
function instrument({slow}) {
  window.__rpc=[];window.__draw=[];window.__responses=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);let players=0;const requestById=new Map();
      this.addEventListener('message',event=>{const request=requestById.get(event.data?.id);const value=event.data?.value; if(request?.command==='detect') window.__responses.push({at:performance.now(),request,result:value});});
      const send=this.postMessage.bind(this);
      this.postMessage=(message,...rest)=>{
        const req=message?.argumentList?.find(x=>x?.value?.command)?.value;
        if(req){const record={at:performance.now(),command:req.command,options:req.payload?.options,maxDimension:req.payload?.maxDimension,sourceRect:req.payload?.sourceRect};window.__rpc.push(record);requestById.set(message.id,record);
          if(slow && req.command==='preview' && req.payload.maxDimension===320 && ++players>1){setTimeout(()=>send(message,...rest),1800);return;}
        }
        send(message,...rest);
      };
    }
  };
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){if(this.canvas.classList.contains('animation-canvas')) window.__draw.push({at:performance.now(),alpha:this.globalAlpha});return draw.apply(this,args);};
}
async function pixels(page,selector){return page.locator(selector).evaluateAll(canvases=>canvases.map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let nonzero=0,partial=0,hash=2166136261;for(let i=0;i<d.length;i++){hash=Math.imul(hash^d[i],16777619);if(i%4===3){if(d[i]>0)nonzero++;if(d[i]>0&&d[i]<255)partial++;}}return {width:c.width,height:c.height,nonzero,ratio:nonzero/(c.width*c.height),partial,hash:(hash>>>0).toString(16),css:{width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height}};}));}
async function ready(page){await page.waitForFunction(()=>{const cs=[...document.querySelectorAll('canvas.thumb:not(.empty-dot),canvas.animation-canvas')];return cs.length>1&&cs.every(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n/(c.width*c.height)>=.01;});},{timeout:20000});}
async function shot(page,name){await page.screenshot({path:`${out}/${name}.png`,fullPage:true});return `${name}.png`;}
async function upload(page,id){await page.locator('#spriteflow-file').setInputFiles(`${root}/tests/golden/cases/${id}/input.png`);await page.locator('section.review').waitFor({timeout:30000});}
async function test(id,fn,{scheme='dark',lang='zh',slow=false}={}){
 const r={id,scheme,lang,startedAt:new Date().toISOString()};report.tests.push(r);console.log(`START ${id}`);
 const context=await browser.newContext({viewport:report.viewport,locale:lang==='zh'?'zh-CN':'en-US',colorScheme:scheme,acceptDownloads:true,recordVideo:{dir:`${out}/videos`,size:report.viewport}});
 const page=await context.newPage();const video=page.video();r.pageErrors=[];page.on('pageerror',e=>r.pageErrors.push(e.message));
 try{await page.addInitScript(instrument,{slow});await page.goto(report.baseUrl,{waitUntil:'networkidle'});await page.locator('.lang select').selectOption(lang);r.assets=await page.locator('script[src]').evaluateAll(ns=>ns.map(n=>n.src));await fn(page,r);r.status='PASS';}
 catch(e){r.status='FAIL';r.error=e.stack;await shot(page,`${id}-failure`).catch(()=>{});}
 finally{r.rpc=await page.evaluate(()=>window.__rpc).catch(()=>[]);r.responses=await page.evaluate(()=>window.__responses).catch(()=>[]);await context.close();const original=await video.path();r.video=`videos/${id}.webm`;await rename(original,`${out}/${r.video}`);r.finishedAt=new Date().toISOString();await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(`END ${id} ${r.status} ${r.error??''}`);}
}
try{
 for(const scheme of ['dark','light'])for(const lang of ['zh','en'])await test(`matrix-${scheme}-${lang}`,async(page,r)=>{
   await upload(page,'02-grid-3x2');await ready(page);
   r.theme=await page.evaluate(()=>({prefersDark:matchMedia('(prefers-color-scheme: dark)').matches,background:getComputedStyle(document.body).backgroundColor,lang:document.documentElement.lang}));
   r.thumb=await pixels(page,'.thumb');assert.equal(r.thumb.length,6);assert.ok(r.thumb.every(p=>p.ratio>=report.alphaThreshold));
   r.screenshots=[await shot(page,`${r.id}-thumbnails`)];
   r.player=await pixels(page,'.animation-canvas');assert.ok(r.player[0].ratio>=report.alphaThreshold);
   await page.locator('.timeline input[type=number]').fill('6');
   const beforeRPC=await page.evaluate(()=>window.__rpc.length);
   await page.getByRole('button',{name:lang==='zh'?'播放':'Play',exact:true}).click();
   r.screenshots.push(await shot(page,`${r.id}-playback`));
   r.playback=[];for(let i=0;i<12;i++){await page.waitForTimeout(100);r.playback.push({frame:await page.locator('.viewport-caption').innerText(),pixels:(await pixels(page,'.animation-canvas'))[0]});}
   await page.getByRole('button',{name:lang==='zh'?'暂停':'Pause',exact:true}).click();
   r.playbackRPC=(await page.evaluate(()=>window.__rpc)).slice(beforeRPC);assert.equal(r.playbackRPC.length,0);assert.ok(new Set(r.playback.map(p=>p.pixels.hash)).size>=3);assert.ok(r.playback.every(p=>p.pixels.ratio>=.01));
   await page.locator('.frame-chip').nth(2).click();r.onionOff=(await pixels(page,'.animation-canvas'))[0];
   await page.evaluate(()=>{window.__draw=[];});await page.locator('.timeline input[type=checkbox]').check();await page.waitForTimeout(100);
   r.onionOn=(await pixels(page,'.animation-canvas'))[0];r.onionDraw=await page.evaluate(()=>window.__draw);assert.notEqual(r.onionOff.hash,r.onionOn.hash);assert.ok(r.onionDraw.some(x=>x.alpha>.29&&x.alpha<.31)&&r.onionDraw.some(x=>x.alpha>.19&&x.alpha<.21));
   r.screenshots.push(await shot(page,`${r.id}-onion`));
   await page.getByRole('button',{name:lang==='zh'?'换一张图':'Choose another image',exact:true}).click();await page.locator('dialog button.primary').click();
   await upload(page,'19-ambiguous-degrade');await page.locator('.tune-guidance').waitFor();await ready(page);
   r.guidance=await page.locator('.tune-guidance').innerText();r.screenshots.push(await shot(page,`${r.id}-guidance`));
   const before=await page.evaluate(()=>window.__rpc.filter(x=>x.command==='detect').length);
   await page.locator('.tune-guidance button').click();r.dialogSnapshot=await page.getByRole('dialog').ariaSnapshot();
   await page.locator('dialog button.primary').click();
   await page.waitForFunction(n=>window.__rpc.filter(x=>x.command==='detect').length>n,before);
   await page.locator('.tune-guidance').waitFor();await page.waitForTimeout(500);
   const requests=await page.evaluate(()=>window.__rpc.filter(x=>x.command==='detect'));r.retryOptions={before:requests.at(-2).options,after:requests.at(-1).options};assert.deepEqual(r.retryOptions.before,r.retryOptions.after);assert.equal(await page.locator('dialog').count(),0);
 },{scheme,lang});
 await test('session-three-exports',async(page,r)=>{
   r.cycles=[];
   for(const [index,id]of ['01-grid-2x2','07-scatter-5','02-grid-3x2'].entries()){
     if(index){await page.getByRole('button',{name:'换一张图',exact:true}).click();r.dialogSnapshot=await page.getByRole('dialog').ariaSnapshot();await page.locator('dialog button.primary').click();}
     await upload(page,id);await ready(page);const frames=await page.locator('.frame-chip').count();
     await page.getByRole('button',{name:/确认审校/}).click();await page.getByRole('button',{name:'导出',exact:true}).click();
     const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'生成并下载',exact:true}).click();const download=await downloadEvent;const name=`session-${index+1}.zip`;await download.saveAs(`${out}/${name}`);const bytes=await readFile(`${out}/${name}`);const files=unzipSync(bytes);const atlas=JSON.parse(new TextDecoder().decode(files['atlas.json']));assert.equal(Object.keys(atlas.frames).length,frames);
     await page.getByRole('button',{name:'继续编辑',exact:true}).click();await page.waitForTimeout(300);
     const text=await page.locator('body').innerText();assert.ok(!text.includes('出了点问题'));assert.ok(!text.includes('正在处理，请稍候。'));
     r.cycles.push({id,frames,zip:name,sha256:sha(bytes),files:Object.keys(files),status:'PASS',screenshot:await shot(page,`session-${index+1}`)});
   }
 });
 await test('slow-player-hold-previous',async(page,r)=>{
   await upload(page,'02-grid-3x2');await page.waitForFunction(()=>{const c=document.querySelector('.animation-canvas');return c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);});
   r.ready=(await pixels(page,'.animation-canvas'))[0];await shot(page,'slow-player-before');
   await page.locator('.frame-chip').nth(5).click();await page.waitForTimeout(150);r.waiting=(await pixels(page,'.animation-canvas'))[0];r.loading=await page.locator('.viewport-loading').count();await shot(page,'slow-player-waiting');
   assert.equal(r.waiting.hash,r.ready.hash,'Unready frame must retain previous rendered frame');
 },{slow:true});
 await test('empty-frame',async(page,r)=>{await upload(page,'20-empty-transparent');await page.waitForTimeout(500);r.thumb=await pixels(page,'.thumb');r.player=await pixels(page,'.animation-canvas');assert.ok(r.thumb.every(p=>p.nonzero===0)&&r.player.every(p=>p.nonzero===0));r.screenshot=await shot(page,'empty-frame');});
}finally{report.finishedAt=new Date().toISOString();await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report.tests.map(({id,status,error})=>({id,status,error})),null,2));
process.exitCode=report.tests.some(t=>t.status==='FAIL')?1:0;
