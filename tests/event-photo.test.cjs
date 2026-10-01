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
test('website photo update keeps the featured image and Eventin banner on the same attachment',async()=>{
 const {publishWebsitePhoto}=await load('lib/event-photo-server.js');const calls=[];let bannerId=10;
 const api=async(p,o)=>{calls.push([p,o]);if(p.includes('/media/'))return {id:99,source_url:'https://website/new.jpg'};if(p.includes('eventin')){if(o?.method==='POST')bannerId=JSON.parse(o.body).event_banner_id;return {id:9440,event_banner_id:bannerId,event_banner:'https://website/new.jpg'};}return {id:9440,featured_media:99};};
 const result=await publishWebsitePhoto({api,eventId:'9440',mediaId:99});assert.deepEqual(JSON.parse(calls[0][1].body),{featured_media:99});assert.equal(JSON.parse(calls[3][1].body).event_banner_id,99);assert.equal(calls.length,6);assert.equal(result.bannerMismatch,false);
 for(const wp of [{id:9440,featured_media:88},{id:999,featured_media:99}]) await assert.rejects(publishWebsitePhoto({api:async p=>p.includes('/media/')?{id:99,source_url:'https://website/new.jpg'}:p.includes('eventin')?{id:9440,event_banner_id:99}:wp,eventId:'9440',mediaId:99}),/controle is niet geslaagd/);
});

test('website preview uses the actual featured attachment and never substitutes an old banner',async()=>{
 const {websitePhotoPreview}=await load('lib/event-photo-server.js');
 const wp={id:9440,featured_media:99}, event={id:9440,event_banner_id:88,event_banner:'https://website/old.jpg'};
 const preview=await websitePhotoPreview(async p=>{assert.equal(p,'/wp-json/wp/v2/media/99');return {id:99,source_url:'https://website/new.jpg'};},wp,event);
 assert.equal(preview.url,'https://website/new.jpg');assert.equal(preview.bannerMismatch,true);
 await assert.rejects(websitePhotoPreview(async()=>({id:88,source_url:event.event_banner}),wp,event));
 const empty=await websitePhotoPreview(async()=>{throw Error('No attachment must be fetched');},{id:9440,featured_media:0},event);
 assert.equal(empty.url,'');
});

test('shared Eventin reader supplies current featured photo to Instagram, never the old banner',async()=>{
 const previous=global.fetch,oldUser=process.env.EVENTIN_USERNAME,oldPass=process.env.EVENTIN_APPLICATION_PASSWORD;
 process.env.EVENTIN_USERNAME='test';process.env.EVENTIN_APPLICATION_PASSWORD='test';
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='workspace_members'?{role:'owner'}:{name:'Caribbean Corner'}})};}};
 const {GET}=await load('app/api/marketing/website-events/create/route.js',{'lib/server-supabase.js':{createUserSupabase:()=>client}});
 const {instagramEventMedia}=await load('lib/instagram-event-media.js');
 try {
  for(const scenario of ['embedded','missing-embed','wrong-embed','media-failure','no-featured','wrong-event']) {
   let mediaReads=0;
   global.fetch=async(url,options={})=>{
    assert.equal(options.method,undefined,'source reader never writes');
    if(url.includes('/wp/v2/media/')){mediaReads++;return scenario==='media-failure'?new Response('',{status:503}):Response.json({id:99,source_url:'https://website.example/new.jpg'});}
    if(url.includes('/eventin/'))return Response.json({id:scenario==='wrong-event'?55:9440,title:'Event',description:'Keep text',event_banner_id:88,event_banner:'https://website/old.jpg'});
    return Response.json({id:9440,featured_media:scenario==='no-featured'?0:99,_embedded:scenario==='embedded'?{'wp:featuredmedia':[{id:99,source_url:'https://website.example/new.jpg'}]}:scenario==='wrong-embed'?{'wp:featuredmedia':[{id:88,source_url:'https://website/old.jpg'}]}:{}});
   };
   const r=await GET(new Request('https://app/api/marketing/website-events/create?workspaceId=w&businessId=b&site=caribbeancorner.nl&eventId=9440&importEvent=1',{headers:{authorization:'Bearer test'}}));
   if(['media-failure','wrong-event'].includes(scenario)){assert.equal(r.status,502,scenario);continue;}
   assert.equal(r.status,200,scenario);const data=await r.json();
   assert.equal(data.event.imageUrl,scenario==='no-featured'?'':'https://website.example/new.jpg',scenario);
   assert.equal(data.event.description,'Keep text');
   assert.equal(mediaReads,['missing-embed','wrong-embed'].includes(scenario)?1:0);
   const item={business_id:'b',media:[]};
   const media=instagramEventMedia(item,[{label:'Eventin',item:{business_id:'b',media:[{kind:'campaign_distribution',common:{image_url:data.event.imageUrl}}]}}]);
   assert.ok(media.every(asset=>!asset.url.includes('old.jpg')));
   assert.equal(media.length,scenario==='no-featured'?0:1);
  }
 } finally {global.fetch=previous;if(oldUser===undefined)delete process.env.EVENTIN_USERNAME;else process.env.EVENTIN_USERNAME=oldUser;if(oldPass===undefined)delete process.env.EVENTIN_APPLICATION_PASSWORD;else process.env.EVENTIN_APPLICATION_PASSWORD=oldPass;}
});

