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
const item={id:'c',business_id:'b',media:[{kind:'campaign_distribution',common:{title:'Event',description:'Original'}}]};
function fakeWindow(){global.window={addEventListener(){},removeEventListener(){},confirm:()=>true};}
test('UI loads lazily, keeps draft through token refresh and save failure, and does not double-submit',async()=>{
 fakeWindow();let calls=[],release,lastBody;
 global.fetch=async(url,opts)=>{calls.push(opts.method);if(opts.method==='GET')return {ok:true,json:async()=>({saved:null})};lastBody=JSON.parse(opts.body);return new Promise(resolve=>{release=resolve});};
 const Component=(await load('components/manual-predis.js',{'next/image':{default:p=>React.createElement('img',p)}})).default;
 const props={item,workspaceId:'w',session:{access_token:'one'},businessName:'Venue',enabled:false};
 let r;await React.act(async()=>{r=Renderer.create(React.createElement(Component,props));});
 try{
 assert.equal(calls.length,0);
 await React.act(async()=>r.update(React.createElement(Component,{...props,enabled:true})));assert.deepEqual(calls,['GET']);
 await React.act(async()=>r.root.findByType('textarea').props.onChange({target:{value:'Edited'}}));
 await React.act(async()=>r.update(React.createElement(Component,{...props,enabled:true,session:{access_token:'two'}})));
 assert.equal(r.root.findByType('textarea').props.value,'Edited');assert.equal(calls.length,1);
 const save=()=>r.root.findAllByType('button').find(b=>allText(b)==='Voorbereiding bewaren in Horeca OS').props.onClick();
 let pending;await React.act(async()=>{pending=save();save();});assert.equal(calls.length,2);
 await React.act(async()=>{release({ok:false,json:async()=>({error:'Conflict'})});await pending;});assert.equal(r.root.findByType('textarea').props.value,'Edited');assert.match(allText(r.root.findByProps({role:'alert'})),/Conflict/);
 await React.act(async()=>{pending=save();});
 await React.act(async()=>{release({ok:true,json:async()=>({saved:{revision:'new',draft:lastBody.draft,confirmations:{}}})});await pending;});
 assert.match(allText(r.root),/Bewaard in Horeca OS/);assert.doesNotMatch(allText(r.root),/Niet-bewaarde wijzigingen/);
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
