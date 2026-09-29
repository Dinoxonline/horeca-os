const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const Renderer = require('react-test-renderer');
const swc = require('next/dist/build/swc');
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

const draft = { caption: 'Kom naar ons evenement', assets: [{ type: 'image', url: 'https://example.com/foto.png', label: 'Foto' }], entries: [{ at: '2026-10-07T10:00', channel: 'google' }] };
test('manual month planning retains Dutch wall-clock times, inclusive boundaries and all four channels', async () => {
 const { makeManualEntries: make, validateManualDraft: validate } = await load('lib/manual-predis.js');
 const entries = make({ start: '2026-10-01', end: '2026-10-31', time: '10:00', weekdays: [3], channels: ['facebook', 'instagram', 'google', 'tiktok'] });
 assert.equal(entries.length, 16); assert.equal(entries[0].at, '2026-10-07T10:00'); assert.equal(entries.at(-1).at, '2026-10-28T10:00');
 assert.equal(make({ start:'2028-02-29', time:'12:30', channels:['google'] }).length,1);
 for (const patch of [{ caption: 3 }, { assets:[{type:'image',url:'javascript:bad'}] }, {entries:[{at:'2026-02-30T10:00',channel:'google'}]}, {entries:[{at:'2026-10-01T24:00',channel:'google'}]}, {entries:[{at:'2026-10-01T10:00',channel:'__proto__'}]}, {entries:[...draft.entries,...draft.entries]}]) assert.throws(()=>validate({...draft,...patch}));
 assert.throws(()=>make({start:'2026-01-01',end:'2028-01-01',time:'10:00',channels:['google']}));
 assert.throws(()=>make({start:'2026-01-01',time:'10:00',channels:[],weekdays:[3]}));
});
test('unchanged content retains confirmations; content changes clear them; elapsed time never implies publication', async () => {
 const {validateManualDraft:validate,retainedConfirmations:retain,manualSummary,transferText}=await load('lib/manual-predis.js');
 const d=validate(draft), key=d.entries[0].key, previous={draft:d,confirmations:{[key]:{state:'scheduled'}}};
 assert.deepEqual(retain(previous,d),previous.confirmations);
 assert.deepEqual(retain(previous,{...d,caption:'Changed'}),{});
 assert.deepEqual(retain(previous,{...d,assets:[]}),{});
 assert.equal(manualSummary(previous),'1/1 handmatig bevestigd');
 assert.match(transferText('Title',d),/NIET automatisch ingepland/);
 assert.equal(manualSummary({draft:d}),'0/1 handmatig bevestigd');
});
async function harness({ denied=false, noAuth=false, aal='aal2', locationOnly=false, conflict=false, samePlanConflict=false, storageError=false, noVersion=false }={}) {
 const updates=[]; const row={id:'c',updated_at:noVersion?null:'2026-09-26T00:00:00.000001Z',media:[{kind:'image',url:'keep'},{kind:'campaign_distribution',common:{title:'Keep title'},provider_delivery:{facebook:{status:'published'}}}]};
 const token='verified.'+Buffer.from(JSON.stringify({aal})).toString('base64url')+'.sig'; let adminCalls=0;
 function query(table) {const filters={};let patch;
  function result(){
   if(table==='user_role_assignments')return {data:[{business_id:denied?'other':'b',location_id:locationOnly?'l':null,role:{role_key:'owner'}}]};
   assert.equal(filters.workspace_id,'w');assert.equal(filters.business_id,'b');assert.equal(filters.id,'c');
   if(!patch)return {data:structuredClone(row)};
   updates.push(patch);assert.deepEqual(Object.keys(patch),['media']);assert.equal(filters.updated_at,row.updated_at);
   if(storageError)return {error:{message:'hidden'}};
   if(conflict){conflict=false;row.updated_at='2026-09-26T00:00:00.000002Z';row.media[1].instagram_publications={feed:{status:'published'}};if(samePlanConflict)row.media[1].manual_predis={revision:'other'};return {data:null};}
   row.media=patch.media;row.updated_at=new Date().toISOString();return {data:{id:'c'}};
  }
  let q;q=new Proxy({}, {get:(_,key)=>{
   if(key==='then')return (resolve,reject)=>Promise.resolve(result()).then(resolve,reject);
   if(key==='maybeSingle')return async()=>result();
   if(key==='eq')return (field,value)=>{filters[field]=value;return q};
   if(key==='update')return value=>{patch=value;return q};
   if(['insert','delete','upsert'].includes(key))return ()=>{throw new Error('No external or destructive actions')};
   return ()=>q;
  }});return q;
 }
 const db={from:query,auth:{getUser:async()=>({data:{user:noAuth?null:{id:'u'}}})}};
 const route=await load('app/api/marketing/manual-predis/route.js',{'../../../../lib/server-supabase':{createUserSupabase:()=>db,createAdminSupabase:()=>{adminCalls++;return db;}}});
 async function post(extra={}){const r=await route.POST(new Request('https://local.test/api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'save',workspaceId:'w',businessId:'b',itemId:'c',expectedRevision:null,draft,...extra})}));return {status:r.status,...await r.json()};}
 async function get(){const r=await route.GET(new Request('https://local.test/api?workspaceId=w&businessId=b&itemId=c',{headers:{Authorization:'Bearer '+token}}));return {status:r.status,...await r.json()};}
 return {post,get,row,updates,adminCalls:()=>adminCalls};
}
test('save/reload and explicit per-channel confirmation preserve event and direct publishing data',async()=>{
 const h=await harness();const first=await h.post();assert.equal(first.status,200);assert.equal((await h.get()).saved.revision,first.saved.revision);
 assert.equal(h.row.media[0].url,'keep');assert.equal(h.row.media[1].common.title,'Keep title');assert.equal(h.row.media[1].provider_delivery.facebook.status,'published');
 assert.equal((await h.post()).status,409);
 const key=first.saved.draft.entries[0].key;
 assert.equal((await h.post({action:'confirm',expectedRevision:first.saved.revision,entryKey:key,state:'scheduled'})).status,400);
 const confirmed=await h.post({action:'confirm',expectedRevision:first.saved.revision,entryKey:key,state:'scheduled',confirmed:true});
 assert.equal(confirmed.saved.confirmations[key].verification,'user_reported');assert.equal(confirmed.saved.confirmations[key].by,'u');
 assert.equal((await h.post({expectedRevision:confirmed.saved.revision,draft:{...draft,caption:'Changed'}})).status,409);
 const reset=await h.post({expectedRevision:confirmed.saved.revision,draft:{...draft,caption:'Changed'},acceptReset:true});
 assert.deepEqual(reset.saved.confirmations,{});assert.equal(reset.saved.history.at(-1).invalidated[0],key);
});
test('CAS retry preserves independent updates but refuses concurrent edits to this preparation',async()=>{
 const h=await harness({conflict:true});assert.equal((await h.post()).status,200);assert.equal(h.updates.length,2);assert.equal(h.row.media[1].instagram_publications.feed.status,'published');
 const same=await harness({conflict:true,samePlanConflict:true});assert.equal((await same.post()).status,409);assert.equal(same.updates.length,1);
});
test('auth, MFA, venue scopes, storage errors, unknown entries and missing version fail closed',async()=>{
 for(const opts of [{denied:true},{noAuth:true},{aal:'aal1'},{locationOnly:true}]){const h=await harness(opts);assert.equal((await h.post()).status,403);assert.equal(h.adminCalls(),0);}
 for(const opts of [{noVersion:true},{storageError:true}]){const h=await harness(opts);assert.notEqual((await h.post()).status,200);assert.equal(h.row.media[1].manual_predis,undefined);}
 const h=await harness();assert.equal((await h.post({action:'publish'})).status,400);assert.equal((await h.post({action:'confirm',confirmed:true,state:'scheduled',entryKey:'unknown'})).status,409);
 const source=fs.readFileSync(path.join(root,'app/api/marketing/manual-predis/route.js'),'utf8');assert.doesNotMatch(source,/fetch\(|integration_credentials|\.insert\(/);
});
const allText=node=>typeof node==='string'?node:(node.children||[]).map(allText).join(' ');
test('weekly choices include Monday and Wednesday, Thursday boundaries and DST without shifting the time',async()=>{
 const {makeManualEntries:make}=await load('lib/manual-predis.js');
 const entries=make({start:'2026-10-19',end:'2026-10-28',time:'10:00',weekdays:[1,3],channels:['facebook']});
 assert.deepEqual(entries.map(e=>e.at),['2026-10-19T10:00','2026-10-21T10:00','2026-10-26T10:00','2026-10-28T10:00']);
 assert.deepEqual(make({start:'2026-10-01',end:'2026-10-08',time:'19:00',weekdays:[4],channels:['instagram']}).map(e=>e.at),['2026-10-01T19:00','2026-10-08T19:00']);
 assert.equal(make({start:'2026-10-01',end:'2026-10-01',time:'10:00',weekdays:[1],channels:['facebook']}).length,0);
 assert.throws(()=>make({start:'2026-10-01',time:'10:00',weekdays:[],channels:['facebook']}));
});
const item={id:'c',business_id:'b',media:[{kind:'campaign_distribution',common:{title:'Event',description:'Original'}}]};
function fakeWindow(){global.window={addEventListener(){},removeEventListener(){},confirm:()=>true};}

test('future suggestions use Dutch time, round forward and cross midnight and DST safely',async()=>{
 const {nextPlanningMoment:next,validateNewMoments:check,groupManualMoments:group,validateManualDraft:validate}=await load('lib/manual-predis.js');
 assert.equal(next(Date.parse('2026-09-28T13:04:00Z')),'2026-09-28T15:30');
 assert.equal(next(Date.parse('2026-09-28T21:50:00Z')),'2026-09-29T00:15');
 assert.equal(next(Date.parse('2026-03-29T00:50:00Z')),'2026-03-29T03:15');
 assert.equal(next(Date.parse('2026-10-24T23:50:00Z')),'2026-10-25T03:00');
 const now=Date.parse('2026-09-28T13:04:30Z');
 for(const at of ['2026-09-28T10:00','2026-09-28T15:04'])assert.throws(()=>check([{at}],now),/toekomst/);
 assert.doesNotThrow(()=>check([{at:'2026-09-28T15:05'}],now));
 assert.throws(()=>check([{at:'2026-03-29T02:30'}],now,true),/zomer/);
 assert.throws(()=>check([{at:'2026-10-25T02:30'}],now),/zomer/);
 assert.doesNotThrow(()=>check([{at:'2026-09-28T10:00'}],now,true));
 assert.throws(()=>check([{at:'2026-09-29T10:00'}],now,true),/al geplaatste/);
 const old=validate({...draft,entries:['facebook','instagram','google','tiktok'].map(channel=>({at:'2026-09-28T10:00',channel}))});
 const before=JSON.stringify(old);const groups=group(old.entries,now);
 assert.equal(groups.length,1);assert.equal(groups[0].entries.length,4);assert.equal(groups[0].elapsed,true);assert.equal(JSON.stringify(old),before);
});

test('planner groups channels, retains past records, and rejects a time that expires before clicking',async()=>{
 fakeWindow();const originalNow=Date.now;let now=Date.parse('2026-09-28T13:04:00Z');Date.now=()=>now;
 const {validateManualDraft}=await load('lib/manual-predis.js');
 let saved={revision:'r1',draft:validateManualDraft({...draft,entries:['2026-09-28T10:00','2026-09-29T16:00'].flatMap(at=>['facebook','instagram','google','tiktok'].map(channel=>({at,channel})))}),confirmations:{}};
 const originalEntries=structuredClone(saved.draft.entries),posts=[];
 global.fetch=async(url,opts)=>{if(opts.method==='POST'){const body=JSON.parse(opts.body);posts.push(body);saved={...saved,revision:'r2',draft:body.draft};}return Response.json({saved});};
 let r;
 try{
   const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
   await React.act(async()=>{r=Renderer.create(React.createElement(Component,{item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:true}));});
   const planner=()=>r.root.findByProps({'aria-label':'Publicatiemomenten kiezen'});
   const label=name=>planner().findAllByType('label').find(n=>allText(n).trim()===name);
   const button=name=>r.root.findAllByType('button').find(n=>allText(n)===name);
   assert.equal(label('Tijd (Nederland)').findByType('input').props.value,'15:30');
   const list=planner().findByProps({'aria-label':'Toegevoegde publicatiemomenten'});
   assert.equal(list.findAllByType('button').length,2); // two times, not eight channel rows
   const past=list.findByType('details');assert.equal(past.props.open,undefined);
   assert.match(allText(past),/Verstreken tijdstippen/);assert.match(allText(past),/Tijdstip verstreken/);
   assert.match(allText(list),/Facebook · Google Business Profile · Instagram · TikTok/);
   await React.act(async()=>label('Facebook').findByType('input').props.onChange());
   assert.equal(button('Momenten toevoegen aan planning').props.disabled,false);
   now=Date.parse('2026-09-28T13:30:01Z');
   await React.act(async()=>button('Momenten toevoegen aan planning').props.onClick());
   assert.match(allText(planner().findByProps({role:'alert'})),/toekomst/);assert.equal(posts.length,0);
   // Caption edits still save the existing history unchanged.
   await React.act(async()=>r.root.findByType('textarea').props.onChange({target:{value:'Updated caption'}}));
   await React.act(async()=>button('Concept bewaren').props.onClick());
   assert.deepEqual(saved.draft.entries,originalEntries);assert.deepEqual(saved.confirmations,{});
   await React.act(async()=>planner().findByType('select').props.onChange({target:{value:'recorded'}}));
   await React.act(async()=>label('Tijd (Nederland)').findByType('input').props.onChange({target:{value:'15:00'}}));
   await React.act(async()=>button('Momenten toevoegen aan planning').props.onClick());
   await React.act(async()=>button('Concept bewaren').props.onClick());
   assert.equal(saved.draft.entries.length,9);assert.deepEqual(saved.confirmations,{});
   // Group deletion affects only that time; individual controls still exist in step three.
   await React.act(async()=>r.root.findByProps({'aria-label':'Verwijder tijdstip 2026-09-29T16:00 voor alle 4 kanalen'}).props.onClick());
   await React.act(async()=>button('Concept bewaren').props.onClick());
   assert.equal(saved.draft.entries.length,5);assert.ok(saved.draft.entries.every(e=>e.at!=='2026-09-29T16:00'));
 }finally{if(r)await React.act(async()=>r.unmount());Date.now=originalNow;delete global.window;}
});

test('visible planner previews selected weekdays, adds nonduplicated dates, saves and reloads without sending to Predis',async()=>{
 fakeWindow();let saved=null;const calls=[];
 global.fetch=async(url,opts)=>{calls.push({url,method:opts.method});if(opts.method==='POST')saved={revision:'r',draft:JSON.parse(opts.body).draft,confirmations:{}};return Response.json({saved});};
 const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 const props={item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:true};
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,props));});
 const button=label=>r.root.findAllByType('button').find(b=>allText(b)===label);
 const planner=()=>r.root.findByProps({'aria-label':'Publicatiemomenten kiezen'});
 const label=name=>planner().findAllByType('label').find(n=>allText(n).trim()===name);
 try {
   for(let p=planner().parent;p;p=p.parent)assert.notEqual(p.type,'details');
   await React.act(async()=>planner().findByType('select').props.onChange({target:{value:'weekly'}}));
   await React.act(async()=>label('Facebook').findByType('input').props.onChange());
   await React.act(async()=>label('Begindatum').findByType('input').props.onChange({target:{value:'2026-10-19'}}));
   await React.act(async()=>label('Einddatum (inclusief)').findByType('input').props.onChange({target:{value:'2026-10-28'}}));
   await React.act(async()=>label('Maandag').findByType('input').props.onChange());
   await React.act(async()=>label('Tijd (Nederland)').findByType('input').props.onChange({target:{value:'10:00'}}));
   assert.match(allText(planner()),/4\s+datums/);assert.match(allText(planner()),/28-10-2026 10:00/);
   assert.deepEqual(calls.map(c=>c.method),['GET']);
   await React.act(async()=>button('Momenten toevoegen aan planning').props.onClick());
   assert.equal(button('Momenten toevoegen aan planning').props.disabled,true);
   assert.match(allText(planner()),/4 kanaalmomenten toegevoegd/);
   const visibleList=planner().findByProps({'aria-label':'Toegevoegde publicatiemomenten'});
   assert.match(allText(visibleList),/nog niet bewaard/);
   assert.match(allText(visibleList),/28\s*-\s*10\s*-\s*2026.*Facebook/);
   for(let p=visibleList;p;p=p.parent)assert.notEqual(p.type,'details');
   assert.equal(button('Direct publiceren — nog niet beschikbaar'),undefined);
   assert.match(allText(r.root),/nu publiceren/);
   assert.match(allText(r.root),/Je hoeft hier geen moment toe te voegen/);
   assert.match(allText(r.root),/Wil je zien wat al is ingepland/);
   assert.match(allText(r.root),/Predis-scherm met keuzes/);
   await React.act(async()=>planner().findByType('select').props.onChange({target:{value:'single'}}));
   await React.act(async()=>label('Datum').findByType('input').props.onChange({target:{value:'2026-10-30'}}));
   await React.act(async()=>button('Momenten toevoegen aan planning').props.onClick());
   await React.act(async()=>button('Concept bewaren').props.onClick());
   assert.equal(saved.draft.entries.length,5);assert.equal(saved.draft.entries.at(-1).at,'2026-10-30T10:00');
   assert.match(allText(planner().findByProps({'aria-label':'Toegevoegde publicatiemomenten'})),/bewaard bij je concept/);
   assert.ok(calls.every(c=>c.url.startsWith('/api/marketing/manual-predis')));
   await React.act(async()=>r.unmount());
   await React.act(async()=>{r=Renderer.create(React.createElement(Component,props));});
   assert.equal(r.root.findByType('tbody').findAllByType('tr').length,5);
   assert.match(allText(r.root.findByType('tbody')),/Concept — nog niet overgezet/);
 }finally{await React.act(async()=>r.unmount());delete global.window;}
});

test('planner reports validation failure beside the add button and does not silently discard or save input',async()=>{
 fakeWindow();const calls=[];
 global.fetch=async(url,opts)=>{calls.push(opts.method);return Response.json({saved:{revision:'r',draft:{caption:'Keep text',assets:[{type:'image',url:'http://example.com/old.jpg',label:'Old media'}],entries:[]},confirmations:{}}});};
 const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,{item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:true}));});
 try{
   const planner=()=>r.root.findByProps({'aria-label':'Publicatiemomenten kiezen'});
   await React.act(async()=>planner().findAllByType('label').find(n=>allText(n).trim()==='Facebook').findByType('input').props.onChange());
   await React.act(async()=>planner().findAllByType('button').find(n=>allText(n)==='Momenten toevoegen aan planning').props.onClick());
   assert.match(allText(planner().findByProps({role:'alert'})),/Niet toegevoegd: Ongeldig mediabestand/);
   assert.equal(r.root.findByType('textarea').props.value,'Keep text');
   assert.equal(planner().findAllByProps({'aria-label':'Toegevoegde publicatiemomenten'}).length,0);
   assert.deepEqual(calls,['GET']);
 }finally{await React.act(async()=>r.unmount());delete global.window;}
});
test('UI loads lazily, keeps draft through token refresh and save failure, and does not double-submit',async()=>{
 fakeWindow();let calls=[],release,lastBody;
 global.fetch=async(url,opts)=>{calls.push(opts.method);if(opts.method==='GET')return {ok:true,json:async()=>({saved:null})};lastBody=JSON.parse(opts.body);return new Promise(resolve=>{release=resolve});};
 const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 const props={item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:false};
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,props));});
 try{
 assert.equal(calls.length,0);
 await React.act(async()=>r.update(React.createElement(Component,{...props,enabled:true})));assert.deepEqual(calls,['GET']);
 const content=allText(r.root);
 assert.match(content,/Geen nieuw AI-ontwerp/);
 assert.ok(content.includes('1. Bericht voorbereiden'));
 assert.ok(content.indexOf('1. Bericht voorbereiden') < content.indexOf('2. In Predis bekijken, maken en plannen'));
 assert.ok(content.indexOf('2. In Predis bekijken, maken en plannen') < content.indexOf('3. Bevestigen na Predis'));
 assert.doesNotMatch(content,/3\. Bericht en planning bewaren|4\. Verder/);
 assert.match(content,/Foto en tekst worden niet automatisch meegestuurd/);
 assert.equal(r.root.findAllByType('a').find(a=>allText(a)==='Predis-planning bekijken ↗').props.href,'https://app.predis.ai/app/content_calendar');
 assert.equal(r.root.findAllByType('a').find(a=>allText(a)==='Nieuw bericht in Predis starten ↗').props.href,'https://app.predis.ai/app/new_post/create');
 await React.act(async()=>r.root.findByType('textarea').props.onChange({target:{value:'Edited'}}));
 await React.act(async()=>r.update(React.createElement(Component,{...props,enabled:true,session:{access_token:'two'}})));
 assert.equal(r.root.findByType('textarea').props.value,'Edited');assert.equal(calls.length,1);
 const save=()=>r.root.findAllByType('button').find(b=>allText(b)==='Concept bewaren').props.onClick();
 let pending;await React.act(async()=>{pending=save();save();});assert.equal(calls.length,2);
 await React.act(async()=>{release({ok:false,json:async()=>({error:'Conflict'})});await pending;});assert.equal(r.root.findByType('textarea').props.value,'Edited');assert.match(allText(r.root.findByProps({role:'alert'})),/Conflict/);
 await React.act(async()=>{pending=save();});
 await React.act(async()=>{release({ok:true,json:async()=>({saved:{revision:'new',draft:lastBody.draft,confirmations:{}}})});await pending;});
 assert.match(allText(r.root),/Concept bewaard in Horeca OS/);assert.doesNotMatch(allText(r.root),/Niet-bewaarde wijzigingen/);
 }finally{await React.act(async()=>r.unmount());delete global.window;}
});
test('simple preparation shows selectable images immediately, keeps saved-only media and hides advanced actions',async()=>{
 fakeWindow();const calls=[];
 const original={revision:'r1',draft:{...draft,entries:[{...draft.entries[0],key:'existing'}]},confirmations:{}};
 global.fetch=async(url,opts)=>{calls.push(opts.method);return Response.json({saved:opts.method==='GET'?original:{...original,revision:'r2',draft:JSON.parse(opts.body).draft}});};
 const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 const event={...item,media:[...item.media,{kind:'image',url:'https://example.com/new.jpg',label:'New photo'}]};
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,{item:event,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:true}));});
 try{
   const collapsedAncestor=node=>{for(let p=node.parent;p;p=p.parent)if(p.type==='details'&&!p.props.open)return true;return false;};
   const button=label=>r.root.findAllByType('button').find(b=>allText(b)===label);
   const options=r.root.findByType('details');assert.equal(options.props.open,undefined);assert.equal(allText(options.findByType('summary')),'Meer opties');
   assert.equal(r.root.findAllByType('img').length,2);assert.ok(r.root.findAllByType('img').every(n=>!collapsedAncestor(n)));
   assert.ok(!collapsedAncestor(r.root.findByType('table')));assert.ok(collapsedAncestor(button('Bewaarde versie laden')));
   const visibleButtons=r.root.findAllByType('button').filter(n=>!collapsedAncestor(n));
   assert.equal(visibleButtons.filter(n=>/bewaren/i.test(allText(n))).length,1);
   assert.equal(visibleButtons.filter(n=>/kopiëren/i.test(allText(n))).length,1);
   assert.equal(button('Concept bewaren').props.disabled,true);
   await React.act(async()=>r.root.findByProps({'aria-label':'Kies New photo'}).props.onClick());
   assert.equal(r.root.findByProps({'aria-label':'Deselecteer New photo'}).props['aria-pressed'],true);
   await React.act(async()=>r.root.findByProps({'aria-label':'Deselecteer Foto'}).props.onClick());
   await React.act(async()=>button('Concept bewaren').props.onClick());
   assert.deepEqual(calls,['GET','POST']);assert.match(allText(r.root),/Concept bewaard in Horeca OS/);
   assert.match(allText(r.root.findByType('table')),/Google Business Profile/);
   assert.equal(r.root.findAllByType('a').filter(a=>a.props.href==='https://example.com/new.jpg').length,0);
   assert.equal(r.root.findAllByProps({'aria-label':'Kies Foto'}).length,0);
 }finally{await React.act(async()=>r.unmount());delete global.window;}
});
test('step three stays visible and requires explicit per-channel confirmation after saving a concept',async()=>{
 fakeWindow();const {validateManualDraft}=await load('lib/manual-predis.js');
 let saved={revision:'r1',draft:validateManualDraft(draft),confirmations:{}};const posts=[];
 global.fetch=async(url,opts)=>{if(opts.method==='POST'){const body=JSON.parse(opts.body);posts.push(body);assert.equal(body.action,'confirm');assert.equal(body.confirmed,true);saved={...saved,revision:'r2',confirmations:{[body.entryKey]:{state:body.state,at:'2026-09-28T14:00:00Z'}}};}return Response.json({saved});};
 const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,{item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:true}));});
 try{
   const step=()=>r.root.findByProps({'aria-label':'Uitkomst in Predis bevestigen'});
   for(let p=step();p;p=p.parent)assert.notEqual(p.type,'details');
   assert.match(allText(step().findByType('tbody')),/Concept — nog niet overgezet/);
   assert.equal(posts.length,0);
   await React.act(async()=>step().findAllByType('button').find(b=>allText(b)==='Controleren').props.onClick());
   const confirmButton=()=>step().findAllByType('button').find(b=>allText(b)==='Handmatige bevestiging bewaren');
   assert.equal(confirmButton().props.disabled,true);
   await React.act(async()=>step().findByType('select').props.onChange({target:{value:'published'}}));
   assert.equal(confirmButton().props.disabled,true);assert.equal(posts.length,0);
   await React.act(async()=>step().findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
   assert.equal(confirmButton().props.disabled,false);
   await React.act(async()=>confirmButton().props.onClick());
   assert.equal(posts.length,1);assert.equal(posts[0].entryKey,saved.draft.entries[0].key);
   assert.match(allText(step().findByType('tbody')),/Geplaatst · handmatig bevestigd/);
   assert.match(allText(step()),/Je handmatige bevestiging is bewaard/);
 }finally{await React.act(async()=>r.unmount());delete global.window;}
});

