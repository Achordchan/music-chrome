'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute complete production files, without exporting or replacing their functions.
const root = path.resolve(__dirname, '..');
const scripts = Object.fromEntries(['content.js', 'popup/popup.js'].map(file => [
  file, new vm.Script(readFileSync(path.join(root, file), 'utf8'), {
    filename: path.join(root, file)
  })
]));

class EventTargetMock {
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, fields = {}) {
    const event = { type, target: this, ...fields };
    // Invoke synchronously like DOM events, but expose async handler completion to tests.
    return Promise.all((this.listeners.get(type) || []).map(fn => fn.call(this, event)));
  }
}

class StyleMock {
  properties = new Map();
  writes = [];
  setProperty(name, value, priority = '') {
    this.properties.set(name, { value, priority });
    this.writes.push({ name, value, priority });
  }
  getPropertyValue(name) { return this.properties.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.properties.get(name)?.priority || ''; }
  set display(value) { this.setProperty('display', value); }
  get display() { return this.getPropertyValue('display'); }
}

class ElementMock extends EventTargetMock {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = new StyleMock();
    this.id = '';
    this.innerHTML = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
  }
  appendChild(child) {
    this.children.push(child);
    this.onAppend?.(child);
    return child;
  }
}

function makeDocument(readyState = 'complete') {
  const document = new EventTargetMock();
  document.readyState = readyState;
  document.head = new ElementMock('head');
  document.body = new ElementMock('body');
  document.createElement = tag => new ElementMock(tag);
  document.getElementById = id => {
    const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean);
    return visit(document.head) || visit(document.body) || null;
  };
  // Empty audio list; no progress bar/media elements are needed for these scenarios.
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  return document;
}

function chromeEvent() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    emit(...args) { for (const fn of listeners) fn(...args); }
  };
}

function storageHarness() {
  const changed = chromeEvent();
  const writes = [];
  return {
    changed, writes,
    client() {
      const reads = [];
      const runtime = {
        id: 'test-extension', onMessage: chromeEvent(),
        sendMessage(message, callback) {
          assert.equal(message.type, 'GET_AUDIO_RESOURCES');
          callback([]);
        }
      };
      const chrome = {
        runtime,
        storage: {
          onChanged: changed,
          local: {
            get(keys, callback) {
              assert.deepEqual(Array.from(keys), ['showFloatIcon']);
              reads.push({ callback, done: false });
            },
            set(values) {
              return new Promise((resolve, reject) => {
                writes.push({ values: { ...values }, resolve, reject });
              });
            }
          }
        }
      };
      return {
        chrome, reads,
        reply(index, result, error) {
          const read = reads[index];
          assert.ok(read, `storage read ${index} exists`);
          assert.equal(read.done, false, 'read callback is delivered once');
          read.done = true;
          // Chrome lastError exists only during the failing callback.
          if (error) runtime.lastError = { message: error };
          try { read.callback(result); } finally { delete runtime.lastError; }
        }
      };
    }
  };
}

function execute(file, globals) {
  scripts[file].runInContext(vm.createContext({
    console: { log() {}, debug() {}, error() {} }, URL, ...globals
  }));
}

function content(storage = storageHarness(), readyState = 'complete') {
  const client = storage.client();
  const document = makeDocument(readyState);
  const window = new EventTargetMock();
  const mounts = [];
  document.body.onAppend = element => mounts.push({
    id: element.id,
    display: element.style.getPropertyValue('display'),
    priority: element.style.getPropertyPriority('display')
  });
  execute('content.js', { document, window, chrome: client.chrome });
  return {
    ...client, document, window, mounts,
    get button() { return document.getElementById('audioSnifferFloatBtn'); }
  };
}

function visibility(page, expected) {
  assert.ok(page.button, 'floating button is mounted');
  assert.equal(page.button.style.getPropertyValue('display'), expected);
  assert.equal(page.button.style.getPropertyPriority('display'), 'important');
}

function change(storage, value, area = 'local') {
  storage.changed.emit({ showFloatIcon: { newValue: value } }, area);
}

