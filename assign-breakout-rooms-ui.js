#!/usr/bin/env node

/**
 * Assign users to Google Meet breakout rooms via Meet UI automation.
 *
 * Required ENV:
 *   MEET_URL=https://meet.google.com/xxx-xxxx-xxx
 *   BREAKOUT_ASSIGNMENTS_JSON=[{"name":"Room 1","participants":["Alice","Bob"]},{"name":"Room 2","participants":["Charlie"]}]
 *
 * Optional ENV:
 *   CHROME_USER_DATA_DIR=/absolute/path/to/chrome-user-data
 *   CHROME_PROFILE_DIR=Default|Profile 1|Profile 2
 *   CHROME_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 *   CHROME_LAUNCH_TIMEOUT_MS=90000
 *   CHROME_DUMPIO=true
 *   HEADLESS=false
 *   ACTION_DELAY_MS=500
 */

require('dotenv').config();
const puppeteer = require('puppeteer');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRooms(assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error('BREAKOUT_ASSIGNMENTS_JSON must be a non-empty JSON array.');
  }

  for (const room of assignments) {
    if (!room.name || !Array.isArray(room.participants)) {
      throw new Error('Requires: [{ name, participants[] }]');
    }
  }

  return assignments;
}

async function clickByText(page, text, timeout = 20000) {
  const xpath = `//*[self::button or @role='button' or self::span][contains(normalize-space(.), "${text}")]`;
  await page.waitForXPath(xpath, { timeout });
  const [el] = await page.$x(xpath);
  if (!el) throw new Error(`Could not find clickable text: ${text}`);
  await el.click();
}

async function typeIntoParticipantField(page, participant, roomName) {
  const roomXpath = `//*[contains(normalize-space(.), "${roomName}")]`;
  await page.waitForXPath(roomXpath, { timeout: 10000 });

  const inputXpath = `//input[@type='text' and (contains(@aria-label, 'Add') or contains(@placeholder, 'Add'))]`;
  await page.waitForXPath(inputXpath, { timeout: 10000 });
  const [input] = await page.$x(inputXpath);
  if (!input) throw new Error(`Could not find participant input for room: ${roomName}`);

  await input.click({ clickCount: 3 });
  await input.type(participant, { delay: 30 });
  await page.keyboard.press('Enter');
}

async function main() {
  const meetUrl = requireEnv('MEET_URL');
  const assignments = normalizeRooms(JSON.parse(requireEnv('BREAKOUT_ASSIGNMENTS_JSON')));

  const headless = (process.env.HEADLESS || 'false').toLowerCase() === 'true';
  const delayMs = parseInt(process.env.ACTION_DELAY_MS || '500', 10);
  const userDataDir = process.env.CHROME_USER_DATA_DIR;
  const profileDir = process.env.CHROME_PROFILE_DIR;
  const executablePath = process.env.CHROME_EXECUTABLE_PATH;
  const launchTimeout = parseInt(process.env.CHROME_LAUNCH_TIMEOUT_MS || '90000', 10);
  const dumpio = (process.env.CHROME_DUMPIO || 'true').toLowerCase() === 'true';

  const launchArgs = [
    '--start-maximized',
    '--no-default-browser-check',
    '--disable-background-networking',
  ];

  if (profileDir) launchArgs.push(`--profile-directory=${profileDir}`);

  const launchOptions = {
    headless,
    defaultViewport: null,
    args: launchArgs,
    timeout: launchTimeout,
    dumpio,
    ignoreDefaultArgs: ['--enable-automation'],
  };

  if (userDataDir) launchOptions.userDataDir = userDataDir;
  if (executablePath) launchOptions.executablePath = executablePath;

  console.log('Launching Chrome with options:');
  console.log(JSON.stringify({
    headless,
    userDataDir,
    profileDir,
    executablePath,
    timeout: launchTimeout,
    dumpio,
    args: launchArgs,
  }, null, 2));

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.goto(meetUrl, { waitUntil: 'domcontentloaded' });

    console.log('If prompted, complete sign-in and join as host/co-host.');
    await sleep(8000);

    await clickByText(page, 'Activities');
    await sleep(delayMs);
    await clickByText(page, 'Breakout rooms');
    await sleep(delayMs);

    for (const room of assignments) {
      for (const participant of room.participants) {
        await typeIntoParticipantField(page, participant, room.name);
        await sleep(delayMs);
      }
    }

    await clickByText(page, 'Save').catch(() => null);
    await clickByText(page, 'Open rooms').catch(() => null);

    console.log('UI flow completed. Verify assignments in Meet UI.');
  } finally {
    if (!headless) {
      console.log('Browser left open for verification. Press Ctrl+C when done.');
      await new Promise(() => {});
    } else {
      await browser.close();
    }
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
