/**
 * GeneQuanta survey — Google Apps Script backend.
 *
 * Paste this whole file into Extensions > Apps Script of a Google Sheet,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Each survey submission is appended as a row to the "Responses" sheet.
 */

var SHEET_NAME = 'Responses';

// [payload key, column header] — order here is the column order in the sheet.
var COLUMNS = [
  ['timestamp',    'Timestamp'],
  ['response_id',  'Response ID'],
  ['q1',           'Q1 Health approach'],
  ['q2',           'Q2 DTC tests used'],
  ['q2_other',     'Q2 Other'],
  ['q3',           'Q3 Primary concern'],
  ['q3_other',     'Q3 Other'],
  ['q4',           'Q4 Interest level'],
  ['q4_other',     'Q4 Other'],
  ['q5',           'Q6 Max price'],
  ['q6',           'Q7 Self-sample comfort'],
  ['q7',           'Q9 Provider recommendation'],
  ['q7_other',     'Q9 Other'],
  ['q8',           'Q10 Disease risks of interest'],
  ['q9',           'Q11 Main concern'],
  ['q9_other',     'Q11 Other'],
  ['utm_source',   'UTM source'],
  ['utm_medium',   'UTM medium'],
  ['utm_campaign', 'UTM campaign'],
  ['src',          'Src'],
  ['user_agent',   'User agent'],
  ['referrer',     'Referrer'],
  ['received_at',  'Received at (server)'],
  // Added Oct 2026 — appended AFTER the original columns so rows already in the
  // sheet stay aligned. Payload keys q1-q9 are unchanged; headers show the new numbering.
  ['features',       'Q5 Most valuable features'],
  ['features_other', 'Q5 Other'],
  ['blood_barrier',  'Q8 Blood sample barrier'],
  ['q8_other',       'Q10 Other']
];

var MAX_CELL_LENGTH = 2000;

function getHeaders() {
  return COLUMNS.map(function (c) { return c[1]; });
}

/** Parse the POST body (sent as text/plain JSON). Throws on bad input. */
function parsePayload(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents === '') {
    throw new Error('Empty request body');
  }
  var data = JSON.parse(e.postData.contents);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Body must be a JSON object');
  }
  return data;
}

/** Make a value safe for a cell: string, trimmed length, no formula injection. */
function cleanCell(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) value = value.join('; ');
  var s = String(value);
  if (s.length > MAX_CELL_LENGTH) s = s.slice(0, MAX_CELL_LENGTH);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

/** Build the row (array of cell values) in COLUMNS order. */
function buildRow(data, now) {
  var received = (now || new Date()).toISOString();
  return COLUMNS.map(function (c) {
    if (c[0] === 'received_at') return received;
    return cleanCell(data[c[0]]);
  });
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    var headers = getHeaders();
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data;
  try {
    data = parsePayload(e);
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad request: ' + err.message });
  }

  // Honeypot: the site never sends a filled "website" field; bots might.
  if (data.website) return jsonOut({ ok: true });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return jsonOut({ ok: false, error: 'busy, please retry' });
  }
  try {
    var sheet = getOrCreateSheet();
    sheet.appendRow(buildRow(data, new Date()));
    SpreadsheetApp.flush();
  } catch (err) {
    return jsonOut({ ok: false, error: 'write failed: ' + err.message });
  } finally {
    lock.releaseLock();
  }
  return jsonOut({ ok: true });
}

/* ---------- Read endpoint for dashboard.html ----------
 * GET ?action=stats&key=SECRET[&callback=fn]
 * SECRET lives in Script Properties under DASHBOARD_KEY (never in the repo).
 * Columns are mapped by POSITION (COLUMNS order is exactly what doPost appends), so
 * renamed/renumbered header text in the sheet does not matter, and rows written before
 * the Oct 2026 columns existed simply have those fields empty.
 * Response IDs, user agents and full referrer URLs are not returned (referrer -> host only).
 */
var DASHBOARD_KEY_PROPERTY = 'DASHBOARD_KEY';
var STATS_EXCLUDE = { response_id: true, user_agent: true };

function safeEquals(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  }
  return diff === 0;
}

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : v.toISOString();
  var s = String(v);
  if (s.charAt(0) === "'") s = s.slice(1); // undo cleanCell formula guard
  return s;
}

function referrerHost(v) {
  var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#:]+)/i.exec(v || '');
  return m ? m[1].toLowerCase() : '';
}

/** Turn sheet values (incl. header row) into row objects keyed by payload key. */
function rowsToRecords(values) {
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], rec = {}, any = false;
    for (var c = 0; c < COLUMNS.length; c++) {
      var k = COLUMNS[c][0];
      if (STATS_EXCLUDE[k]) continue;
      var v = cellToString(row[c]);
      if (k === 'referrer') v = referrerHost(v);
      rec[k] = v;
      if (v !== '') any = true;
    }
    if (any) out.push(rec);
  }
  return out;
}

function getStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var values = sheet && sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    keys: COLUMNS.map(function (c) { return c[0]; }).filter(function (k) { return !STATS_EXCLUDE[k]; }),
    rows: rowsToRecords(values)
  };
}

function respond(obj, callback) {
  if (callback && /^[A-Za-z_$][\w$]{0,63}$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOut(obj);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'stats') {
    return ContentService
      .createTextOutput('GeneQuanta survey endpoint OK')
      .setMimeType(ContentService.MimeType.TEXT);
  }
  var secret = PropertiesService.getScriptProperties().getProperty(DASHBOARD_KEY_PROPERTY);
  if (!secret) return respond({ ok: false, error: 'not configured: set Script Property ' + DASHBOARD_KEY_PROPERTY }, p.callback);
  if (!p.key || !safeEquals(p.key, secret)) return respond({ ok: false, error: 'unauthorized' }, p.callback);
  try {
    return respond(getStats(), p.callback);
  } catch (err) {
    return respond({ ok: false, error: 'read failed: ' + err.message }, p.callback);
  }
}
