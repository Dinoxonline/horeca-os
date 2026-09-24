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
async function load(relative, mocks = {}) {
  await swc.loadBindings();
  return loadSync(relative, mocks);
}
function loadSync(relative, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
    filename: relative,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(
    (name) => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.startsWith('.') ? loadSync(path.join(path.dirname(relative), name) + '.js', mocks) : require(name), module, module.exports,
  );
  return module.exports;
}
const flush = () => React.act(async () => { await new Promise(setImmediate); });

test('event layout starts with one workspace and keeps secondary information collapsed', async () => {
  const { EventDetails } = await load('components/marketing-overview.js', { '../lib/supabase': { supabase: {} } });
  const item = { id: 'layout', media: [{ kind: 'campaign_distribution', facebook_event_delivery: { external_id: '456' }, common: { title: 'Avond', description: 'Tekst' } }] };
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(EventDetails, { item, onSyncContent() {}, onClose() {} })); });
  try {
    const folds = renderer.root.findAllByProps({ className: 'marketingDetailFold' });
    assert.deepEqual(folds.map(node => node.findByType('summary').props.children), ['Bronnen vergelijken en tekst kiezen', 'Website afzonderlijk bijwerken', 'Evenementgegevens en publicatiestatus']);
    assert.ok(folds.every(node => !node.props.open), 'secondary information is initially collapsed');
    assert.equal(renderer.root.findAllByType('button').filter(node => node.props.children === 'Tekst bewaren in Horeca OS').length, 1);
    const panel = renderer.root.findByProps({ 'aria-label': 'Facebook handmatig bijwerken' });
    const checkbox = panel.findByType('input');
    assert.equal(checkbox.props.disabled, true);
    assert.match(panel.findByProps({ id: checkbox.props['aria-describedby'] }).props.children, /Kies bij stap 1/);
    assert.equal(panel.findAllByType('a')[0].props.onClick, undefined, 'ordinary event link supports native browser split view');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('source selection previews without saving, survives rerenders and resets for another event', async () => {
  const { EventDetails } = await load('components/marketing-overview.js', { '../lib/supabase': { supabase: {} } });
  const item = { id: 'one', media: [{ kind: 'campaign_distribution', eventin_event_id: '123', common: { title: 'Original', description: 'Original body' } }] };
  const source = (label, description) => ({ label, item: { id: label, media: [{ kind: 'campaign_distribution', common: { title: label + ' title', description } }] } });
  const sources = [source('Horeca OS', 'Original body'), source('Eventin', ''), source('Facebook', 'Chosen body')];
  const saved = [];
  const props = { item, sourceComparisonItems: sources, onClose() {}, onUpdateWebsite() {}, onSyncContent: content => saved.push(content) };
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(EventDetails, props)); });
  const buttons = () => renderer.root.findAllByType('button');
  const sync = () => buttons().find(b => b.props.children === 'Tekst bewaren in Horeca OS');
  const choose = label => buttons().find(b => b.props['aria-label'] === 'Tekst van ' + label + ' gebruiken');
  try {
    assert.equal(sync().props.disabled, true);
    assert.equal(buttons().find(b => b.props.children === 'Website bijwerken').props.disabled, false);
    const facebookPanel = renderer.root.findByProps({ 'aria-label': 'Facebook handmatig bijwerken' });
    assert.equal(facebookPanel.findAllByType('button').some(b => String(b.props.children).includes('website')), false);
    await React.act(async () => choose('Facebook').props.onClick());
    assert.equal(buttons().find(b => b.props.children === 'Website bijwerken').props.disabled, true, 'unsaved source choice must block website updates');
    assert.equal(saved.length, 0);
    assert.equal(choose('Facebook').props['aria-pressed'], true);
    const preview = () => renderer.root.findByProps({ 'aria-label': 'Voorbeeld gekozen tekst' });
    assert.equal(preview().findByType('p').props.children, 'Chosen body');
    await React.act(async () => renderer.update(React.createElement(EventDetails, { ...props, sourceComparisonItems: [source('Facebook', 'New remote text')] })));
    assert.equal(preview().findByType('p').props.children, 'Chosen body');
    await React.act(async () => sync().props.onClick());
    assert.deepEqual(saved, [{ title: 'Facebook title', description: 'Chosen body' }]);
    await React.act(async () => renderer.update(React.createElement(EventDetails, props)));
    await React.act(async () => choose('Eventin').props.onClick());
    await React.act(async () => sync().props.onClick());
    assert.deepEqual(saved[1], { title: 'Eventin title', description: '' });
    await React.act(async () => renderer.update(React.createElement(EventDetails, { ...props, item: { ...item, id: 'two' } })));
    assert.equal(sync().props.disabled, true);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Voorbeeld gekozen tekst' }).length, 0);
  } finally { await React.act(async () => renderer.unmount()); }
});

