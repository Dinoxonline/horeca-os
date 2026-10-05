const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const Renderer = require('react-test-renderer');
const swc = require('next/dist/build/swc');
global.IS_REACT_ACT_ENVIRONMENT = true;
async function component() {
  await swc.loadBindings();
  const filename = path.join(__dirname, '../components/marketing-agenda-navigation.js');
  const { code } = swc.transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
  const module = { exports: {} }; vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(require, module, module.exports); return module.exports.default;
}
const businesses = [{ id: 'b1', name: 'Caribbean Corner' }, { id: 'b2', name: 'Grandcafé Het Plein' }];
function Agenda({ venues }) { const [month, setMonth] = React.useState('september'); return React.createElement('input', { 'aria-label': 'Testmaand', value: month, onChange: e => setMonth(e.target.value), 'data-venues': venues.map(v => v.id).join(',') }); }
function Creator({ business }) { const [title, setTitle] = React.useState(''); return React.createElement('input', { 'aria-label': 'Testtitel', value: title, onChange: e => setTitle(e.target.value), 'data-business': business }); }
function FoodMachine() { return React.createElement('div', { 'aria-label': 'Test Food Marketing Machine' }, 'Gerechten'); }
const props = { businessId: 'all', businesses, renderAgenda: venues => React.createElement(Agenda, { venues }), renderCreator: business => React.createElement(Creator, { business }), renderFoodMachine: () => React.createElement(FoodMachine) };
const click = (renderer, name) => renderer.root.findAllByType('button').find(button => button.props.children === name).props.onClick();
const panel = (renderer, label) => renderer.root.findByProps({ 'aria-label': label });

