const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8');

function makeCtx() {
  const log = { locks: 0, released: 0, flushes: 0, inserted: [] };
  const sheets = {};
  function makeSheet(name) {
    const rows = [];
    return { name, rows, frozen: 0, bold: null,
      getLastRow() { return rows.length; },
      appendRow(r) { rows.push(r.slice()); },
      getRange(r, c, nr, nc) { const self = this; return { setFontWeight(w) { self.bold = [r, c, nr, nc, w]; return this; } }; },
      getDataRange() { return { getValues: () => rows.map(r => r.slice()) }; },
      setFrozenRows(n) { this.frozen = n; } };
  }
  const ss = { getSheetByName: n => sheets[n] || null,
    insertSheet: n => { log.inserted.push(n); return (sheets[n] = makeSheet(n)); } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => { log.flushes++; } },
    LockService: { getScriptLock: () => ({ waitLock: () => { log.locks++; }, releaseLock: () => { log.released++; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'DASHBOARD_KEY' ? ctx.__key : null) }) },
  ContentService: { MimeType: { JSON: 'json', TEXT: 'text', JAVASCRIPT: 'js' },
      createTextOutput: t => ({ text: t, mime: null, setMimeType(m) { this.mime = m; return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  return { ctx, sheets, log };
}

const payload = {
  timestamp: '2026-10-06T19:00:00.000Z', response_id: 'abc-123',
  q1: 'Very proactive– I actively seek out new tests and technologies.',
  q2: 'Ancestry DNA testing; Other', q2_other: 'gut microbiome',
  q3: 'Slowing down aging', q3_other: '', q4: 'Neutral', q4_other: '',
  q5: '$100-$250', q6: 'Blood; Saliva', q7: 'Other', q7_other: '=HYPERLINK("x")',
  q8: 'Cancer; Type 2 Diabetes', q9: 'Data privacy', q9_other: '',
  utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'oct', src: 'tw',
  user_agent: 'UA/1.0', referrer: 'https://example.com/'
};

// 1. Headers
let { ctx, sheets, log } = makeCtx();
const headers = ctx.getHeaders();
assert.strictEqual(headers[0], 'Timestamp');
assert.strictEqual(headers[1], 'Response ID');
assert.strictEqual(headers[2], 'Q1 Health approach');
assert.strictEqual(headers[3], 'Q2 DTC tests used');
assert.strictEqual(headers[4], 'Q2 Other');
assert.ok(headers.includes('User agent') && headers.includes('Referrer') && headers.includes('UTM source'));
for (let i = 1; i <= 9; i++) assert.ok(headers.some(h => h.startsWith('Q' + i + ' ')), 'missing Q' + i);

// 2. doPost on empty spreadsheet creates sheet + header + row
let out = ctx.doPost({ postData: { contents: JSON.stringify(payload), type: 'text/plain' } });
assert.deepStrictEqual(JSON.parse(out.text), { ok: true });
assert.strictEqual(out.mime, 'json');
const sh = sheets.Responses;
assert.ok(sh, 'Responses sheet created');
assert.deepStrictEqual(log.inserted, ['Responses']);
assert.strictEqual(sh.rows.length, 2);
assert.deepStrictEqual(sh.rows[0], headers);
assert.strictEqual(sh.frozen, 1);
const row = sh.rows[1];
const col = h => row[headers.indexOf(h)];
assert.strictEqual(col('Timestamp'), payload.timestamp);
assert.strictEqual(col('Response ID'), 'abc-123');
assert.strictEqual(col('Q2 DTC tests used'), 'Ancestry DNA testing; Other');
assert.strictEqual(col('Q2 Other'), 'gut microbiome');
assert.strictEqual(col('Q6 Max price'), '$100-$250');
assert.strictEqual(col('Q9 Other'), "'=HYPERLINK(\"x\")", 'formula injection neutralised');
assert.strictEqual(col('UTM source'), 'linkedin');
assert.strictEqual(col('Src'), 'tw');
assert.strictEqual(col('User agent'), 'UA/1.0');
assert.strictEqual(col('Referrer'), 'https://example.com/');
assert.ok(/^\d{4}-\d\d-\d\dT/.test(col('Received at (server)')));
assert.strictEqual(row.length, headers.length);
assert.strictEqual(log.locks, 1); assert.strictEqual(log.released, 1);

// 3. Second post: no duplicate header, missing fields -> ''
ctx.doPost({ postData: { contents: JSON.stringify({ response_id: 'r2', q6: ['Blood', 'None'] }) } });
assert.strictEqual(sh.rows.length, 3);
assert.strictEqual(sh.rows[2][headers.indexOf('Q1 Health approach')], '');
assert.strictEqual(sh.rows[2][headers.indexOf('Q7 Self-sample comfort')], 'Blood; None');
assert.strictEqual(log.inserted.length, 1);

// 4. Bad input
for (const bad of [undefined, {}, { postData: { contents: '' } }, { postData: { contents: 'not json' } }, { postData: { contents: '[1,2]' } }]) {
  const r = JSON.parse(ctx.doPost(bad).text);
  assert.strictEqual(r.ok, false);
}
assert.strictEqual(sh.rows.length, 3);

// 5. Honeypot dropped
ctx.doPost({ postData: { contents: JSON.stringify({ website: 'spam', q1: 'x' }) } });
assert.strictEqual(sh.rows.length, 3);

// 6. Long values truncated
ctx.doPost({ postData: { contents: JSON.stringify({ q9_other: 'a'.repeat(5000) }) } });
assert.strictEqual(sh.rows[3][headers.indexOf('Q11 Other')].length, 2000);

// 7. Lock released even if append throws
({ ctx, sheets, log } = makeCtx());
ctx.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('boom'); };
assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: '{}' } }).text).ok, false);
assert.strictEqual(log.released, 1);

