const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const css = postcss.parse(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'));

// Inspect the actual stylesheet's matching rules in source order. These are
// regression checks of the CSS contract, not a substitute for a browser layout test.
function declarations(selectors, width) {
  const result = {};
  css.walkRules(rule => {
    if (!rule.selectors.some(selector => selectors.includes(selector))) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule' || parent.name !== 'media') continue;
      const max = /max-width:\s*(\d+)px/.exec(parent.params);
      if (max && width > Number(max[1])) return;
    }
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

test('desktop sidebar bounds height and gives navigation its own shrinking scroll area', () => {
  for (const width of [801, 1024, 1920]) {
    const sidebar = declarations(['.sidebar'], width);
    assert.equal(sidebar.position, 'fixed'); assert.equal(sidebar.height, '100dvh');
    assert.equal(sidebar.overflow, 'hidden');
    const nav = declarations(['.sidebar nav', '.sidebar > nav'], width);
    assert.equal(nav['min-height'], '0'); assert.equal(nav['overflow-y'], 'auto');
    assert.equal(nav.flex, '1 1 auto'); assert.equal(nav['overflow-x'], 'hidden');
    assert.equal(declarations(['.sidebarHeader'], width)['flex-shrink'], '0');
    assert.equal(declarations(['.sidebar > .logout'], width)['flex-shrink'], '0');
  }
});

test('mobile retains collapsed menu and constrains the expanded sidebar to the viewport', () => {
  const sidebar = declarations(['.sidebar'], 390);
  assert.equal(sidebar.height, 'auto'); assert.equal(sidebar['max-height'], '100dvh');
  const nav = declarations(['.sidebar nav', '.sidebar > nav'], 390);
  assert.equal(nav.display, 'none'); assert.equal(nav['min-height'], '0');
  assert.equal(nav['max-height'], 'none'); assert.equal(nav['overflow-y'], 'auto');
  assert.equal(declarations(['.sidebar nav.open'], 390).display, 'block');
  assert.equal(declarations(['.sidebar nav:not(.open)+.logout'], 390).display, 'none');
});

test('navigation is keyboard-focusable and retains the bottom settings links', () => {
  const app = fs.readFileSync(path.join(root, 'components/horeca-os-app.js'), 'utf8');
  const nav = app.match(/<nav id="main-navigation"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav); assert.match(nav, /aria-label="Hoofdnavigatie"/); assert.match(nav, /tabIndex=\{0\}/);
  for (const route of ['/koppelingen', '/beveiliging', '/beveiliging/backups']) assert.ok(nav.includes(`href="${route}"`));
  assert.ok(declarations(['.sidebar > nav:focus-visible'], 1280).outline);
});
