#!/usr/bin/env node

/**
 * Experimental Google Calendar / Meet API payloads for breakout-room assignment.
 *
 * Required ENV:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 *   GOOGLE_REFRESH_TOKEN
 *   EVENT_ID=<calendar_event_id>
 *   BREAKOUT_ASSIGNMENTS_JSON=[{"name":"Room 1","emails":["a@example.com"]},{"name":"Room 2","emails":["b@example.com"]}]
 *
 * Optional ENV:
 *   CALENDAR_ID=primary
 *   PATCH_VARIANT=all|v1|v2|v3|v4   (default: all)
 *
 * Root cause of v1–v3 failures:
 *   conferenceData.parameters.addOnParameters is READ-ONLY via Calendar REST API.
 *   The API returns 400 "Invalid conference data" for any attempt to write it.
 *   Breakout rooms are a Meet concept — use Meet REST API (v4) instead.
 *
 * Note:
 * - This is for experimentation only.
 * - Accepted PATCH response does not guarantee Meet UI applied breakout rooms.
 */

require('dotenv').config();
const { google } = require('googleapis');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function normalizeRooms(assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error('BREAKOUT_ASSIGNMENTS_JSON must be a non-empty JSON array.');
  }

  for (const room of assignments) {
    if (!room.name || !Array.isArray(room.emails)) {
      throw new Error('Requires: [{ name, emails[] }]');
    }
  }

  return assignments.map((r) => ({
    name: r.name,
    emails: r.emails.map((e) => e.toLowerCase()),
  }));
}

