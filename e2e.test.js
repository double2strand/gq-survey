const puppeteer = require('puppeteer-core');
const http = require('http');
const assert = require('assert');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';

const EXPECT = {
  title: 'GeneQuanta Epigenetic Health & Longevity Profiling: Understanding Your Needs',
  sections: ['Introduction & Informed Consent', 'Current Health Awareness & Demographics', 'Platform Interest & Value Proposition', 'Willingness to Pay & Adoption', 'Specific Health Interests & Concerns', 'Thank you!'],
  questions: [
    ['1. How would you describe your current approach to managing your health and wellness?', ['Very proactive– I actively seek out new tests and technologies.', "Moderately proactive – I try to stay healthy but don't seek out advanced testing.", 'Reactive– I only see a doctor when I have a specific concern.', 'Minimalist– I prefer to manage health independently without medical intervention.']],
    ['2. Have you ever used a direct-to-consumer genetic or biological testing service?', ['Ancestry DNA testing', 'Health-focused DNA testing (e.g., genetic risk for specific diseases)', 'Biological age testing (e.g., blood tests for aging markers)', 'No - never used', 'Other (please specify, e.g., gut microbiome, food sensitivity, allergy test)']],
    ['3. What is your primary concern regarding preventative health?', ['Identifying unknown risks early', 'Optimizing current performance/energy', 'Slowing down aging', 'Preventing specific diseases', 'Understand lifestyle impact for health', 'Other (please specify)']],
    ['4. How interested would you be in a multi-system epigenetic profile that assesses your health risks and provides actionable insights?', ['Not interested', 'Extremely interested', 'Neutral', 'Slightly interested', 'Other (please specify)']],
    ['5. Maximum price you would pay for a comprehensive epigenetic health report', ['Less than $100', '$100-$250', '$251-$500', '$501-$1,000', 'More than $1,000', 'I would not pay']],
    ['6. Which of the following samples are you comfortable to take on your own?', ['Blood', 'Saliva', 'Stool', 'None']],
    ['7. Would you be more likely to use this if recommended by a healthcare provider?', ['Yes', 'No', 'Other (please specify)']],
    ['8. Which specific disease risks interest you most?', ['Cardiovascular', 'Cancer', 'Neurodegenerative', 'Type 2 Diabetes', 'Autoimmune', 'Overall risk only']],
    ['9. What concerns you most about commercial epigenetic tests?', ['Data privacy', 'Clinical validity', 'Actionability of results', 'Psychological impact', 'Other']],
  ],
  types: ['radio', 'checkbox', 'radio', 'radio', 'radio', 'checkbox', 'radio', 'checkbox', 'radio'],
};

// Mock Apps Script endpoint: records POSTs, replies 302 like Apps Script does.
const received = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    if (req.method === 'POST') {
      received.push({ ct: req.headers['content-type'], body, method: req.method });
      res.writeHead(302, { Location: '/echo' }); res.end();
    } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
  });
});

const visible = (page, sel) => page.$eval(sel, el => !el.hidden && getComputedStyle(el).display !== 'none' && el.offsetParent !== null).catch(() => false);
const currentScreen = page => page.evaluate(() => window.GQSurvey.current);
const click = (page, sel) => page.$eval(sel, el => el.click());

