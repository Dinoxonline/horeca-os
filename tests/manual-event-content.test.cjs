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

// Exercise the private date readers used by the Eventin detail response.
function eventinDateReaders() {
  const source = fs.readFileSync(path.join(root, 'app/api/marketing/website-events/create/route.js'), 'utf8');
  return vm.runInNewContext(`(() => {
    ${source.slice(source.indexOf('function eventinValue('), source.indexOf('function eventinLocation('))}
    ${source.slice(source.indexOf('function normalizedEventinDate('), source.indexOf('function imageFromContent('))}
    return { normalizedEventinDate, eventinDateTime };
  })()`);
}

test('Eventin date reader preserves every day, including both digits of 26 September', () => {
  const { normalizedEventinDate } = eventinDateReaders();
  for (let month = 1; month <= 12; month++) {
    const days = new Date(Date.UTC(2026, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const expected = `2026-${mm}-${dd}`;
      for (const separator of ['-', '/', '.']) {
        for (const input of [`2026${separator}${mm}${separator}${dd}`, `2026${separator}${month}${separator}${day}`, `${dd}${separator}${mm}${separator}2026`]) {
          assert.equal(normalizedEventinDate(input), expected, input);
        }
      }
      assert.equal(normalizedEventinDate(`${expected}T19:00:00+02:00`), expected);
      assert.equal(normalizedEventinDate(`${expected} 19:00:00`), expected);
    }
  }
});

test('Eventin start, end and ticket-sale dates retain their day and time', () => {
  const { eventinDateTime, normalizedEventinDate } = eventinDateReaders();
  assert.equal(eventinDateTime({ start_date: '2026-09-26', start_time: '7:00 PM' }, 'start'), '2026-09-26T19:00');
  assert.equal(eventinDateTime({ end_date: '2026-09-27', end_time: '01:00' }, 'end'), '2026-09-27T01:00');
  assert.equal(eventinDateTime({ meta: { etn_start_date: { value: '2026-09-26' }, etn_start_time: '19:00' } }, 'start'), '2026-09-26T19:00');
  assert.equal(normalizedEventinDate(''), '');
  assert.equal(normalizedEventinDate('not-a-date'), '');
});

for (const failure of ['', 'first', 'second', 'zero']) test(`local merge verifies both saves and never publishes: ${failure || 'success'}`, async () => {
  await swc.loadBindings();
  const { saveLocalEventMerge } = load('lib/local-event-merge.js');
  const keep = { id: 'keep', business_id: 'b', updated_at: at, media: [{ kind: 'photo', url: '/unchanged.jpg' }, base()] };
  const duplicate = { id: 'duplicate', business_id: 'b', updated_at: at, media: [base()] };
  const merged = { ...base(), common: { ...base().common, title: 'Chosen title' } };
  const writes = [];
  const client = { from(table) {
    assert.equal(table, 'social_content_items');
    const write = { filters: [] };
    const query = { update(value) { write.value = value; return query; }, eq(key, value) { write.filters.push([key, value]); return query; }, select() { return query; }, async maybeSingle() {
      const id = write.filters.find(([key]) => key === 'id')[1];
      if (!write.value) return { data: structuredClone(id === 'keep' ? keep : duplicate) };
      writes.push(write);
      if ((failure === 'first' && writes.length === 1) || (failure === 'second' && writes.length === 2)) return { error: new Error('Database failure') };
      if (failure === 'zero') return { data: null };
      return { data: { id, updated_at: at } };
    } };
    return query;
  } };
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Publishing is forbidden during local merge'); };
  try {
    if (failure) await assert.rejects(saveLocalEventMerge(client, 'w', keep, duplicate, merged), error => {
      assert.match(error.message, /Website en Facebook zijn niet gewijzigd/);
      if (failure === 'second') {
        assert.match(error.message, /gekozen tekst is opgeslagen/);
        assert.equal(error.savedItem.media[1].common.title, 'Chosen title');
      } else assert.equal(error.savedItem, undefined);
      return true;
    });
    else {
      const saved = await saveLocalEventMerge(client, 'w', keep, duplicate, merged);
      assert.equal(saved.id, keep.id);
      assert.deepEqual(saved.media[0], keep.media[0], 'unrelated artwork is preserved');
      assert.equal(saved.media[1].common.title, 'Chosen title');
    }
    assert.equal(writes.length, failure === 'zero' ? 3 : failure === 'first' ? 1 : 2);
    assert.deepEqual(writes[0].filters, [['workspace_id', 'w'], ['business_id', 'b'], ['id', 'keep'], ['updated_at', at]]);
    assert.equal(writes[0].value.media[1].duplicate_of, undefined, 'retained text is saved before hiding another item');
    if (writes[1] && failure !== 'zero') {
      assert.equal(writes[1].value.media[0].duplicate_of, 'keep');
      assert.deepEqual(writes[1].filters, [['workspace_id', 'w'], ['business_id', 'b'], ['id', 'duplicate'], ['updated_at', at]]);
    }
    const count = writes.length;
    await assert.rejects(saveLocalEventMerge(client, 'w', keep, { ...duplicate, business_id: 'other' }, merged), /dezelfde vestiging/);
    await assert.rejects(saveLocalEventMerge(client, 'w', keep, keep, merged), /verschillende agendapunten/);
    assert.equal(writes.length, count);
  } finally { global.fetch = originalFetch; }
});

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

function storageHarness(initial, { miss = 0, denied = false, readError = false, onMiss } = {}) {
  let row = structuredClone(initial);
  const reads = [], writes = [];
  const client = { from(table) {
    assert.equal(table, 'social_content_items');
    let patch;
    const filters = [];
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      update(value) { patch = value; return query; },
      async maybeSingle() {
        const scope = [['workspace_id', 'w'], ['business_id', 'b'], ['id', 'i']];
        if (!patch) {
          reads.push(filters);
          assert.deepEqual(filters, scope);
          return readError ? { error: new Error('Denied read') } : { data: structuredClone(row) };
        }
        writes.push({ patch, filters });
        assert.deepEqual(filters, [...scope, ['updated_at', row.updated_at]]);
        assert.ok(filters.every(([key]) => key !== 'media'), 'large media never becomes a URL filter');
        if (denied) return { error: new Error('Denied') };
        if (writes.length <= miss) {
          row.updated_at = '2026-09-25T09:12:23.123' + writes.length + '56+00:00';
          onMiss?.(row);
          return { data: null };
        }
        row = { ...row, ...patch, updated_at: '2026-09-25T09:13:00.654321+00:00' };
        return { data: { id: row.id, updated_at: row.updated_at } };
      },
    };
    return query;
  } };
  return { client, reads, writes, row: () => row };
}
const storageItem = () => ({ id: 'i', business_id: 'b', body: 'old', updated_at: '2026-09-25T09:12:23.123456+00:00', media: [{ kind: 'image', url: 'keep' }, base()] });

