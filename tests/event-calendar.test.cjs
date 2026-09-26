const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');
const React = require('react');
const Renderer = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
async function load(file, mocks = {}) {
  await swc.loadBindings();
  function compile(relative) {
    const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), { filename: relative, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) } : name.startsWith('.') ? compile(path.join(path.dirname(relative), name) + '.js') : require(name), module, module.exports);
    return module.exports;
  }
  return compile(file);
}
const draft = { subject:'Arabian Night',description:'Diner en muziek',start:'2026-10-03T19:00',end:'2026-10-03T23:00',location:'Caribbean Corner' };
test('candidate selection is clickable before any form confirmation, with a separate adjacent link confirmation',async()=>{
 const C=(await load('components/event-calendar.js')).default;
 const h=await harness({events:[appointment({id:'one',subject:'Jamsessies',recurrence:{pattern:{type:'weekly'}}}),appointment({id:'two',subject:'Muziekavond'})]});
 const prior=global.fetch,calls=[];let tree;
 global.fetch=async(url,options)=>{const input=JSON.parse(options.body);calls.push(input);const data=await h.run(input.action,input);return {ok:true,json:async()=>data};};
 const props={item:h.row,workspaceId:'w',session:{access_token:'token'},enabled:true};
 const choose=()=>tree.root.findAllByType('button').filter(b=>b.props.children==='Deze afspraak kiezen');
 const link=()=>tree.root.findAllByType('button').find(b=>b.props.children==='Deze bestaande afspraak koppelen');
 const confirmation=()=>tree.root.findAllByProps({role:'region'}).find(r=>String(r.props['aria-label']).startsWith('Koppeling bevestigen:')).findByType('input');
 try{
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(C,props));});
  assert.equal(calls.length,1);assert.equal(choose().length,2);assert.ok(choose().every(b=>!b.props.disabled));assert.equal(link(),undefined);
  await Renderer.act(async()=>choose()[0].props.onClick());assert.equal(calls.length,1,'choosing never saves or changes Outlook');
  assert.equal(link().props.disabled,true);assert.equal(choose()[0].props['aria-pressed'],true);
  await Renderer.act(async()=>confirmation().props.onChange({target:{checked:true}}));assert.equal(link().props.disabled,false);
  await Renderer.act(async()=>choose()[1].props.onClick());assert.equal(confirmation().props.checked,false,'a different choice needs fresh consent');
  await Renderer.act(async()=>confirmation().props.onChange({target:{checked:true}}));
  const submit=link().props.onClick;await Renderer.act(async()=>{await Promise.all([submit(),submit()]);});
  assert.equal(calls.filter(c=>c.action==='link').length,1);assert.equal(calls.at(-1).eventId,'two');assert.equal(calls.at(-1).confirmed,true);
  assert.ok(h.calls.every(c=>!c.o.method||c.o.method==='GET'),'linking does not mutate Outlook');
  assert.equal(choose().length,0);assert.equal(h.row.media[1].calendar_channel.event_id,'two');
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=prior;}
});
test('new-appointment checkbox cannot silently confirm linking, and a recheck clears the selected candidate',async()=>{
 const C=(await load('components/event-calendar.js')).default,h=await harness({events:[appointment()]});
 const prior=global.fetch;let tree;global.fetch=async(url,options)=>({ok:true,json:async()=>h.run('check')});
 try{
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(C,{item:h.row,workspaceId:'w',session:{access_token:'token'},enabled:true}));});
  const buttons=()=>tree.root.findAllByType('button');
  await Renderer.act(async()=>buttons().find(b=>b.props.children==='Deze afspraak kiezen').props.onClick());
  const region=()=>tree.root.findAllByProps({role:'region'}).find(r=>String(r.props['aria-label']).startsWith('Koppeling bevestigen:'));
  const form=tree.root.findByType('fieldset');
  await Renderer.act(async()=>form.findAllByType('input').find(i=>i.props.type==='checkbox'&&!i.props.checked).props.onChange({target:{checked:true}}));
  assert.equal(region(),undefined,'choosing to make a new appointment clears the link selection');
  await Renderer.act(async()=>buttons().find(b=>b.props.children==='Deze afspraak kiezen').props.onClick());
  await Renderer.act(async()=>region().findByType('input').props.onChange({target:{checked:true}}));
  await Renderer.act(async()=>buttons().find(b=>b.props.children==='Controleren of het in de agenda staat').props.onClick());
  assert.equal(region(),undefined,'rechecking invalidates the prior selection and its consent');
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=prior;}
});
function appointment(patch = {}) { return {id:'remote1',subject:draft.subject,body:{content:draft.description},start:{dateTime:draft.start},end:{dateTime:draft.end},location:{displayName:draft.location},'@odata.etag':'v1',...patch}; }
async function harness({events=[],state=null,legacy=null,hook}={}) {
  const {eventCalendarAction}=await load('lib/event-calendar-service.js');
  let version=1;
  const row={id:'item',business_id:'b',updated_at:'v1',media:[{kind:'image',url:'keep'},{kind:'campaign_distribution',common:{title:draft.subject,description:draft.description,start:draft.start,end:draft.end,location:draft.location},calendar_channel:state,calendar_delivery:legacy,instagram_publications:{feed:{status:'published'}},manual_predis:{keep:true}}]};
  const calls=[];
  const repo={read:async()=>structuredClone(row),write:async(v,media)=>{if(v!==row.updated_at)return false;row.media=structuredClone(media);row.updated_at='v'+(++version);return true;}};
  const graph=async(p,o={},missing=false)=>{
    assert.ok(p.startsWith('users/info@leclubbbq.nl/calendar/'));calls.push({p,o,missing});
    if(hook){const r=await hook(p,o,row);if(r!==undefined)return r;}
    if(o.method){assert.ok(row.media[1].calendar_channel.operation,'must reserve before external mutation');const b=JSON.parse(o.body);const e=appointment({...b,id:'remote1','@odata.etag':'v2'});events.splice(0,events.length,e);return e;}
    if(p.includes('calendarView'))return {value:events};
    return events.find(e=>p.includes('/events/'+encodeURIComponent(e.id)))||null;
  };
  return {row,calls,repo,events,run:async(action,extra={})=>eventCalendarAction({repo,graph,input:{action,revision:row.media[1].calendar_channel?.revision||null,confirmed:true,draft,...extra}})};
}
test('info mailbox only: 10% threshold finds rough titles and date-only notes; score is not an automatic link',async()=>{
 const {infoCalendarMatch:match,INFO_CALENDAR_MATCH_THRESHOLD:t}=await load('lib/event-calendar.js');
 assert.equal(t,.1);
 assert.equal(match(appointment({subject:'XYZ'}),draft).score,.1);
 assert.match(match(appointment({subject:'XYZ'}),draft).reason,/Alleen dezelfde datum/);
 assert.ok(match(appointment({subject:'Arab nacht'}),draft).score>=t);
 assert.equal(match(appointment({subject:'XYZ',start:{dateTime:'2026-10-02T10:00'}}),draft).score,0);
 const h=await harness({events:[appointment({subject:'XYZ'}),appointment({id:'cancelled',isCancelled:true})]});
 const result=await h.run('check');assert.equal(result.candidates.length,1);assert.equal(result.saved.status,'candidates');assert.equal(result.saved.event_id,'');
 assert.equal(h.calls.filter(c=>c.o.method).length,0);
 assert.deepEqual(h.row.media[1].instagram_publications,{feed:{status:'published'}});
});
test('check then create reserves identity, reads back, preserves other channels and blocks duplicate create',async()=>{
 const h=await harness();assert.equal((await h.run('check')).saved.status,'missing');
 const result=await h.run('create');assert.equal(result.saved.status,'present');assert.equal(result.saved.event_id,'remote1');assert.equal(result.saved.operation,null);
 assert.equal(h.row.media[1].calendar_delivery.event_id,'remote1');assert.deepEqual(h.row.media[1].manual_predis,{keep:true});assert.equal(h.row.media[0].url,'keep');
 assert.equal(h.calls.filter(c=>c.o.method==='POST').length,1);
 await assert.rejects(h.run('create'));assert.equal(h.calls.filter(c=>c.o.method==='POST').length,1);
});
test('broad suggestions require review before creation and require explicit confirmation before linking',async()=>{
 const h=await harness({events:[appointment({subject:'XYZ'})]});await h.run('check');
 await assert.rejects(h.run('create'),/mogelijke afspraken/);await assert.rejects(h.run('link',{eventId:'remote1',confirmed:false}),/Bevestig/);
 const linked=await h.run('link',{eventId:'remote1'});assert.equal(linked.saved.status,'present');assert.equal(h.calls.filter(c=>c.o.method).length,0);
 const other=await harness({events:[appointment({subject:'XYZ'})]});await other.run('check');
 await assert.rejects(other.run('create',{reviewedCandidateIds:['wrong']}));
 assert.equal((await other.run('create',{reviewedCandidateIds:['remote1']})).saved.status,'present');
});
test('new candidate appearing since review blocks creation',async()=>{
 const h=await harness({events:[appointment({subject:'XYZ'})]});await h.run('check');h.events.push(appointment({id:'new',subject:'ABC'}));
 await assert.rejects(h.run('create',{reviewedCandidateIds:['remote1']}));assert.equal(h.calls.filter(c=>c.o.method).length,0);
});
test('legacy ID is read and update patches only requested fields with an etag',async()=>{
 const h=await harness({events:[appointment()],legacy:{mailbox:'info@leclubbbq.nl',event_id:'remote1'}});await h.run('check');
 await assert.rejects(h.run('update',{etag:'old'}),/ondertussen/);
 const r=await h.run('update',{etag:'v1',draft:{...draft,subject:'Updated'}});assert.equal(r.saved.remote.subject,'Updated');
 const c=h.calls.find(c=>c.o.method==='PATCH');assert.equal(c.o.headers['If-Match'],'v1');assert.deepEqual(Object.keys(JSON.parse(c.o.body)).sort(),['body','end','location','start','subject']);
});
test('meetings, repeated appointments and non-organizer entries cannot be modified here',async()=>{
 for(const patch of [{attendees:[{emailAddress:{address:'guest@example.com'}}]},{recurrence:{}},{isOnlineMeeting:true},{isAllDay:true},{isOrganizer:false}]){
  const h=await harness({events:[appointment(patch)],legacy:{mailbox:'info@leclubbbq.nl',event_id:'remote1'}});await h.run('check');
  await assert.rejects(h.run('update',{etag:'v1'}),/Outlook/);assert.equal(h.calls.filter(c=>c.o.method).length,0);
 }
});
test('network error is not missing; a missing linked ID cannot silently create another appointment',async()=>{
 const failed=await harness({hook:()=>{throw new Error('offline');}});const r=await failed.run('check');assert.equal(r.saved.status,'error');await assert.rejects(failed.run('create'));
 const gone=await harness({legacy:{mailbox:'info@leclubbbq.nl',event_id:'remote1'}});assert.equal((await gone.run('check')).saved.status,'missing');await assert.rejects(gone.run('create'));
});
test('uncertain POST remains reserved and is recovered by transaction ID, never repeated',async()=>{
 let transaction;
 const h=await harness({hook:(p,o)=>{if(o.method==='POST'){transaction=JSON.parse(o.body).transactionId;throw new Error('lost response');}}});await h.run('check');
 const r=await h.run('create');assert.ok(r.error);assert.ok(r.saved.operation);await assert.rejects(h.run('create'));
 h.row.media[1].calendar_channel.operation.started_at='2020-01-01T00:00:00Z';h.events.push(appointment({transactionId:transaction}));
 assert.equal((await h.run('check')).saved.status,'present');assert.equal(h.calls.filter(c=>c.o.method==='POST').length,1);
});
test('invalid dates rejected, offset dates converted to Netherlands time and unsafe links hidden',async()=>{
 const {validateCalendarDraft:v,calendarLocalTime:l,calendarWebLink:w}=await load('lib/event-calendar.js');
 assert.equal(l('2026-10-03T17:00:00Z'),draft.start);assert.throws(()=>v({...draft,start:'2026-02-30T19:00'}));assert.throws(()=>v({...draft,end:draft.start}));assert.equal(w('javascript:alert(1)'), '');assert.equal(w('https://evil.com'),'');
});
test('component only checks when opened, never writes on opening and retains edits after login refresh',async()=>{
 const C=(await load('components/event-calendar.js')).default;const h=await harness();const prior=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{const input=JSON.parse(options.body);calls.push(input);return {ok:true,json:async()=>({saved:{revision:'v',status:'missing',checked_at:'2026-10-01T10:00:00Z'},message:'Checked'})};};
 let tree;const props={item:h.row,workspaceId:'w',session:{access_token:'token'},enabled:false};
 try{await Renderer.act(async()=>{tree=Renderer.create(React.createElement(C,props));});assert.equal(calls.length,0);
 await Renderer.act(async()=>tree.update(React.createElement(C,{...props,enabled:true})));assert.equal(calls.length,1);assert.equal(calls[0].action,'check');
 const title=tree.root.findAllByType('input').find(n=>n.props.maxLength===250);await Renderer.act(async()=>title.props.onChange({target:{value:'Changed'}}));
 await Renderer.act(async()=>tree.update(React.createElement(C,{...props,enabled:true,session:{access_token:'refreshed'}})));assert.equal(tree.root.findAllByType('input').find(n=>n.props.maxLength===250).props.value,'Changed');assert.equal(calls.length,1);
 assert.ok(tree.root.findAllByType('button').find(n=>n.props.children==='In agenda zetten').props.disabled);
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=prior;}
});
test('concurrent create reserves the row once and makes only one external write',async()=>{
 const h=await harness();await h.run('check');const result=await Promise.allSettled([h.run('create'),h.run('create')]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.calls.filter(c=>c.o.method==='POST').length,1);
});
test('route rejects absent auth, missing MFA, non-owner and wrong item before looking up Microsoft credentials',async()=>{
 for(const scenario of ['no-token','aal1','not-owner','missing-item','no-connection']){
  let credentialQueries=0;
  const token='verified.'+Buffer.from(JSON.stringify({aal:scenario==='aal1'?'aal1':'aal2'})).toString('base64url')+'.sig';
  function query(table){const filters={};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},maybeSingle:async()=>{
   assert.equal(filters.workspace_id,'w');
   if(table==='workspace_members'){assert.equal(filters.user_id,'user');return {data:{role:scenario==='not-owner'?'staff':'owner'}};}
   if(table==='social_content_items'){assert.equal(filters.business_id,'b');assert.equal(filters.id,'item');return {data:scenario==='missing-item'?null:{id:'item'}};}
   assert.equal(table,'calendar_connections');assert.equal(filters.email,'info@leclubbbq.nl');assert.equal(filters.user_id,'user');assert.equal(filters.provider,'microsoft');credentialQueries++;return {data:null};
  }};return q;}
  const {POST}=await load('app/api/marketing/event-calendar/route.js',{'../../../../lib/server-supabase':{createUserSupabase:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:query}),createAdminSupabase:()=>({from:query})},'../../../../lib/microsoft-token':{microsoftAccessToken:()=>{throw Error('credentials must not be read');}}});
  const res=await POST(new Request('https://test/api',{method:'POST',headers:scenario==='no-token'?{}:{authorization:'Bearer '+token},body:JSON.stringify({action:'check',workspaceId:'w',businessId:'b',itemId:'item',revision:null})}));
  assert.equal(res.status,{'no-token':401,aal1:403,'not-owner':403,'missing-item':404,'no-connection':409}[scenario]);assert.equal(credentialQueries,scenario==='no-connection'?1:0);
 }
});
