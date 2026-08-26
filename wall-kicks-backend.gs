/**
 * Wall Kicks — backend for the 8U tracker.
 *
 * Stores every entry as a row in the Google Sheet this script is bound to,
 * so the data lives in Yan's Drive rather than inside the web page.
 *
 * Everything runs through doGet with a JSONP callback. That is deliberate:
 * a JSONP GET never triggers a CORS preflight, which is the thing that most
 * often breaks a static page talking to Apps Script.
 *
 * SETUP
 *   1. Make a new Google Sheet (name it anything, e.g. "Wall Kicks").
 *   2. Extensions -> Apps Script. Delete whatever is there.
 *   3. Paste this whole file in. Save.
 *   4. Deploy -> New deployment -> type "Web app".
 *        Execute as:        Me
 *        Who has access:    Anyone
 *   5. Authorise it when Google asks (it is your own script; the
 *      "unverified app" warning is expected -> Advanced -> Go to ...).
 *   6. Copy the Web app URL. It looks like
 *        https://script.google.com/macros/s/AKfy..../exec
 *      Send that URL to Claude and it gets wired into the page.
 *
 * Re-deploying after an edit: Deploy -> Manage deployments -> pencil ->
 * Version: New version -> Deploy. The URL stays the same.
 */

var SHEET = 'entries';
var HEADERS = ['timestamp', 'player', 'date', 'kicks', 'source'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1]) continue;
    out.push({
      p: String(r[1]),
      d: fmtDate_(r[2]),
      k: Number(r[3]) || 0,
      ts: r[0] instanceof Date ? r[0].getTime() : Number(r[0]) || 0
    });
  }
  return out;
}

/** Sheets may hand back a Date or a string depending on how the cell was typed. */
function fmtDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
}

function add_(p, d, k) {
  p = String(p || '').trim().slice(0, 40);
  d = String(d || '').trim().slice(0, 10);
  k = Math.floor(Number(k));

  if (!p) throw new Error('no player');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('bad date');
  if (!(k > 0) || k > 5000) throw new Error('bad count');

  // Same player, same day, same number, already recorded in the last few
  // minutes? Treat it as a double-tap rather than a second session.
  var existing = readAll_();
  var now = Date.now();
  for (var i = existing.length - 1; i >= 0 && i > existing.length - 30; i--) {
    var e = existing[i];
    if (e.p === p && e.d === d && e.k === k && now - e.ts < 5 * 60 * 1000) {
      return { duplicate: true };
    }
  }

  sheet_().appendRow([new Date(), p, d, k, 'web']);
  return { duplicate: false };
}

function doGet(e) {
  var cb = (e && e.parameter && e.parameter.callback) || 'cb';
  cb = String(cb).replace(/[^A-Za-z0-9_$.]/g, '');
  var out;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'add') {
      var res = add_(e.parameter.p, e.parameter.d, e.parameter.k);
      out = { ok: true, duplicate: !!res.duplicate, entries: readAll_() };
    } else {
      out = { ok: true, entries: readAll_() };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }

  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(out) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** Run this once from the editor to check the sheet wiring without the web app. */
function selfTest() {
  add_('Annie', '2026-08-26', 40);
  Logger.log(JSON.stringify(readAll_()));
}