test('short versioned save preserves large media, exact timestamps and concurrent unrelated fields', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  const item = storageItem(), latest = structuredClone(item);
  latest.media.push({ kind: 'image', url: 'new-photo', metadata: 'x'.repeat(100000) });
  latest.media[1].instagram_publications = [{ status: 'published', permalink: 'keep-live-post' }];
  latest.media[1].verification.checked_at = 'new-check';
  const db = storageHarness(latest);
  const saved = await m.saveEventContent(db.client, 'w', item, m.prepareContent(item.media[1], { title: 'Nieuw', description: '' }, at), '');
  assert.equal(saved.body, '');
  assert.equal(saved.media[1].common.title, 'Nieuw');
  assert.deepEqual(saved.media[0], latest.media[0]);
  assert.deepEqual(saved.media[2], latest.media[2]);
  assert.deepEqual(saved.media[1].instagram_publications, latest.media[1].instagram_publications);
  assert.deepEqual(saved.media[1].verification, latest.media[1].verification);
  assert.equal(db.writes.length, 1);
  assert.equal(saved.updated_at, db.row().updated_at);
});

test('version races retry boundedly and preserve changes that arrived after the read', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js'), item = storageItem();
  for (const miss of [1, 3]) {
    const db = storageHarness(item, { miss, onMiss: row => { row.media[1].instagram_publications = ['still-published']; } });
    const save = m.saveEventContent(db.client, 'w', item, m.prepareContent(item.media[1], { title: 'Nieuw', description: 'new' }, at), 'new');
    if (miss === 3) await assert.rejects(save, /intussen gewijzigd/);
    else assert.deepEqual((await save).media[1].instagram_publications, ['still-published']);
    assert.equal(db.writes.length, miss === 3 ? 3 : 2);
  }
});

