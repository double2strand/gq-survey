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
  ['q5',           'Q5 Max price'],
  ['q6',           'Q6 Self-sample comfort'],
  ['q7',           'Q7 Provider recommendation'],
  ['q7_other',     'Q7 Other'],
  ['q8',           'Q8 Disease risks of interest'],
  ['q9',           'Q9 Main concern'],
  ['q9_other',     'Q9 Other'],
  ['utm_source',   'UTM source'],
  ['utm_medium',   'UTM medium'],
  ['utm_campaign', 'UTM campaign'],
  ['src',          'Src'],
  ['user_agent',   'User agent'],
  ['referrer',     'Referrer'],
  ['received_at',  'Received at (server)']
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

function doGet() {
  return ContentService
    .createTextOutput('GeneQuanta survey endpoint OK')
    .setMimeType(ContentService.MimeType.TEXT);
}
