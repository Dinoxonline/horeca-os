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
  const cache = new Map();
  function compile(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), { filename: relative, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) } : name.startsWith('.') ? compile(path.join(path.dirname(relative), name) + '.js') : require(name), module, module.exports);
    cache.set(relative, module.exports); return module.exports;
  }
  return compile(file);
}
const venues = new Map([['b', { name: 'Caribbean Corner' }]]);
function campaign(entries, confirmations = {}, extra = {}) {
  return { id: 'event-1', business_id: 'b', ...extra, media: [{ kind: 'campaign_distribution', common: { title: 'Live muziek', start: '2026-09-01T18:00' }, manual_predis: { draft: { entries }, confirmations } }] };
}
const entry = (at = '2026-10-07T10:00', channel = 'facebook') => ({ at, channel, key: `${at}|${channel}` });
const text = renderer => JSON.stringify(renderer.toJSON());

test('events are the default; message dates stay separate and toggling never changes saved data', async () => {
  const { calendarContentItems: select } = await load('lib/marketing-calendar-view.js');
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const parent = campaign([entry('2026-09-28T10:00')]);
  parent.media[0].common.start = '2026-10-01T18:00';
  const events = [parent], publications = derive(events, venues), before = JSON.stringify({ events, publications });
  assert.deepEqual(select(events, publications), events);
  assert.deepEqual(select(events, publications, 'events'), events);
  assert.deepEqual(select(events, publications, 'publications'), publications);
  assert.deepEqual(select(events, publications, 'both'), [...events, ...publications]);
  assert.equal(select(events, publications).filter(i => i.media[0].common.start.startsWith('2026-09-28')).length, 0);
  assert.equal(select(events, publications, 'publications')[0].media[0].common.start, '2026-09-28T10:00');
  assert.deepEqual(select([], publications), []);
  assert.deepEqual(select(events, [], 'publications'), []);
  assert.equal(JSON.stringify({ events, publications }), before);
});

test('agenda selector changes each view with an accessible selected state and explanation', async () => {
  const { CalendarContentSelector } = await calendarComponents();
  function Harness() {
    const [view, setView] = React.useState('events');
    return React.createElement(CalendarContentSelector, { value: view, onChange: setView });
  }
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Harness)); });
  try {
    const buttons = () => renderer.root.findByProps({ 'aria-label': 'Agenda-inhoud kiezen' }).findAllByType('button');
    assert.deepEqual(buttons().map(b => b.props.children), ['Evenementen', 'Berichtenplanning', 'Beide']);
    assert.equal(buttons()[0].props['aria-pressed'], true);
    for (const index of [1, 2, 0]) {
      await React.act(async () => buttons()[index].props.onClick());
      assert.deepEqual(buttons().map(b => b.props['aria-pressed']), [0, 1, 2].map(i => i === index));
      assert.ok(renderer.root.findByProps({ role: 'status' }).props.children.length);
    }
  } finally { await React.act(async () => renderer.unmount()); }
});

test('separate channel/moment cards keep past parent events and correct venue without modifying records', async () => {
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const parent = campaign([entry(), entry(undefined, 'instagram'), entry('2026-09-27T09:00'), entry('2026-10-08T11:00', 'google')]);
  const before = JSON.stringify(parent);
  const result = derive([parent, parent, campaign([entry()], {}, { id: 'other', business_id: 'other' })], venues);
  assert.equal(result.length, 4); assert.equal(new Set(result.map(r => r.id)).size, 4);
  assert.equal(result[0].publication.at, '2026-09-27T09:00');
  assert.ok(result.every(r => r.business_id === 'b' && r.publication.parent === parent));
  assert.equal(result[1].media[0].common.start, '2026-10-07T10:00');
  assert.equal(JSON.stringify(parent), before);
  assert.equal(derive([parent], new Map()).length, 0);
});

test('only explicit confirmation creates scheduled/published status; invalid and duplicate entries are ignored', async () => {
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const entries = [entry('2020-01-01T00:15'), entry(undefined, 'instagram'), entry(undefined, 'google'), entry(), entry(), entry('2026-02-30T10:00'), entry(undefined, 'unknown'), null];
  const parent = campaign(entries, { [entries[1].key]: { state: 'scheduled' }, [entries[2].key]: { state: 'published' }, [entries[3].key]: { state: 'confirmed' } });
  const result = derive([parent], venues);
  assert.equal(result.length, 4);
  assert.equal(result[0].publication.state, 'pending');
  assert.match(result[0].publication.label, /nog niet verstuurd/);
  for (const row of result.filter(r => r.publication.state !== 'pending')) assert.match(row.publication.label, /handmatig bevestigd/);
  parent.media[0].manual_predis.draft.entries = [];
  assert.deepEqual(derive([parent], venues), []);
});

test('Dutch midnight and winter/summer dates are retained without UTC conversion', async () => {
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const entries = [entry('2026-10-25T00:15'), entry('2026-10-26T00:15'), entry('2026-03-29T00:15')];
  const result = derive([campaign(entries)], venues);
  assert.deepEqual(result.map(r => r.media[0].common.start).sort(), entries.map(e => e.at).sort());
});

