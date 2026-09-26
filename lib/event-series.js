import { calendarLocalTime } from "./event-calendar";

export const seriesDistribution = row => (row?.media || []).find(m => m?.kind === "campaign_distribution") || {};
const DAY = 86400000;
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
export function validSeriesDay(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + "T00:00:00Z").toISOString().slice(0,10) === value;
}
export function seriesDates(rule) {
  if (!validSeriesDay(rule?.from) || !validSeriesDay(rule?.until) || rule.until < rule.from) fail("Kies een geldige begin- en einddatum.");
  const first = Date.parse(rule.from), last = Date.parse(rule.until);
  if (last - first > 366 * DAY) fail("Plan maximaal één jaar per reeks.");
  const interval = Number(rule.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) fail("Kies een interval van 1 tot 12.");
  if (!["weekly", "monthly"].includes(rule.type)) fail("Kies wekelijks of maandelijks.");
  const weekday = Number(rule.weekday), ordinal = Number(rule.ordinal);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) fail("Kies een weekdag.");
  if (rule.type === "monthly" && ![1,2,3,4,-1].includes(ordinal)) fail("Kies de eerste, tweede, derde, vierde of laatste weekdag.");
  if (!Array.isArray(rule.exclude) || rule.exclude.length > 100 || rule.exclude.some(d => !validSeriesDay(d))) fail("Controleer de overgeslagen datums.");
  const excluded = new Set(rule.exclude), dates=[];
  const origin=new Date(first), monday=first-((origin.getUTCDay()+6)%7)*DAY;
  for(let t=first;t<=last;t+=DAY){
    const d=new Date(t), day=d.toISOString().slice(0,10);
    if(d.getUTCDay()!==weekday) continue;
    if(rule.type==='weekly' && Math.floor((t-monday)/(7*DAY))%interval!==0) continue;
    if(rule.type==='monthly'){
      if(((d.getUTCFullYear()-origin.getUTCFullYear())*12+d.getUTCMonth()-origin.getUTCMonth())%interval!==0)continue;
      if(ordinal===-1 ? new Date(t+7*DAY).getUTCMonth()===d.getUTCMonth() : Math.floor((d.getUTCDate()-1)/7)+1!==ordinal)continue;
    }
    if(!excluded.has(day))dates.push(day);
  }
  if(!dates.length)fail("Er blijven geen uitvoeringen over.");
  return dates;
}
export function seriesTimes(day, startTime, endTime) {
  const valid=t=>typeof t==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if(!validSeriesDay(day)||!valid(startTime)||!valid(endTime))fail("Vul een geldige datum en begin- en eindtijd in.");
  // Equal times are not guessed to mean an entire day.
  if(startTime===endTime)fail("Begin- en eindtijd mogen niet gelijk zijn.");
  const endDay=endTime<startTime?new Date(Date.parse(day)+DAY).toISOString().slice(0,10):day;
  return {start:`${day}T${startTime}`,end:`${endDay}T${endTime}`};
}
export function seriesInitial(row) {
 const c=seriesDistribution(row).common || {}, start=calendarLocalTime(c.start), end=calendarLocalTime(c.end);
 return { title:c.title||'', description:c.description||row.body||'', location:c.location||'', startTime:start.slice(11,16)||'20:00',endTime:end.slice(11,16)||'23:00',date:start.slice(0,10),cancelled:Boolean(seriesDistribution(row).series?.cancelled) };
}
export function validateSeriesText(input) {
 const result={};for(const [key,max]of Object.entries({title:300,description:20000,location:500})){
  if(typeof input?.[key]!=='string'||input[key].length>max)fail("Controleer de titel, omschrijving en locatie.");result[key]=input[key].trim();
 }
 if(!result.title)fail("Vul een titel in.");
 return result;
}
export function seriesChangePreview(rows, input, today) {
 if(!['one','following','all'].includes(input.scope))fail("Kies welke uitvoeringen je wilt wijzigen.");
 const selected=rows.find(r=>r.id===input.itemId);if(!selected)fail("De gekozen uitvoering hoort niet bij deze reeks.");
 const allowed=['title','description','location','times','date','cancelled'];
 if(!Array.isArray(input.fields)||!input.fields.length||input.fields.some(k=>!allowed.includes(k)))fail("Kies minstens één te wijzigen gegeven.");
 if(input.fields.includes('date')&&input.scope!=='one')fail("Een datum verplaatsen kan alleen per uitvoering.");
 if(input.fields.includes('cancelled')&&typeof input.values?.cancelled!=='boolean')fail("Kies annuleren of herstellen.");
 const source=seriesDistribution(selected).series, changes=[],skipped=[];
 for(const row of rows){
  const d=seriesDistribution(row), c=d.common||{}, s=d.series;
  if(!s||s.id!==source.id)continue;
  if(input.scope==='one'&&row.id!==selected.id)continue;
  if(input.scope==='following'&&s.date<source.date)continue;
  if(calendarLocalTime(c.start).slice(0,10)<today && input.includePast!==true){skipped.push({id:row.id,reason:'Verleden',date:s.date});continue;}
  if(input.scope!=='one'&&s.exception&&input.includeExceptions!==true){skipped.push({id:row.id,reason:'Uitzondering beschermd',date:s.date});continue;}
  const next={...c}, values=input.values||{};
  for(const key of ['title','description','location'])if(input.fields.includes(key))next[key]=validateSeriesText({...seriesInitial(row),...Object.fromEntries([[key,values[key]]])})[key];
  if(input.fields.includes('date')||input.fields.includes('times')){
   const old=seriesInitial(row), day=input.fields.includes('date')?values.date:old.date;
   Object.assign(next,seriesTimes(day,input.fields.includes('times')?values.startTime:old.startTime,input.fields.includes('times')?values.endTime:old.endTime));
  }
  const cancelled=input.fields.includes('cancelled')?values.cancelled:Boolean(s.cancelled);
  if(JSON.stringify(next)===JSON.stringify(c)&&cancelled===Boolean(s.cancelled))continue;
  changes.push({id:row.id,date:s.date,before:c,after:next,cancelled,beforeCancelled:Boolean(s.cancelled),exception:input.scope==='one'||Boolean(s.exception),version:row.updated_at});
 }
 const warnings=changes.filter(p=>p.after.start!==p.before.start&&rows.some(r=>r.id!==p.id&&!seriesDistribution(r).series?.cancelled&&seriesInitial(r).date===p.after.start.slice(0,10))).map(p=>`${p.after.start.slice(0,10)}: op deze datum staat al een andere uitvoering. Controleer of dit de bedoeling is.`);
 return {changes,skipped,warnings};
}
