/* GeneQuanta survey dashboard — vanilla JS + Chart.js. */
(function () {
  'use strict';

  var KEY_STORE = 'gq_dashboard_key';
  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1';
  // ?endpoint= override is for local testing only; normally config.js supplies SURVEY_ENDPOINT.
  var ENDPOINT = params.get('endpoint') || String(window.SURVEY_ENDPOINT || '').trim();

  // Question definitions (display numbers match index.html; keys match the payload / Sheet columns).
  var Q = [
    { key: 'q1', n: 1, title: 'Approach to health', type: 'single', short: true,
      opts: ['Very proactive– I actively seek out new tests and technologies.', 'Moderately proactive – I try to stay healthy but don\'t seek out advanced testing.', 'Reactive– I only see a doctor when I have a specific concern.', 'Minimalist– I prefer to manage health independently without medical intervention.'] },
    { key: 'q2', n: 2, title: 'Direct-to-consumer tests used', type: 'multi', other: 'q2_other',
      opts: ['Ancestry DNA testing', 'Health-focused DNA testing (e.g., genetic risk for specific diseases)', 'Biological age testing (e.g., blood tests for aging markers)', 'No - never used', 'Other'] },
    { key: 'q3', n: 3, title: 'Primary preventative-health concern', type: 'single', other: 'q3_other',
      opts: ['Identifying unknown risks early', 'Optimizing current performance/energy', 'Slowing down aging', 'Preventing specific diseases', 'Understand lifestyle impact for health', 'Other'] },
    { key: 'q4', n: 4, title: 'Interest in a multi-system epigenetic profile', type: 'single', other: 'q4_other',
      opts: ['Extremely interested', 'Slightly interested', 'Neutral', 'Not interested', 'Other'] },
    { key: 'features', n: 5, title: 'Most valuable features', type: 'multi', other: 'features_other', added: true,
      opts: ['Biological age prediction', 'System-specific aging analysis', 'Disease (terminating or chronic) risk prediction', 'Lifestyle impact monitoring', 'Actionable lifestyle recommendations', 'Other'] },
    { key: 'q5', n: 6, title: 'Maximum price', type: 'single',
      opts: ['I would not pay', 'Less than $100', '$100-$250', '$251-$500', '$501-$1,000', 'More than $1,000'] },
    { key: 'q6', n: 7, title: 'Samples comfortable self-collecting', type: 'multi', opts: ['Blood', 'Saliva', 'Stool', 'None'] },
    { key: 'blood_barrier', n: 8, title: 'Blood sample as a barrier', type: 'single', added: true,
      opts: ['Not a barrier', 'Minor', 'Moderate', 'Major', 'Would stop me entirely'] },
    { key: 'q7', n: 9, title: 'More likely if a provider recommended it', type: 'single', other: 'q7_other', opts: ['Yes', 'No', 'Other'] },
    { key: 'q8', n: 10, title: 'Disease risks of interest', type: 'multi', other: 'q8_other',
      opts: ['Cardiovascular', 'Cancer', 'Neurodegenerative', 'Type 2 Diabetes', 'Autoimmune', 'Overall risk only', 'Other'] },
    { key: 'q9', n: 11, title: 'Main concern about commercial epigenetic tests', type: 'single', other: 'q9_other',
      opts: ['Data privacy', 'Clinical validity', 'Actionability of results', 'Psychological impact', 'Other'] }
  ];
  var QBY = {}; Q.forEach(function (q) { QBY[q.key] = q; });
  var SHORT = { // compact labels for long option text
    'Very proactive– I actively seek out new tests and technologies.': 'Very proactive',
    'Moderately proactive – I try to stay healthy but don\'t seek out advanced testing.': 'Moderately proactive',
    'Reactive– I only see a doctor when I have a specific concern.': 'Reactive',
    'Minimalist– I prefer to manage health independently without medical intervention.': 'Minimalist',
    'Health-focused DNA testing (e.g., genetic risk for specific diseases)': 'Health-focused DNA',
    'Biological age testing (e.g., blood tests for aging markers)': 'Biological age test',
    'Disease (terminating or chronic) risk prediction': 'Disease risk prediction',
    'Actionable lifestyle recommendations': 'Lifestyle recommendations'
  };
  function lbl(v) { return SHORT[v] || v; }

  var PALETTE = ['#9cc2e6', '#d4d6da', '#5ccbb8', '#d9b660', '#f08a9c', '#a7abb2', '#7f9cf5', '#6c7078'];
  var ORDINAL = ['#5ccbb8', '#9cc2e6', '#d4d6da', '#d9b660', '#f08a9c']; // good -> bad

  var $ = function (id) { return document.getElementById(id); };
  var allRows = [], rows = [], charts = [], generatedAt = null;

  /* ---------- helpers ---------- */
  function vals(r, k) { var s = (r[k] || '').trim(); return s ? s.split(/\s*;\s*/).filter(Boolean) : []; }
  function when(r) { var t = Date.parse(r.timestamp || r.received_at || ''); return isNaN(t) ? null : new Date(t); }
  function dayKey(d) { return d.toISOString().slice(0, 10); }
  function source(r) {
    var s = (r.src || r.utm_source || '').trim().toLowerCase();
    if (s) return s;
    if (r.referrer) return 'ref: ' + r.referrer;
    return '(direct)';
  }
  function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function isComplete(r) {
    var hasNew = Q.some(function (q) { return q.added && vals(r, q.key).length; });
    return Q.every(function (q) {
      if (q.added && !hasNew) return true; // rows from before these questions existed
      var v = vals(r, q.key);
      if (!v.length) return false;
      if (q.other && v.indexOf('Other') !== -1 && !(r[q.other] || '').trim()) return false;
      return true;
    });
  }

  /* ---------- charts ---------- */
  if (window.Chart) {
    Chart.defaults.color = '#a7abb2';
    Chart.defaults.borderColor = '#2a2b31';
    Chart.defaults.font.family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = false;
  }
  function destroyCharts() { charts.forEach(function (c) { c.destroy(); }); charts = []; }

  function card(container, title, metaText, warn) {
    var c = el('div', 'card chart-card');
    c.appendChild(el('h3', null, title));
    var m = el('div', 'meta', metaText);
    if (warn) { m.appendChild(document.createTextNode(' · ')); m.appendChild(el('span', 'warn', warn)); }
    c.appendChild(m);
    if (container) container.appendChild(c);
    return c;
  }
  function smallWarn(n) { return n === 0 ? '' : (n < 10 ? 'small sample — treat with caution' : ''); }
  function chartIn(c, cfg, height) {
    var box = el('div', 'chart-box'); if (height) box.style.height = height + 'px';
    var cv = el('canvas'); box.appendChild(cv); c.appendChild(box);
    if (!window.Chart) { box.textContent = 'Chart library failed to load.'; return; }
    charts.push(new Chart(cv, cfg));
  }
  function emptyIn(c, msg) { c.appendChild(el('div', 'empty', msg || 'No responses for this view yet.')); }

  function pctTooltip(countsBy) {
    return { callbacks: { label: function (ctx) {
      var cnt = countsBy ? countsBy[ctx.datasetIndex][ctx.dataIndex] : null;
      return (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + ctx.parsed[ctx.chart.options.indexAxis === 'y' ? 'x' : 'y'] + '%' + (cnt != null ? ' (' + cnt + ')' : '');
    } } };
  }

  /* ---------- rendering ---------- */
  function renderKPIs() {
    var k = $('kpis'); k.textContent = '';
    var now = generatedAt ? new Date(generatedAt) : new Date();
    var wk = rows.filter(function (r) { var d = when(r); return d && (now - d) <= 7 * 864e5; }).length;
    var prev = rows.filter(function (r) { var d = when(r); return d && (now - d) > 7 * 864e5 && (now - d) <= 14 * 864e5; }).length;
    var comp = rows.filter(isComplete).length;
    var interested = rows.filter(function (r) { return /interested/.test(r.q4 || '') && !/^Not/.test(r.q4); }).length;
    var withQ4 = rows.filter(function (r) { return (r.q4 || '').trim(); }).length;
    [
      ['Total responses', String(rows.length), allRows.length !== rows.length ? 'of ' + allRows.length + ' before filters' : 'all time'],
      ['Last 7 days', String(wk), 'previous 7 days: ' + prev],
      ['Completion', rows.length ? pct(comp, rows.length) + '%' : '–', comp + ' of ' + rows.length + ' fully answered'],
      ['Interested (Q4)', withQ4 ? pct(interested, withQ4) + '%' : '–', 'extremely or slightly · n=' + withQ4]
    ].forEach(function (x) {
      var c = el('div', 'card kpi'); c.appendChild(el('div', 'l', x[0])); c.appendChild(el('div', 'v', x[1])); c.appendChild(el('div', 's', x[2])); k.appendChild(c);
    });
  }

  function renderTime() {
    var c = $('c-time'); c.textContent = '';
    var dated = rows.map(when).filter(Boolean).sort(function (a, b) { return a - b; });
    var h = card(null, 'Daily responses and cumulative total', 'n=' + rows.length, smallWarn(rows.length));
    while (h.firstChild) c.appendChild(h.firstChild);
    if (!dated.length) return emptyIn(c);
    var counts = {}; dated.forEach(function (d) { var k = dayKey(d); counts[k] = (counts[k] || 0) + 1; });
    var labels = [], daily = [], cum = [], run = 0;
    for (var d = new Date(dayKey(dated[0])); d <= dated[dated.length - 1] || dayKey(d) === dayKey(dated[dated.length - 1]); d = new Date(d.getTime() + 864e5)) {
      var key = dayKey(d); labels.push(key); var v = counts[key] || 0; daily.push(v); run += v; cum.push(run);
      if (labels.length > 1000) break;
    }
    chartIn(c, { type: 'bar', data: { labels: labels, datasets: [
      { type: 'bar', label: 'Daily', data: daily, backgroundColor: '#6c7078', yAxisID: 'y' },
      { type: 'line', label: 'Cumulative', data: cum, borderColor: '#9cc2e6', backgroundColor: '#9cc2e6', pointRadius: 0, tension: .2, yAxisID: 'y1' }
    ] }, options: { interaction: { mode: 'index', intersect: false }, scales: {
      x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      y: { beginAtZero: true, title: { display: true, text: 'Daily' }, ticks: { precision: 0 } },
      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Cumulative' }, ticks: { precision: 0 } } } } }, 280);
  }

  function distribution(q, subset) {
    var answered = subset.filter(function (r) { return vals(r, q.key).length; });
    var counts = {}; q.opts.forEach(function (o) { counts[o] = 0; });
    answered.forEach(function (r) { vals(r, q.key).forEach(function (v) { counts[v] = (counts[v] || 0) + 1; }); });
    return { n: answered.length, counts: counts, labels: Object.keys(counts) };
  }

  function renderQuestions() {
    var wrap = $('questions'); wrap.textContent = '';
    Q.forEach(function (q) {
      var d = distribution(q, rows);
      var meta = 'Q' + q.n + ' · ' + (q.type === 'multi' ? 'multi-select, % of respondents (can exceed 100%)' : 'single choice, % of respondents') + ' · n=' + d.n;
      if (q.added) meta += ' · added Oct 2026';
      var c = card(wrap, 'Q' + q.n + '. ' + q.title, meta, smallWarn(d.n));
      if (!d.n) return emptyIn(c, q.added ? 'No answers yet (question added Oct 2026).' : null);
      var cnt = d.labels.map(function (l) { return d.counts[l]; });
      chartIn(c, { type: 'bar', data: { labels: d.labels.map(lbl), datasets: [{ data: cnt.map(function (x) { return pct(x, d.n); }), backgroundColor: q.key === 'blood_barrier' ? ORDINAL : '#9cc2e6', borderRadius: 3 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: pctTooltip([cnt]) },
          scales: { x: { beginAtZero: true, max: q.type === 'multi' ? undefined : 100, ticks: { callback: function (v) { return v + '%'; } } }, y: { ticks: { autoSkip: false } } } } }, Math.max(160, d.labels.length * 38 + 50));
    });
  }

  // Stacked 100% bars: rows grouped by `by`, each segment an answer of `of`.
  function crossTab(container, title, byKey, ofKey, opts) {
    opts = opts || {};
    var by = QBY[byKey], of = QBY[ofKey];
    var subset = rows.filter(function (r) { return vals(r, byKey).length && vals(r, ofKey).length; });
    var c = card(container, title, 'Q' + by.n + ' × Q' + of.n + ' · ' + (opts.note || '% within each group') + ' · n=' + subset.length, smallWarn(subset.length));
    if (!subset.length) return emptyIn(c, 'Not enough overlapping answers yet.');
    var groups = by.opts.filter(function (g) { return subset.some(function (r) { return vals(r, byKey).indexOf(g) !== -1; }); });
    var groupN = groups.map(function (g) { return subset.filter(function (r) { return vals(r, byKey).indexOf(g) !== -1; }).length; });
    var series = of.opts.filter(function (o) { return subset.some(function (r) { return vals(r, ofKey).indexOf(o) !== -1; }); });
    var countsBy = [];
    var ds = series.map(function (s, i) {
      var cnts = groups.map(function (g) { return subset.filter(function (r) { return vals(r, byKey).indexOf(g) !== -1 && vals(r, ofKey).indexOf(s) !== -1; }).length; });
      countsBy.push(cnts);
      return { label: lbl(s), data: cnts.map(function (x, j) { return pct(x, groupN[j]); }), backgroundColor: (opts.colors || PALETTE)[i % (opts.colors || PALETTE).length] };
    });
    chartIn(c, { type: 'bar', data: { labels: groups.map(function (g, j) { return lbl(g) + ' (n=' + groupN[j] + ')'; }), datasets: ds },
      options: { indexAxis: 'y', plugins: { tooltip: pctTooltip(countsBy), legend: { position: 'bottom', labels: { boxWidth: 12 } } },
        scales: { x: { stacked: !opts.grouped, beginAtZero: true, max: opts.grouped ? undefined : 100, ticks: { callback: function (v) { return v + '%'; } } }, y: { stacked: !opts.grouped, ticks: { autoSkip: false } } } } },
      Math.max(240, groups.length * (opts.grouped ? 22 * series.length : 34) + 110));
  }

  function renderCross() {
    var w = $('crosstabs'); w.textContent = '';
    crossTab(w, 'Interest by maximum price', 'q5', 'q4');
    crossTab(w, 'Blood-sample barrier by self-sample comfort', 'q6', 'blood_barrier', { colors: ORDINAL, note: '% within each sample type (multi-select groups overlap)' });
    crossTab(w, 'Most valuable features by primary concern', 'q3', 'features', { grouped: true, note: '% of each concern group choosing the feature' });
  }

  function renderSource() {
    var c = $('c-source'); c.textContent = '';
    var counts = {}; rows.forEach(function (r) { var s = source(r); counts[s] = (counts[s] || 0) + 1; });
    var labels = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var h = card(null, 'Responses by source', 'src / utm_source, else referrer host · n=' + rows.length, smallWarn(rows.length));
    while (h.firstChild) c.appendChild(h.firstChild);
    if (!rows.length) return emptyIn(c);
    var camp = {}; rows.forEach(function (r) { if (r.utm_campaign) camp[r.utm_campaign] = (camp[r.utm_campaign] || 0) + 1; });
    chartIn(c, { type: 'bar', data: { labels: labels, datasets: [{ data: labels.map(function (l) { return counts[l]; }), backgroundColor: '#d4d6da', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } }, Math.max(140, labels.length * 34 + 40));
    var ck = Object.keys(camp);
    if (ck.length) c.appendChild(el('p', 'muted small', 'Campaigns: ' + ck.sort(function (a, b) { return camp[b] - camp[a]; }).map(function (k) { return k + ' (' + camp[k] + ')'; }).join(', ')));
  }

  var STOP = 'a an and the of to for in on or with my i me is it be as at by e.g eg etc not no yes other my our your more less very'.split(' ');
  function renderOthers() {
    var w = $('others'); w.textContent = '';
    var list = [];
    rows.forEach(function (r) {
      Q.forEach(function (q) { if (q.other && (r[q.other] || '').trim()) list.push({ q: q, text: r[q.other].trim(), d: when(r) }); });
    });
    w.appendChild(el('p', 'muted small', list.length + ' free-text answer' + (list.length === 1 ? '' : 's') + ' in the current filter.'));
    if (!list.length) return;
    var freq = {};
    list.forEach(function (o) { o.text.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\s-]/g, ' ').split(/\s+/).forEach(function (t) {
      if (t.length > 2 && STOP.indexOf(t) === -1) freq[t] = (freq[t] || 0) + 1; }); });
    var top = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a] || a.localeCompare(b); }).slice(0, 30);
    if (top.length) {
      w.appendChild(el('h3', 'muted small', 'Most frequent words'));
      var words = el('div', 'words');
      top.forEach(function (t) { var s = el('span', null, t + ' '); s.appendChild(el('small', null, '×' + freq[t])); s.style.fontSize = (13 + Math.min(8, freq[t] * 1.5)) + 'px'; words.appendChild(s); });
      w.appendChild(words);
    }
    var sc = el('div', 'table-scroll'), t = el('table'), th = el('thead'), tr = el('tr');
    ['Date', 'Question', 'Answer'].forEach(function (x) { tr.appendChild(el('th', null, x)); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    list.sort(function (a, b) { return (b.d || 0) - (a.d || 0); }).forEach(function (o) {
      var r = el('tr'); r.appendChild(el('td', null, o.d ? dayKey(o.d) : '')); r.appendChild(el('td', null, 'Q' + o.q.n + ' ' + o.q.title));
      r.appendChild(el('td', 'ans', o.text)); tb.appendChild(r);
    });
    t.appendChild(tb); sc.appendChild(t); w.appendChild(sc);
  }

  function render() {
    destroyCharts();
    renderKPIs(); renderTime(); renderCross(); renderQuestions(); renderSource(); renderOthers();
    $('updated').textContent = (DEMO ? 'Example data generated ' : 'Data fetched ') + new Date(generatedAt || Date.now()).toLocaleString('en-GB') + ' · showing ' + rows.length + ' of ' + allRows.length + ' responses';
  }

  /* ---------- filters & export ---------- */
  function applyFilters() {
    var from = $('f-from').value, to = $('f-to').value, src = $('f-src').value;
    rows = allRows.filter(function (r) {
      var d = when(r), k = d ? dayKey(d) : '';
      if (from && (!k || k < from)) return false;
      if (to && (!k || k > to)) return false;
      if (src && source(r) !== src) return false;
      return true;
    });
    render();
  }
  function fillSources() {
    var sel = $('f-src'), cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    var seen = {}; allRows.forEach(function (r) { seen[source(r)] = (seen[source(r)] || 0) + 1; });
    Object.keys(seen).sort().forEach(function (s) { var o = el('option', null, s + ' (' + seen[s] + ')'); o.value = s; sel.appendChild(o); });
    sel.value = seen[cur] ? cur : '';
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula guard
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var keys = ['timestamp']; Q.forEach(function (q) { keys.push(q.key); if (q.other) keys.push(q.other); });
    ['utm_source', 'utm_medium', 'utm_campaign', 'src', 'referrer', 'received_at'].forEach(function (k) { keys.push(k); });
    var head = keys.map(function (k) { var q = QBY[k]; return q ? 'Q' + q.n + ' ' + q.title : (k.slice(-6) === '_other' ? 'Q' + (Q.filter(function (x) { return x.other === k; })[0] || {}).n + ' Other' : k); });
    var lines = [head.map(csvCell).join(',')].concat(rows.map(function (r) { return keys.map(function (k) { return csvCell(r[k]); }).join(','); }));
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = 'gq-survey-' + (DEMO ? 'EXAMPLE-' : '') + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ---------- data loading ---------- */
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cb = 'gqcb_' + Math.random().toString(36).slice(2);
      var s = document.createElement('script');
      var t = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, 20000);
      function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
      window[cb] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error('network error')); };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  function fetchStats(key) {
    var url = ENDPOINT + (ENDPOINT.indexOf('?') === -1 ? '?' : '&') + 'action=stats&key=' + encodeURIComponent(key);
    // Apps Script answers GET with a 302 to script.googleusercontent.com, which sends
    // Access-Control-Allow-Origin:* — so plain fetch normally works. If a browser/extension
    // blocks it, fall back to JSONP (the endpoint supports &callback=).
    return fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () { return jsonp(url); });
  }

  function status(msg) { var s = $('status'); s.textContent = msg || ''; s.hidden = !msg; }
  function showLogin(err) {
    $('dash').hidden = true; $('btn-logout').hidden = true; $('login').hidden = false; status('');
    var e = $('login-error'); e.textContent = err || ''; e.hidden = !err;
    $('key-input').focus();
  }
  function setData(data) {
    allRows = (data.rows || []).slice().sort(function (a, b) { return (when(a) || 0) - (when(b) || 0); });
    generatedAt = data.generated_at || new Date().toISOString();
    fillSources();
    $('login').hidden = true; $('dash').hidden = false; status('');
    applyFilters();
  }
  function load(key) {
    if (!ENDPOINT) { showLogin('No endpoint configured (config.js SURVEY_ENDPOINT is empty).'); return; }
    status('Loading responses…');
    fetchStats(key).then(function (data) {
      if (!data || !data.ok) {
        if (data && data.error === 'unauthorized') { localStorage.removeItem(KEY_STORE); showLogin('That key was not accepted.'); }
        else showLogin('Could not load data: ' + ((data && data.error) || 'unknown error'));
        return;
      }
      localStorage.setItem(KEY_STORE, key);
      $('btn-logout').hidden = false;
      setData(data);
    }, function (err) { showLogin('Could not reach the endpoint (' + err.message + ').'); });
  }

  /* ---------- demo data ---------- */
  function demoData() {
    var seed = 20261020; function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
    function pick(opts, w) { var t = 0, i, x = rnd() * w.reduce(function (a, b) { return a + b; }, 0); for (i = 0; i < opts.length; i++) { t += w[i]; if (x < t) return opts[i]; } return opts[opts.length - 1]; }
    function multi(opts, probs) { var o = opts.filter(function (_, i) { return rnd() < probs[i]; }); return o.length ? o : [opts[0]]; }
    var srcs = [['linkedin', 'social', 'launch'], ['reddit', '', ''], ['newsletter', 'email', 'oct'], ['', '', ''], ['x', 'social', 'launch']];
    var otherTexts = { q2_other: ['gut microbiome', 'food sensitivity', 'allergy test', 'vitamin panel'], q3_other: ['sleep quality', 'family history'],
      features_other: ['sleep tracking', 'pharmacogenomics', 'hormone health', 'comparison with friends'], q8_other: ['kidney disease', 'osteoporosis', 'thyroid'], q9_other: ['cost', 'cost of retesting', 'insurance use of data'], q7_other: ['depends on the provider'] };
    var out = [], now = Date.now();
    for (var i = 0; i < 160; i++) {
      var age = Math.pow(rnd(), 1.6) * 42; // more recent responses
      var d = new Date(now - age * 864e5 - rnd() * 864e5);
      var s = srcs[Math.floor(rnd() * srcs.length)];
      var q5 = pick(QBY.q5.opts, [10, 22, 30, 22, 10, 6]);
      var pi = QBY.q5.opts.indexOf(q5);
      var q4 = pick(QBY.q4.opts, pi === 0 ? [5, 20, 35, 38, 2] : [20 + pi * 6, 35, 20, 8, 2]);
      var q6 = multi(QBY.q6.opts.slice(0, 3), [0.45, 0.9, 0.3]);
      var hasBlood = q6.indexOf('Blood') !== -1;
      var r = {
        timestamp: d.toISOString(), received_at: d.toISOString(),
        q1: pick(QBY.q1.opts, [25, 45, 20, 10]),
        q2: multi(QBY.q2.opts, [0.35, 0.2, 0.12, 0.35, 0.08]).join('; '),
        q3: pick(QBY.q3.opts, [30, 15, 22, 18, 12, 3]), q4: q4, q5: q5, q6: q6.join('; '),
        q7: pick(QBY.q7.opts, [70, 25, 5]), q8: multi(QBY.q8.opts, [0.6, 0.55, 0.45, 0.3, 0.15, 0.1, 0.06]).join('; '),
        q9: pick(QBY.q9.opts, [35, 30, 20, 10, 5]),
        utm_source: s[0], utm_medium: s[1], utm_campaign: s[2], src: '', referrer: s[0] ? '' : (rnd() < .5 ? 'www.google.com' : '')
      };
      if (age < 30) { // new questions only exist for recent rows (like the real sheet)
        r.features = multi(QBY.features.opts, [0.6, 0.4, 0.55, 0.45, 0.5, 0.07]).join('; ');
        r.blood_barrier = pick(QBY.blood_barrier.opts, hasBlood ? [45, 35, 15, 4, 1] : [8, 20, 30, 25, 17]);
      }
      Q.forEach(function (q) { if (q.other && vals(r, q.key).indexOf('Other') !== -1) { var l = otherTexts[q.other] || ['other']; r[q.other] = l[Math.floor(rnd() * l.length)]; } });
      if (rnd() < 0.08) { r.q9 = ''; } // a few incomplete legacy rows
      out.push(r);
    }
    return { ok: true, generated_at: new Date(now).toISOString(), rows: out };
  }

  /* ---------- wire up ---------- */
  ['f-from', 'f-to', 'f-src'].forEach(function (id) { $(id).addEventListener('change', applyFilters); });
  $('btn-reset').addEventListener('click', function () { $('f-from').value = ''; $('f-to').value = ''; $('f-src').value = ''; applyFilters(); });
  $('btn-csv').addEventListener('click', exportCSV);
  $('btn-refresh').addEventListener('click', function () { if (DEMO) setData(demoData()); else load(localStorage.getItem(KEY_STORE) || ''); });
  $('btn-logout').addEventListener('click', function () { localStorage.removeItem(KEY_STORE); allRows = rows = []; destroyCharts(); showLogin(''); });
  $('login-form').addEventListener('submit', function (e) { e.preventDefault(); var k = $('key-input').value.trim(); if (k) load(k); });

  window.GQDashboard = { get rows() { return rows; }, get allRows() { return allRows; }, isComplete: isComplete };

  if (DEMO) { $('demo-banner').hidden = false; document.title = 'EXAMPLE DATA · ' + document.title; setData(demoData()); }
  else if (localStorage.getItem(KEY_STORE)) load(localStorage.getItem(KEY_STORE));
  else showLogin('');
})();
