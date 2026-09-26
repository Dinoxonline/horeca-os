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
function appointment(patch = {}) { return {id:'remote1',subject:draft.subject,body:{content:draft.description},start:{dateTime:draft.start},end:{dateTime:draft.end},location:{displayName:draft.location},'@odata.etag':'v1',...patch}; }
const rule={type:'weekly',from:'2027-01-07',until:'2027-12-31',weekday:4,interval:1,ordinal:-1,exclude:[]};
test('website series update preserves tickets, artwork and visibility and refuses native recurrence',async()=>{
 const originalFetch=global.fetch;const oldUser=process.env.EVENTIN_CARIBBEAN_USERNAME,oldPass=process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD;
 process.env.EVENTIN_CARIBBEAN_USERNAME='test';process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD='test';
 const original={id:123,title:'Old',description:'Old',start_date:'2027-01-07',end_date:'2027-01-07',start_time:'20:00',end_time:'23:00',visibility_status:'publish',event_banner:'image.jpg',ticket_variations:[{etn_sold_tickets:5}],total_ticket:50};
 let sent=[],recurring=false;
 try{
  const {PATCH}=await load('app/api/marketing/website-events/create/route.js',{'../../../../../lib/server-supabase':{createUserSupabase:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='workspace_members'?{role:'owner'}:{name:'Caribbean Corner'}})})})}});
  global.fetch=async(url,options)=>{if(options.method==='POST'){sent.push(JSON.parse(options.body));return Response.json({id:123});}return Response.json({...original,...(recurring?{is_recurring:true}:{})});};
  const req=()=>new Request('https://local.test/api/marketing/website-events/create',{method:'PATCH',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify({workspaceId:'w',businessId:'b',campaignId:'i',site:'caribbeancorner.nl',eventId:'123',allowLinked:true,action:'sync-series',title:'New',description:'New text',start:'2027-01-14T21:00',end:'2027-01-15T01:00',location:'Caribbean Corner'})});
  assert.equal((await PATCH(req())).status,200);assert.equal(sent.length,1);
  assert.deepEqual(sent[0].ticket_variations,original.ticket_variations);assert.equal(sent[0].event_banner,'image.jpg');assert.equal(sent[0].visibility_status,'publish');assert.equal(sent[0].start_date,'2027-01-14');assert.equal(sent[0].end_date,'2027-01-15');assert.equal(sent[0].start_time,'21:00');
  recurring=true;assert.equal((await PATCH(req())).status,409);assert.equal(sent.length,1);
 }finally{global.fetch=originalFetch;if(oldUser===undefined)delete process.env.EVENTIN_CARIBBEAN_USERNAME;else process.env.EVENTIN_CARIBBEAN_USERNAME=oldUser;if(oldPass===undefined)delete process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD;else process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD=oldPass;}
});
test('website preview is read-only, publication needs consent, and confirmed identity is saved and read back',async()=>{
 const h=await setup();const created=await h.create();
 const {seriesWebsiteStep:step,seriesWebsitePreview:preview}=await load('lib/event-series-website.js');
 let writes=0,reads=0;const target=created.rows[1],id='987';
 const website={preflight:async()=>{},write:async()=>{writes++;assert.equal(h.d(h.db.get(target.id)).series_website.status,'sending');return {id,url:'https://example.com/event/987'};},read:async row=>{reads++;return {id,...h.d(row).common,status:'publish'};}};
 const base={repo:h.repo,website,today:'2027-01-01'};
 const p=await step({...base,input:{action:'preview-website',itemId:'anchor'}});
 assert.equal(writes,0);assert.equal(p.changes.length,52);
 await assert.rejects(step({...base,input:{action:'website-step',itemId:'anchor',targetId:target.id,token:p.token}}));
 const r=await step({...base,input:{action:'website-step',itemId:'anchor',targetId:target.id,token:p.token,confirmed:true}});
 assert.equal(writes,1);assert.equal(reads,1);assert.equal(h.d(r.row).eventin_event_id,id);assert.equal(h.d(r.row).series_website.status,'verified');
 const remaining=preview(await h.repo.list('anchor'),'2027-01-01');assert.ok(!remaining.changes.some(c=>c.id===target.id));
 await assert.rejects(step({...base,input:{action:'website-step',itemId:'anchor',targetId:target.id,token:p.token,confirmed:true}}));assert.equal(writes,1);
});
test('uncertain website create never repeats; known ID readback failure retains exact identity',async()=>{
 for(const known of [false,true]){
  const h=await setup();const created=await h.create();const target=created.rows[1];
  const {seriesWebsiteStep:step}=await load('lib/event-series-website.js');let writes=0;
  const website={preflight:async()=>{},write:async()=>{writes++;if(!known)throw Error('Lost response');return {id:'999'};},read:async()=>{throw Error('Readback failed');}};
  const base={repo:h.repo,website,today:'2027-01-01'};
  let p=await step({...base,input:{action:'preview-website',itemId:'anchor'}});
  await assert.rejects(step({...base,input:{action:'website-step',itemId:'anchor',targetId:target.id,token:p.token,confirmed:true}}));
  const job=h.d(h.db.get(target.id));assert.equal(job.series_website.status,'uncertain');assert.equal(job.eventin_event_id,known?'999':undefined);
  p=await step({...base,input:{action:'preview-website',itemId:'anchor'}});
  assert.equal(p.changes.find(c=>c.id===target.id).blocked,!known);
  if(!known){await assert.rejects(step({...base,input:{action:'website-step',itemId:'anchor',targetId:target.id,token:p.token,confirmed:true}}));assert.equal(writes,1);}
 }
});
test('website configuration failures do not reserve or publish; dates and cancellation are respected',async()=>{
 const h=await setup();const created=await h.create();const target=created.rows[1];
 const {seriesWebsiteStep:step,seriesWebsitePreview:preview}=await load('lib/event-series-website.js');
 let writes=0;const website={preflight:async()=>{throw Error('No credentials');},write:async()=>{writes++;}};
 const base={repo:h.repo,website,today:'2027-01-01'},p=preview(created.rows,'2027-01-01');
 await assert.rejects(step({...base,input:{action:'website-step',itemId:'anchor',targetId:target.id,token:p.token,confirmed:true}}));
 assert.equal(writes,0);assert.equal(h.d(h.db.get(target.id)).series_website,undefined);
 h.db.get(target.id).media[0].series.cancelled=true;
 const next=preview(await h.repo.list('anchor'),'2027-01-14');
 assert.ok(next.skipped.some(p=>p.id==='anchor'));assert.ok(next.skipped.some(p=>p.id===target.id));
});
test('series API rejects missing token, unverified MFA and non-owner before admin access',async()=>{
 let admin=0;let user={id:'u'},role='owner';
 const {POST}=await load('app/api/marketing/event-series/route.js',{
  '../../../../lib/server-supabase':{createAdminSupabase:()=>{admin++;throw Error('Must not reach');},createUserSupabase:()=>({auth:{getUser:async()=>({data:{user}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role}})})})},
 });
 const request=token=>new Request('https://example.com/api/marketing/event-series',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action:'get',workspaceId:'w',businessId:'b',itemId:'i'})});
 assert.equal((await POST(request())).status,401);
 const token=aal=>'x.'+Buffer.from(JSON.stringify({aal})).toString('base64url')+'.x';
 assert.equal((await POST(request(token('aal1')))).status,403);
 role='member';assert.equal((await POST(request(token('aal2')))).status,403);assert.equal(admin,0);
});
test('weekly year, alternate weeks, last Fridays and excluded dates are calendar-correct',async()=>{
 const {seriesDates:d}=await load('lib/event-series.js');
 assert.equal(d(rule).length,52);assert.equal(d({...rule,interval:2}).length,26);
 const fridays=d({...rule,type:'monthly',from:'2027-01-01',weekday:5});assert.equal(fridays.length,12);assert.equal(fridays[0],'2027-01-29');assert.equal(fridays[1],'2027-02-26');
 assert.equal(d({...rule,exclude:['2027-01-07']})[0],'2027-01-14');
 assert.throws(()=>d({...rule,from:'2027-02-30'}));assert.throws(()=>d({...rule,until:'2029-01-01'}));assert.throws(()=>d({...rule,weekday:7}));assert.throws(()=>d({...rule,interval:0.5}));assert.throws(()=>d({...rule,interval:0}));
});
test('wall-clock times retain local hours across DST and midnight advances one calendar day',async()=>{
 const {seriesTimes:t}=await load('lib/event-series.js');
 assert.deepEqual(t('2027-03-28','20:00','01:00'),{start:'2027-03-28T20:00',end:'2027-03-29T01:00'});
 assert.deepEqual(t('2027-10-31','20:00','01:00'),{start:'2027-10-31T20:00',end:'2027-11-01T01:00'});
 assert.throws(()=>t('2027-01-07','20:00','20:00'));assert.throws(()=>t('2027-01-07','25:00','23:00'));
});
async function setup(){
 const {eventSeriesAction:action}=await load('lib/event-series-service.js');
 const {seriesDistribution:d}=await load('lib/event-series.js');
 let v=1;const anchor={id:'anchor',workspace_id:'w',business_id:'b',account_id:'account',updated_at:'v1',body:'Music',media:[{kind:'campaign_distribution',source_type:'event',common:{title:'Jamsessie',description:'Music',start:'2027-01-07T20:00',end:'2027-01-07T23:00',location:'Corner',image_url:'https://example.com/photo.jpg',website_url:'https://old.example.com/event'},eventin_event_id:'123',calendar_delivery:{event_id:'appointment'},facebook_event_delivery:{external_id:'456'},instagram_publications:{feed:{status:'published'}}}]};
 const db=new Map([[anchor.id,anchor]]);
 const repo={read:async id=>structuredClone(db.get(id)),list:async id=>structuredClone([...db.values()].filter(r=>d(r).series?.id===id)),update:async(id,version,patch)=>{const r=db.get(id);if(r.updated_at!==version)return null;Object.assign(r,structuredClone(patch),{updated_at:'v'+(++v)});return structuredClone(r);},insert:async rows=>{if(rows.some(r=>db.has(r.id)))throw Error('duplicate');rows.forEach(r=>db.set(r.id,{...structuredClone(r),updated_at:'v'+(++v)}));}};
 const run=(input)=>action({repo,input:{itemId:'anchor',...input},userId:'user',today:'2027-01-01'});
 const create=async()=>{const preview=await run({action:'preview-create',rule,startTime:'20:00',endTime:'23:00'});return run({action:'create',rule,startTime:'20:00',endTime:'23:00',confirmed:true,token:preview.token});};
 return {run,create,db,repo,d};
}
test('preview has no writes; create retains original IDs and creates clean uniquely identified occurrences',async()=>{
 const h=await setup();await h.run({action:'preview-create',rule,startTime:'20:00',endTime:'23:00'});assert.equal(h.db.size,1);
 const r=await h.create();assert.equal(r.rows.length,52);assert.equal(r.definition.state,'ready');
 const a=h.d(h.db.get('anchor'));assert.equal(a.eventin_event_id,'123');assert.equal(a.facebook_event_delivery.external_id,'456');
 const child=h.d(r.rows[1]);assert.equal(child.eventin_event_id,undefined);assert.equal(child.calendar_delivery,undefined);assert.equal(child.instagram_publications,undefined);assert.equal(child.common.website_url,undefined);assert.equal(child.common.image_url,'https://example.com/photo.jpg');
 await assert.rejects(h.create());assert.equal(h.db.size,52);
});
test('uncertain bulk insert is resumed without duplicate children',async()=>{
 const h=await setup(),insert=h.repo.insert;h.repo.insert=async rows=>{await insert(rows);throw Error('lost response');};
 await assert.rejects(h.create());assert.equal(h.db.size,52);h.repo.insert=insert;
 const r=await h.run({action:'resume',confirmed:true});assert.equal(r.rows.length,52);assert.equal(r.definition.state,'ready');
});
test('one, following, and entire series scopes protect exceptions and history by default',async()=>{
 const h=await setup(),r=await h.create(),single=r.rows[10];
 const request={action:'preview-change',itemId:single.id,scope:'one',fields:['title'],values:{title:'Special guest'}};
 let p=await h.run(request);assert.equal(p.changes.length,1);await h.run({...request,action:'change',confirmed:true,token:p.token});
 p=await h.run({...request,scope:'following',values:{title:'Later sessions'}});assert.equal(p.changes.length,41);assert.equal(p.skipped[0].reason,'Uitzondering beschermd');
 p=await h.run({...request,scope:'all',values:{title:'All sessions'}});assert.equal(p.changes.length,51);
 p=await h.run({...request,scope:'all',includeExceptions:true,values:{title:'All sessions'}});assert.equal(p.changes.length,52);
});
test('changed preview, missing confirmation, concurrent edits and channel IDs are handled safely',async()=>{
 const h=await setup();await h.create();const req={action:'preview-change',scope:'one',fields:['description'],values:{description:'Changed'}};
 const p=await h.run(req);await assert.rejects(h.run({...req,action:'change',token:p.token}));
 h.db.get('anchor').updated_at='concurrent';await assert.rejects(h.run({...req,action:'change',confirmed:true,token:p.token}));
 const next=await h.run(req);const r=await h.run({...req,action:'change',confirmed:true,token:next.token});assert.equal(r.changed.length,1);
 assert.equal(h.d(h.db.get('anchor')).eventin_event_id,'123');assert.equal(h.db.get('anchor').body,'Changed');assert.equal(h.d(h.db.get('anchor')).series_channel_tasks.website,'Wijziging doorzetten');
});
test('past dates are protected and cancelling or moving an occurrence preserves its identity',async()=>{
 const {seriesChangePreview:p}=await load('lib/event-series.js');const h=await setup(),r=await h.create();
 let result=p(r.rows,{itemId:'anchor',scope:'all',fields:['cancelled'],values:{cancelled:true}},'2027-02-01');assert.equal(result.skipped.length,4);assert.equal(result.changes.length,48);
 result=p(r.rows,{itemId:'anchor',scope:'one',fields:['date'],values:{date:'2027-01-08'}},'2027-01-01');assert.equal(result.changes[0].id,'anchor');assert.equal(result.changes[0].after.start,'2027-01-08T20:00');
 assert.throws(()=>p(r.rows,{itemId:'anchor',scope:'all',fields:['date'],values:{date:'2027-01-08'}},'2027-01-01'));
});
test('UI is lazy and draft edits survive token refresh without saving',async()=>{
 const C=(await load('components/event-series.js')).default,h=await setup();let tree;const old=global.fetch,calls=[];global.fetch=async(url,o)=>{calls.push(JSON.parse(o.body));return {ok:true,json:async()=>({rows:[h.db.get('anchor')],definition:null})};};
 const props={item:h.db.get('anchor'),workspaceId:'w',session:{access_token:'test'},enabled:false};
 try{await Renderer.act(async()=>{tree=Renderer.create(React.createElement(C,props));});assert.equal(calls.length,0);
 await Renderer.act(async()=>tree.update(React.createElement(C,{...props,enabled:true})));assert.equal(calls[0].action,'get');
 const until=tree.root.findAllByType('input').filter(n=>n.props.type==='date')[1];await Renderer.act(async()=>until.props.onChange({target:{value:'2027-11-30'}}));
 await Renderer.act(async()=>tree.update(React.createElement(C,{...props,enabled:true,session:{access_token:'new'}})));assert.equal(tree.root.findAllByType('input').filter(n=>n.props.type==='date')[1].props.value,'2027-11-30');assert.equal(calls.length,1);
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=old;}
});