for (const failure of [null, 'save', 'external', 'website_save', 'unlinked']) test('local save and explicit website update are independent: ' + (failure || 'success'), async () => {
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const now = new Date().toISOString();
  const campaign = { id: 'campaign', business_id: 'b', scheduled_for: now, created_at: now, body: 'Old body', media: [
    { kind: 'image', url: 'keep-image' },
    { kind: 'campaign_distribution', eventin_event_id: '123', facebook_event_delivery: { external_id: '456' }, common: { title: 'Old title', description: 'Old body', start: now, location: 'Keep location' } }
  ] };
  const writes = [], patches = [], order = [];
  if (failure === 'unlinked') delete campaign.media[1].eventin_event_id;
  global.fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') {
      order.push('external'); patches.push(JSON.parse(options.body));
      return { ok: failure !== 'external', status: 500, json: async () => ({ error: 'Remote unavailable' }) };
    }
    return { ok: true, json: async () => ({ events: [], media: campaign.media, event: { title: 'Selected title', description: 'Selected body', start: now } }) };
  };
  const supabase = { from: () => {
    const write = { filters: [] };
    let updating = false, query;
    query = new Proxy({}, { get: (_, key) => {
      if (key === 'then') return (resolve, reject) => Promise.resolve({ data: [campaign] }).then(resolve, reject);
      if (key === 'update') return value => { updating = true; write.value = value; return query; };
      if (key === 'eq') return (key, value) => { if (updating) write.filters.push([key, value]); return query; };
      if (key === 'single' || key === 'maybeSingle') return async () => {
        writes.push(write); order.push('save');
        return failure === 'save' || (failure === 'website_save' && writes.length === 3) ? { error: new Error('Save denied') } : { data: { id: 'campaign' } };
      };
      return () => query;
    } });
    return query;
  } };
  const Marketing = (await load('components/marketing-overview.js', { '../lib/supabase': { supabase } })).default;
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Marketing, { workspaceId: 'w', businesses: [{ id: 'b', name: 'Caribbean Corner' }], session: { user: { id: 'u' }, access_token: 't' } })); });
  await flush();
  try {
    const buttons = () => renderer.root.findAllByType('button');
    await React.act(async () => buttons().find(b => b.props.className?.includes('marketingCalendarEvent')).props.onClick());
    await flush();
    await React.act(async () => buttons().find(b => b.props['aria-label'] === 'Tekst van ' + (failure === 'unlinked' ? 'Horeca OS' : 'Eventin') + ' gebruiken').props.onClick());
    assert.equal(writes.length, 0);
    assert.equal(patches.length, 0);
    await React.act(async () => buttons().find(b => b.props.children === 'Tekst bewaren in Horeca OS').props.onClick());
    assert.equal(writes.length, 1, 'saving is exactly one local write');
    assert.equal(patches.length, 0, 'saving must never update any external source');
    assert.deepEqual(writes[0].filters, [['workspace_id', 'w'], ['business_id', 'b'], ['id', 'campaign'], ['media', JSON.stringify(campaign.media)]]);
    assert.equal(writes[0].value.body, failure === 'unlinked' ? 'Old body' : 'Selected body');
    assert.deepEqual(writes[0].value.media[0], campaign.media[0]);
    assert.equal(writes[0].value.media[1].common.location, 'Keep location');
    assert.equal(writes[0].value.media[1].common.title, failure === 'unlinked' ? 'Old title' : 'Selected title');
    assert.equal(order[0], 'save');
    if (failure === 'save') {
      assert.ok(renderer.root.findByProps({ 'aria-label': 'Voorbeeld gekozen tekst' }));
      assert.match(JSON.stringify(renderer.toJSON()), /Save denied/);
    }
    if (failure !== 'save') {
      const panel = renderer.root.findByProps({ 'aria-label': 'Facebook handmatig bijwerken' });
      assert.equal(panel.findByType('strong').props.children, 'Gereed voor handmatige verwerking');
      await React.act(async () => panel.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
      await React.act(async () => buttons().find(b => b.props.children === 'Handmatig bijgewerkt').props.onClick());
      const facebook = writes.at(-1).value.media[1].event_content_delivery.facebook;
      assert.equal(facebook.status, 'manual_confirmed');
      assert.equal(facebook.confirmed_by, 'u');
      assert.equal(facebook.snapshot.description, failure === 'unlinked' ? 'Old body' : 'Selected body');
      assert.ok(facebook.confirmed_at);
      assert.equal(patches.length, 0, 'confirmation never calls Facebook or the website');
      assert.equal(writes.at(-1).value.media[1].event_content_delivery.website, undefined);
      const websiteButton = buttons().find(b => b.props.children === 'Website bijwerken');
      assert.equal(websiteButton.props.disabled, failure === 'unlinked');
      // Invoke even a disabled handler to ensure the no-link server-call guard also holds.
      await React.act(async () => websiteButton.props.onClick());
      assert.equal(patches.length, ['website_save', 'unlinked'].includes(failure) ? 0 : 1);
      for (const payload of patches) {
        assert.equal(payload.eventId, '123');
        assert.equal(payload.title, 'Selected title');
        assert.equal(payload.description, 'Selected body');
        assert.equal(payload.workspaceId, 'w');
        assert.equal(payload.businessId, 'b');
        assert.equal(payload.site, 'caribbeancorner.nl');
        assert.equal(payload.action, 'sync-content');
      }
      assert.deepEqual(writes.at(-1).value.media[1].event_content_delivery.facebook, facebook, 'website action preserves manual Facebook confirmation');
      if (!['website_save', 'unlinked'].includes(failure)) {
        assert.equal(writes.at(-1).value.media[1].event_content_delivery.website.status, failure === 'external' ? 'failed' : 'updated');
        assert.deepEqual(order, ['save', 'save', 'save', 'external', 'save']);
      }
      if (failure === 'external') assert.match(JSON.stringify(renderer.toJSON()), /website kon niet worden bijgewerkt/);
    }
  } finally { await React.act(async () => renderer.unmount()); }
});

