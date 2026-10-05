const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');
async function load(file) {
  await swc.loadBindings();
  function compile(f) {
    const { code } = swc.transformSync(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), {
      filename: f, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
    });
    const m = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(name => name.startsWith('.') ? compile(path.join(path.dirname(f), name) + '.js') : require(name), m, m.exports);
    return m.exports;
  }
  return compile(file);
}
const snapshot = () => ({ form: {
  title: 'Alleen een naam', description: '', shortDescription: '', start: '', end: '', location: '',
  images: {}, eventinImage: null, imageUrl: '', organizer: '', contactEmail: '', language: 'nl',
  ctaLabel: '', ctaUrl: '', ticketType: 'free', ticketPrice: '', capacity: '', ticketVariations: [],
  channels: {}, facebookText: '', whatsappMessage: '', instagramCaption: '', videoUrl: '',
}, artistProgram: 'Band zoeken', practicalDetails: '25+', creativeBrief: 'Tropisch', sourceText: '', step: 'horeca_os' });
function database(rows = {}) {
  let writes = 0;
  return { rows, get writes() { return writes; }, from(table) {
    assert.equal(table, 'social_content_items');
    let filters = {}, patch, insert;
    const q = { select() { return q; }, eq(k,v) { filters[k] = v; return q; },
      update(value) { patch = value; return q; }, insert(value) { insert = value; return q; },
      async maybeSingle() {
        if (insert) { assert.equal(rows[insert.id], undefined); rows[insert.id] = { ...insert, updated_at: 'v' + ++writes }; return { data: rows[insert.id] }; }
        const row = rows[filters.id];
        if (!row || Object.entries(filters).some(([k,v]) => row[k] !== v)) return { data: null };
        if (patch) { rows[row.id] = { ...row, ...patch, updated_at: 'v' + ++writes }; return { data: rows[row.id] }; }
        return { data: structuredClone(row) };
      } };
    return q;
  } };
}
test('a name-only event saves centrally, resumes and never publishes', async () => {
  const { saveEventDossier, eventDistribution } = await load('lib/event-dossier.js');
  const db = database(), input = { workspaceId:'w', businessId:'b', userId:'u', accountId:'a', id:'i', snapshot:snapshot() };
  const row = await saveEventDossier(db,input);
  assert.equal(row.status,'draft'); assert.equal(eventDistribution(row).common.start,'');
  assert.equal(eventDistribution(row).common.artist_program,'Band zoeken');
  const next = snapshot(); next.form.description = 'Volledige tekst'; next.step = 'website';
  const saved = await saveEventDossier(db,{...input,item:row,snapshot:next});
  assert.equal(saved.id,row.id); assert.equal(Object.keys(db.rows).length,1);
  assert.equal(eventDistribution(saved).common.description,'Volledige tekst');
  assert.equal(eventDistribution(saved).event_workflow.step,'website');
});
test('legacy photo links and metadata survive with original Eventin image and full ticket details', async () => {
  const { dossierDistribution } = await load('lib/event-dossier.js'), input=snapshot();
  input.form.images={square:'https://example.com/s.jpg',portrait:{url:'https://example.com/p.jpg',width:1080,path:'keep'}};
  input.form.eventinImage={url:'https://example.com/original.jpg',path:'original'};
  input.form.ticketVariations=[{id:'early',type:'paid',price:'12.50',capacity:'25',salesStart:'2026-10-01T10:00',maxQuantity:'4'}];
  const value=dossierDistribution(input);
  assert.equal(value.common.images.square.url,'https://example.com/s.jpg');
  assert.equal(value.common.images.portrait.path,'keep'); assert.equal(value.common.image_url,input.form.eventinImage.url);
  assert.deepEqual(value.common.tickets.variations,input.form.ticketVariations);
});
test('editing Horeca OS preserves concurrent channel publication and history', async () => {
  const { saveEventDossier,eventDistribution }=await load('lib/event-dossier.js'), db=database();
  const args={workspaceId:'w',businessId:'b',userId:'u',accountId:'a',id:'i',snapshot:snapshot()};
  const row=await saveEventDossier(db,args);
  db.rows.i.media[0].provider_delivery={whatsapp:{status:'published'}};
  db.rows.i.media[0].manual_predis={state:'prepared'};
  const next=snapshot();next.form.title='Andere naam';
  const saved=await saveEventDossier(db,{...args,item:row,snapshot:next});
  assert.equal(eventDistribution(saved).provider_delivery.whatsapp.status,'published');
  assert.equal(eventDistribution(saved).manual_predis.state,'prepared');
  assert.equal(saved.status,'draft');
});
test('a lost insert response can be recovered by stable id without duplicate',async()=>{
  const { saveEventDossier }=await load('lib/event-dossier.js'),db=database();
  const args={workspaceId:'w',businessId:'b',userId:'u',accountId:'a',id:'i',snapshot:snapshot()};
  await saveEventDossier(db,args);await saveEventDossier(db,args);assert.equal(db.writes,1);
});
test('conflicting edits fail rather than replacing newer event data',async()=>{
  const { saveEventDossier }=await load('lib/event-dossier.js'),db=database();
  const args={workspaceId:'w',businessId:'b',userId:'u',accountId:'a',id:'i',snapshot:snapshot()};
  const row=structuredClone(await saveEventDossier(db,args));
  db.rows.i.media[0].common.title='Someone else changed this';
  const next=snapshot();next.form.title='My edit';
  await assert.rejects(saveEventDossier(db,{...args,item:row,snapshot:next}),/intussen gewijzigd/);
  assert.equal(db.rows.i.media[0].common.title,'Someone else changed this');
});