async function calendarComponents() {
  const noop = { default: () => null };
  return load('components/marketing-overview.js', {
    '../lib/supabase': { supabase: {} }, './manual-facebook-update': noop, './instagram-event-publisher': noop,
    './predis-workspace': noop, './event-calendar': noop, './event-series': noop, './event-editor': noop,
    './event-photo-sync': { ...noop, EventPhoto: () => null }, './marketing-worklist': noop,
  });
}
test('publication card names time/channel/status and opens original event without network calls', async () => {
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const { CalendarEvent } = await calendarComponents();
  const parent = campaign([entry()]), item = derive([parent], venues)[0];
  let chosen, renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(CalendarEvent, { item, onSelectEvent: value => { chosen = value; } })); });
  try {
    assert.match(text(renderer), /10:00/); assert.match(text(renderer), /Facebook/); assert.match(text(renderer), /nog niet verstuurd/);
    await React.act(async () => renderer.root.findByType('button').props.onClick());
    assert.equal(chosen.id, parent.id); assert.equal(chosen.requestedChannel, 'predis');
    assert.equal(chosen.media, parent.media); assert.equal(chosen.publication, undefined);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('year view lets the user open every publication on a day, not only the first', async () => {
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const { YearCalendar } = await calendarComponents();
  const parent = campaign([entry(), entry(undefined, 'instagram')]);
  const items = derive([parent], venues); let renderer, chosen;
  await React.act(async () => { renderer = Renderer.create(React.createElement(YearCalendar, { anchor: new Date(2026, 9, 1), items, onSelectEvent: value => { chosen = value; } })); });
  try {
    const day = renderer.root.findAllByType('button').find(b => b.props['aria-label']?.endsWith('2 items'));
    await React.act(async () => day.props.onClick());
    const list = renderer.root.findByProps({ 'aria-label': 'Gekozen dag' });
    assert.equal(list.findAllByType('button').length, 2);
    await React.act(async () => list.findAllByType('button')[1].props.onClick());
    assert.equal(chosen.id, parent.id); assert.equal(chosen.requestedChannel, 'predis');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('both publication and event open creation choices; old manual preparation stays explicitly available', async () => {
  const Workspace = (await load('components/predis-workspace.js', { './manual-predis': { default: props => React.createElement('div', { 'data-preparation': props.item.id }) }, './predis-content': { default: () => null } })).default;
  for (const fromCalendar of [true, false]) {
    let renderer;
    await React.act(async () => { renderer = Renderer.create(React.createElement(Workspace, { item: { id: 'event-1', requestedChannel: fromCalendar ? 'predis' : undefined } })); });
    try {
      assert.equal(renderer.root.findAllByProps({ 'data-preparation': 'event-1' }).length, 0);
      assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Predis-werkwijze kiezen' }).length, 1);
      const manual = renderer.root.findAllByType('button').find(button => button.props.children === 'Eigen foto en tekst / eerdere planning');
      await React.act(async () => manual.props.onClick());
      assert.equal(renderer.root.findAllByProps({ 'data-preparation': 'event-1' }).length, 1);
    }
    finally { await React.act(async () => renderer.unmount()); }
  }
});

test('month and week place publications on their own date, retaining the event date', async () => {
  const { publicationCalendarItems: derive } = await load('lib/marketing-publications.js');
  const { MonthCalendar, WeekCalendar } = await calendarComponents();
  const parent = campaign([entry()]);
  parent.media[0].common.start = '2026-10-09T18:00';
  const items = [parent, ...derive([parent], venues)];
  for (const Component of [MonthCalendar, WeekCalendar]) {
    let renderer;
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { anchor: new Date(2026, 9, 7), items, businessById: venues, onSelectEvent: () => {} })); });
    try {
      const buttons = renderer.root.findAllByType('button');
      assert.equal(buttons.length, 2);
      const publication = buttons.find(b => b.props.title.startsWith('Publicatiemoment'));
      const event = buttons.find(b => !b.props.title.startsWith('Publicatiemoment'));
      function cell(node) { while (node && !/marketingDayCell|marketingWeekColumn(?: |$)/.test(node.props.className || '')) node = node.parent; return node; }
      const publicationCell = cell(publication), eventCell = cell(event);
      assert.ok(publicationCell); assert.ok(eventCell);
      assert.notEqual(publicationCell, eventCell);
      if (Component === MonthCalendar) { assert.equal(publicationCell.findAllByType('strong')[0].props.children.at(-1), 7); assert.equal(eventCell.findAllByType('strong')[0].props.children.at(-1), 9); }
      assert.match(publication.props.title, /2026-10-07 10:00/);
      assert.equal(parent.media[0].common.start, '2026-10-09T18:00');
    } finally { await React.act(async () => renderer.unmount()); }
  }
});
