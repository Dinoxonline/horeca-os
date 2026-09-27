import { timingSafeEqual } from 'node:crypto';
import { validateDetail } from '../../../lib/backup-history.mjs';
// Metadata reporting only. No restore execution or production write credential is exposed.
Deno.serve(async request=>{
 const reply=(status:number)=>new Response(JSON.stringify({ok:status===200}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405);
 const supplied=request.headers.get('x-backup-report-token')||'',expected=Deno.env.get('BACKUP_REPORT_TOKEN')||'';
 if(!/^[a-f0-9]{64}$/.test(supplied)||!/^[a-f0-9]{64}$/.test(expected)||!timingSafeEqual(new TextEncoder().encode(supplied),new TextEncoder().encode(expected)))return reply(401);
 try {
  const reader=request.body?.getReader();if(!reader)return reply(400);
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>150000){await reader.cancel();return reply(413);}chunks.push(r.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const value=validateDetail(JSON.parse(new TextDecoder().decode(bytes)));
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${value.table}?on_conflict=${value.conflict}`,{method:'POST',headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(value.data),signal:AbortSignal.timeout(15000)});
  return reply(response.ok?200:503);
 } catch {return reply(400);}
});