for (const businessId of ['all', 'b1', 'b2']) test('agenda is the default and remains reachable for ' + businessId, async () => {
  const Component = await component(); let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { ...props, businessId })); });
  try {
    assert.equal(panel(renderer, 'Marketingagenda').props.hidden, false);
    assert.equal(panel(renderer, 'Testmaand').props['data-venues'], businessId === 'all' ? 'b1,b2' : businessId);
    await React.act(async () => click(renderer, 'Evenement of campagne maken'));
    assert.equal(panel(renderer, 'Marketingagenda').props.hidden, true);
    if (businessId === 'all') {
      assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Testtitel' }).length, 0, 'never silently pick a venue');
      await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'b2' } }));
    }
    assert.equal(panel(renderer, 'Testtitel').props['data-business'], businessId === 'all' ? 'b2' : businessId);
    await React.act(async () => click(renderer, 'Agenda'));
    assert.equal(panel(renderer, 'Marketingagenda').props.hidden, false);
    assert.equal(panel(renderer, 'Evenement of campagne maken').props.hidden, true);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('switching views keeps calendar position and unsaved form input without any network writes', async () => {
  const Component = await component(); let renderer, calls = 0;
  global.fetch = async () => { calls++; throw new Error('Navigation must not write'); };
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { ...props, businessId: 'b1' })); });
  try {
    await React.act(async () => panel(renderer, 'Testmaand').props.onChange({ target: { value: 'oktober' } }));
    await React.act(async () => click(renderer, 'Evenement of campagne maken'));
    await React.act(async () => panel(renderer, 'Testtitel').props.onChange({ target: { value: 'Mijn nieuwe evenement' } }));
    await React.act(async () => click(renderer, 'Agenda'));
    assert.equal(panel(renderer, 'Testmaand').props.value, 'oktober');
    await React.act(async () => click(renderer, 'Evenement of campagne maken'));
    assert.equal(panel(renderer, 'Testtitel').props.value, 'Mijn nieuwe evenement');
    assert.equal(calls, 0);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('Food Marketing Machine stays inside Marketing and does not start a campaign', async () => {
  const Component = await component(); let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { ...props, businessId: 'b1' })); });
  try {
    await React.act(async () => click(renderer, 'Food Marketing Machine'));
    assert.equal(panel(renderer, 'Marketingagenda').props.hidden, true);
    assert.equal(panel(renderer, 'Test Food Marketing Machine').props.children, 'Gerechten');
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Testtitel' }).length, 0);
    await React.act(async () => click(renderer, 'Agenda'));
    assert.equal(panel(renderer, 'Marketingagenda').props.hidden, false);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('selected venue filter never turns the agenda into a form or exposes a removed venue', async () => {
  const Component = await component(); let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
  try {
    await React.act(async () => renderer.update(React.createElement(Component, { ...props, businessId: 'b2' })));
    assert.equal(panel(renderer, 'Marketingagenda').props.hidden, false);
    assert.equal(panel(renderer, 'Testmaand').props['data-venues'], 'b2');
    await React.act(async () => click(renderer, 'Evenement of campagne maken'));
    await React.act(async () => renderer.update(React.createElement(Component, { ...props, businessId: 'b2', businesses: [businesses[0]] })));
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Testtitel' }).length, 0);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('agenda waits for the active dossier save, and a failed save keeps the form visible', async () => {
  const C = await component(); let tree, saves=0, fail=true;
  function SavingCreator({ register }) {
    React.useEffect(()=>{register(async()=>{saves++;return !fail;});return ()=>register(null);});
    return React.createElement('p',null,'Dossier');
  }
  try {
    await React.act(async()=>{tree=Renderer.create(React.createElement(C,{...props,businessId:'b1',renderCreator:(b,n,s,o,register)=>React.createElement(SavingCreator,{register})}));});
    await React.act(async()=>click(tree,'Evenement of campagne maken'));
    await React.act(async()=>click(tree,'Agenda'));
    assert.equal(saves,1);assert.equal(panel(tree,'Evenement of campagne maken').props.hidden,false);
    fail=false;
    await React.act(async()=>click(tree,'Agenda'));
    assert.equal(saves,2);assert.equal(panel(tree,'Marketingagenda').props.hidden,false);
  } finally {if(tree)await React.act(async()=>tree.unmount());}
});

test('opening an agenda concept passes the same record and venue to the complete dossier',async()=>{
  const C=await component();let tree,open,received;
  const item={id:'existing-event',business_id:'b2',media:[{kind:'campaign_distribution',common:{title:'Keep me'}}]};
  try{
    await React.act(async()=>{tree=Renderer.create(React.createElement(C,{...props,renderAgenda:(b,d,r,onOpen)=>{open=onOpen;return React.createElement('p',null,'Agenda');},renderCreator:(b,n,s,request)=>{received={business:b,request};return React.createElement('p',null,'Dossier');}}));});
    await React.act(async()=>open(item,'website'));
    assert.equal(received.business,'b2');assert.equal(received.request.item,item);assert.equal(received.request.step,'website');
  }finally{if(tree)await React.act(async()=>tree.unmount());}
});

test('returning from the dossier reopens the same Marketing event', async () => {
  const C = await component(); let tree, openDossier, resumeEvent;
  const item = { id: 'saved-event', business_id: 'b1', media: [{ kind: 'campaign_distribution', common: { title: 'Blijf zichtbaar' } }] };
  try {
    await React.act(async () => { tree = Renderer.create(React.createElement(C, {
      ...props,
      businessId: 'b1',
      renderAgenda: (venues, onPlan, refresh, open, resume) => { openDossier = open; resumeEvent = resume; return React.createElement('p', null, 'Agenda'); },
      renderCreator: (business, request, onSaved, openRequest, registerSave, onContinue) => React.createElement('button', { type: 'button', onClick: () => onContinue({ ...item, title: 'Bewaard dossier' }, 'horeca_os') }, 'Terug naar marketingevenement'),
    })); });
    await React.act(async () => openDossier(item, 'horeca_os'));
    assert.equal(panel(tree, 'Marketingagenda').props.hidden, true);
    await React.act(async () => click(tree, 'Terug naar marketingevenement'));
    assert.equal(panel(tree, 'Marketingagenda').props.hidden, false);
    assert.equal(resumeEvent.id, item.id);
    assert.equal(resumeEvent.requestedChannel, 'horeca_os');
  } finally { if (tree) await React.act(async () => tree.unmount()); }
});