for (const failure of [null, 'read', 'write', 'auth']) test('Eventin text-only update preserves event settings: ' + (failure || 'success'), async () => {
  const oldUsername = process.env.EVENTIN_CARIBBEAN_USERNAME;
  const oldPassword = process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD;
  process.env.EVENTIN_CARIBBEAN_USERNAME = 'test-user';
  process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD = 'test-password';
  const existing = { id: 123, title: 'Old title', description: 'Old body', excerpt: 'Old excerpt', visibility_status: 'publish',
    start_date: '2026-10-01', end_date: '2026-10-02', start_time: '20:00', end_time: '01:00',
    event_banner: 'keep-banner', event_banner_id: 456, location: { address: 'Keep venue' },
    ticket_variations: [{ id: 'ticket', etn_ticket_price: 25, etn_sold_tickets: 12 }], total_ticket: 100 };
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(options);
    return { ok: options.method === 'POST' ? failure !== 'write' : failure !== 'read', json: async () => ({ data: existing }) };
  };
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) }, from(table) {
    const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({
      data: table === 'workspace_members' ? { role: failure === 'auth' ? 'staff' : 'owner' } : { name: 'Caribbean Corner' }
    }) };
    return query;
  } };
  try {
    const { PATCH } = await load('app/api/marketing/website-events/create/route.js', {
      '../../../../../lib/server-supabase': { createUserSupabase: () => client },
    });
    const response = await PATCH(new Request('https://test.local/api/event', { method: 'PATCH',
      headers: { authorization: 'Bearer fake', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync-content', allowLinked: true, workspaceId: 'w', businessId: 'b', site: 'caribbeancorner.nl',
        eventId: '123', title: 'Chosen title', description: 'Chosen & safe <text>\nSecond line' }) }));
    assert.equal(response.status, failure === 'auth' ? 403 : failure ? 502 : 200);
    if (failure === 'auth') assert.equal(calls.length, 0);
    else if (failure === 'read') assert.equal(calls.length, 1);
    else {
      assert.equal(calls.length, 2);
      const payload = JSON.parse(calls[1].body);
      assert.deepEqual(payload, { ...existing, title: 'Chosen title',
        description: '<p>Chosen &amp; safe &lt;text&gt;<br>Second line</p>', excerpt: 'Chosen & safe <text>\nSecond line' });
    }
  } finally {
    if (oldUsername === undefined) delete process.env.EVENTIN_CARIBBEAN_USERNAME; else process.env.EVENTIN_CARIBBEAN_USERNAME = oldUsername;
    if (oldPassword === undefined) delete process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD; else process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD = oldPassword;
  }
});

