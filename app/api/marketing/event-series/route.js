import {NextResponse} from 'next/server';
import {createAdminSupabase,createUserSupabase} from '../../../../lib/server-supabase';
import {eventSeriesAction} from '../../../../lib/event-series-service';
import {seriesDistribution} from '../../../../lib/event-series';
import {GET as readWebsite,POST as createWebsite,PATCH as updateWebsite} from '../website-events/create/route';
export const maxDuration=60;
const reply=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request){
 let input;try{input=await request.json();}catch{return reply({error:'Ongeldig verzoek.'},400);}
 if(!['get','preview-create','create','resume','preview-change','change','preview-website','website-step'].includes(input?.action)||![input.workspaceId,input.businessId,input.itemId].every(v=>typeof v==='string'&&v.length>0&&v.length<100))return reply({error:'Evenement of vestiging ontbreekt.'},400);
 try{
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'Log opnieuw in.'},401);
  const client=createUserSupabase(token),{data:auth,error}=await client.auth.getUser(token);if(error||!auth?.user)return reply({error:'Sessie verlopen.'},401);
  let aal;try{aal=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).aal;}catch{}
  if(aal!=='aal2')return reply({error:'Bevestig je tweestapsverificatie.'},403);
  const {data:member,error:roleError}=await client.from('workspace_members').select('role').eq('workspace_id',input.workspaceId).eq('user_id',auth.user.id).maybeSingle();
  if(roleError||member?.role!=='owner')return reply({error:'Alleen de eigenaar kan evenementenreeksen beheren.'},403);
  const admin=createAdminSupabase(),scope=q=>q.eq('workspace_id',input.workspaceId).eq('business_id',input.businessId);
  const repo={
   read:async id=>{const {data,error}=await scope(admin.from('social_content_items').select('*')).eq('id',id).maybeSingle();if(error)throw Error('Evenement laden mislukt.');return data;},
   list:async id=>{const {data,error}=await scope(admin.from('social_content_items').select('*')).contains('media',[{kind:'campaign_distribution',series:{id}}]).limit(101);if(error)throw Error('Reeks laden mislukt.');return data||[];},
   update:async(id,version,patch)=>{if(!version)throw Error('Versie ontbreekt.');const {data,error}=await scope(admin.from('social_content_items').update(patch)).eq('id',id).eq('updated_at',version).select('*').maybeSingle();if(error)throw Error('Bewaren mislukt.');return data;},
   insert:async rows=>{const {error}=await admin.from('social_content_items').insert(rows);if(error)throw Error('Reeks nog niet bevestigd. Kies voorbereiding hervatten.');}
  };
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  async function callWebsite(handler,row,id,method='GET'){
   const common=seriesDistribution(row).common;
   const payload={...common,workspaceId:input.workspaceId,businessId:input.businessId,campaignId:row.id,site:'caribbeancorner.nl',eventId:id,importEvent:'1',allowLinked:true,action:'sync-series',seriesPublication:true,imageUrl:common.image_url,ticketVariations:[],ticketType:'none',status:'publish'};
   const url=new URL('/api/marketing/website-events/create',request.url);
   if(method==='GET')for(const key of ['workspaceId','businessId','campaignId','site','eventId','importEvent'])url.searchParams.set(key,payload[key]||'');
   const res=await handler(new Request(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(payload)})}));
   const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||'Website niet beschikbaar.'),{status:res.status});return data;
  }
  const website={
   write:async(row,id)=>(await callWebsite(id?updateWebsite:createWebsite,row,id,id?'PATCH':'POST')).event,
   read:async(row,id)=>(await callWebsite(readWebsite,row,id)).event,
  };
  website.preflight=async(row,id)=>{
   const c=seriesDistribution(row).common;
   if(!c?.title?.trim()||c.title.length>300||String(c.description||'').length>10000)throw Object.assign(Error('Controleer de tekst: maximaal 300 tekens voor de titel en 10.000 voor de websiteomschrijving.'),{status:400});
   if(!(process.env.EVENTIN_CARIBBEAN_USERNAME||process.env.EVENTIN_USERNAME)||!(process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD||process.env.EVENTIN_APPLICATION_PASSWORD))throw Object.assign(Error('De beveiligde websitekoppeling is nog niet ingesteld.'),{status:409});
   const {data:business,error}=await admin.from('businesses').select('name').eq('workspace_id',input.workspaceId).eq('id',input.businessId).maybeSingle();
   const name=String(business?.name||''),venue=name.toLowerCase().includes('plein')?'Grandcafé Het Plein':name.toLowerCase().includes('caribbean')?'Caribbean Corner':'';
   if(error||!venue||seriesDistribution(row).common?.location?.toLowerCase()!==venue.toLowerCase())throw Object.assign(Error('Controleer de locatie: gebruik de ingestelde vestigingsnaam voor websiteplaatsing vanuit de reeks.'),{status:409});
   if(id)await callWebsite(readWebsite,row,id);
  };
  return reply(await eventSeriesAction({repo,website,input,userId:auth.user.id,today}));
 }catch(e){return reply({error:e.status?e.message:'De reeks kon niet volledig worden verwerkt. Controleer de bewaarde reeks voordat je opnieuw begint.'},e.status||500);}
}
