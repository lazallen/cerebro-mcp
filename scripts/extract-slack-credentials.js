#!/usr/bin/env node
/**
 * Extract Slack session credentials from a running Chrome/Edge instance
 * and POST them directly to the Cerebro auth server.
 *
 * Requires the browser to be running with remote debugging enabled:
 *
 *   Windows Chrome:
 *     "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *
 *   macOS Chrome:
 *     open -a "Google Chrome" --args --remote-debugging-port=9222
 *
 *   Edge (Windows):
 *     "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
 *
 * Usage:
 *   node scripts/extract-slack-credentials.js
 *   node scripts/extract-slack-credentials.js --port 9222  (default)
 *   node scripts/extract-slack-credentials.js --dry-run    (print values, don't save)
 *   node scripts/extract-slack-credentials.js --auth-url http://localhost:3333
 *
 * WSL2 note:
 *   If the browser runs on Windows and the server runs in WSL2, the CDP port
 *   is on the Windows side. Use --cdp-host with the Windows host IP:
 *     node scripts/extract-slack-credentials.js --cdp-host 172.x.x.x
 *   Or run this script directly in a Windows terminal (node must be installed on Windows).
 */

'use strict';

const WebSocket = require('ws');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const CDP_HOST   = getArg('--cdp-host', 'localhost');
const CDP_PORT   = getArg('--port', '9222');
const AUTH_URL   = getArg('--auth-url', 'http://localhost:3333');
const DRY_RUN    = args.includes('--dry-run');

// ─── CDP helpers ─────────────────────────────────────────────────────────────

async function listTabs() {
  const url = `http://${CDP_HOST}:${CDP_PORT}/json/list`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `Cannot reach Chrome DevTools at ${url}.\n` +
      `Make sure Chrome/Edge is running with --remote-debugging-port=${CDP_PORT}.\n` +
      `Original error: ${err.message}`
    );
  }
  if (!res.ok) {
    throw new Error(`CDP list endpoint returned HTTP ${res.status}`);
  }
  return res.json();
}

function openCdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = new Map();

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`CDP error: ${msg.error.message}`));
        else res(msg.result);
      }
    });

    ws.on('error', reject);
    ws.on('open', () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = ++msgId;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });

      resolve({ send, close: () => ws.close() });
    });
  });
}

// ─── Extraction ───────────────────────────────────────────────────────────────

async function extractCredentials(tab, cdp) {
  // 1. xoxc token from localStorage (accessible from JS context)
  const localStorageResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      try {
        const raw = localStorage.getItem('localConfig_v2');
        if (!raw) return null;
        const config = JSON.parse(raw);
        const teams = config.teams || {};
        const firstTeam = Object.values(teams)[0];
        return firstTeam?.token || null;
      } catch(e) { return null; }
    })()`,
    returnByValue: true,
  });

  const xoxcToken = localStorageResult.result?.value ?? null;

  // 2. xoxd cookie — HttpOnly, so must use CDP Network.getCookies (not document.cookie)
  const slackHost = new URL(tab.url).hostname;
  const cookiesResult = await cdp.send('Network.getCookies', {
    urls: [`https://${slackHost}`],
  });

  const dCookie = (cookiesResult.cookies ?? []).find((c) => c.name === 'd');
  const xoxdCookie = dCookie?.value ?? null;

  return { xoxcToken, xoxdCookie, slackHost };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to Chrome DevTools at ${CDP_HOST}:${CDP_PORT}...`);

  const tabs = await listTabs();
  const slackTab = tabs.find(
    (t) => t.url && t.url.includes('app.slack.com') && t.type === 'page'
  );

  if (!slackTab) {
    const pageUrls = tabs.filter((t) => t.type === 'page').map((t) => `  ${t.url}`).join('\n');
    throw new Error(
      `No Slack tab found (looking for app.slack.com).\n` +
      `Open tabs:\n${pageUrls || '  (none)'}`
    );
  }

  console.log(`Found Slack tab: ${slackTab.url}`);

  const cdp = await openCdpSession(slackTab.webSocketDebuggerUrl);

  let credentials;
  try {
    credentials = await extractCredentials(slackTab, cdp);
  } finally {
    cdp.close();
  }

  const { xoxcToken, xoxdCookie, slackHost } = credentials;

  if (!xoxcToken) {
    throw new Error(
      `Could not find xoxc token in localStorage.\n` +
      `Make sure you are logged in to Slack in this tab (${slackHost}).`
    );
  }

  if (!xoxdCookie) {
    throw new Error(
      `Could not find xoxd cookie (named 'd') for ${slackHost}.\n` +
      `Make sure you are logged in to Slack in this tab.`
    );
  }

  console.log(`\nExtracted credentials for ${slackHost}:`);
  console.log(`  xoxc: ${xoxcToken.slice(0, 20)}... (${xoxcToken.length} chars)`);
  console.log(`  xoxd: ${xoxdCookie.slice(0, 12)}... (${xoxdCookie.length} chars)`);

  if (DRY_RUN) {
    console.log('\n--dry-run: credentials not saved.');
    return;
  }

  // POST to auth server
  const endpoint = `${AUTH_URL}/auth/slack-saved-items/credentials`;
  console.log(`\nSaving to ${endpoint}...`);

  const body = new URLSearchParams({ xoxcToken, xoxdCookie });
  let saveRes;
  try {
    saveRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error(
      `Could not reach auth server at ${AUTH_URL}.\n` +
      `Make sure the Cerebro server is running (npm start).\n` +
      `Original error: ${err.message}`
    );
  }

  const json = await saveRes.json().catch(() => ({}));

  if (!saveRes.ok || !json.success) {
    throw new Error(`Auth server returned ${saveRes.status}: ${JSON.stringify(json)}`);
  }

  const expiresAt = json.estimatedExpiresAt
    ? new Date(json.estimatedExpiresAt).toLocaleString()
    : 'unknown';

  console.log(`\n✅ Credentials saved! Estimated expiry: ${expiresAt}`);
  console.log(`   Refresh again before ${expiresAt} to avoid interruptions.`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