async function harness({ failMfa = false, stuckMembership = false, pathname = '/marketing' } = {}) {
  const listeners = new Map();
  global.window = {
    location: { hash: '', search: '' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval: () => 1, clearInterval() {},
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name),
  };
  global.document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const calls = { mounts: 0, unmounts: 0, factors: 0, enroll: 0, tables: {}, admin: 0, channels: 0 };
  global.fetch = async () => { calls.admin++; return { ok: true, json: async () => ({}) }; };
  const state = { failMfa, stuckMembership, deferredMfa: null, level: 'aal2', session: { user: { id: 'user-a' }, access_token: 'token-a' } };
  let authListener;
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (fn) => { authListener = fn; return { data: { listener: null, subscription: { unsubscribe() {} } } }; },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.level, nextLevel: 'aal2' } }),
        listFactors: async () => {
          calls.factors++;
          if (state.deferredMfa) return state.deferredMfa;
          return state.failMfa ? { error: new Error('network') } : { data: { totp: [{ id: 'existing', status: 'verified' }] } };
        },
        enroll: async () => { calls.enroll++; throw new Error('Unexpected enrollment'); },
      },
    },
    from: (table) => {
      calls.tables[table] = (calls.tables[table] || 0) + 1;
      const data = table === 'workspace_members' ? [{ workspace_id: 'workspace-a', role: 'owner', workspace: { name: 'Test' } }]
        : table === 'businesses' ? [{ id: 'business-a', name: 'Test', active: true }] : [];
      const request = new Proxy({}, { get: (_, key) => key === 'then'
        ? (resolve, reject) => (table === 'workspace_members' && state.stuckMembership ? new Promise(() => {}) : Promise.resolve({ data, count: 0 })).then(resolve, reject)
        : () => request });
      return request;
    },
    channel: () => { calls.channels++; return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
  const timeout = await load('lib/request-timeout.js');
  const polling = await load('lib/background-poll.js', { './request-timeout': timeout });
  const pollTimers = new Map();
  const mocks = {
    'next/navigation': { usePathname: () => pathname },
    'next/link': { default: (props) => React.createElement('a', props) },
    '../lib/supabase': { supabase },
    '../lib/request-timeout': { withRequestTimeout: (promise, message, abort) => timeout.withRequestTimeout(promise, message, abort, 100) },
    '../lib/background-poll': { startBackgroundPoll: (task) => polling.startBackgroundPoll(task, {
      setTimer: (fn, ms) => { pollTimers.set(fn, ms); return fn; }, clearTimer: (fn) => pollTimers.delete(fn),
    }) },
    './marketing-overview': { default: function Marketing() {
      React.useEffect(() => { calls.mounts++; return () => { calls.unmounts++; }; }, []);
      return React.createElement('span', null, 'Agenda loopt');
    } },
  };
  for (const name of ['central-event-creator', 'workboard', 'process-trash', 'process-audit', 'manager-logbook', 'documents', 'staff-ticket-form', 'staff-tickets']) mocks['./' + name] = { default: () => null };
  const App = (await load('components/horeca-os-app.js', mocks)).default;
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(App)); });
  await flush();
  const text = () => JSON.stringify(renderer.toJSON());
  return {
    renderer, calls, state, text, listeners, pollTimers,
    emit: async (event, session) => { state.session = session; await React.act(async () => authListener(event, session)); await flush(); },
    close: async () => React.act(async () => renderer.unmount()),
  };
}