test('content, destination and body conflicts fail closed without a write', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  for (const mutate of [
    row => { row.media[1].common.title = 'Someone else'; },
    row => { row.media[1].common.description = 'Other description'; },
    row => { row.media[1].eventin_event_id = '999'; },
    row => { row.media[1].facebook_event_delivery.external_id = '999'; },
    row => { row.media[1].duplicate_of = 'merged'; },
    row => { row.body = 'Someone else'; },
    row => { delete row.updated_at; },
    row => { row.media.push(base()); },
    row => { row.business_id = 'other'; },
  ]) {
    const item = storageItem(), latest = structuredClone(item);
    mutate(latest);
    const db = storageHarness(latest);
    await assert.rejects(m.saveEventContent(db.client, 'w', item, m.prepareContent(item.media[1], { title: 'Nieuw', description: 'new' }, at), 'new'), /intussen gewijzigd/);
    assert.equal(db.writes.length, 0);
  }
});

test('read denial, write denial and concurrent changes to the same delivery are not overwritten', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  for (const options of [{ readError: true }, { denied: true }]) {
    const item = storageItem(), db = storageHarness(item, options);
    await assert.rejects(m.saveEventContent(db.client, 'w', item, m.prepareContent(item.media[1], { title: 'Nieuw', description: 'new' }, at)), /niet worden gecontroleerd|mislukt/);
    assert.equal(db.writes.length, options.readError ? 0 : 1);
    assert.equal(db.row().media[1].common.title, 'Avond');
  }
  const item = storageItem();
  item.media[1].event_content_delivery = { facebook: { status: 'ready' } };
  const latest = structuredClone(item);
  latest.media[1].event_content_delivery.facebook.status = 'manual_confirmed';
  const desired = structuredClone(item.media[1]);
  desired.event_content_delivery.facebook.status = 'failed';
  const db = storageHarness(latest);
  await assert.rejects(m.saveEventContent(db.client, 'w', item, desired), /intussen gewijzigd/);
  assert.equal(db.writes.length, 0);
});

test('JSON key order does not create a false concurrent-content conflict', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js'), item = storageItem();
  const latest = structuredClone(item);
  latest.media[1].common = Object.fromEntries(Object.entries(latest.media[1].common).reverse());
  const db = storageHarness(latest);
  const saved = await m.saveEventContent(db.client, 'w', item, m.prepareContent(item.media[1], { title: 'Nieuw', description: 'new' }, at));
  assert.equal(saved.media[1].common.title, 'Nieuw');
});

