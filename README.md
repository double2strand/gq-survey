# GeneQuanta survey

A free, standalone version of the GeneQuanta consumer research survey
**"GeneQuanta Epigenetic Health & Longevity Profiling: Understanding Your Needs"**
(mirrors the original SurveyMonkey survey). Responses go to a Google Sheet through a small Google Apps Script.

**Live:** https://double2strand.github.io/gq-survey/

## How it works
- Plain HTML, CSS and vanilla JS. No build step. Hosted on GitHub Pages.
- 5 survey pages (intro + 9 questions) with Next / Prev, Done, then a thank-you page. No question is required.
- On **Done** the answers are POSTed as JSON to the URL in [`config.js`](config.js) (`window.SURVEY_ENDPOINT`).
- Every submission is also saved in the respondent's browser (`localStorage`, key `gq_survey_responses`) as a backup. If the endpoint is empty or unreachable, the respondent still sees the thank-you page.
- `utm_source`, `utm_medium`, `utm_campaign` and `src` link parameters are recorded so you can see which channel each response came from.
- Basic bot protection with a hidden honeypot field. The page is set to `noindex`.

## Files
| File | Purpose |
| --- | --- |
| `index.html` | The survey (all pages) |
| `styles.css` | Styling |
| `survey.js` | Page navigation, "Other" auto-select, submission |
| `config.js` | The one setting: `window.SURVEY_ENDPOINT` |
| `apps-script/Code.gs` | Google Apps Script backend that writes rows to the **Responses** sheet |
| `SETUP.md` | Connect Google Sheets in about 2 minutes |

## Setup
See [SETUP.md](SETUP.md). After you deploy the Apps Script, paste the Web app URL into `config.js`:

```js
window.SURVEY_ENDPOINT = 'https://script.google.com/macros/s/XXXX/exec';
```

## Local preview
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Tests
```sh
node tests/code_gs.test.js                 # Apps Script logic with stubbed SpreadsheetApp/LockService
npm i puppeteer-core && python3 -m http.server 8765 &
node tests/e2e.test.js                     # headless Chrome end-to-end (set CHROME=/path/to/chrome)
```

## Analytics dashboard

`dashboard.html` (live: https://double2strand.github.io/gq-survey/dashboard.html) charts the responses.
It reads them from the Apps Script web app (`GET ?action=stats&key=…`). The key is stored in the
Script Property `DASHBOARD_KEY` (Project Settings → Script properties) and never in this repo.
Preview with synthetic example data: `dashboard.html?demo=1`.