test('Marketing does not run dashboard badge queries or subscriptions', async () => {
  const h = await harness();
  try {
    assert.match(h.text(), /Agenda loopt/);
    assert.equal(h.calls.admin, 0);
    assert.equal(h.calls.tables.staff_tickets || 0, 0);
    assert.equal(h.calls.channels, 0);
    assert.equal(h.pollTimers.size, 0);
  } finally { await h.close(); }
});

test('dashboard badge polling stops on MFA failure and does not restart on token refresh', async () => {
  const h = await harness({ pathname: '/dashboard' });
  try {
    assert.equal(h.calls.admin, 1);
    assert.equal(h.calls.tables.staff_tickets, 1);
    assert.equal(h.pollTimers.size, 2);
    await h.emit('TOKEN_REFRESHED', { ...h.state.session, access_token: 'token-b' });
    assert.equal(h.calls.admin, 1);
    assert.equal(h.calls.tables.staff_tickets, 1);
    h.state.failMfa = true;
    await h.emit('TOKEN_REFRESHED', { ...h.state.session, access_token: 'token-c' });
    assert.match(h.text(), /Verbinding herstellen/);
    assert.equal(h.pollTimers.size, 0);
    assert.equal(h.calls.channels, 0);
  } finally { await h.close(); }
});

test('failed initial access check never starts dashboard badge polling', async () => {
  const h = await harness({ pathname: '/dashboard', failMfa: true });
  try {
    assert.equal(h.calls.admin, 0);
    assert.equal(h.calls.tables.staff_tickets || 0, 0);
    assert.equal(h.pollTimers.size, 0);
  } finally { await h.close(); }
});

test('background polls serialize work, back off on errors and skip hidden tabs', async () => {
  const timeout = await load('lib/request-timeout.js');
  const { startBackgroundPoll } = await load('lib/background-poll.js', { './request-timeout': timeout });
  const pending = new Map();
  let visible = true;
  let resolveFirst;
  let calls = 0;
  let shouldFail = false;
  const stop = startBackgroundPoll(async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { resolveFirst = resolve; });
    if (shouldFail) throw new Error('outage');
  }, { isVisible: () => visible, setTimer: (fn, ms) => { pending.set(fn, ms); return fn; }, clearTimer: fn => pending.delete(fn) });
  const tick = async () => { const fn = pending.keys().next().value; pending.delete(fn); await fn(); };
  try {
    assert.equal(calls, 1);
    assert.equal(pending.size, 0); // No interval can overlap the unfinished request.
    resolveFirst(); await flush();
    assert.equal([...pending.values()][0], 60000);
    shouldFail = true;
    await tick(); assert.equal([...pending.values()][0], 120000);
    await tick(); assert.equal([...pending.values()][0], 240000);
    await tick(); assert.equal([...pending.values()][0], 300000);
    await tick(); assert.equal([...pending.values()][0], 300000);
    visible = false;
    const before = calls;
    await tick(); assert.equal(calls, before);
    visible = true; shouldFail = false;
    await tick(); assert.equal([...pending.values()][0], 60000);
  } finally { stop(); }
  assert.equal(pending.size, 0);
});