test('real Supabase query builder sends a short scoped PATCH URL with large media only in its body', async () => {
  await swc.loadBindings();
  const { createClient } = require('@supabase/supabase-js');
  const { saveEventContent, prepareContent } = load('lib/manual-event-content.js');
  const item = storageItem();
  item.media.push({ kind: 'image', metadata: 'x'.repeat(100000) });
  const requests = [];
  const client = createClient('https://database.example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify(options.method === 'PATCH' ? { id: item.id, updated_at: at } : item), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await saveEventContent(client, 'w', item, prepareContent(item.media[1], { title: 'Nieuw', description: 'new' }, at), 'new');
  assert.equal(requests.length, 2);
  const patch = requests[1], url = new URL(patch.url);
  assert.equal(patch.options.method, 'PATCH');
  assert.ok(patch.url.length < 500);
  assert.equal(url.searchParams.get('updated_at'), 'eq.' + item.updated_at);
  assert.equal(url.searchParams.get('workspace_id'), 'eq.w');
  assert.equal(url.searchParams.get('business_id'), 'eq.b');
  assert.equal(url.searchParams.get('id'), 'eq.i');
  assert.equal(url.searchParams.has('media'), false);
  assert.equal(JSON.parse(patch.options.body).media[2].metadata.length, 100000);
});

test('legacy delivery IDs become event links only after an exact successful event comparison', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  const d = { ...base(), facebook_event_delivery: undefined, provider_delivery: { facebook: { external_id: '456' } } };
  const validSource = [{ label: 'Facebook', item: { id: 'compare:facebook:456' } }];
  assert.equal(m.facebookEventId(m.withVerifiedFacebookEvent(d, [])), '');
  assert.equal(m.facebookEventId(m.withVerifiedFacebookEvent(d, [{ label: 'Facebook', item: { id: 'compare:facebook:789' } }])), '');
  const linked = m.withVerifiedFacebookEvent(d, validSource);
  assert.equal(m.facebookEventId(linked), '456');
  const prepared = m.prepareContent(linked, m.eventContent(linked), at);
  const confirmed = m.confirmFacebookContent(prepared, m.contentSnapshot(prepared, 'facebook'), 'u', at);
  assert.equal(m.contentDeliveryStatus(JSON.parse(JSON.stringify(confirmed)), 'facebook').key, 'manual_confirmed');
  assert.equal(d.facebook_event_delivery, undefined, 'comparison alone does not mutate stored data');
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
    assert.ok(renderer.root.findAllByType('a').every(a => a.props.href === 'https://www.facebook.com/events/456/'));
    await React.act(async () => button('Titel kopiëren').props.onClick());
    assert.ok(renderer.root.findAllByProps({ role: 'status' }).some(node => node.props.children === 'Titel gekopieerd'));
    await React.act(async () => button('Beschrijving kopiëren').props.onClick());
    assert.ok(renderer.root.findAllByProps({ role: 'status' }).some(node => node.props.children === 'Beschrijving gekopieerd'));
    assert.equal(renderer.root.findAllByProps({ role: 'status' }).some(node => node.props.children === 'Titel gekopieerd'), false);
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

test('event workspace opens a secure compact window only on click, with fallback and unchanged confirmation', async () => {
  await swc.loadBindings();
  const m = load('lib/manual-event-content.js');
  const Panel = load('components/manual-facebook-update.js').default;
  const originalWindow = global.window;
  const opened = [], saves = [], choices = [], confirmations = [];
  global.window = { screen: { availWidth: 1920, availHeight: 1080 }, open: (...args) => { opened.push(args); return null; } };
  const distribution = m.prepareContent(base(), m.eventContent(base()), at);
  const source = { label: 'Eventin', item: { id: 'existing' } };
  const props = { distribution, sources: [source], onChooseSource: value => choices.push(value), onSave: value => saves.push(value), onConfirm: value => confirmations.push(value) };
  let renderer;
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Panel, props)); });
    const button = text => renderer.root.findAllByType('button').find(b => b.props.children === text);
    const link = () => renderer.root.findAllByType('a').find(a => a.props.onClick);
    assert.equal(opened.length, 0, 'mount must not open Facebook');
    assert.equal(button('Tekst bewaren in Horeca OS').props.disabled, true);
    let prevented = false;
    await React.act(async () => link().props.onClick({ button: 0, preventDefault() { prevented = true; } }));
    assert.equal(prevented, true);
    assert.deepEqual(opened[0], ['https://www.facebook.com/events/456/', '_blank', 'popup=yes,width=760,height=900,left=1160,top=0,noopener,noreferrer']);
    assert.match(JSON.stringify(renderer.toJSON()), /Geen Facebook-venster verschenen/);
    assert.equal(button('Handmatig bijgewerkt').props.disabled, true);
    assert.equal(confirmations.length, 0);
    assert.equal(saves.length, 0);
    await React.act(async () => link().props.onClick({ ctrlKey: true, preventDefault() { throw new Error('modified click intercepted'); } }));
    assert.equal(opened.length, 1);
    global.window.open = () => { throw new Error('Blocked'); };
    await React.act(async () => link().props.onClick({ button: 0, preventDefault() {} }));
    assert.match(JSON.stringify(renderer.toJSON()), /kon niet worden geopend/);
    assert.equal(renderer.root.findAllByType('a').find(a => !a.props.onClick).props.target, '_blank');
    await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'Eventin' } }));
    assert.deepEqual(choices, [source]);
    await React.act(async () => renderer.update(React.createElement(Panel, { ...props, draftContent: { label: 'Eventin', title: 'Nieuw', description: 'Andere tekst' }, dirty: true })));
    assert.equal(renderer.root.findAllByType('textarea')[0].props.value, 'Nieuw');
    assert.equal(button('Titel kopiëren').props.disabled, true);
    await React.act(async () => button('Tekst bewaren in Horeca OS').props.onClick());
    assert.deepEqual(saves, [{ title: 'Nieuw', description: 'Andere tekst' }]);
    assert.equal(confirmations.length, 0);
  } finally {
    if (renderer) await React.act(async () => renderer.unmount());
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
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

for (const scenario of ['event', 'post', 'not-found', 'failed']) test('startup verification persists only an exact native Facebook event: ' + scenario, async () => {
  await swc.loadBindings();
  const campaign = { id: 'i', business_id: 'b', media: [{ kind: 'campaign_distribution', provider_delivery: { facebook: { external_id: scenario === 'post' ? '123_456' : '456' } }, common: { title: 'Keep', description: 'Keep text' } }] };
  let patch, calls = 0;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) }, from() {
    const call = ++calls;
    return { select() { return this; }, update(value) { patch = value; return this; }, eq() { return this; }, limit() { return this; },
      maybeSingle: async () => ({ data: call === 1 ? campaign : { id: 'i' } }),
      then: (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject) };
  } };
  const originalFetch = global.fetch;
  let reads = 0;
  global.fetch = async (url, options) => { reads++; assert.match(String(url), /\/api\/integrations\/facebook\/events/); assert.equal(options.method, undefined); return { ok: scenario !== 'failed', status: 503, json: async () => ({ events: scenario === 'event' ? [{ id: '456' }] : scenario === 'post' ? [{ id: '123_456' }] : [] }) }; };
  try {
    const route = load('app/api/marketing/publication-status/route.js', {
      'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
      '../../../../lib/server-supabase': { createUserSupabase: () => client },
    });
    const result = await route.POST(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify({ workspaceId: 'w', campaignId: 'i' }) }));
    assert.equal(result.status, 200);
    assert.equal(reads, 1, 'no additional Facebook request for storing the link');
    assert.deepEqual(patch.media[0].common, campaign.media[0].common);
    if (scenario === 'event') {
      assert.equal(patch.media[0].facebook_event_delivery.external_id, '456');
      assert.equal(patch.media[0].facebook_event_delivery.permalink, 'https://www.facebook.com/events/456/');
      assert.equal(result.body.media[0].verification.links.facebook, 'https://www.facebook.com/events/456/');
    } else assert.equal(patch.media[0].facebook_event_delivery, undefined);
  } finally { global.fetch = originalFetch; }
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
