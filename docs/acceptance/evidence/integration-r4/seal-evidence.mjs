import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root='D:/projects/new_project1',out=`${root}/docs/acceptance/evidence/integration-r4`;
const hash=b=>createHash('sha256').update(b).digest('hex');
const report=JSON.parse(await readFile(`${out}/results.json`,'utf8'));
const assetURL=report.tests[0].assets[0];const response=await fetch(assetURL);if(!response.ok)throw new Error(`HTTP ${response.status}`);const asset=Buffer.from(await response.arrayBuffer());
const externalFiles=['apps/web/evidence/q1-thumbnail-runtime.png','apps/web/evidence/q2-playback-viewport.png','apps/web/evidence/q2-onion-skin.png','apps/web/evidence/q3-degraded-tuning.png','tests/golden/reports/acceptance/exec-records.md',...['01-grid-2x2','02-grid-3x2','03-grid-4x3','07-scatter-5','19-ambiguous-degrade','20-empty-transparent'].map(id=>`tests/golden/cases/${id}/input.png`),'docs/technical-design.md','docs/prd-m1.md','docs/architecture-m1.md','docs/interface-contract.md','docs/ui-spec.md','docs/acceptance/consult-2026-09-24-m1.0-hotfix.md'];
const manifest={sealedAt:new Date().toISOString(),localHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),production:{assetURL,sha256:hash(asset),bytes:asset.length,httpStatus:response.status,etag:response.headers.get('etag'),note:'Content fingerprint only; no deployed Git SHA exposed/independently attested.'},referenced:[],evidence:[]};
for(const file of externalFiles){const b=await readFile(`${root}/${file}`);manifest.referenced.push({file,bytes:b.length,sha256:hash(b)});}
async function walk(relative=''){for(const entry of await readdir(`${out}/${relative}`,{withFileTypes:true})){if(entry.name==='runtime'||entry.name==='manifest.json')continue;const file=relative?`${relative}/${entry.name}`:entry.name;if(entry.isDirectory())await walk(file);else{const b=await readFile(`${out}/${file}`);manifest.evidence.push({file,bytes:b.length,sha256:hash(b)});}}}
await walk();await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2));console.log(JSON.stringify({production:manifest.production,evidenceFiles:manifest.evidence.length}));