test('stopping a background poll aborts its request and prevents late rescheduling', async () => {
  const timeout = await load('lib/request-timeout.js');
  const { startBackgroundPoll } = await load('lib/background-poll.js', { './request-timeout': timeout });
  let signal, finish;
  let scheduled = 0;
  const stop = startBackgroundPoll(async s => { signal = s; await new Promise(resolve => { finish = resolve; }); }, {
    isVisible: () => true, setTimer: () => { scheduled++; }, clearTimer() {},
  });
  stop();
  assert.equal(signal.aborted, true);
  finish(); await flush();
  assert.equal(scheduled, 0);
});

test('a hung background request is aborted and its retry is delayed', async () => {
  const timeout = await load('lib/request-timeout.js');
  const { startBackgroundPoll } = await load('lib/background-poll.js', { './request-timeout': timeout });
  let signal, delay;
  const stop = startBackgroundPoll(s => { signal = s; return new Promise(() => {}); }, {
    timeoutMs: 20, isVisible: () => true, setTimer: (_fn, ms) => { delay = ms; }, clearTimer() {},
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(signal.aborted, true);
    assert.equal(delay, 120000);
  } finally { stop(); }
});

test('returning to a tab with the same session does not reload access or remount Marketing', async () => {
  const h = await harness();
  try {
    assert.match(h.text(), /Agenda loopt/);
    const tables = { ...h.calls.tables };
    const factors = h.calls.factors;
    for (let i = 0; i < 3; i++) await h.emit('SIGNED_IN', { ...h.state.session, user: { id: 'user-a' } });
    assert.deepEqual(h.calls.tables, tables);
    assert.equal(h.calls.factors, factors);
    assert.equal(h.calls.mounts, 1);
    assert.equal(h.calls.unmounts, 0);
  } finally { await h.close(); }
});

test('token refresh checks MFA without discarding the running Marketing component', async () => {
  const h = await harness();
  try {
    const membershipCalls = h.calls.tables.workspace_members;
    let resolve;
    h.state.deferredMfa = new Promise((done) => { resolve = done; });
    await h.emit('TOKEN_REFRESHED', { ...h.state.session, access_token: 'token-b' });
    assert.match(h.text(), /Agenda loopt/);
    await React.act(async () => resolve({ data: { totp: [{ id: 'existing', status: 'verified' }] } }));
    assert.equal(h.calls.tables.workspace_members, membershipCalls);
    assert.equal(h.calls.mounts, 1);
    assert.equal(h.calls.unmounts, 0);
  } finally { await h.close(); }
});

test('MFA fetch error blocks access and offers retry without enrolling another authenticator', async () => {
  const h = await harness({ failMfa: true });
  try {
    assert.match(h.text(), /Verbinding herstellen/);
    assert.doesNotMatch(h.text(), /Stel tweestapsverificatie in|Agenda loopt/);
    assert.equal(h.calls.enroll, 0);
    h.state.failMfa = false;
    const retry = h.renderer.root.findAllByType('button').find((button) => button.props.children === 'Opnieuw proberen');
    await React.act(async () => retry.props.onClick());
    await flush();
    assert.match(h.text(), /Agenda loopt/);
    assert.equal(h.calls.enroll, 0);
  } finally { await h.close(); }
});

test('a hanging workspace request leaves the spinner and can recover', async () => {
  const h = await harness({ stuckMembership: true });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 130)); });
    assert.match(h.text(), /Verbinding herstellen/);
    h.state.stuckMembership = false;
    const retry = h.renderer.root.findAllByType('button').find((button) => button.props.children === 'Opnieuw proberen');
    await React.act(async () => retry.props.onClick());
    await flush();
    assert.match(h.text(), /Agenda loopt/);
  } finally { await h.close(); }
});

