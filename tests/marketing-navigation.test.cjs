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
const props = { businessId: 'all', businesses, renderAgenda: venues => React.createElement(Agenda, { venues }), renderCreator: business => React.createElement(Creator, { business }) };
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
