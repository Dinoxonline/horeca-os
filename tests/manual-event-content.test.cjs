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
function load(file, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
    filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(
    name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.startsWith('.') ? load(path.join(path.dirname(file), name) + '.js', mocks) : require(name), module, module.exports);
  return module.exports;
}
const base = () => ({ kind: 'campaign_distribution', common: { title: 'Avond', description: 'Tekst\n🎵', start: '2026-10-01' }, eventin_event_id: '123', facebook_event_delivery: { external_id: '456' }, verification: { channels: { facebook: { status: 'reachable' } } } });
const at = '2026-09-24T15:00:00.000Z';

test('content versions invalidate manual confirmations, independently of website and link health', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  const d = base();
  assert.equal(m.contentDeliveryStatus(d, 'facebook').key, 'needs_update');
  const prepared = m.prepareContent(d, m.eventContent(d), at);
  const confirmed = m.confirmFacebookContent(prepared, m.contentSnapshot(prepared, 'facebook'), 'user', at);
  const reopened = JSON.parse(JSON.stringify(confirmed));
  assert.equal(m.contentDeliveryStatus(reopened, 'facebook').key, 'manual_confirmed');
  assert.equal(m.contentDeliveryStatus(reopened, 'website').key, 'needs_update');
  for (const changed of [
    { ...reopened, common: { ...reopened.common, title: 'Andere titel' } },
    { ...reopened, common: { ...reopened.common, description: '' } },
    { ...reopened, facebook_event_delivery: { external_id: '999' } },
  ]) {
    assert.equal(m.contentDeliveryStatus(changed, 'facebook').key, 'needs_update');
    assert.throws(() => m.confirmFacebookContent(changed, m.contentSnapshot(reopened, 'facebook'), 'user', at));
    const next = m.prepareContent(changed, m.eventContent(changed), at);
    assert.equal(m.contentDeliveryStatus(next, 'facebook').key, 'ready');
    assert.equal(next.event_content_delivery.facebook.confirmed_at, undefined);
  }
  assert.equal(m.prepareContent(reopened, m.eventContent(reopened), at).event_content_delivery.facebook.confirmed_at, at);
  assert.throws(() => m.confirmFacebookContent(prepared, m.contentSnapshot(prepared, 'facebook'), '', at));
});

test('native event links cannot be confused with Facebook posts or untrusted URLs', async () => {
  await swc.loadBindings();
  const { facebookEventId } = load('lib/manual-event-content.js');
  assert.equal(facebookEventId({ provider_delivery: { facebook: { external_id: '123_456', permalink: 'https://www.facebook.com/posts/456' } } }), '');
  assert.equal(facebookEventId({ provider_delivery: { facebook: { external_id: '456' } } }), '');
  assert.equal(facebookEventId({ source_url: 'https://www.facebook.com/events/456/?x=1' }), '456');
  assert.equal(facebookEventId({ source_url: 'https://facebook.com.evil.test/events/456/' }), '');
  assert.equal(facebookEventId({ source_url: 'javascript:alert(1)' }), '');
  assert.equal(facebookEventId({ external_ids: { facebook: '456' } }), '456');
});

test('scoped persistence preserves unrelated media and rejects conflicts and denied saves', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  const item = { id: 'i', business_id: 'b', media: [{ kind: 'image', url: 'keep' }, base()] };
  for (const result of [{ data: { id: 'i' } }, { data: null }, { error: new Error('Denied') }]) {
    const filters = [];
    let patch;
    const query = { update(p) { patch = p; return this; }, eq(k, v) { filters.push([k, v]); return this; }, select() { return this; }, maybeSingle: async () => result };
    const save = m.saveEventContent({ from: table => { assert.equal(table, 'social_content_items'); return query; } }, 'w', item, m.prepareContent(base(), { title: 'Nieuw', description: '' }, at), '');
    if (result.data) {
      const saved = await save;
      assert.equal(saved.body, '');
      assert.deepEqual(patch.media[0], item.media[0]);
    } else await assert.rejects(save);
    assert.deepEqual(filters, [['workspace_id', 'w'], ['business_id', 'b'], ['id', 'i'], ['media', JSON.stringify(item.media)]]);
  }
});

