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
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
    filename: relative,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(
    (name) => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports,
  );
  return module.exports;
}
const flush = () => React.act(async () => { await new Promise(setImmediate); });

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
