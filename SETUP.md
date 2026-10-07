# Connect the survey to Google Sheets (about 2 minutes)

1. Go to <https://sheets.new> to create a new Google Sheet. Name it e.g. **GeneQuanta Survey Responses**.
2. In the sheet, open **Extensions > Apps Script**.
3. Delete everything in the editor, then paste the full contents of [`apps-script/Code.gs`](apps-script/Code.gs). Click **Save** (disk icon).
4. Click **Deploy > New deployment**.
5. Click the gear icon next to "Select type" and choose **Web app**.
6. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Click **Deploy**, then **Authorize access**. Choose your Google account. If you see "Google hasn't verified this app", click **Advanced > Go to (project name) (unsafe)** (it's your own script), then **Allow**.
8. Copy the **Web app URL** (it ends in `/exec`).
9. Send that URL back to the assistant. It will be pasted into `config.js` and the site redeployed.

Optional check: open the Web app URL in your browser. It should say **GeneQuanta survey endpoint OK**.
A **Responses** tab with headers is created automatically when the first response arrives.

**Note:** if you edit `Code.gs` later, go to **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy** so the same URL keeps working.

## Tracking channels
Add tags to the link you share, and they will show up as columns in the sheet:

- `https://tw599.github.io/gq-survey/?utm_source=linkedin&utm_medium=social&utm_campaign=launch`
- `https://tw599.github.io/gq-survey/?src=reddit`
