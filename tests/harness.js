const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const SRC = path.join(__dirname, '..', 'src');
function makeEnv() {
  const env = { now: Date.UTC(2026, 9, 15, 0, 0), props: {}, cache: {}, sheets: {}, triggers: [], user: { eff: 'owner@x.com', act: 'owner@x.com' }, fetchHandler: null, sleeps: 0, fetchLog: [] };
  const FakeDate = class extends Date { constructor(...a) { if (a.length === 0) super(env.now); else super(...a); } static now() { return env.now; } };
  const pad = n => String(n).padStart(2, '0');
  const sheet = (name) => {
    const data = [];
    const s = {
      name, data, getMaxRows: () => 1000, getLastRow: () => data.length,
      getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
      getRange(r, c, nr = 1, nc = 1) {
        return {
          setNumberFormat() { return this; }, setFontWeight() { return this; },
          setValues(v) { for (let i = 0; i < v.length; i++) { while (data.length < r + i) data.push([]); for (let j = 0; j < v[i].length; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
          getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        };
      },
      getDataRange() { return this.getRange(1, 1, data.length, this.getLastColumn()); },
      setFrozenRows() {}, deleteRow(n) { data.splice(n - 1, 1); },
    };
    return s;
  };
  const ctx = vm.createContext({
    Date: FakeDate, JSON, Math, Object, Array, String, Number, Error, RegExp, parseInt, isNaN, Set, Map,
    Logger: { log() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(), sleep: () => { env.sleeps++; },
      formatDate(d, tz, f) {
        const k = new Date(d.getTime() + 9 * 3600 * 1000);
        const map = { yyyy: k.getUTCFullYear(), MM: pad(k.getUTCMonth() + 1), dd: pad(k.getUTCDate()), HH: pad(k.getUTCHours()), mm: pad(k.getUTCMinutes()), ss: pad(k.getUTCSeconds()) };
        return f.replace(/yyyy|MM|dd|HH|mm|ss/g, t => map[t]);
      },
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in env.props ? env.props[k] : null), setProperty: (k, v) => { env.props[k] = String(v); },
      deleteProperty: k => { delete env.props[k]; }, getKeys: () => Object.keys(env.props) }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in env.cache ? env.cache[k] : null), put: (k, v) => { env.cache[k] = v; }, remove: k => { delete env.cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {}, waitLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => env.sheets[n] || null, insertSheet: n => (env.sheets[n] = sheet(n)) }) },
    ScriptApp: {
      newTrigger: fn => ({ timeBased() { return { everyMinutes: n => ({ create() { env.triggers.push({ fn, n }); } }) }; } }),
      getProjectTriggers: () => env.triggers.map(t => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: t => { env.triggers.splice(env.triggers.indexOf(t._t), 1); },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => env.user.eff }), getActiveUser: () => ({ getEmail: () => env.user.act }) },
    UrlFetchApp: { fetch(url, opt) { env.fetchLog.push(url); const r = env.fetchHandler ? env.fetchHandler(url, opt) : { code: 500, body: '{}' };
      return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), getHeaders: () => r.headers || {} }; } },
    HtmlService: {},
    LanguageApp: { translate: (t, f, to) => '[번역]' + t },
  });
  fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f })); // 알파벳 순으로 로딩 (GAS 로딩 순서가 달라도 안전한지 확인)
  env.ctx = ctx;
  env.call = (expr) => JSON.parse(JSON.stringify(vm.runInContext(`(${expr})`, ctx) ?? null));
  env.setNow = (s) => { const m = /(\d+)-(\d+)-(\d+) (\d+):(\d+)/.exec(s); env.now = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]); };
  env.run = (code) => vm.runInContext(code, ctx);
  return env;
}

module.exports = { makeEnv, SRC };