// 8. doGet
const g = ctx.doGet();
assert.strictEqual(g.text, 'GeneQuanta survey endpoint OK');
// 9. doGet stats: auth + mapping
{
  const m = makeCtx(); const c = m.ctx;
  // not configured
  let r = JSON.parse(c.doGet({ parameter: { action: 'stats', key: 'x' } }).text);
  assert.strictEqual(r.ok, false); assert.ok(/not configured/.test(r.error));
  c.__key = 's3cret-key';
  r = JSON.parse(c.doGet({ parameter: { action: 'stats' } }).text);
  assert.deepStrictEqual(r, { ok: false, error: 'unauthorized' }, 'missing key rejected');
  r = JSON.parse(c.doGet({ parameter: { action: 'stats', key: 's3cret-kez' } }).text);
  assert.strictEqual(r.error, 'unauthorized', 'wrong key rejected');
  assert.ok(!('rows' in r));
  // empty sheet
  r = JSON.parse(c.doGet({ parameter: { action: 'stats', key: 's3cret-key' } }).text);
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.rows, []);
  // new-style row + an OLD row (written before the 4 appended columns existed, i.e. shorter)
  c.doPost({ postData: { contents: JSON.stringify(Object.assign({}, payload, {
    features: 'Biological age prediction; Other', features_other: 'sleep', blood_barrier: 'Major', q8_other: 'kidney' })) } });
  const sh2 = m.sheets.Responses;
  const oldRow = sh2.rows[1].slice(0, 23); oldRow[2] = 'Neutral-old'; oldRow[0] = new Date('2026-10-01T10:00:00Z');
  sh2.rows.push(oldRow);
  const res = c.doGet({ parameter: { action: 'stats', key: 's3cret-key' } });
  assert.strictEqual(res.mime, 'json');
  r = JSON.parse(res.text);
  assert.strictEqual(r.rows.length, 2);
  const [n, o] = r.rows;
  assert.strictEqual(n.features, 'Biological age prediction; Other'); assert.strictEqual(n.features_other, 'sleep');
  assert.strictEqual(n.blood_barrier, 'Major'); assert.strictEqual(n.q8_other, 'kidney');
  assert.strictEqual(n.q5, '$100-$250'); assert.strictEqual(n.q9, 'Data privacy');
  assert.strictEqual(n.q7_other, '=HYPERLINK("x")', 'formula guard quote stripped on read');
  assert.strictEqual(n.referrer, 'example.com', 'referrer reduced to host');
  assert.ok(!('user_agent' in n) && !('response_id' in n), 'UA / response id not exposed');
  assert.strictEqual(o.q1, 'Neutral-old'); assert.strictEqual(o.features, ''); assert.strictEqual(o.blood_barrier, '');
  assert.strictEqual(o.timestamp, '2026-10-01T10:00:00.000Z', 'Date cells serialised');
  // JSONP
  const j = c.doGet({ parameter: { action: 'stats', key: 's3cret-key', callback: 'cb_1' } });
  assert.strictEqual(j.mime, 'js'); assert.ok(j.text.startsWith('cb_1({'));
  const bad = c.doGet({ parameter: { action: 'stats', key: 's3cret-key', callback: 'alert(1)//' } });
  assert.strictEqual(bad.mime, 'json', 'unsafe callback ignored');
  // plain GET unchanged
  assert.strictEqual(c.doGet({ parameter: {} }).text, 'GeneQuanta survey endpoint OK');
}
console.log('Code.gs tests: all passed (' + headers.length + ' columns)');
