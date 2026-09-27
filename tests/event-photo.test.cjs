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
 function compile(f) {
  f = f.replaceAll('\\', '/');
  if (mocks[f]) return mocks[f];
  const {code} = swc.transformSync(fs.readFileSync(path.join(root, f),'utf8'), {filename:f,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
  const m={exports:{}};
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(name => name==='next/image'?{__esModule:true,default:p=>React.createElement('img',p)}:name.endsWith('.css')?{__esModule:true,default:new Proxy({},{get:(_,k)=>k})}:name.startsWith('.')?compile(path.join(path.dirname(f),name)+'.js'):require(name),m,m.exports);
  return m.exports;
 } return compile(file);
}
const jpeg = Buffer.from([255,216,255,224,1,2,3]);
const fixture = () => ({id:'item',business_id:'business',updated_at:'v1',body:'KEEP',media:[{kind:'image',url:'https://example.com/keep.png'}, {kind:'campaign_distribution',common:{title:'Keep title',description:'Keep description',image_url:'https://example.com/old.jpg',images:{square:{url:'https://example.com/square.jpg'}},tickets:[{price:25}]},eventin_event_id:'9440',facebook_event_delivery:{external_id:'123'},instagram_publications:{feed:{status:'published'}},series:{id:'series',exception:false}}]});
test('photo URLs reject SSRF targets, deceptive suffixes, credentials and redirects', async()=>{
 const {facebookPhotoUrl,downloadFacebookPhoto}=await load('lib/event-photo-server.js');
 for(const url of ['http://a.fbcdn.net/x','https://fbcdn.net.evil.test/x','https://127.0.0.1/x','https://u:p@a.fbcdn.net/x','https://a.fbcdn.net:8443/x','file:///x']) assert.throws(()=>facebookPhotoUrl(url));
 assert.equal(facebookPhotoUrl('https://a.fbcdn.net/x'),'https://a.fbcdn.net/x');
 await downloadFacebookPhoto('https://a.fbcdn.net/x',async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});});
});
test('photo downloads validate MIME, bytes and streamed size',async()=>{
 const {downloadFacebookPhoto}=await load('lib/event-photo-server.js');
 for(const response of [new Response('<html>',{headers:{'content-type':'image/jpeg'}}),new Response(jpeg,{headers:{'content-type':'image/svg+xml'}}),new Response(jpeg,{headers:{'content-type':'image/jpeg','content-length':String(11*1024*1024)}}),new Response(new Uint8Array(10*1024*1024+1),{headers:{'content-type':'image/jpeg'}})]) await assert.rejects(downloadFacebookPhoto('https://a.fbcdn.net/x',async()=>response));
});
test('import changes only the main photo and protects this series occurrence',async()=>{
 const {importedPhotoDistribution}=await load('lib/event-photo-server.js'), d=fixture().media[1], before=structuredClone(d);
 const next=importedPhotoDistribution(d,{url:'https://store/new.jpg',hash:'hash',path:'p',eventId:'123',at:'now'});
 assert.deepEqual(d,before);assert.equal(next.common.image_url,'https://store/new.jpg');assert.equal(next.event_photo_import.previous_url,d.common.image_url);assert.equal(next.series.exception,true);
 assert.deepEqual(next.common.images,d.common.images);assert.deepEqual(next.common.tickets,d.common.tickets);assert.deepEqual(next.instagram_publications,d.instagram_publications);assert.equal(next.common.title,d.common.title);
});
test('website photo update sends ONLY featured_media and verifies both WordPress and Eventin',async()=>{
 const {publishWebsitePhoto}=await load('lib/event-photo-server.js');const calls=[];
 const api=async(p,o)=>{calls.push([p,o]);return p.includes('eventin')?{id:9440,event_banner_id:'99',event_banner:'https://website/new.jpg'}:{id:9440,featured_media:99};};
 await publishWebsitePhoto({api,eventId:'9440',mediaId:99});assert.deepEqual(JSON.parse(calls[0][1].body),{featured_media:99});assert.equal(calls.length,3);
 await assert.rejects(publishWebsitePhoto({api:async p=>p.includes('eventin')?{id:9440,event_banner_id:88}:{id:9440,featured_media:99},eventId:'9440',mediaId:99}),/controle is niet geslaagd/);
});

