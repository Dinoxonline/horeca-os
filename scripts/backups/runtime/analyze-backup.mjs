import { execFileSync } from 'node:child_process';
import { readFileSync,readdirSync,realpathSync,writeFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sanitizeRunResult } from '../../../lib/backup-status.mjs';
import { validateDetail } from '../../../lib/backup-history.mjs';
import { fingerprintCopy,compareContent } from './backup-content.mjs';

const root='C:/Users/Dino Veldkamp/AppData/Local/HorecaOS-PrivateBackup';
const dropbox='D:/Dropbox (Persoonlijk)/Horeca OS Backups/Automatisch';
const toolsRoot='D:/CodexData/2026-09-04/ik/horeca-backup-tools-20260927';
const [reportPath,powershell,restoreReport]=process.argv.slice(2);
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const opts={windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:128*1024*1024};
const sha=b=>createHash('sha256').update(b).digest('hex');
let identity;
function archiveOf(result){
 sanitizeRunResult(result);
 if(!result.ok)throw Error('FAILED_BACKUP');
 const component=result.components.find(c=>c.component==='application-database-core'&&c.file?.endsWith('.dump.age'));
 const expected=`HorecaOS-AUTOMATISCH-${result.runId}-database-core-database-PARTIAL.dump.age`;
 if(component.file!==expected||!/^[a-f0-9]{64}$/.test(component.sha256))throw Error('INVALID_ARCHIVE');
 const archive=realpathSync(path.join(dropbox,expected));
 if(path.dirname(archive).toLowerCase()!==realpathSync(dropbox).toLowerCase())throw Error('ARCHIVE_OUTSIDE_BACKUP');
 const bytes=readFileSync(archive);
 if(bytes.length!==component.bytes||sha(bytes)!==component.sha256)throw Error('ARCHIVE_CHANGED');
 return {archive,sha256:component.sha256};
}
async function deliver(payload){
 validateDetail(payload);
 const token=execFileSync(powershell,['-NoProfile','-File',fileURLToPath(new URL('../Read-BackupReportCredential.ps1',import.meta.url))],opts).toString().trim();
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('INVALID_TOKEN');
 const response=await fetch('https://xsduwtkrmfkphidkoght.supabase.co/functions/v1/horeca-backup-detail',{method:'POST',headers:{'Content-Type':'application/json','x-backup-report-token':token},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 if(!response.ok||(await response.json()).ok!==true)throw Error('DELIVERY_FAILED');
}
function fingerprint(result){
 const {archive}=archiveOf(result);
 identity??=execFileSync(powershell,['-NoProfile','-File',fileURLToPath(new URL('../Read-BackupIdentity.ps1',import.meta.url)),'-IdentityPath',read(path.join(root,'backup-encryption.json')).path],opts);
 let dump,sql;
 try{
  dump=execFileSync(path.join(toolsRoot,'age-v1.3.2/age/age.exe'),['--decrypt','--identity','-',archive],{...opts,input:identity});
  sql=execFileSync(path.join(toolsRoot,'postgresql-17.11/pgsql/bin/pg_restore.exe'),['--data-only','--no-owner','--no-privileges','--file=-'],{...opts,input:dump});
  return fingerprintCopy(sql.toString('utf8'));
 }finally{dump?.fill(0);sql?.fill(0);}
}
try{
 const current=read(reportPath),currentReceipt=sanitizeRunResult(current);
 if(!current.ok)throw Error('FAILED_BACKUP');
 const {sha256}=archiveOf(current);
 if(restoreReport){
  const r=read(restoreReport);
  if(r.sourceSha256!==sha256||r.productionTouched!==false)throw Error('RESTORE_SOURCE_MISMATCH');
  await deliver({type:'restore',data:{run_id:current.runId,checked_at:r.completedAt,archive_sha256:sha256,archive_restored:r.ok===true&&r.applicationArchiveRestored===true,local_server_stopped:r.localServerStopped===true,production_touched:false,category:r.ok?'APPLICATION_ARCHIVE_RESTORED':r.category||'LOCAL_RESTORE_FAILED'}});
 }else{
  const runsDir=path.join(root,'automatic-runs');
  const previous=readdirSync(runsDir).filter(n=>/^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(n)&&n<current.runId).sort().reverse().flatMap(n=>{
   try{const r=read(path.join(runsDir,n,'RUN-RESULT.json'));const receipt=sanitizeRunResult(r);return r.ok&&receipt.started_at<currentReceipt.started_at?[r]:[];}catch{return [];}
  })[0];
  const after=fingerprint(current),before=previous?fingerprint(previous):null;
  const data={run_id:current.runId,compared_to:previous?.runId??null,checked_at:new Date().toISOString(),table_count:Object.keys(after).length,changes:before?compareContent(before,after):[],schema_compared:false};
  const output=path.join(root,'automatic-runs',current.runId,'CONTENT-CHECK.json');
  if(!existsSync(output))writeFileSync(output,JSON.stringify(data,null,2),{flag:'wx'});
  await deliver({type:'content',data});
 }
 console.log(JSON.stringify({ok:true,runId:current.runId,type:restoreReport?'restore':'content'}));
}catch(e){
 const allowed=['FAILED_BACKUP','INVALID_ARCHIVE','ARCHIVE_OUTSIDE_BACKUP','ARCHIVE_CHANGED','INVALID_TOKEN','DELIVERY_FAILED','UNSUPPORTED_COPY','INCOMPLETE_COPY','RESTORE_SOURCE_MISMATCH'];
 console.log(JSON.stringify({ok:false,error:'BACKUP_DETAIL_CHECK_FAILED',reason:allowed.includes(e.message)?e.message:'CHECK_FAILED'}));process.exitCode=1;
}finally{identity?.fill(0);}