test('signing out still removes protected content', async () => {
  const h = await harness();
  try {
    await h.emit('SIGNED_OUT', null);
    assert.doesNotMatch(h.text(), /Agenda loopt/);
    assert.match(h.text(), /Veilig inloggen/);
  } finally { await h.close(); }
});

test('an actual MFA downgrade still requires the existing authenticator', async () => {
  const h = await harness();
  try {
    h.state.level = 'aal1';
    await h.emit('TOKEN_REFRESHED', { ...h.state.session, access_token: 'aal1-token' });
    assert.match(h.text(), /Voer je beveiligingscode in/);
    assert.doesNotMatch(h.text(), /Agenda loopt|Stel tweestapsverificatie in/);
    assert.equal(h.calls.enroll, 0);
  } finally { await h.close(); }
});

test('a hanging MFA request fails closed without starting enrollment', async () => {
  const h = await harness();
  try {
    h.state.deferredMfa = new Promise(() => {});
    await h.emit('TOKEN_REFRESHED', { ...h.state.session, access_token: 'hanging-token' });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 130)); });
    assert.match(h.text(), /Verbinding herstellen/);
    assert.doesNotMatch(h.text(), /Agenda loopt|Stel tweestapsverificatie in/);
    assert.equal(h.calls.enroll, 0);
  } finally { await h.close(); }
});

test('a late MFA response cannot restore protected content after sign-out', async () => {
  const h = await harness();
  try {
    let resolve;
    h.state.deferredMfa = new Promise((done) => { resolve = done; });
    await h.emit('TOKEN_REFRESHED', { ...h.state.session, access_token: 'old-token' });
    await h.emit('SIGNED_OUT', null);
    await React.act(async () => resolve({ data: { totp: [{ id: 'existing', status: 'verified' }] } }));
    assert.match(h.text(), /Veilig inloggen/);
    assert.doesNotMatch(h.text(), /Agenda loopt/);
  } finally { await h.close(); }
});

test('startup verification updates an open event immediately, independently of slow events and browser focus', async () => {
  const listeners = new Map();
  global.window = { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener() {} };
  global.document = { visibilityState: 'visible', addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener() {} };
  const now = new Date().toISOString();
  const campaigns = ['first', 'slow'].map(id => ({ id, business_id: 'b', created_at: now, scheduled_for: now, media: [{ kind: 'campaign_distribution', provider_delivery: { facebook: { external_id: id === 'first' ? '456' : '789' } }, common: { title: id, description: 'Text', start: now } }] }));
  const pending = new Map(); let checks = 0;
  global.fetch = async (url, options = {}) => {
    if (url === '/api/marketing/publication-status') { checks++; const { campaignId } = JSON.parse(options.body); return new Promise(resolve => pending.set(campaignId, resolve)); }
    return { ok: true, json: async () => ({ events: [] }) };
  };
  let query;
  query = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve, reject) => Promise.resolve({ data: campaigns }).then(resolve, reject) : () => query });
  const Marketing = (await load('components/marketing-overview.js', { '../lib/supabase': { supabase: { from: () => query } } })).default;
  const props = { workspaceId: 'w', businesses: [{ id: 'b', name: 'Caribbean Corner' }], session: { user: { id: 'u' }, access_token: 't' } };
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Marketing, props)); });
  await flush();
  const buttons = () => renderer.root.findAllByType('button');
  const open = index => buttons().filter(b => b.props.className?.includes('marketingCalendarEvent'))[index].props.onClick();
  const panel = () => renderer.root.findByProps({ 'aria-label': 'Facebook handmatig bijwerken' });
  try {
    await React.act(async () => open(0));
    assert.equal(panel().findByType('strong').props.children, 'Koppeling controleren…');
    assert.ok(panel().findAllByProps({ role: 'status' }).some(node => /automatisch/.test(node.props.children)));
    const media = [{ ...campaigns[0].media[0], facebook_event_delivery: { external_id: '456', permalink: 'https://www.facebook.com/events/456/' }, verification: { channels: { facebook: { status: 'reachable' } } } }];
    await React.act(async () => pending.get('first')({ ok: true, json: async () => ({ media }) }));
    assert.equal(panel().findAllByType('a')[0].props.href, 'https://www.facebook.com/events/456/');
    assert.equal(checks, 2);
    await React.act(async () => { listeners.get('focus')?.(); listeners.get('visibilitychange')?.(); renderer.update(React.createElement(Marketing, { ...props, session: { ...props.session, access_token: 'new' } })); });
    assert.equal(checks, 2, 'focus and token refresh must not restart startup checks');
    assert.equal(panel().findAllByType('a')[0].props.href, 'https://www.facebook.com/events/456/');
    await React.act(async () => pending.get('slow')({ ok: false, json: async () => ({ error: 'Unavailable' }) }));
    await flush();
    await React.act(async () => buttons().find(b => b.props.children === 'Details sluiten').props.onClick());
    await React.act(async () => open(0));
    assert.equal(panel().findAllByType('a')[0].props.href, 'https://www.facebook.com/events/456/', 'verified link survives reopening');
    await React.act(async () => buttons().find(b => b.props.children === 'Details sluiten').props.onClick());
    await React.act(async () => open(1));
    assert.equal(panel().findByType('strong').props.children, 'Koppeling kon niet worden gecontroleerd');
  } finally {
    await React.act(async () => { renderer.unmount(); for (const resolve of pending.values()) resolve({ ok: false, json: async () => ({}) }); });
  }
});

