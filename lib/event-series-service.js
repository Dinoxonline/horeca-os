import { createHash } from "node:crypto";
import { seriesDistribution as dist, seriesDates, seriesTimes, seriesInitial, seriesChangePreview } from "./event-series";
import {seriesWebsiteStep} from './event-series-website';
import {prepareContent} from './manual-event-content';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const error=message=>Object.assign(new Error(message),{status:409});
export const seriesChildId=(parent,date)=>{const h=hash([parent,date]);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export function freshSeriesDistribution(d,series,common){
 const safe={};for(const k of ['campaign_type','title','description','short_description','location','image_url','images','video_url','organizer','contact_email','language'])if(common[k]!==undefined)safe[k]=common[k];
 Object.assign(safe,{start:common.start,end:common.end});
 return {kind:'campaign_distribution',source_type:'event',common:safe,series,target_channels:['website','facebook','calendar'],provider_delivery:{},scheduling_status:'draft',series_channel_tasks:{website:'Nog plaatsen',facebook:'Handmatig aanmaken',calendar:'Nog controleren / inplannen'}};
}
export async function eventSeriesAction({repo,website,input,userId,today,now=()=>new Date().toISOString()}){
 let selected=await repo.read(input.itemId);if(!selected||!dist(selected).kind)throw error('Evenement niet toegankelijk.');
 const member=dist(selected).series;
 const anchorId=member?.id||selected.id;
 let anchor=await repo.read(anchorId);if(!anchor)throw error('De basis van de reeks ontbreekt.');
 const definition=()=>dist(anchor).series_definition;
 async function save(row,transform){
  const media=row.media.map(m=>m===dist(row)?transform(m):m);
  const updatedCommon=dist({media}).common;
  const result=await repo.update(row.id,row.updated_at,{media,body:updatedCommon?.description??row.body});if(!result)throw error('Dit evenement is ondertussen gewijzigd. Vernieuw het voorbeeld.');return result;
 }
 async function rows(){const all=await repo.list(anchorId);if(all.length>100)throw error('De reeks bevat te veel uitvoeringen om veilig te bewerken.');return all.sort((a,b)=>dist(a).series.date.localeCompare(dist(b).series.date));}
 if(input.action==='get')return {rows:member?await rows():[selected],definition:definition()||null};
 if(input.action==='preview-create'){
  if(member)throw error('Dit evenement hoort al bij een reeks.');
  const dates=seriesDates(input.rule),initial=seriesInitial(selected);
  if(dates[0]!==initial.date)throw error('De eerste reeksdatum moet gelijk zijn aan de datum van dit evenement. Pas de begindatum, weekdag of maandkeuze aan.');
  const occurrences=dates.map(date=>({date,...seriesTimes(date,input.startTime,input.endTime)}));
  return {occurrences,token:hash([selected.updated_at,input.rule,input.startTime,input.endTime]),message:'De eerste datum gebruikt dit bestaande evenement; overige datums worden nieuwe concepten. Er wordt nog niets gepubliceerd.'};
 }
 if(input.action==='create'){
  if(input.confirmed!==true)throw error('Bevestig eerst de reeks.');
  if(member)throw error('Deze reeks is al aangemaakt. Open de reeks of hervat de voorbereiding.');
  if(input.token!==hash([selected.updated_at,input.rule,input.startTime,input.endTime]))throw error('Het voorbeeld is verouderd. Bekijk de datums opnieuw.');
  const dates=seriesDates(input.rule),initial=seriesInitial(selected);
  if(dates[0]!==initial.date)throw error('De eerste datum wijkt af van dit evenement.');
  dates.forEach(date=>seriesTimes(date,input.startTime,input.endTime));
  const common=dist(selected).common||{};
  const firstTimes=seriesTimes(dates[0],input.startTime,input.endTime);
  const timesChanged=common.start?.slice(0,16)!==firstTimes.start||common.end?.slice(0,16)!==firstTimes.end;
  anchor=await save(selected,d=>({...d,common:{...common,...firstTimes},...(timesChanged?{series_channel_tasks:{website:'Tijden controleren / bijwerken',facebook:'Tijden handmatig controleren',calendar:'Tijden controleren / bijwerken'}}:{}),series:{id:anchorId,date:dates[0],exception:false,cancelled:false},series_definition:{state:'preparing',rule:input.rule,startTime:input.startTime,endTime:input.endTime,dates,template:common,created_by:userId,created_at:now()}}));
 }
 if(input.action==='create'||input.action==='resume'){
  if(input.confirmed!==true)throw error('Bevestig eerst het hervatten.');
  const def=definition();if(!def||def.state!=='preparing')throw error('Er is geen onafgeronde reeks om te hervatten.');
  const existing=await rows(), seen=new Set(existing.map(r=>r.id));
  const children=def.dates.slice(1).map(date=>({
   id:seriesChildId(anchorId,date),workspace_id:anchor.workspace_id,business_id:anchor.business_id,account_id:anchor.account_id,created_by:userId,
   content_type:'post',direction:'outbound',body:def.template.description||'',status:'draft',workflow_status:'new',scheduled_for:null,
   media:[freshSeriesDistribution(dist(anchor),{id:anchorId,date,exception:false,cancelled:false},{...def.template,...seriesTimes(date,def.startTime,def.endTime)})]
  })).filter(r=>!seen.has(r.id));
  if(children.length)await repo.insert(children); // One atomic insert; deterministic IDs make uncertain outcomes recoverable.
  anchor=await repo.read(anchorId);
  if(definition()?.state!=='preparing')return {rows:await rows(),definition:definition(),message:'Reeks is al voorbereid.'};
  const verified=await rows();
  if(def.dates.some(date=>!verified.some(r=>r.id===(date===def.dates[0]?anchorId:seriesChildId(anchorId,date)))))throw error('Niet alle uitvoeringen zijn bevestigd. Hervat de voorbereiding; maak geen nieuwe reeks.');
  anchor=await save(anchor,d=>({...d,series_definition:{...d.series_definition,state:'ready',prepared_at:now()}}));
  return {rows:await rows(),definition:definition(),message:`${def.dates.length} uitvoeringen staan in Horeca OS. Nieuwe uitvoeringen zijn nog niet op de kanalen geplaatst.`};
 }
 if(!member||definition()?.state!=='ready')throw error('Rond eerst de voorbereiding van de reeks af.');
 if(['preview-website','website-step'].includes(input.action))return seriesWebsiteStep({repo,website,input,today,now});
 const all=await rows(),preview=seriesChangePreview(all,input,today);
 const token=hash([input.scope,input.fields,input.values,input.includePast===true,input.includeExceptions===true,preview]);
 if(input.action==='preview-change')return {...preview,token};
 if(input.action!=='change'||input.confirmed!==true||input.token!==token)throw error('Bekijk en bevestig eerst een actueel wijzigingsvoorstel.');
 const changed=[],failed=[];
 for(const p of preview.changes){
  const row=all.find(r=>r.id===p.id);
  try{
   const result=await save(row,d=>({...prepareContent(d,{title:p.after.title,description:p.after.description},now()),common:p.after,...(d.calendar_channel?{calendar_channel:{...d.calendar_channel,status:'needs_check'}}:{}),series:{...d.series,exception:p.exception,cancelled:p.cancelled,modified_at:now(),modified_by:userId},
    series_channel_tasks:{...d.series_channel_tasks,website:p.cancelled?'Annulering doorzetten': 'Wijziging doorzetten',facebook:p.cancelled?'Handmatig annuleren':'Handmatig controleren / wijzigen',calendar:p.cancelled?'Annulering controleren':'Wijziging controleren / doorzetten'},
    series_history:[...(d.series_history||[]),{at:now(),by:userId,before:p.before,after:p.after,cancelled:p.cancelled}].slice(-20)}));
   changed.push(result.id);
  }catch{failed.push(p.id);}
 }
 return {rows:await rows(),definition:definition(),changed,failed,message:failed.length?`${changed.length} gewijzigd; ${failed.length} niet gewijzigd. Bekijk een nieuw voorstel voor de resterende wijzigingen.`:`${changed.length} uitvoeringen gewijzigd in Horeca OS. Controleer en werk de kanalen afzonderlijk bij.`};
}
