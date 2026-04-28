#!/usr/bin/env node

/**
 * Create a Google Calendar event (optionally with Google Meet link).
 *
 * Usage:
 *   node create-calendar-event.js
 *
 * Required ENV:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 *   GOOGLE_REFRESH_TOKEN
 *
 * Optional ENV:
 *   CALENDAR_ID=primary
 *   EVENT_SUMMARY
 *   EVENT_DESCRIPTION
 *   EVENT_LOCATION
 *   EVENT_START=2026-05-02T10:00:00+05:30
 *   EVENT_END=2026-05-02T11:00:00+05:30
 *   EVENT_TIMEZONE=Asia/Kolkata
 *   EVENT_ATTENDEES=alice@example.com,bob@example.com
 *   CREATE_MEET_LINK=true
 */

const { google } = require('googleapis');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI');
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const attendees = (process.env.EVENT_ATTENDEES || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  const event = {
    summary: process.env.EVENT_SUMMARY || 'New Meeting',
    description: process.env.EVENT_DESCRIPTION || 'Created by Node.js script',
    location: process.env.EVENT_LOCATION || undefined,
    start: {
      dateTime: process.env.EVENT_START || '2026-05-02T10:00:00+05:30',
      timeZone: process.env.EVENT_TIMEZONE || 'Asia/Kolkata',
    },
    end: {
      dateTime: process.env.EVENT_END || '2026-05-02T11:00:00+05:30',
      timeZone: process.env.EVENT_TIMEZONE || 'Asia/Kolkata',
    },
    attendees,
  };

  const createMeetLink = (process.env.CREATE_MEET_LINK || 'true').toLowerCase() === 'true';

  const requestBody = createMeetLink
    ? {
        ...event,
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }
    : event;

  const res = await calendar.events.insert({
    calendarId: process.env.CALENDAR_ID || 'primary',
    requestBody,
    conferenceDataVersion: createMeetLink ? 1 : 0,
    sendUpdates: 'all',
  });

  const created = res.data;
  console.log('Event created:');
  console.log(`- ID: ${created.id}`);
  console.log(`- Title: ${created.summary}`);
  console.log(`- Start: ${created.start?.dateTime || created.start?.date}`);
  console.log(`- End: ${created.end?.dateTime || created.end?.date}`);
  console.log(`- Calendar Link: ${created.htmlLink}`);

  const meetLink = created.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  if (meetLink) {
    console.log(`- Google Meet Link: ${meetLink}`);
  }
}

main().catch((err) => {
  console.error('Failed to create event:', err.message);
  process.exit(1);
});