test('a new Horeca OS event uploads its saved image as the actual Eventin banner',async()=>{
 const previous=global.fetch,oldUser=process.env.EVENTIN_CARIBBEAN_USERNAME,oldPass=process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD;
 process.env.EVENTIN_CARIBBEAN_USERNAME='test';process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD='test';
 const jpeg=Buffer.from([255,216,255,224,1,2,3]);let featured=0,banner=0;const writes=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='workspace_members'?{role:'owner'}:{name:'Caribbean Corner'}})};},storage:{from(){return {download:async()=>({data:new Blob([jpeg],{type:'image/jpeg'})})};}}};
 const {POST}=await load('app/api/marketing/website-events/create/route.js',{'lib/server-supabase.js':{createUserSupabase:()=>client}});
 global.fetch=async(url,o={})=>{
  if(o.method==='POST')writes.push([url,JSON.parse(Buffer.isBuffer(o.body)?'{}':o.body)]);
  if(url.endsWith('/wp-json/wp/v2/media'))return Response.json({id:99});
  if(/\/wp-json\/wp\/v2\/media\/99$/.test(url))return Response.json({id:99,source_url:'https://caribbeancorner.nl/banner.jpg'});
  if(/\/wp-json\/wp\/v2\/etn\/9440/.test(url)){if(o.method==='POST')featured=JSON.parse(o.body).featured_media;return Response.json({id:9440,featured_media:featured});}
  if(url.endsWith('/wp-json/eventin/v2/events'))return Response.json({id:9440,link:'https://caribbeancorner.nl/event/test',visibility_status:'draft'});
  if(/\/wp-json\/eventin\/v2\/events\/9440/.test(url)){if(o.method==='POST')banner=JSON.parse(o.body).event_banner_id;return Response.json({id:9440,title:'Test',start_date:'2027-01-01',end_date:'2027-01-01',event_banner_id:banner,event_banner:'https://caribbeancorner.nl/banner.jpg',ticket_variations:[]});}
  throw Error('Unexpected request '+url);
 };
 try {
  const response=await POST(new Request('https://app/api/marketing/website-events/create',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({workspaceId:'workspace',businessId:'business',site:'caribbeancorner.nl',title:'Test',description:'Tekst',start:'2027-01-01T18:00',end:'2027-01-01T22:00',location:'Caribbean Corner',status:'draft',eventinImage:{path:'workspace/business/eventin-test.jpg',url:'https://storage.example/test.jpg'}})}));
  assert.equal(response.status,200,JSON.stringify(await response.json()));assert.equal(featured,99);assert.equal(banner,99);assert.equal(writes.filter(([url])=>url.endsWith('/wp-json/eventin/v2/events/9440')).length,1);
 } finally {global.fetch=previous;if(oldUser===undefined)delete process.env.EVENTIN_CARIBBEAN_USERNAME;else process.env.EVENTIN_CARIBBEAN_USERNAME=oldUser;if(oldPass===undefined)delete process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD;else process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD=oldPass;}
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
 let media=10,banner=10;const externalWrites=[];
 global.fetch=async(url,o={})=>{
  if(url.includes('fbcdn'))return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
  assert.equal(o.redirect,'error');
  if(/\/media\/\d+$/.test(url))return Response.json({id:media,source_url:'https://website/'+media+'.jpg'});
  if(o.method==='POST'){
   externalWrites.push([url,o]);
   if(url.endsWith('/media'))return Response.json({id:99});
   const body=JSON.parse(o.body);
   if(url.includes('eventin')){assert.equal(body.event_banner_id,99);banner=99;return Response.json({id:9440,event_banner_id:banner,event_banner:'https://website/'+banner+'.jpg'});}
   assert.deepEqual(body,{featured_media:99});media=99;return Response.json({id:9440,featured_media:media,modified_gmt:'time'});
  }
  return Response.json(url.includes('eventin')?{id:9440,event_banner_id:banner,event_banner:'https://website/'+banner+'.jpg'}:{id:9440,featured_media:media,modified_gmt:'time'});
 };
 try{const h=await routeHarness();const {preview:fb}=await (await h.call('facebook-preview')).json();await h.call('facebook-import',{hash:fb.hash});
  assert.equal((await h.call('website-publish',{websiteVersion:'old'})).status,400);
  assert.equal((await h.call('website-publish',{websiteVersion:'old',confirmed:true})).status,409);assert.equal(externalWrites.length,0);
  const {preview}=await (await h.call('website-preview')).json();const r=await h.call('website-publish',{websiteVersion:preview.version,confirmed:true});assert.equal(r.status,200,JSON.stringify(await r.json()));assert.equal(externalWrites.length,3);assert.equal(h.row.media[1].event_photo_website.status,'updated');assert.equal(h.row.media[1].common.title,'Keep title');
  assert.equal(h.row.media[1].event_photo_website.bannerMismatch,false);
  h.row.media[1].event_photo_website.status='updating';
  const checked=await (await h.call('website-preview')).json();
  assert.equal(checked.preview.url,'https://website/99.jpg');assert.equal(checked.preview.bannerMismatch,false);
  assert.equal(h.row.media[1].event_photo_website.status,'updated');assert.equal(externalWrites.length,3,'reconcile must not publish');
  assert.equal((await h.call('website-publish',{websiteVersion:checked.preview.version,confirmed:true})).status,200);
  assert.equal(externalWrites.length,3,'retry must not upload or publish an already confirmed attachment');
  media=77;
  await h.call('website-preview');assert.equal(h.row.media[1].event_photo_website.status,'unconfirmed','external photo change must revoke success');
 }finally{global.fetch=previous;if(oldUser===undefined)delete process.env.EVENTIN_USERNAME;else process.env.EVENTIN_USERNAME=oldUser;if(oldPass===undefined)delete process.env.EVENTIN_APPLICATION_PASSWORD;else process.env.EVENTIN_APPLICATION_PASSWORD=oldPass;}
});

test('confirmed photo UI shows the banner warning without offering another publication',async()=>{
 const Component=(await load('components/event-photo-sync.js')).default;
 const item=fixture(),d=item.media[1];
 d.event_photo_import={url:d.common.image_url,hash:'hash'};
 d.event_photo_website={status:'updated',hash:'hash',targetId:'9440',bannerMismatch:true};
 let tree;
 try {
  await Renderer.act(async()=>{tree=Renderer.create(React.createElement(Component,{item,mode:'website'}));});
  const content=JSON.stringify(tree.toJSON());
  assert.match(content,/Opnieuw plaatsen is niet nodig/);assert.match(content,/hoofdfoto en de Eventin-banner zijn nog niet gelijk/);
  assert.equal(tree.root.findAllByType('input').length,0);
  assert.equal(tree.root.findAllByType('button').filter(b=>b.props.children==='Nieuwe foto uit Horeca OS op de website zetten').length,0);
 } finally {if(tree)await Renderer.act(async()=>tree.unmount());}
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