for (const readyState of ['loading', 'interactive', 'complete']) {
  test(`content mounts hidden with !important (${readyState})`, async () => {
    const page = content(undefined, readyState);
    if (readyState === 'loading') {
      assert.equal(page.button, null);
      assert.equal(page.reads.length, 0);
      await page.document.dispatch('DOMContentLoaded');
    }
    assert.deepEqual(page.mounts, [{
      id: 'audioSnifferFloatBtn', display: 'none', priority: 'important'
    }]);
    assert.equal(page.reads.length, 1);
    visibility(page, 'none');
  });
}

for (const [label, result, expected] of [
  ['false', { showFloatIcon: false }, 'none'],
  ['true', { showFloatIcon: true }, 'flex'],
  ['missing', {}, 'flex']
]) {
  test(`content initializes ${label} as ${expected}`, () => {
    const page = content();
    visibility(page, 'none');
    page.reply(0, result);
    visibility(page, expected);
    if (expected === 'none') {
      assert.ok(page.button.style.writes.every(write => write.value === 'none'),
        'false initialization never briefly displays the icon');
    }
  });
}

test('storage changes synchronize two isolated content contexts and ignore unrelated events', () => {
  const storage = storageHarness();
  const pages = [content(storage), content(storage)];
  assert.notEqual(pages[0].button, pages[1].button);
  pages.forEach(page => page.reply(0, {}));
  for (const area of ['sync', 'session', 'managed']) {
    change(storage, false, area);
    pages.forEach(page => visibility(page, 'flex'));
  }
  storage.changed.emit({ anotherSetting: { newValue: false } }, 'local');
  pages.forEach(page => visibility(page, 'flex'));
  change(storage, false);
  pages.forEach(page => visibility(page, 'none'));
  change(storage, true);
  pages.forEach(page => visibility(page, 'flex'));
  change(storage, false);
  storage.changed.emit({ showFloatIcon: { oldValue: false } }, 'local');
  pages.forEach(page => visibility(page, 'flex'));
});

for (const [newValue, staleValue] of [[false, true], [true, false]]) {
  test(`old initialization cannot overwrite storage change to ${newValue}`, () => {
    const storage = storageHarness();
    const page = content(storage);
    change(storage, newValue);
    page.reply(0, { showFloatIcon: staleValue });
    visibility(page, newValue ? 'flex' : 'none');
  });
}

test('ignored storage events do not invalidate a pending initialization', () => {
  const storage = storageHarness();
  const page = content(storage);
  change(storage, false, 'sync');
  storage.changed.emit({ anotherSetting: { newValue: false } }, 'local');
  page.reply(0, { showFloatIcon: true });
  visibility(page, 'flex');
});

test('only persisted pageshow rereads storage and applies restored settings', async () => {
  const page = content();
  page.reply(0, { showFloatIcon: true });
  await page.window.dispatch('pageshow', { persisted: false });
  assert.equal(page.reads.length, 1);
  await page.window.dispatch('pageshow', { persisted: true });
  assert.equal(page.reads.length, 2);
  page.reply(1, { showFloatIcon: false });
  visibility(page, 'none');
  await page.window.dispatch('pageshow', { persisted: true });
  page.reply(2, {});
  visibility(page, 'flex');
});

test('persisted pageshow reads cannot override newer storage changes', async () => {
  const storage = storageHarness();
  const page = content(storage);
  page.reply(0, {});
  for (const value of [false, true]) {
    await page.window.dispatch('pageshow', { persisted: true });
    change(storage, value);
    page.reply(page.reads.length - 1, { showFloatIcon: !value });
    visibility(page, value ? 'flex' : 'none');
  }
});

test('newest pageshow read wins over older restore and initialization reads', async () => {
  const page = content();
  await page.window.dispatch('pageshow', { persisted: true });
  await page.window.dispatch('pageshow', { persisted: true });
  assert.equal(page.reads.length, 3);
  page.reply(2, { showFloatIcon: false });
  page.reply(1, { showFloatIcon: true });
  page.reply(0, { showFloatIcon: true });
  visibility(page, 'none');
});

test('failed initialization and restore reads leave a hidden icon hidden', async () => {
  const page = content();
  page.reply(0, undefined, 'storage unavailable');
  visibility(page, 'none');
  await page.window.dispatch('pageshow', { persisted: true });
  page.reply(1, undefined, 'storage unavailable');
  visibility(page, 'none');
  await page.window.dispatch('pageshow', { persisted: true });
  page.reply(2, { showFloatIcon: true });
  visibility(page, 'flex');
});

