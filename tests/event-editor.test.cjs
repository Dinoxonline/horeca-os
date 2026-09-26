const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');
const React = require('react');
const Renderer = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname,'..');
async function load(file) {
 await swc.loadBindings();
 function compile(f) {
  const {code}=swc.transformSync(fs.readFileSync(path.join(root,f),'utf8'),{filename:f,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
  const m={exports:{}};
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(name=>name==='next/image'?{__esModule:true,default:p=>React.createElement('img',p)}:name.endsWith('.css')?{__esModule:true,default:new Proxy({},{get:(_,k)=>k})}:name.startsWith('.')?compile(path.join(path.dirname(f),name)+'.js'):require(name),m,m.exports);return m.exports;
 }return compile(file);
}
const row=()=>({id:'i',business_id:'b',body:'Body',updated_at:'v1',media:[{kind:'image',url:'https://example.com/keep.jpg'},{kind:'campaign_distribution',common:{title:'Avond',description:'Beschrijving',start:'2026-10-01T18:00:00Z',end:'2026-10-01T21:00:00Z',location:'Corner',image_url:'https://example.com/main.jpg',images:{square:{url:'https://example.com/square.jpg',width:1080}},ticket:{price:20}},eventin_event_id:'123',facebook_event_delivery:{external_id:'456'},instagram_publications:{feed:{status:'published'}},calendar_channel:{status:'present',event_id:'cal'},manual_predis:{state:'prepared'}}]});
test('base editing changes only chosen fields and preserves links, image metadata, tickets and publication history',async()=>{
 const {prepareEventEdit,eventEditorDraft}=await load('lib/event-editor.js');const item=row();const before=structuredClone(item);const draft=eventEditorDraft(item);
 assert.equal(draft.start,'2026-10-01T20:00');draft.title='Nieuwe avond';draft.image_url='https://example.com/new.jpg';
 const d=prepareEventEdit(item,draft,'now');assert.deepEqual(item,before);assert.equal(d.common.title,draft.title);assert.equal(d.common.start,before.media[1].common.start);assert.deepEqual(d.common.images,before.media[1].common.images);assert.deepEqual(d.common.ticket,{price:20});assert.equal(d.eventin_event_id,'123');assert.deepEqual(d.instagram_publications,before.media[1].instagram_publications);assert.equal(d.calendar_channel.event_id,'cal');assert.equal(d.calendar_channel.status,'needs_check');assert.deepEqual(d.base_edit.fields,['title','image_url']);
});
test('one-off edits protect a recurring occurrence as exception',async()=>{const {prepareEventEdit,eventEditorDraft}=await load('lib/event-editor.js');const r=row();r.media[1].series={id:'series',date:'2026-10-01',exception:false};const d=prepareEventEdit(r,{...eventEditorDraft(r),location:'Plein'},'now');assert.equal(d.series.exception,true);assert.equal(d.series.id,'series');assert.equal(d.series.date,'2026-10-01');});
test('invalid title, dates, ordering and photo protocols fail before saving',async()=>{const {prepareEventEdit,eventEditorDraft}=await load('lib/event-editor.js');const r=row();for(const change of [{title:''},{start:'2026-02-30T20:00'},{end:'2026-10-01T19:00'},{image_url:'javascript:alert(1)'},{square:'http://example.com/a.jpg'},{start:''}])assert.throws(()=>prepareEventEdit(r,{...eventEditorDraft(r),...change},'now'));});
test('date-only records remain date-only and photo clearing preserves all other versions',async()=>{const {prepareEventEdit,eventEditorDraft}=await load('lib/event-editor.js');const r=row();r.media[1].common.start='2026-10-01';r.media[1].common.end='';const draft=eventEditorDraft(r);draft.image_url='';const d=prepareEventEdit(r,draft,'now');assert.equal(d.common.start,'2026-10-01');assert.equal(d.common.image_url,'');assert.deepEqual(d.common.images,r.media[1].common.images);});
test('save uses scoped compare-and-swap, preserves concurrent channel work, and never publishes',async()=>{
 const {saveEventEdit,eventEditorDraft}=await load('lib/event-editor.js');const r=row(),latest=structuredClone(r);latest.updated_at='v2';latest.media[1].instagram_publications.story={status:'published'};let patch,filters;
 const client={from(table){assert.equal(table,'social_content_items');let value;const qs=[];const q={select(){return q;},eq(k,v){qs.push([k,v]);return q;},update(v){value=v;return q;},async maybeSingle(){if(!value)return {data:latest};patch=value;filters=qs;return {data:{id:'i',updated_at:'v3'}};}};return q;}};
 const prev=global.fetch;global.fetch=()=>{throw Error('No external writes permitted');};try{const saved=await saveEventEdit(client,'workspace',r,{...eventEditorDraft(r),title:'Nieuw'});assert.equal(saved.media[1].common.title,'Nieuw');assert.equal(saved.media[1].instagram_publications.story.status,'published');assert.equal(patch.media[0].url,r.media[0].url);assert.deepEqual(filters,[['workspace_id','workspace'],['business_id','b'],['id','i'],['updated_at','v2']]);}finally{global.fetch=prev;}
});
test('concurrent conflicting time edit is rejected rather than overwritten',async()=>{const {saveEventEdit,eventEditorDraft}=await load('lib/event-editor.js');const r=row(),latest=structuredClone(r);latest.media[1].common.start='2026-10-02T19:00';const client={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:latest};},update(){throw Error('must not write');}};return q;}};await assert.rejects(saveEventEdit(client,'w',r,{...eventEditorDraft(r),start:'2026-10-03T20:00',end:'2026-10-03T23:00'}),/intussen gewijzigd/);});
test('editor separates website content, copying is draft-only, failed save retains draft and retry saves once',async()=>{
 const C=(await load('components/event-editor.js')).default,r=row(),w=row();w.id='web';w.media[1].common.title='Website titel';w.media[1].common.image_url='https://example.com/website.jpg';let tree,calls=0,resolve;
 const props={item:r,sources:[{label:'Eventin',item:w}],onSave:async(base,draft)=>{calls++;if(calls===1)throw Error('Opslag mislukt');return new Promise(done=>{resolve=()=>done({...base,media:[base.media[0],{...base.media[1],common:{...base.media[1].common,...draft}}]});});}};
 const btn=name=>tree.root.findAllByType('button').find(b=>b.props.children===name);
 try{await Renderer.act(async()=>{tree=Renderer.create(React.createElement(C,props));});assert.equal(btn('Wijzigingen bewaren in Horeca OS').props.disabled,true);assert.match(JSON.stringify(tree.toJSON()),/website.jpg/);
 await Renderer.act(async()=>btn('Website-tekst overnemen als bewerking').props.onClick());assert.equal(calls,0);assert.equal(tree.root.findAllByType('input')[0].props.value,'Website titel');
 await Renderer.act(async()=>btn('Wijzigingen bewaren in Horeca OS').props.onClick());assert.equal(calls,1);assert.match(JSON.stringify(tree.toJSON()),/Opslag mislukt/);assert.equal(tree.root.findAllByType('input')[0].props.value,'Website titel');
 await Renderer.act(async()=>{tree.update(React.createElement(C,{...props,item:{...r,updated_at:'background'}}));});assert.equal(tree.root.findAllByType('input')[0].props.value,'Website titel');
 await Renderer.act(async()=>{btn('Wijzigingen bewaren in Horeca OS').props.onClick();btn('Wijzigingen bewaren in Horeca OS').props.onClick();});assert.equal(calls,2);await Renderer.act(async()=>resolve());assert.match(JSON.stringify(tree.toJSON()),/Opgeslagen in Horeca OS/);
 }finally{if(tree)await Renderer.act(async()=>tree.unmount());}
});
test('missing or cross-business website data is never substituted with local data',async()=>{const C=(await load('components/event-editor.js')).default;let tree;const w=row();w.business_id='other';try{await Renderer.act(async()=>{tree=Renderer.create(React.createElement(C,{item:row(),sources:[{label:'Eventin',item:w}]}));});assert.match(JSON.stringify(tree.toJSON()),/Geen websitegegevens beschikbaar/);assert.equal(tree.root.findAllByType('button').some(b=>b.props.children==='Website-tekst overnemen als bewerking'),false);}finally{if(tree)await Renderer.act(async()=>tree.unmount());}});