test('focus and visibility events do not duplicate a manual source comparison', async () => {
  const listeners = new Map();
  global.window = { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener() {} };
  global.document = { visibilityState: 'visible', addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener() {} };
  let calls = 0;
  let resolve;
  let holdComparison = false;
  const now = new Date().toISOString();
  const campaign = { id: 'campaign', business_id: 'b', created_at: now, scheduled_for: now, media: [{ kind: 'campaign_distribution', eventin_event_id: '123', common: { title: 'Testavond', start: now } }] };
  global.fetch = async (url) => {
    calls++;
    if (holdComparison && String(url).includes('eventId=123')) return new Promise((done) => { resolve = done; });
    return { ok: true, json: async () => ({ events: [], media: campaign.media, event: { title: 'Testavond', start: now } }) };
  };
  let query;
  query = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve, reject) => Promise.resolve({ data: [campaign] }).then(resolve, reject) : () => query });
  const Marketing = (await load('components/marketing-overview.js', { '../lib/supabase': { supabase: { from: () => query } } })).default;
  const props = { workspaceId: 'w', businesses: [{ id: 'b', name: 'Caribbean Corner' }], session: { user: { id: 'u' }, access_token: 't' } };
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Marketing, props)); });
  await flush();
  try {
    const event = renderer.root.findAllByType('button').find((button) => button.props.className?.includes('marketingCalendarEvent'));
    assert.ok(event, 'campaign is visible in the calendar');
    await React.act(async () => event.props.onClick());
    const compare = renderer.root.findAllByType('button').find((button) => button.props.children === 'Bronnen opnieuw vergelijken');
    holdComparison = true;
    await React.act(async () => { compare.props.onClick(); });
    const callsWhileRunning = calls;
    await React.act(async () => {
      listeners.get('focus')?.();
      listeners.get('visibilitychange')?.();
      renderer.update(React.createElement(Marketing, { ...props, session: { ...props.session, access_token: 'renewed' } }));
    });
    assert.equal(calls, callsWhileRunning, 'no duplicate comparison or reload on focus/token change');
    await React.act(async () => resolve({ ok: true, json: async () => ({ event: { title: 'Vergelijking voltooid', start: now } }) }));
    assert.match(JSON.stringify(renderer.toJSON()), /Vergelijking voltooid/);
  } finally { await React.act(async () => renderer.unmount()); }
});