function buildOauthClient() {
  const oauth2Client = new google.auth.OAuth2(
    requireEnv('GOOGLE_CLIENT_ID'),
    requireEnv('GOOGLE_CLIENT_SECRET'),
    requireEnv('GOOGLE_REDIRECT_URI')
  );
  oauth2Client.setCredentials({ refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN') });
  return oauth2Client;
}

async function main() {
  const calendar = google.calendar({ version: 'v3', auth: buildOauthClient() });

  const calendarId = process.env.CALENDAR_ID || 'primary';
  const eventId = requireEnv('EVENT_ID');
  const variant = (process.env.PATCH_VARIANT || 'all').toLowerCase();
  const rooms = normalizeRooms(JSON.parse(requireEnv('BREAKOUT_ASSIGNMENTS_JSON')));

  const existingEvent = await calendar.events.get({ calendarId, eventId, conferenceDataVersion: 1 });
  const data = existingEvent.data;

  if (!data.conferenceData) {
    throw new Error('Event has no conferenceData. Create event with Meet link first.');
  }

  const existingAttendees = data.attendees || [];
  const existingEmails = new Set(
    existingAttendees.filter((a) => a.email).map((a) => a.email.toLowerCase())
  );

  const allRoomEmails = new Set(rooms.flatMap((r) => r.emails.map((e) => e.toLowerCase())));
  const updatedAttendees = [...existingAttendees];
  for (const email of allRoomEmails) {
    if (!existingEmails.has(email)) updatedAttendees.push({ email });
  }

  const settingsJson = JSON.stringify({
    rooms: rooms.map((r) => ({ name: r.name, assignedAttendees: r.emails })),
    roomCount: rooms.length,
  });

  const confSolutionKey = (data.conferenceData.conferenceSolution || {}).key || { type: 'hangoutsMeet' };

  const variants = {
    v1: {
      conferenceData: {
        conferenceId: data.conferenceData.conferenceId,
        conferenceSolution: data.conferenceData.conferenceSolution,
        parameters: {
          addOnParameters: {
            parameters: {
              breakoutRoomSettings: settingsJson,
            },
          },
        },
      },
      attendees: updatedAttendees,
    },
    v2: {
      conferenceData: {
        conferenceSolution: { key: confSolutionKey },
        parameters: {
          addOnParameters: {
            parameters: {
              breakoutRooms: rooms.map((r) => ({ name: r.name, attendeeEmails: r.emails })),
            },
          },
        },
      },
      attendees: updatedAttendees,
    },
    v3: {
      conferenceData: {
        conferenceSolution: { key: confSolutionKey },
        parameters: {
          addOnParameters: {
            parameters: {
              breakoutRooms: JSON.stringify({
                rooms: rooms.map((r) => ({ name: r.name, attendeeEmails: r.emails })),
                roomCount: rooms.length,
              }),
            },
          },
        },
      },
      attendees: updatedAttendees,
    },
  };

  // v4: Meet REST API — the only API that may support breakout room config.
  // Requires Meet API enabled + scope: https://www.googleapis.com/auth/meetings.space.settings
  // meetingUri looks like "https://meet.google.com/xxx-yyyy-zzz" → spaceId = "xxx-yyyy-zzz"
  const meetingUri = (data.conferenceData.entryPoints || []).find(
    (ep) => ep.entryPointType === 'video'
  )?.uri;
  const spaceId = meetingUri ? meetingUri.split('/').pop() : null;
  console.log('[patch:v4] meetingUri:', meetingUri);
  console.log('[patch:v4] spaceId:', spaceId);
  console.log('[patch:v4] conferenceId:', data.conferenceData.conferenceId);
  console.log('[patch:v4] entryPoints:', JSON.stringify(data.conferenceData.entryPoints));

  if (spaceId) {
    variants.v4 = { _meetSpaceId: spaceId };
  }

  const toRun = variant === 'all' ? ['v1', 'v2', 'v3', 'v4'] : [variant];
  for (const v of toRun) {
    if (!variants[v]) throw new Error(`Unknown PATCH_VARIANT: ${v}`);

    try {
      if (v === 'v4') {
        if (!spaceId) {
          console.log('[patch:v4] No Meet space ID found in event — skipping.');
          continue;
        }
        // Meet REST API: probe GET first, then PATCH
        const auth = buildOauthClient();
        const { token } = await auth.getAccessToken();
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const baseUrl = `https://meet.googleapis.com/v2/spaces/${spaceId}`;

        // GET — verify space is accessible and get canonical resource name
        const getRes = await fetch(baseUrl, { headers });
        const getData = await getRes.json();
        console.log('[patch:v4] GET status:', getRes.status);
        console.log('[patch:v4] GET response:', JSON.stringify(getData, null, 2));

        if (!getRes.ok) {
          console.log('[patch:v4] Cannot reach space — skipping PATCH. Check: Meet API enabled in Cloud Console? Space ID correct?');
          if (variant === 'all') break;
          continue;
        }

        // Use canonical name from GET response
        const canonicalName = getData.name || `spaces/${spaceId}`;
        const patchUrl = `https://meet.googleapis.com/v2/${canonicalName}?updateMask=config`;
        const meetRes = await fetch(patchUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ config: {} }),
        });
        const meetData = await meetRes.json();
        console.log('[patch:v4] PATCH status:', meetRes.status);
        console.log('[patch:v4] PATCH response:', JSON.stringify(meetData, null, 2));
        if (variant === 'all') break;
        continue;
      }

      const patchBody = { ...variants[v] };
      console.log(`[patch:${v}] attendees=${patchBody.attendees?.length} conferenceParamKeys=${Object.keys((patchBody.conferenceData?.parameters?.addOnParameters?.parameters) || {}).join(',')}`);

      const res = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: patchBody,
        conferenceDataVersion: 1,
        sendUpdates: 'all',
      });

      console.log(`PATCH ${v} accepted by API.`);
      console.log(`- Event ID: ${res.data.id}`);
      console.log(`- Attendees: ${(res.data.attendees || []).length}`);
      console.log('Note: Accepted patch does NOT guarantee Meet UI applied breakout assignments.');

      if (variant === 'all') break;
    } catch (err) {
      const errorResponse = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.log(`[patch:${v}] errorResponse=${errorResponse}`);
      console.log(`PATCH ${v} failed: ${err.message}`);
      if (variant !== 'all') throw err;
    }
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
