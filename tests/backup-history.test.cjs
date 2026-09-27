const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),swc=require('next/dist/build/swc');
let helpers,content;
before(async()=>{await swc.loadBindings();helpers=await import('../lib/backup-history.mjs');content=await import('../scripts/backups/runtime/backup-content.mjs');});
function load(file,mocks={}){
 const {code}=swc.transformSync(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{filename:file,jsc:{parser:{syntax:file.endsWith('.ts')?'typescript':'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const module={exports:{}};
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(name=>Object.hasOwn(mocks,name)?{__esModule:true,...mocks[name]}:require(name),module,module.exports);return module.exports;
}
const run='20260927T161811Z-bd93295e';
const prior='20260927T155738Z-352803da';
const check=()=>({run_id:run,compared_to:prior,checked_at:'2026-09-27T16:19:00Z',table_count:2,changes:[{table:'public.quotes',before:22,after:22,state:'changed'}],schema_compared:false});
test('comparison notices edits without count changes and ignores row order',()=>{
 const sql=rows=>`COPY public.quotes (id, title) FROM stdin;\n${rows.join('\n')}\n\\.\n`;
 const a=content.fingerprintCopy(sql(['1\tA','2\tB'])),reordered=content.fingerprintCopy(sql(['2\tB','1\tA']));
 assert.deepEqual(content.compareContent(a,reordered),[]);
 assert.deepEqual(content.fingerprintCopy(sql(['1\tA','2\tB']).replaceAll('\n','\r\n')),a);
 const edited=content.fingerprintCopy(sql(['1\tUpdated','2\tB']));
 assert.deepEqual(content.compareContent(a,edited),[{table:'public.quotes',before:2,after:2,state:'changed'}]);
 assert.equal(content.compareContent(a,content.fingerprintCopy(sql(['1\tA','2\tB','2\tB'])))[0].after,3);
 assert.throws(()=>content.fingerprintCopy('COPY public.q (id) FROM stdin;\n1'));
 assert.throws(()=>content.fingerprintCopy('COPY auth.users (id) FROM stdin;\n\\.\n'));
});
test('new and removed tables are explicit; plain data is not executed',()=>{
 const a=content.fingerprintCopy('COPY public.q (text) FROM stdin;\nDROP SCHEMA public CASCADE;\n\\.\n');
 assert.equal(a['public.q'].rows,1);
 assert.equal(content.compareContent({},a)[0].state,'added');
 assert.equal(content.compareContent(a,{})[0].state,'removed');
});
test('metadata validation rejects extra data, false completeness, bad rows and restore claims',()=>{
 assert.equal(helpers.validateDetail({type:'content',data:check()}).table,'backup_content_checks');
 for(const change of [{schema_compared:true},{compared_to:run},{table_count:-1},{secret:'not allowed'},{changes:[{table:'public.q',before:null,after:1,state:'changed'}]}])assert.throws(()=>helpers.validateDetail({type:'content',data:{...check(),...change}}));
 const d={run_id:run,checked_at:'2026-09-27T16:19:00Z',archive_sha256:'a'.repeat(64),archive_restored:false,local_server_stopped:true,production_touched:false,category:'MANAGED_SCHEMA_MISSING'};
 assert.equal(helpers.validateDetail({type:'restore',data:d}).table,'backup_restore_checks');
 assert.throws(()=>helpers.validateDetail({type:'restore',data:{...d,production_touched:true}}));
 assert.throws(()=>helpers.validateDetail({type:'restore',data:{...d,archive_restored:true}}));
 assert.match(helpers.historySummary(null),/niet vastgelegd/);
 assert.match(helpers.restoreSummary(d),/geblokkeerd/);
});
test('history endpoint refuses unauthorized callers before admin use and invalid pages',async()=>{
 let authorized=false,adminCalls=0;
 const {GET}=load('app/api/backups/history/route.js',{
  'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
  '../../../../lib/backup-owner':{requireBackupOwner:async()=>authorized?{userId:'u'}:{error:'Denied',status:403}},
  '../../../../lib/server-supabase':{createAdminSupabase:()=>{adminCalls++;throw Error('Unexpected');}},
 });
 const req=q=>({nextUrl:new URL('https://test/?'+q)});
 assert.equal((await GET(req('page=0'))).status,403);assert.equal(adminCalls,0);
 authorized=true;
 for(const q of ['page=-1','page=0.5','page=10000000','kind=secrets'])assert.equal((await GET(req(q))).status,400);
 assert.equal(adminCalls,0);
});
for(const scenario of ['missing','expired','aal1','wrong-workspace','member','owner'])test(`history owner guard: ${scenario}`,async()=>{
 let membershipRead=false;
 const workspace='24dfa725-127b-40fa-a278-b744ccb4a1ba';
 const token=`a.${Buffer.from(JSON.stringify({aal:scenario==='aal1'?'aal1':'aal2'})).toString('base64url')}.c`;
 const query={select(){membershipRead=true;return this},eq(){return this},maybeSingle:async()=>({data:{role:scenario==='member'?'member':'owner'}})};
 const {requireBackupOwner}=load('lib/backup-owner.js',{'./backup-status.mjs':{BACKUP_WORKSPACE:workspace},'./server-supabase':{createUserSupabase:()=>({auth:{getUser:async()=>scenario==='expired'?{error:true}:{data:{user:{id:'u'}}}},from:()=>query})}});
 const r=await requireBackupOwner({headers:new Headers(scenario==='missing'?{}:{authorization:`Bearer ${token}`})},scenario==='wrong-workspace'?'other':workspace);
 if(scenario==='owner')assert.equal(r.userId,'u');else assert.equal(r.status,['expired','missing'].includes(scenario)?401:403);
 assert.equal(membershipRead,['member','owner'].includes(scenario));
});
test('history pagination is bounded and never returns receipt secrets',async()=>{
 let range;
 const chain={select(){return this},order(){return this},range(a,b){range=[a,b];return Promise.resolve({count:26,data:[{id:'file',event:{type:'UPDATE',record:{name:'photo.png',bucket_id:'marketing-assets'},secret:'PRIVATE'},receipt:{ok:true,bytes:50,revision:'PRIVATE'},status:'succeeded'}]})}};
 const {GET}=load('app/api/backups/history/route.js',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'../../../../lib/backup-owner':{requireBackupOwner:async()=>({userId:'u'})},'../../../../lib/server-supabase':{createAdminSupabase:()=>({from:()=>chain})}});
 const r=await GET({nextUrl:new URL('https://test/?kind=files&page=1')});
 assert.equal(r.status,200);assert.deepEqual(range,[25,49]);assert.equal(r.body.total,26);assert.equal(r.body.items[0].cloudConfirmed,true);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);assert.match(r.headers['Cache-Control'],/no-store/);
});
test('detail endpoint rejects unauthenticated, oversized and invalid metadata',async()=>{
 let handler,calls=0;const oldDeno=global.Deno,oldFetch=global.fetch,token='a'.repeat(64);
 global.Deno={serve:h=>handler=h,env:{get:n=>n==='BACKUP_REPORT_TOKEN'?token:'test'}};
 global.fetch=async()=>{calls++;return new Response(null,{status:201});};
 try{
  load('supabase/functions/horeca-backup-detail/index.ts',{'../../../lib/backup-history.mjs':helpers});
  assert.equal((await handler(new Request('https://test',{method:'POST',body:'{}'}))).status,401);
  const send=body=>handler(new Request('https://test',{method:'POST',headers:{'x-backup-report-token':token},body}));
  assert.equal((await send('x'.repeat(150001))).status,413);
  assert.equal((await send(JSON.stringify({type:'content',data:{...check(),secret:'private'}}))).status,400);
  assert.equal((await send(JSON.stringify({type:'content',data:check()}))).status,200);assert.equal(calls,1);
 }finally{global.Deno=oldDeno;global.fetch=oldFetch;}
});
test('UI shows real changes, blocks production restore, clears stale data on failure',async()=>{
 const React=require('react'),Renderer=require('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
 const oldFetch=global.fetch;let fail=false,tree;
 global.fetch=async()=>({ok:!fail,json:async()=>fail?{error:'Offline'}:{total:26,items:[{run_id:run,ok:true,copy_verified:true,completed_at:'2026-09-27T16:19:00Z',started_at:'2026-09-27T16:18:00Z',bytes:123,contentCheck:check(),restoreCheck:{category:'MANAGED_SCHEMA_MISSING',local_server_stopped:true}}]}});
 const {default:Component}=load('components/backup-history.js',{'../lib/backup-history.mjs':helpers,'../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}}},'./backup-overview.module.css':{default:new Proxy({},{get:(_,key)=>key})}});
 const button=text=>tree.root.findAllByType('button').find(b=>b.props.children===text);
 try{
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Component,{workspaceId:'w'}));});
  assert.match(JSON.stringify(tree.toJSON()),/1 tabel met gewijzigde inhoud/);
  await Renderer.act(async()=>button('Inhoud en herstel bekijken').props.onClick());
  assert.match(JSON.stringify(tree.toJSON()),/Supabase-onderdelen ontbreken/);
  assert.equal(button('Terugzetten nog niet beschikbaar').props.disabled,true);
  fail=true;await Renderer.act(async()=>button('Lijst vernieuwen').props.onClick());
  assert.match(JSON.stringify(tree.toJSON()),/Offline/);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/Gekozen back-up/);
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=oldFetch;}
});
