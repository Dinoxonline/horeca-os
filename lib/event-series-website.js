import {createHash} from 'node:crypto';
import {seriesDistribution as dist,seriesInitial} from './event-series';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
export const seriesWebsiteFingerprint=row=>hash(dist(row).common);
export function seriesWebsitePreview(rows,today){
 const changes=[],skipped=[];
 for(const row of rows){
  const d=dist(row),date=seriesInitial(row).date;
  if(date<today||d.series?.cancelled){skipped.push({id:row.id,date,reason:d.series?.cancelled?'Geannuleerd: afzonderlijk afhandelen':'Verleden'});continue;}
  const id=String(d.eventin_event_id||d.external_ids?.eventin||''),job=d.series_website;
  if(job?.status==='verified'&&job.fingerprint===seriesWebsiteFingerprint(row))continue;
  changes.push({id:row.id,date,title:d.common?.title,start:d.common?.start,end:d.common?.end,location:d.common?.location,action:id?'Bijwerken met behoud van tickets en afbeelding':'Nieuw publiceren zonder tickets',version:row.updated_at,blocked:(!id&&['sending','uncertain'].includes(job?.status))||(job?.status==='sending'&&(!job.started_at||Date.now()-Date.parse(job.started_at)<120000))});
 }
 return {changes,skipped,token:hash(changes)};
}
// One occurrence per request. A reservation precedes every remote write; an
// ambiguous create is never automatically repeated. Known IDs are read back.
export async function seriesWebsiteStep({repo,website,input,today,now=()=>new Date().toISOString()}){
 const row=await repo.read(input.itemId),d=dist(row);
 if(!d.series?.id)fail('Deze uitvoering hoort niet bij een reeks.');
 const all=await repo.list(d.series.id),preview=seriesWebsitePreview(all,today);
 if(input.action==='preview-website')return preview;
 if(input.confirmed!==true||input.token!==preview.token)fail('Bekijk en bevestig eerst het actuele website-overzicht.');
 const p=preview.changes.find(r=>r.id===input.targetId);if(!p)fail('Deze uitvoering staat niet in het websitevoorstel.');
 let current=all.find(r=>r.id===p.id),distribution=dist(current);
 if(p.blocked)fail('Een eerdere plaatsing is niet bevestigd. Controleer eerst de website en koppel het bestaande evenement; opnieuw aanmaken is geblokkeerd om dubbele evenementen te voorkomen.');
 let id=String(distribution.eventin_event_id||distribution.external_ids?.eventin||'');
 const creating=!id;
 if(id&&!/^\d+$/.test(id))fail('De websitekoppeling is ongeldig. Controleer deze uitvoering.');
 const fingerprint=seriesWebsiteFingerprint(current),common=distribution.common;
 async function save(transform){
  const result=await repo.update(current.id,current.updated_at,{media:current.media.map(m=>m.kind==='campaign_distribution'?transform(m):m)});
  if(!result)fail('Deze uitvoering is tussentijds gewijzigd. Controleer het kanaal voordat je verdergaat.');
  current=result;distribution=dist(current);return result;
 }
 // Configuration and existing remote identity must be checked BEFORE reservation.
 await website.preflight(current,id);
 await save(d=>({...d,series_website:{status:'sending',fingerprint,started_at:now()}}));
 try{
  const event=await website.write(current,id);
  id=String(event?.id||id);
  if(!/^\d+$/.test(id))fail('Website gaf geen bevestigd evenementnummer terug.');
  await save(d=>({...d,eventin_event_id:id,source_url:event.url||d.source_url,series_website:{...d.series_website,status:'checking',external_id:id}}));
  const verified=await website.read(current,id);
  const plain=value=>String(value||'').replace(/\s+/g,' ').trim();
  if(!verified||verified.id!==id||plain(verified.title)!==plain(common.title)||plain(verified.description)!==plain(common.description)||verified.start?.slice(0,16)!==common.start?.slice(0,16)||verified.end?.slice(0,16)!==common.end?.slice(0,16)||(creating&&verified.status!=='publish'))fail('De website bevestigt de tekst, tijden of publicatiestatus nog niet. Controleer deze uitvoering; er wordt geen tweede evenement aangemaakt.');
  const result=await save(d=>({...d,website_event_status:verified.status,event_content_delivery:{...d.event_content_delivery,website:{status:'updated',snapshot:{title:common.title,description:common.description,event_id:id},updated_at:now()}},series_website:{status:'verified',external_id:id,fingerprint,checked_at:now()},series_channel_tasks:{...d.series_channel_tasks,website:verified.status==='publish'?'Website gecontroleerd':'Websiteconcept gecontroleerd'}}));
  return {row:result,message:`${p.date}: website gecontroleerd.`};
 }catch(e){
  // Retain a known ID even after a readback failure. Do not claim unchanged.
  try{await save(d=>({...d,...(id?{eventin_event_id:id}:{}),series_website:{...d.series_website,status:'uncertain',external_id:id||null}}));}catch{}
  fail(`${p.date}: geen volledige bevestiging. Een wijziging kan al op de website staan. ${e.message||'Controleer de uitvoering.'}`);
 }
}
