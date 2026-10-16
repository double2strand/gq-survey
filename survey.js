/* GeneQuanta survey — vanilla JS, no build step. */
(function () {
  'use strict';

  var TOTAL_QUESTION_SCREENS = 5; // screens 1-5; screen 6 is the thank-you page
  var STORAGE_KEY = 'gq_survey_responses';
  var REQUEST_TIMEOUT_MS = 10000;
  // Payload keys. q1-q9 keep their original keys (= Sheet columns) so existing data stays aligned;
  // questions added in Oct 2026 use named keys. Displayed numbers are in index.html.
  var QUESTIONS = ['q1', 'q2', 'q3', 'q4', 'features', 'q5', 'q6', 'blood_barrier', 'q7', 'q8', 'q9'];
  var OTHER_FIELDS = ['q2_other', 'q3_other', 'q4_other', 'features_other', 'q7_other', 'q8_other', 'q9_other'];
  var URL_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'src'];

  var form = document.getElementById('survey');
  var screens = Array.prototype.slice.call(document.querySelectorAll('.screen'));
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var btnDone = document.getElementById('btn-done');
  var nav = document.getElementById('nav');
  var progress = document.getElementById('progress');
  var progressLabel = document.getElementById('progress-label');
  var progressBar = document.getElementById('progress-bar');
  var progressFill = document.getElementById('progress-fill');

  var current = 1;
  var submitting = false;
  var submitted = false;

  /* ---------- helpers ---------- */

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (e) {
      return '';
    }
  }

  function checkedValues(name) {
    var nodes = form.querySelectorAll('input[name="' + name + '"]:checked');
    return Array.prototype.map.call(nodes, function (n) { return n.value; });
  }

  function otherText(field) {
    var input = document.getElementById(field);
    if (!input) return '';
    var opt = document.getElementById(input.getAttribute('data-opt'));
    // Only keep the "other" text if its option is (still) selected.
    if (opt && !opt.checked) return '';
    return input.value.trim();
  }

  function buildPayload() {
    var data = {
      timestamp: new Date().toISOString(),
      response_id: randomId()
    };
    QUESTIONS.forEach(function (q) {
      data[q] = checkedValues(q).join('; ');
      var other = q + '_other';
      if (OTHER_FIELDS.indexOf(other) !== -1) data[other] = otherText(other);
    });
    URL_PARAMS.forEach(function (p) { data[p] = getParam(p); });
    data.user_agent = navigator.userAgent || '';
    data.referrer = document.referrer || '';
    return data;
  }

  function storeLocally(payload, status) {
    try {
      var list = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
      var found = false;
      list.forEach(function (item) {
        if (item && item.payload && item.payload.response_id === payload.response_id) {
          item.status = status;
          item.updated = new Date().toISOString();
          found = true;
        }
      });
      if (!found) list.push({ payload: payload, status: status, updated: new Date().toISOString() });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      /* storage unavailable (e.g. private mode) — ignore */
    }
  }

  function sendToEndpoint(endpoint, payload) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    return fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /* ---------- navigation ---------- */

  function show(n, focus) {
    current = n;
    screens.forEach(function (s) {
      s.hidden = Number(s.getAttribute('data-screen')) !== n;
    });
    var isThanks = n > TOTAL_QUESTION_SCREENS;
    btnPrev.hidden = n === 1 || isThanks;
    btnNext.hidden = n >= TOTAL_QUESTION_SCREENS;
    btnDone.hidden = n !== TOTAL_QUESTION_SCREENS;
    nav.hidden = isThanks;

    var pct = isThanks ? 100 : Math.round(((n - 1) / TOTAL_QUESTION_SCREENS) * 100);
    progressFill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(pct));
    progressLabel.textContent = isThanks ? 'Complete' : 'Page ' + n + ' of ' + TOTAL_QUESTION_SCREENS;
    progress.hidden = false;

    if (focus !== false) {
      window.scrollTo(0, 0);
      var heading = document.querySelector('.screen[data-screen="' + n + '"] .section-title');
      if (heading) {
        try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }
      }
    }
  }

  /* ---------- validation ---------- */

  function errorFor(fs) {
    var inputs = fs.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (inputs.length) {
      var anyChecked = Array.prototype.some.call(inputs, function (i) { return i.checked; });
      if (!anyChecked) {
        return inputs[0].type === 'checkbox' ? 'Please select at least one option.' : 'Please select an option.';
      }
      var others = fs.querySelectorAll('.other-text');
      for (var k = 0; k < others.length; k++) {
        var opt = document.getElementById(others[k].getAttribute('data-opt'));
        if (opt && opt.checked && others[k].value.trim() === '') {
          return { msg: 'Please specify your “Other” answer.', field: others[k] };
        }
      }
      return '';
    }
    var text = fs.querySelector('input[type="text"], textarea');
    if (text && text.value.trim() === '') return { msg: 'Please answer this question.', field: text };
    return '';
  }

  function setError(fs, err) {
    var msg = typeof err === 'string' ? err : err.msg;
    var box = fs.querySelector('.q-error');
    Array.prototype.forEach.call(fs.querySelectorAll('.other-text'), function (t) {
      t.classList.remove('is-invalid'); t.removeAttribute('aria-invalid');
    });
    if (!msg) {
      fs.classList.remove('has-error');
      fs.removeAttribute('aria-invalid');
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('p');
      box.className = 'q-error';
      box.id = (fs.getAttribute('data-q') || 'q') + '-error';
      box.setAttribute('role', 'alert');
      fs.appendChild(box);
      fs.setAttribute('aria-describedby', box.id);
    }
    box.textContent = msg;
    fs.classList.add('has-error');
    fs.setAttribute('aria-invalid', 'true');
    if (err.field) { err.field.classList.add('is-invalid'); err.field.setAttribute('aria-invalid', 'true'); }
  }

  function screenQuestions(n) {
    var scr = document.querySelector('.screen[data-screen="' + n + '"]');
    return scr ? Array.prototype.slice.call(scr.querySelectorAll('fieldset.question')) : [];
  }

  // Returns true if every question on screen n is answered; otherwise marks errors.
  function validateScreen(n) {
    var first = null;
    screenQuestions(n).forEach(function (fs) {
      var err = errorFor(fs);
      setError(fs, err);
      if (err && !first) first = { fs: fs, err: err };
    });
    if (first) {
      first.fs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var target = first.err.field || first.fs.querySelector('input');
      if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
      return false;
    }
    return true;
  }

  // Clear (or update) an error as soon as the question is answered.
  form.addEventListener('input', revalidate);
  form.addEventListener('change', revalidate);
  function revalidate(e) {
    var fs = e.target.closest && e.target.closest('fieldset.question');
    if (fs && fs.classList.contains('has-error')) setError(fs, errorFor(fs));
  }

  btnNext.addEventListener('click', function () {
    if (current < TOTAL_QUESTION_SCREENS && validateScreen(current)) show(current + 1);
  });
  btnPrev.addEventListener('click', function () {
    if (current > 1) show(current - 1);
  });

  /* ---------- "Other (please specify)" auto-select ---------- */

  Array.prototype.forEach.call(form.querySelectorAll('.other-text'), function (input) {
    var opt = document.getElementById(input.getAttribute('data-opt'));
    input.addEventListener('input', function () {
      if (opt && input.value.trim() !== '' && !opt.checked) {
        opt.checked = true;
        opt.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Enter inside a text box should never submit the form.
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });
  });

  /* ---------- submit ---------- */

  function finish() {
    submitted = true;
    submitting = false;
    show(TOTAL_QUESTION_SCREENS + 1);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (current !== TOTAL_QUESTION_SCREENS || submitting || submitted) return;
    // Enforce every page (guards against skipping via devtools/API).
    for (var s = 1; s <= TOTAL_QUESTION_SCREENS; s++) {
      if (screenQuestions(s).some(function (fs) { return !!errorFor(fs); })) {
        if (s !== current) show(s);
        validateScreen(s);
        return;
      }
    }
    submitting = true;
    btnDone.disabled = true;
    btnPrev.disabled = true;
    btnDone.textContent = 'Submitting…';

    // Honeypot: bots fill hidden fields; silently drop but behave normally.
    var hp = document.getElementById('website');
    if (hp && hp.value.trim() !== '') {
      finish();
      return;
    }

    var payload = buildPayload();
    var endpoint = String(window.SURVEY_ENDPOINT || '').trim();
    storeLocally(payload, endpoint ? 'pending' : 'no-endpoint');

    if (!endpoint) {
      finish();
      return;
    }

    try {
      sendToEndpoint(endpoint, payload).then(function () {
        storeLocally(payload, 'sent');
        finish();
      }, function () {
        storeLocally(payload, 'error');
        finish();
      });
    } catch (err) {
      storeLocally(payload, 'error');
      finish();
    }
  });

  // Expose a tiny API for testing/debugging.
  window.GQSurvey = {
    buildPayload: buildPayload,
    validateScreen: validateScreen,
    show: show,
    storageKey: STORAGE_KEY,
    get current() { return current; }
  };

  show(1, false);
})();
