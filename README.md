# Google Workspace Scripts (Calendar + Meet)

This folder contains 3 Node.js scripts:

1. `create-calendar-event.js`
2. `assign-breakout-rooms-ui.js`
3. `assign-breakout-rooms-api-experiments.js`

## Prerequisites

- Node.js 18+
- npm
- A Google Cloud project with:
  - Calendar API enabled
  - OAuth consent screen configured
  - OAuth client credentials
  - OAuth scope grant for: `https://www.googleapis.com/auth/calendar.events`
- A valid OAuth refresh token for the Google account

Install dependencies:

```bash
cd /Users/naresh/Documents/NI/google-workspace-scripts
npm install
```

## 1) Create Calendar Event

Creates a Google Calendar event and optionally adds a Google Meet link.

Script: `create-calendar-event.js`

### ENV template

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_REDIRECT_URI="your-redirect-uri"
export GOOGLE_REFRESH_TOKEN="your-refresh-token"

# Optional
export CALENDAR_ID="primary"
export EVENT_SUMMARY="Team Sync"
export EVENT_DESCRIPTION="Weekly planning"
export EVENT_LOCATION="Virtual"
export EVENT_START="2026-05-02T10:00:00+05:30"
export EVENT_END="2026-05-02T11:00:00+05:30"
export EVENT_TIMEZONE="Asia/Kolkata"
export EVENT_ATTENDEES="alice@example.com,bob@example.com"
export CREATE_MEET_LINK="true"
```

### Run

```bash
npm run create:event
```

## 2) Breakout Assignment via Meet UI Automation

Automates Meet web UI using Puppeteer.

Script: `assign-breakout-rooms-ui.js`

### ENV template

```bash
export MEET_URL="https://meet.google.com/xxx-xxxx-xxx"
export BREAKOUT_ASSIGNMENTS_JSON='[
  {"name":"Room 1","participants":["Alice","Bob"]},
  {"name":"Room 2","participants":["Charlie"]}
]'

# Optional
export CHROME_USER_DATA_DIR="/Users/naresh/Library/Application Support/Google/Chrome"
export CHROME_PROFILE_DIR="Default"
# Optional:
# export CHROME_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export HEADLESS="false"
export ACTION_DELAY_MS="500"
```

### Run

```bash
npm run assign:breakouts:ui
```

## 3) Breakout Assignment via Calendar API (Experimental)

Tries undocumented payload variants against Calendar `events.patch`.

Script: `assign-breakout-rooms-api-experiments.js`

### ENV template

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_REDIRECT_URI="your-redirect-uri"
export GOOGLE_REFRESH_TOKEN="your-refresh-token"

export EVENT_ID="calendar-event-id"
export BREAKOUT_ASSIGNMENTS_JSON='[
  {"name":"Room 1","emails":["a@example.com","b@example.com"]},
  {"name":"Room 2","emails":["c@example.com"]}
]'

# Optional
export CALENDAR_ID="primary"
# all | v1 | v2 | v3
export PATCH_VARIANT="all"
```

### Run

```bash
npm run assign:breakouts:api-exp
```

## Notes / Limitations

- Official public Google Calendar/Meet APIs do not currently document a stable breakout-room assignment endpoint.
- Experimental script success means API accepted payload, not guaranteed Meet UI applied assignments.
- Meet hosts still control room open/close manually during the meeting.

## How To Get OAuth Values (Add This Last)

Use these steps to get:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_REFRESH_TOKEN`

### A) Create OAuth Client in Google Cloud

1. Open Google Cloud Console: `https://console.cloud.google.com/`
2. Select or create a project.
3. Enable API:
   - `APIs & Services` -> `Library` -> enable `Google Calendar API`.
4. Configure OAuth consent screen:
   - `APIs & Services` -> `OAuth consent screen`.
   - Choose `External` (or `Internal` for Workspace org), fill required app fields.
   - Add scope: `https://www.googleapis.com/auth/calendar.events`
   - Add your Google account as a Test User (if app is in testing mode).
5. Create credentials:
   - `APIs & Services` -> `Credentials` -> `Create Credentials` -> `OAuth client ID`.
   - App type: usually `Web application`.
   - Add redirect URI(s), for example:
     - `http://localhost:3000/oauth2callback`
     - or `https://developers.google.com/oauthplayground` (if using OAuth Playground)

Now copy:
- `Client ID` -> `GOOGLE_CLIENT_ID`
- `Client secret` -> `GOOGLE_CLIENT_SECRET`
- one authorized redirect URI -> `GOOGLE_REDIRECT_URI`

### B) Get Refresh Token

You need one-time user consent with `access_type=offline`.

Option 1 (recommended for quick setup): OAuth Playground

1. Open: `https://developers.google.com/oauthplayground`
2. Click gear icon (top-right):
   - enable `Use your own OAuth credentials`
   - set your client ID + secret.
3. In Step 1, enter scope:
   - `https://www.googleapis.com/auth/calendar.events`
4. Click `Authorize APIs` and grant consent.
5. Click `Exchange authorization code for tokens`.
6. Copy `Refresh token` -> `GOOGLE_REFRESH_TOKEN`.

Important:
- Ensure your OAuth client has `https://developers.google.com/oauthplayground` as an authorized redirect URI if using Playground.
- Refresh token may rotate/revoke if user revokes access or app config changes.

### C) Quick Test Before Running Scripts

After exporting env vars, run this test to verify token + API access:

```bash
ACCESS_TOKEN=$(curl -s https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" \
  -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" \
  -d grant_type=refresh_token | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token||''));")

curl -s "https://www.googleapis.com/calendar/v3/users/me/calendarList" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Expected:
- You should get JSON with your calendars.
- If you see `invalid_grant`, refresh token is invalid/revoked or OAuth client/redirect setup is mismatched.

## One-Time Testing With Short-Lived Access Token

If you only want a quick one-time test, you can use an access token (valid for about 1 hour) instead of a refresh token.

### Steps

1. Open OAuth Playground: `https://developers.google.com/oauthplayground`
2. Click gear icon (top-right):
   - enable `Use your own OAuth credentials`
   - paste your OAuth Client ID and Client Secret
3. In Step 1, enter scope:
   - `https://www.googleapis.com/auth/calendar.events`
4. Click `Authorize APIs` and complete consent.
5. Click `Exchange authorization code for tokens`.
6. Copy the `Access token`.

### Quick validation

```bash
export GOOGLE_ACCESS_TOKEN="paste-access-token"

curl -s "https://www.googleapis.com/calendar/v3/users/me/calendarList" \
  -H "Authorization: Bearer $GOOGLE_ACCESS_TOKEN"
```

Expected:
- JSON response containing your calendar list.

Important:
- If your OAuth client type is `Web application`, add `https://developers.google.com/oauthplayground` in authorized redirect URIs.
- Access token expires quickly; generate a new token when it expires.
