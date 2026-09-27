import { NextResponse } from 'next/server';
import { createAdminSupabase } from '../../../../lib/server-supabase';
import { requireBackupOwner } from '../../../../lib/backup-owner';
export const dynamic='force-dynamic';
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Authorization'}});
export async function GET(request){
 try {
  const params=request.nextUrl.searchParams;
  const owner=await requireBackupOwner(request,params.get('workspaceId'));
  if(owner.error)return json({error:owner.error},owner.status);
  const kind=params.get('kind')||'database',pageValue=params.get('page')||'0';
  if(!['database','files'].includes(kind)||!/^\d{1,6}$/.test(pageValue))return json({error:'Ongeldige pagina.'},400);
  const page=Number(pageValue),limit=25,admin=createAdminSupabase();
  if(kind==='files'){
   const result=await admin.from('backup_file_jobs').select('id,event,status,created_at,completed_at,receipt',{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*limit,page*limit+limit-1);
   if(result.error)throw Error('HISTORY_FAILED');
   return json({kind,page,total:result.count,items:result.data.map(r=>({id:r.id,name:r.event?.record?.name||'Onbekend bestand',bucket:r.event?.record?.bucket_id||'',event:r.event?.type||'UNKNOWN',status:r.status,createdAt:r.created_at,completedAt:r.completed_at,bytes:r.receipt?.bytes||null,cloudConfirmed:r.status==='succeeded'&&r.receipt?.ok===true}))});
  }
  const [result,latest]=await Promise.all([
   admin.from('backup_database_runs').select('run_id,started_at,completed_at,ok,copy_verified,bytes',{count:'exact'}).order('started_at',{ascending:false}).order('run_id',{ascending:false}).range(page*limit,page*limit+limit-1),
   admin.from('backup_database_runs').select('run_id,started_at,completed_at,ok,copy_verified,bytes').eq('ok',true).eq('copy_verified',true).order('started_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(result.error||latest.error)throw Error('HISTORY_FAILED');
  const ids=[...new Set([...result.data.map(r=>r.run_id),...(latest.data?[latest.data.run_id]:[])])];
  const [checks,restore]=ids.length?await Promise.all([
   admin.from('backup_content_checks').select('run_id,compared_to,checked_at,table_count,changes,schema_compared').in('run_id',ids),
   admin.from('backup_restore_checks').select('run_id,checked_at,archive_restored,local_server_stopped,category').in('run_id',ids).order('checked_at',{ascending:false}).limit(1000),
  ]):[{data:[]},{data:[]}];
  if(checks.error||restore.error)throw Error('CHECKS_FAILED');
  const enrich=r=>({...r,contentCheck:checks.data.find(c=>c.run_id===r.run_id)||null,restoreCheck:restore.data.find(c=>c.run_id===r.run_id)||null});
  return json({kind,page,total:result.count,items:result.data.map(enrich),latestSuccess:latest.data?enrich(latest.data):null});
 }catch{return json({error:'De back-uplijst kon niet worden opgehaald. Probeer opnieuw.'},503);}
}