test('WhatsApp and giveaway preparations flush into the same dossier and survive reopening',async()=>{
  const React=require('react'),Renderer=require('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const usePreparation=(await load('components/use-event-preparation.js')).default;
  const {saveEventDossier,eventDistribution}=await load('lib/event-dossier.js');
  const db=database(),row=await saveEventDossier(db,{workspaceId:'w',businessId:'b',userId:'u',accountId:'a',id:'i',snapshot:snapshot()});
  let flush,tree,saved;
  function Editor({value,item=row,channel='whatsapp'}) {
    const state=usePreparation({client:db,item,workspaceId:'w',channel,value,enabled:true,onSaved:r=>{saved=r;},registerSave:(key,fn)=>{flush=fn;}});
    return React.createElement('p',null,state.notice);
  }
  try{
    await React.act(async()=>{tree=Renderer.create(React.createElement(Editor,{value:{text:'Original',image:'square'}}));});
    await React.act(async()=>tree.update(React.createElement(Editor,{value:{text:'Edited full text',image:'portrait'}})));
    await React.act(async()=>flush());
    assert.equal(eventDistribution(saved).channel_drafts.whatsapp.text,'Edited full text');
    assert.equal(eventDistribution(saved).channel_drafts.whatsapp.image,'portrait');
    await React.act(async()=>tree.unmount());tree=null;
    const reloaded=structuredClone(db.rows.i);
    await React.act(async()=>{tree=Renderer.create(React.createElement(Editor,{item:reloaded,channel:'facebook_giveaway',value:{cards:2,text:'Giveaway'}}));});
    await React.act(async()=>tree.update(React.createElement(Editor,{item:reloaded,channel:'facebook_giveaway',value:{cards:4,text:'Win four'}})));
    await React.act(async()=>flush());
    assert.equal(eventDistribution(saved).channel_drafts.facebook_giveaway.cards,4);
    assert.equal(eventDistribution(saved).channel_drafts.whatsapp.text,'Edited full text');
    assert.equal(saved.status,'draft');
  }finally{if(tree)await React.act(async()=>tree.unmount());}
});