test('manual UI requires explicit checkbox, blocks dirty content and handles clipboard failure', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  const Panel = load('components/manual-facebook-update.js').default;
  let distribution = m.prepareContent(base(), m.eventContent(base()), at);
  const confirmations = [], copied = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => copied.push(value) } } });
  let renderer;
  const props = () => ({ distribution, onConfirm: snapshot => confirmations.push(snapshot) });
  await React.act(async () => { renderer = Renderer.create(React.createElement(Panel, props())); });
  const button = text => renderer.root.findAllByType('button').find(b => b.props.children === text);
  try {
    assert.equal(button('Handmatig bijgewerkt').props.disabled, true);
    assert.equal(renderer.root.findByType('a').props.href, 'https://www.facebook.com/events/456/');
    await React.act(async () => button('Titel kopiëren').props.onClick());
    await React.act(async () => button('Beschrijving kopiëren').props.onClick());
    assert.deepEqual(copied, ['Avond', 'Tekst\n🎵']);
    assert.equal(confirmations.length, 0);
    await React.act(async () => renderer.root.findByType('input').props.onChange({ target: { checked: true } }));
    assert.equal(button('Handmatig bijgewerkt').props.disabled, false);
    await React.act(async () => button('Handmatig bijgewerkt').props.onClick());
    assert.equal(confirmations.length, 1);
    await React.act(async () => renderer.update(React.createElement(Panel, { ...props(), dirty: true })));
    assert.equal(button('Handmatig bijgewerkt').props.disabled, true);
    assert.equal(button('Titel kopiëren').props.disabled, true);
    await React.act(async () => renderer.update(React.createElement(Panel, props())));
    assert.equal(renderer.root.findByType('input').props.checked, false);
    global.navigator.clipboard.writeText = async () => { throw new Error('Denied'); };
    await React.act(async () => button('Titel kopiëren').props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /Kopiëren is geblokkeerd/);
    assert.equal(renderer.root.findAllByType('textarea').length, 2);
  } finally {
    await React.act(async () => renderer.unmount());
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator); else delete global.navigator;
  }
});

test('server rejects automatic Facebook event edits without any network or database work', async () => {
  await swc.loadBindings();
  let calls = 0;
  const route = load('app/api/integrations/facebook/events/route.js', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '../../../../../lib/server-supabase': { createUserSupabase: () => { calls++; throw new Error('No DB'); }, createAdminSupabase: () => { calls++; throw new Error('No admin'); } },
    '../../../../../lib/meta-oauth': { decryptMetaToken: () => { calls++; throw new Error('No token'); } },
  });
  const original = global.fetch;
  global.fetch = () => { calls++; throw new Error('No network'); };
  try {
    const result = await route.PATCH(new Request('https://example.test', { method: 'PATCH' }));
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'FACEBOOK_EVENT_MANUAL_ONLY');
    assert.equal(calls, 0);
  } finally { global.fetch = original; }
});

test('a background publication check cannot overwrite a newer manual confirmation', async () => {
  await swc.loadBindings();
  const campaign = { id: 'i', business_id: 'b', media: [{ kind: 'campaign_distribution', common: { title: 'Old' } }] };
  const latestMedia = [{ ...campaign.media[0], common: { title: 'New' }, event_content_delivery: { facebook: { status: 'manual_confirmed', confirmed_at: at } } }];
  let calls = 0;
  const filters = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) }, from() {
    const call = ++calls;
    const query = {
      select() { return this; }, update() { return this; }, limit() { return this; },
      eq(key, value) { if (call === 3) filters.push([key, value]); return this; },
      maybeSingle: async () => ({ data: call === 1 ? campaign : call === 3 ? null : { media: latestMedia } }),
      then: (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject),
    };
    return query;
  } };
  const route = load('app/api/marketing/publication-status/route.js', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '../../../../lib/server-supabase': { createUserSupabase: () => client },
  });
  const result = await route.POST(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify({ workspaceId: 'w', campaignId: 'i' }) }));
  assert.equal(result.status, 200);
  assert.equal(result.body.skipped, 'concurrent_change');
  assert.deepEqual(result.body.media, latestMedia);
  assert.ok(filters.some(([key, value]) => key === 'media' && value === JSON.stringify(campaign.media)));
});