async function run() {
  await new Promise(r => mock.listen(8766, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const newPage = async (url) => {
    const page = await browser.newPage();
    // Never hit the real endpoint from tests: serve an empty config.js and block Google.
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (/\/config\.js(\?|$)/.test(u)) return req.respond({ status: 200, contentType: 'application/javascript', body: "window.SURVEY_ENDPOINT = '';" });
      if (/script\.google(usercontent)?\.com/.test(u)) return req.abort();
      req.continue();
    });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'load' });
    return page;
  };

  // ---------- Static content checks ----------
  let page = await newPage(BASE);
  assert.strictEqual(await page.$eval('.survey-title', e => e.textContent.trim()), EXPECT.title);
  assert.strictEqual(await page.$eval('.brand', e => e.textContent.trim()), 'GeneQuanta');
  assert.strictEqual(await page.$eval('meta[name=robots]', e => e.content), 'noindex');
  assert.ok(await page.$eval('meta[property="og:title"]', e => e.content.length > 0));
  assert.ok(await page.$eval('meta[property="og:description"]', e => e.content.length > 0));
  const sections = await page.$$eval('.section-title', els => els.map(e => e.textContent.trim()));
  assert.deepStrictEqual(sections, EXPECT.sections);
  const qs = await page.$$eval('fieldset.question', fs => fs.map(f => ({
    legend: f.querySelector('legend').textContent.trim(),
    opts: [...f.querySelectorAll('label.opt')].map(l => l.textContent.trim()),
    types: [...new Set([...f.querySelectorAll('label.opt input')].map(i => i.type))],
    required: [...f.querySelectorAll('input')].some(i => i.required),
    others: f.querySelectorAll('.other-text').length,
  })));
  assert.strictEqual(qs.length, 9);
  qs.forEach((q, i) => {
    assert.strictEqual(q.legend, EXPECT.questions[i][0]);
    assert.deepStrictEqual(q.opts, EXPECT.questions[i][1]);
    assert.deepStrictEqual(q.types, [EXPECT.types[i]]);
    assert.strictEqual(q.required, false);
    assert.strictEqual(q.others, EXPECT.questions[i][1].some(o => o.startsWith('Other')) ? 1 : 0);
  });
  const html = await page.content();
  assert.ok(!/Neutrual/.test(html), 'typo fixed');
  assert.ok(!/SurveyMonkey/i.test(html), 'no SurveyMonkey branding');
  assert.strictEqual(await page.$eval('a[href^=mailto]', a => a.getAttribute('href')), 'mailto:info@genequanta.com?subject=Sign%20me%20up');
  // styles
  const st = await page.evaluate(() => {
    const cs = s => getComputedStyle(document.querySelector(s));
    return { btnBg: cs('#btn-next').backgroundColor, btnColor: cs('#btn-next').color, h1: cs('.survey-title').color,
      bodyBg: cs('body').backgroundColor, bodyFs: cs('body').fontSize, qFs: cs('.q-title').fontSize, qFw: cs('.q-title').fontWeight, qColor: cs('.q-title').color };
  });
  assert.strictEqual(st.btnBg, 'rgb(8, 121, 74)'); assert.strictEqual(st.btnColor, 'rgb(255, 255, 255)');
  assert.strictEqual(st.h1, 'rgb(8, 121, 74)'); assert.strictEqual(st.bodyBg, 'rgb(255, 255, 255)');
  assert.strictEqual(st.bodyFs, '16px'); assert.strictEqual(st.qFs, '20px'); assert.strictEqual(st.qFw, '500'); assert.strictEqual(st.qColor, 'rgb(6, 35, 23)');
  console.log('✓ content: title, 5 sections + thank-you, 9 questions, exact wording/option order/types, none required, styles');

  // ---------- Flow A: no endpoint ----------
  assert.strictEqual(await currentScreen(page), 1);
  assert.ok(!(await visible(page, '#btn-prev'))); assert.ok(await visible(page, '#btn-next')); assert.ok(!(await visible(page, '#btn-done')));
  assert.strictEqual(await page.$eval('#progress-label', e => e.textContent), 'Page 1 of 5');
  await page.screenshot({ path: '/tmp/gq_shot_screen1.png', fullPage: true });
  await click(page, '#btn-next');
  assert.strictEqual(await currentScreen(page), 2);
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 's2-title', 'focus moved to heading');
  assert.ok(await visible(page, '#btn-prev'));
  // Answer screen 2 with keyboard/mouse
  await page.click('input[name=q1][value^="Reactive"]');
  await page.click('input[name=q2][value="Ancestry DNA testing"]');
  await page.type('#q2_other', 'gut microbiome');
  assert.ok(await page.$eval('#q2-other-opt', e => e.checked), 'typing auto-selects Other (checkbox)');
  await page.click('input[name=q3][value="Slowing down aging"]');
  await page.type('#q3_other', 'x');
  assert.ok(await page.$eval('#q3-other-opt', e => e.checked), 'typing auto-selects Other (radio)');
  await page.click('input[name=q3][value="Slowing down aging"]'); // change mind -> other text excluded
  // Enter in text box must not submit or navigate
  await page.focus('#q2_other'); await page.keyboard.press('Enter');
  assert.strictEqual(await currentScreen(page), 2);
  await page.screenshot({ path: '/tmp/gq_shot_screen2.png', fullPage: true });
  // Prev / Next
  await click(page, '#btn-prev'); assert.strictEqual(await currentScreen(page), 1);
  await click(page, '#btn-next'); assert.strictEqual(await currentScreen(page), 2);
  assert.ok(await page.$eval('input[name=q1][value^="Reactive"]', e => e.checked), 'answers persist across Prev/Next');
  await click(page, '#btn-next'); assert.strictEqual(await currentScreen(page), 3);
  // keyboard selection of radio: focus then Space
  await page.focus('input[name=q4][value="Neutral"]'); await page.keyboard.press('Space');
  assert.ok(await page.$eval('input[name=q4][value="Neutral"]', e => e.checked), 'keyboard Space selects radio');
  await click(page, '#btn-next'); assert.strictEqual(await currentScreen(page), 4);
  await page.click('input[name=q5][value="$251-$500"]');
  await page.click('input[name=q6][value="Blood"]'); await page.click('input[name=q6][value="Saliva"]');
  await click(page, '#btn-next'); assert.strictEqual(await currentScreen(page), 5);
  assert.ok(!(await visible(page, '#btn-next'))); assert.ok(await visible(page, '#btn-done'));
  assert.strictEqual(await page.$eval('#progress-label', e => e.textContent), 'Page 5 of 5');
  await page.click('input[name=q8][value="Cancer"]'); await page.click('input[name=q8][value="Autoimmune"]');
  await page.type('#q9_other', 'cost');
  await click(page, '#btn-done');
  await page.waitForFunction(() => window.GQSurvey.current === 6);
  assert.ok(!(await visible(page, '#nav')), 'nav hidden on thank-you');
  assert.strictEqual(await page.$eval('#progress-label', e => e.textContent), 'Complete');
  await page.screenshot({ path: '/tmp/gq_shot_thanks.png', fullPage: true });
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gq_survey_responses')));
  assert.strictEqual(stored.length, 1); assert.strictEqual(stored[0].status, 'no-endpoint');
  const p = stored[0].payload;
  assert.ok(/^\d{4}-\d\d-\d\dT.*Z$/.test(p.timestamp)); assert.ok(/^[0-9a-f-]{36}$/.test(p.response_id));
  assert.strictEqual(p.q1, 'Reactive– I only see a doctor when I have a specific concern.');
  assert.strictEqual(p.q2, 'Ancestry DNA testing; Other'); assert.strictEqual(p.q2_other, 'gut microbiome');
  assert.strictEqual(p.q3, 'Slowing down aging'); assert.strictEqual(p.q3_other, '');
  assert.strictEqual(p.q4, 'Neutral'); assert.strictEqual(p.q5, '$251-$500'); assert.strictEqual(p.q6, 'Blood; Saliva');
  assert.strictEqual(p.q7, ''); assert.strictEqual(p.q8, 'Cancer; Autoimmune'); assert.strictEqual(p.q9, 'Other'); assert.strictEqual(p.q9_other, 'cost');
  assert.ok(p.user_agent.length > 0);
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'src', 'referrer', 'q4_other', 'q7_other']) assert.ok(k in p, 'payload has ' + k);
  console.log('✓ flow A (no endpoint): Next/Prev, focus, other auto-select, Enter safe, keyboard, Done -> thank-you, localStorage backup');
  await page.close();

  // ---------- Flow B: mock endpoint + UTM params + double submit ----------
  page = await newPage(BASE + '?utm_source=linkedin&utm_medium=social&utm_campaign=launch&src=tw');
  await page.evaluate(() => { window.SURVEY_ENDPOINT = 'http://127.0.0.1:8766/exec'; });
  await page.evaluate(() => window.GQSurvey.show(5));
  await page.click('input[name=q9][value="Clinical validity"]');
  await page.evaluate(() => { const b = document.getElementById('btn-done'); b.click(); b.click(); document.getElementById('survey').requestSubmit(); });
  await page.waitForFunction(() => window.GQSurvey.current === 6, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 500));
  assert.strictEqual(received.length, 1, 'exactly one POST despite triple submit');
  assert.ok(/^text\/plain/.test(received[0].ct), 'text/plain content type: ' + received[0].ct);
  const body = JSON.parse(received[0].body);
  assert.strictEqual(body.utm_source, 'linkedin'); assert.strictEqual(body.utm_medium, 'social');
  assert.strictEqual(body.utm_campaign, 'launch'); assert.strictEqual(body.src, 'tw'); assert.strictEqual(body.q9, 'Clinical validity');
  assert.ok(!('website' in body));
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gq_survey_responses')));
  assert.strictEqual(stored[stored.length - 1].status, 'sent');
  assert.strictEqual(stored[stored.length - 1].payload.response_id, body.response_id);
  console.log('✓ flow B (endpoint): single text/plain no-cors POST, UTM/src captured, double-submit prevented, status=sent');
  await page.close();

  // ---------- Flow C: endpoint unreachable ----------
  page = await newPage(BASE);
  await page.evaluate(() => { window.SURVEY_ENDPOINT = 'http://127.0.0.1:9/exec'; window.GQSurvey.show(5); });
  await click(page, '#btn-done');
  await page.waitForFunction(() => window.GQSurvey.current === 6, { timeout: 15000 });
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gq_survey_responses')));
  assert.strictEqual(stored[stored.length - 1].status, 'error');
  console.log('✓ flow C (endpoint down): thank-you still shown, kept in localStorage with status=error');
  await page.close();

  // ---------- Flow D: honeypot ----------
  const before = received.length;
  page = await newPage(BASE);
  await page.evaluate(() => { window.SURVEY_ENDPOINT = 'http://127.0.0.1:8766/exec'; document.getElementById('website').value = 'spam'; window.GQSurvey.show(5); });
  await click(page, '#btn-done');
  await page.waitForFunction(() => window.GQSurvey.current === 6);
  await new Promise(r => setTimeout(r, 500));
  assert.strictEqual(received.length, before, 'honeypot submission not sent');
  console.log('✓ flow D (honeypot filled): dropped, no POST, thank-you shown');
  await page.close();

  // ---------- Mobile ----------
  page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', req => /script\.google/.test(req.url()) ? req.abort() : (/\/config\.js/.test(req.url()) ? req.respond({ status: 200, contentType: 'application/javascript', body: "window.SURVEY_ENDPOINT = '';" }) : req.continue()));
  await page.setViewport({ width: 375, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => window.GQSurvey.show(2));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.ok(!overflow, 'no horizontal overflow on mobile');
  await page.screenshot({ path: '/tmp/gq_shot_mobile.png', fullPage: false });
  console.log('✓ mobile 375px: no horizontal overflow');

  assert.deepStrictEqual(errors, [], 'no JS errors: ' + errors.join(' | '));
  console.log('✓ no JS errors\nALL E2E TESTS PASSED against ' + BASE);
  await browser.close(); mock.close();
}
run().catch(e => { console.error('FAIL:', e); process.exit(1); });