async function routeHarness(overrides={}) {
 let row=fixture(), version=1;const writes=[],uploads=[];
 const client={auth:{getUser:async()=>({data:{user:overrides.noUser?null:{id:'owner'}}})},from(table){let patch, filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},update(p){patch=p;return q;},async maybeSingle(){
  if(table==='workspace_members')return {data:{role:overrides.role||'owner'}};
  if(table==='businesses')return {data:{name:'Caribbean Corner'}};
  if(table==='social_content_items'){
   assert.equal(filters.workspace_id,'workspace');assert.equal(filters.business_id,'business');
   if(filters.id==='root')return {data:overrides.root || null};
   assert.equal(filters.id,'item');
   if(overrides.missing)return {data:null};
   if(patch){if(filters.updated_at!==row.updated_at)return {data:null};writes.push(patch);row={...row,...patch,updated_at:'v'+(++version)};return {data:{id:row.id,updated_at:row.updated_at}};}
   return {data:structuredClone(row)};
  }throw Error('Unexpected table '+table);
 }};return q;},storage:{from(){return {upload:async(p,bytes)=>{uploads.push(p);assert.deepEqual(Buffer.from(bytes),jpeg);return {};},getPublicUrl:p=>({data:{publicUrl:'https://storage.example/'+p}}),download:async()=>({data:new Blob([jpeg],{type:'image/jpeg'})})};}}};
 const {POST}=await load('app/api/marketing/event-photo/route.js',{'lib/server-supabase.js':{createUserSupabase:()=>client},'app/api/integrations/facebook/events/route.js':{GET:async()=>Response.json({events:[{id:'123',image:'https://a.fbcdn.net/photo.jpg'}]})}});
 const token='x.'+Buffer.from(JSON.stringify({aal:overrides.aal||'aal2'})).toString('base64url')+'.x';
 return {writes,uploads,get row(){return row;},set row(v){row=v;},async call(action,extra={}){return POST(new Request('https://app/api/marketing/event-photo',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({workspaceId:'workspace',businessId:'business',itemId:'item',action,revision:row.updated_at,...extra})}));}};
}
test('route requires authenticated owner, MFA and scoped existing event before downloading',async()=>{
 for(const override of [{noUser:true},{role:'staff'},{aal:'aal1'},{missing:true}]) {const h=await routeHarness(override);const r=await h.call('facebook-preview');assert.ok(r.status>=400);assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);}
});
test('route previews read-only, imports reviewed hash, preserves content, and rejects stale revision/hash',async()=>{
 const previous=global.fetch;global.fetch=async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
 try{const h=await routeHarness();const before=structuredClone(h.row);const r=await h.call('facebook-preview');assert.equal(r.status,200);const {preview}=await r.json();assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);
 assert.equal((await h.call('facebook-import',{hash:'wrong'})).status,409);assert.equal((await h.call('facebook-import',{hash:preview.hash,revision:'old'})).status,409);
 assert.equal((await h.call('facebook-import',{hash:preview.hash})).status,200);assert.equal(h.uploads.length,1);assert.equal(h.row.media[1].event_photo_import.hash,preview.hash);assert.deepEqual(h.row.media[1].common.images,before.media[1].common.images);assert.deepEqual(h.row.media[0],before.media[0]);assert.equal(h.row.body,before.body);
 assert.equal((await h.call('facebook-import',{hash:preview.hash})).status,200);assert.equal(h.uploads.length,1);
 }finally{global.fetch=previous;}
});
test('merged representatives require matching scoped channel identities, legacy self-links remain editable',async()=>{
 const previous=global.fetch;global.fetch=async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
 try {
  for(const scenario of ['self','matching','missing','different-facebook','different-website']) {
   const root=fixture();root.id='root';if(scenario==='different-facebook')root.media[1].facebook_event_delivery.external_id='999';if(scenario==='different-website')root.media[1].eventin_event_id='999';
   const h=await routeHarness({root:scenario==='missing'?null:root});h.row.media[1].duplicate_of=scenario==='self'?'item':'root';
   const response=await h.call('facebook-preview');assert.equal(response.status,['self','matching'].includes(scenario)?200:409,scenario);assert.equal(h.writes.length,0);
  }
 }finally{global.fetch=previous;}
});
test('website route checks remote version before writes and verifies success without touching text',async()=>{
 const previous=global.fetch, oldUser=process.env.EVENTIN_USERNAME,oldPass=process.env.EVENTIN_APPLICATION_PASSWORD;
 process.env.EVENTIN_USERNAME='test';process.env.EVENTIN_APPLICATION_PASSWORD='test';
 let media=10;const externalWrites=[];
 global.fetch=async(url,o={})=>{
  if(url.includes('fbcdn'))return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
  assert.equal(o.redirect,'error');
  if(o.method==='POST'){externalWrites.push([url,o]);if(url.endsWith('/media'))return Response.json({id:99});assert.deepEqual(JSON.parse(o.body),{featured_media:99});media=99;}
  return Response.json(url.includes('eventin')?{id:9440,event_banner_id:String(media),event_banner:'https://website/'+media+'.jpg'}:{id:9440,featured_media:media,modified_gmt:'time'});
 };
 try{const h=await routeHarness();const {preview:fb}=await (await h.call('facebook-preview')).json();await h.call('facebook-import',{hash:fb.hash});
  assert.equal((await h.call('website-publish',{websiteVersion:'old'})).status,400);
  assert.equal((await h.call('website-publish',{websiteVersion:'old',confirmed:true})).status,409);assert.equal(externalWrites.length,0);
  const {preview}=await (await h.call('website-preview')).json();const r=await h.call('website-publish',{websiteVersion:preview.version,confirmed:true});assert.equal(r.status,200,JSON.stringify(await r.json()));assert.equal(externalWrites.length,2);assert.equal(h.row.media[1].event_photo_website.status,'updated');assert.equal(h.row.media[1].common.title,'Keep title');
 }finally{global.fetch=previous;if(oldUser===undefined)delete process.env.EVENTIN_USERNAME;else process.env.EVENTIN_USERNAME=oldUser;if(oldPass===undefined)delete process.env.EVENTIN_APPLICATION_PASSWORD;else process.env.EVENTIN_APPLICATION_PASSWORD=oldPass;}
});
test('photo UI previews before import, blocks duplicate clicks, and requires website confirmation',async()=>{
 const Component=(await load('components/event-photo-sync.js')).default;
 const prevFetch=global.fetch,prevWindow=global.window;global.window={addEventListener(){},removeEventListener(){}};
 const calls=[];let release;global.fetch=async(_,o)=>{const body=JSON.parse(o.body);calls.push(body);if(body.action==='facebook-preview')return new Promise(resolve=>{release=()=>resolve(Response.json({preview:{url:'https://a.fbcdn.net/new.jpg',hash:'hash'}}));});return Response.json({preview:{url:'https://website/old.jpg',version:'web'}});};
 const item=fixture();item.media[1].event_photo_import={url:item.media[1].common.image_url,hash:'hash'};
 let tree;const button=label=>tree.root.findAllByType('button').find(b=>b.props.children===label);
 try{await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Component,{workspaceId:'workspace',session:{access_token:'token'},item}));});
  assert.equal(button('Deze foto gebruiken'),undefined);
  await Renderer.act(async()=>{button('Actuele Facebookfoto ophalen').props.onClick();button('Actuele Facebookfoto ophalen').props.onClick();});assert.equal(calls.length,1);
  await Renderer.act(async()=>release());assert.ok(button('Deze foto gebruiken'));
  assert.equal(button('Websitefoto controleren'),undefined,'Facebook choice cannot publish to the website');
  await Renderer.act(async()=>tree.update(React.createElement(Component,{workspaceId:'workspace',session:{access_token:'token'},item,mode:'website'})));
  assert.equal(button('Deze foto gebruiken'),undefined,'website stage cannot change the chosen source');
  await Renderer.act(async()=>button('Websitefoto controleren').props.onClick());
  const publish='Nieuwe foto uit Horeca OS op de website zetten';
  assert.equal(button(publish).props.disabled,true);
  const images=tree.root.findAllByType('img');
  assert.equal(images.find(i=>i.props.alt.startsWith('Oude foto')).props.src,'https://website/old.jpg');
  assert.equal(images.find(i=>i.props.alt.startsWith('Nieuwe foto')).props.src,item.media[1].common.image_url);
  await Renderer.act(async()=>tree.root.findByType('input').props.onChange({target:{checked:true}}));assert.equal(button(publish).props.disabled,false);
  await Renderer.act(async()=>button(publish).props.onClick());
  assert.equal(calls.at(-1).action,'website-publish');assert.equal(calls.at(-1).confirmed,true);assert.equal(calls.at(-1).websiteVersion,'web');
  await Renderer.act(async()=>button('Websitefoto controleren').props.onClick());
  await Renderer.act(async()=>tree.root.findByType('input').props.onChange({target:{checked:true}}));
  await Renderer.act(async()=>tree.update(React.createElement(Component,{workspaceId:'workspace',item:{...item,updated_at:'v2'},mode:'website'})));
  assert.equal(button(publish),undefined,'a changed record must invalidate the old website preview and confirmation');
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=prevFetch;global.window=prevWindow;}
});

test('website status reconciliation retains its fresh preview but later changes invalidate it',async()=>{
 const Component=(await load('components/event-photo-sync.js')).default;
 const prevFetch=global.fetch,prevWindow=global.window;
 global.window={addEventListener(){},removeEventListener(){}};
 const original=fixture(), current={...original,updated_at:'reconciled'};
 global.fetch=async()=>Response.json({item:current,preview:{url:'https://website/current.jpg',version:'fresh'}});
 let tree;
 function Harness(){const [item,setItem]=React.useState(original);return React.createElement(Component,{item,mode:'website',onSaved:setItem});}
 try {
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Harness));});
  await Renderer.act(async()=>tree.root.findAllByType('button').find(b=>b.props.children==='Websitefoto controleren').props.onClick());
  assert.equal(tree.root.findAllByType('img').find(i=>i.props.alt.startsWith('Oude foto')).props.src,'https://website/current.jpg');
  assert.equal(tree.root.findByType('input').props.checked,false);
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());global.fetch=prevFetch;global.window=prevWindow;}
});