async function popup(storage = storageHarness(), tabs = [{ id: 7, status: 'loading' }]) {
  const client = storage.client();
  const document = makeDocument('loading');
  for (const id of ['floatIconToggle', 'audioList', 'emptyState', 'downloadAllBtn']) {
    const element = document.createElement(id === 'floatIconToggle' ? 'input' : 'div');
    element.id = id;
    document.body.appendChild(element);
  }
  const tabCalls = [];
  client.chrome.tabs = {
    async query(query) { tabCalls.push(['query', { ...query }]); return tabs; },
    async get(id) { tabCalls.push(['get', id]); return tabs.find(tab => tab.id === id); },
    sendMessage(id, message, callback) {
      tabCalls.push(['sendMessage', id, { ...message }]);
      callback?.({ isPlaying: false });
    }
  };
  const alerts = [];
  execute('popup/popup.js', {
    document, chrome: client.chrome, alert: message => alerts.push(message)
  });
  await document.dispatch('DOMContentLoaded');
  return {
    ...client, document, tabCalls, alerts,
    toggle: document.getElementById('floatIconToggle')
  };
}

for (const [label, result, expected] of [
  ['false', { showFloatIcon: false }, false],
  ['true', { showFloatIcon: true }, true],
  ['missing', {}, true]
]) {
  test(`popup initializes ${label} and disables the switch until read completion`, async () => {
    const ui = await popup();
    assert.equal(ui.toggle.disabled, true);
    ui.reply(0, result);
    assert.equal(ui.toggle.checked, expected);
    assert.equal(ui.toggle.disabled, false);
  });
}

test('popup read failure keeps the switch disabled', async () => {
  const ui = await popup();
  ui.reply(0, undefined, 'storage unavailable');
  assert.equal(ui.toggle.disabled, true);
});

for (const tabs of [[{ id: 7, status: 'loading' }], [], [{ id: 7, status: 'complete' }]]) {
  test(`popup writes without tab readiness or messaging (${tabs[0]?.status || 'no tab'})`, async () => {
    const storage = storageHarness();
    const ui = await popup(storage, tabs);
    ui.reply(0, {});
    const initialTabCalls = ui.tabCalls.slice();
    for (const value of [false, true]) {
      ui.toggle.checked = value;
      const completion = ui.toggle.dispatch('change');
      assert.equal(ui.toggle.disabled, true);
      const write = storage.writes.at(-1);
      assert.deepEqual(write.values, { showFloatIcon: value });
      await Promise.resolve();
      assert.equal(ui.toggle.disabled, true, 'remains disabled while save is pending');
      write.resolve();
      await completion;
      assert.equal(ui.toggle.disabled, false);
      assert.equal(ui.toggle.checked, value);
    }
    assert.equal(storage.writes.length, 2);
    assert.deepEqual(ui.tabCalls, initialTabCalls, 'toggle does not query/check/message any tab');
    assert.deepEqual(ui.alerts, []);
  });
}

test('popup save failures roll back to the last successful value and show a retry alert', async () => {
  const storage = storageHarness();
  const ui = await popup(storage);
  ui.reply(0, { showFloatIcon: true });

  const save = async (value, fail) => {
    ui.toggle.checked = value;
    const completion = ui.toggle.dispatch('change');
    assert.equal(ui.toggle.disabled, true);
    const write = storage.writes.at(-1);
    assert.deepEqual(write.values, { showFloatIcon: value });
    if (fail) write.reject(new Error('storage write failed'));
    else write.resolve();
    await completion;
    assert.equal(ui.toggle.disabled, false);
  };

  await save(false, true);
  assert.equal(ui.toggle.checked, true);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /悬浮图标.*保存失败.*重试/);
  await save(false, false);
  assert.equal(ui.toggle.checked, false);
  await save(true, true);
  assert.equal(ui.toggle.checked, false, 'rollback uses the latest successful save, not initialization');
  assert.equal(ui.alerts.length, 2);
  assert.match(ui.alerts[1], /悬浮图标.*保存失败.*重试/);
});