test('Predis starts with a neutral choice; manual and all AI formats require explicit selection',async()=>{
 fakeWindow();const calls=[];
 global.fetch=async(url,opts)=>{calls.push({url,method:opts.method});return Response.json({saved:null,configured:true,jobs:[],photos:[]});};
 const Component=(await load('components/predis-workspace.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,{item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:true}));});
 try{
   const button=label=>r.root.findAllByType('button').find(b=>allText(b).startsWith(label));
   assert.equal(r.root.findByProps({'aria-label':'Predis-werkwijze kiezen'}).type,'section');
   assert.equal(calls.length,0);
   assert.equal(r.root.findAllByType('a').length,4);
   assert.ok(r.root.findAllByType('a').every(a=>a.props.href==='https://app.predis.ai/app/new_post/create'));
   await React.act(async()=>button('Eigen foto en tekst').props.onClick());
   assert.equal(r.root.findByProps({'aria-label':'Predis handmatig voorbereiden'}).type,'section');
   assert.equal(r.root.findAllByProps({'aria-label':'Content maken met Predis'}).length,0);
   assert.equal(calls.length,1);assert.match(calls[0].url,/\/manual-predis\?/);assert.equal(calls[0].method,'GET');
   await React.act(async()=>r.root.findByType('textarea').props.onChange({target:{value:'Mijn eigen bijschrift'}}));
   global.window.confirm=()=>false;
   await React.act(async()=>button('Andere werkwijze kiezen').props.onClick());
   assert.equal(r.root.findByType('textarea').props.value,'Mijn eigen bijschrift');assert.equal(calls.length,1);
   global.window.confirm=()=>true;
   await React.act(async()=>button('Andere werkwijze kiezen').props.onClick());
   for(const [label,format] of [['Afbeelding','single_image'],['Carrousel','carousel'],['Video','video']]){
     await React.act(async()=>button(label).props.onClick());
     assert.equal(r.root.findByType('select').props.value,format);
     assert.equal(button('Content laten maken').props.disabled,true);
     await React.act(async()=>button('Andere werkwijze kiezen').props.onClick());
   }
   assert.equal(calls.length,4);assert.ok(calls.slice(1).every(c=>c.url.includes('/predis-content?')));assert.ok(calls.every(c=>c.method==='GET'));
 }finally{await React.act(async()=>r.unmount());delete global.window;}
});
test('search/worklist filters manual pending actions and opens the exact selected event',async()=>{
 const Component=(await load('components/marketing-worklist.js')).default;let opened;
 const planned={...item,id:'p',media:[{kind:'campaign_distribution',common:{title:'Arabian night',start:'2026-09-26'},manual_predis:{draft:{entries:[{key:'k'}]},confirmations:{}}}]};
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,{items:[item,planned],businesses:new Map([['b',{name:'Venue'}]]),getStatus:()=>({label:'Niet gecontroleerd'}),onOpen:i=>opened=i.id}));});
 try{await React.act(async()=>r.root.findByType('select').props.onChange({target:{value:'todo'}}));assert.equal(r.root.findAllByType('article').length,1);await React.act(async()=>r.root.findAllByType('button')[0].props.onClick());assert.equal(opened,'p');await React.act(async()=>r.root.findByType('input').props.onChange({target:{value:'missing'}}));assert.equal(r.root.findAllByType('article').length,0);}finally{await React.act(async()=>r.unmount());}
});
test('worklist keeps the calendar representative when merge targets are absent or less complete',async()=>{
 const {marketingWorklistItems}=await load('components/marketing-overview.js',{'../lib/supabase':{supabase:{}}});
 const event=(id,duplicate,published)=>({id,business_id:'b',published_at:published?'2026-09-26':null,media:[{kind:'campaign_distribution',duplicate_of:duplicate,common:{title:'Arabian Night',start:'2026-09-26'}}]});
 const orphan=event('kept','old-missing-target',true);
 const roots=new Map([['b',{name:'Venue'}]]);
 assert.deepEqual(marketingWorklistItems([orphan],roots).map(i=>i.id),['kept']);
 assert.deepEqual(marketingWorklistItems([event('root',null,false),event('published','root',true)],roots).map(i=>i.id),['published']);
 assert.equal(marketingWorklistItems([orphan],new Map()).length,0);
});
