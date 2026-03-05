/**
 * SmartMeetingRouter — handles all /smart-meetings/* requests for the Smart Meetings dashboard.
 *
 * Routes:
 *   GET  /smart-meetings           → serve HTML dashboard
 *   GET  /smart-meetings/api/status → serve JSON status (meetings + portfolio)
 */

import * as http from 'http';
import { logger } from '../common/logger';
import { loadSmartMeetingsConfig } from '../services/smart-meetings/config-io';
import { calculateCadenceDebt } from '../services/smart-meetings/cadence-debt';
import type { PortfolioRef } from '../services/smart-meetings/portfolio-ref';
import type {
  MeetingDefinition,
  MeetingStatus,
  SmartMeetingsStatusResponse,
} from '../types/smart-meetings';

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface SmartMeetingRouterDeps {
  configPath: string;
  portfolioRef: PortfolioRef;
}

// ─── Router registration ──────────────────────────────────────────────────────

export function registerSmartMeetingRouter(deps: SmartMeetingRouterDeps): SmartMeetingRouter {
  return new SmartMeetingRouter(deps);
}

// ─── Router class ─────────────────────────────────────────────────────────────

export class SmartMeetingRouter {
  private readonly configPath: string;
  private readonly portfolioRef: PortfolioRef;

  constructor(deps: SmartMeetingRouterDeps) {
    this.configPath = deps.configPath;
    this.portfolioRef = deps.portfolioRef;
  }

  async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const method = req.method ?? 'GET';

    if (pathname === '/smart-meetings' || pathname === '/smart-meetings/') {
      return this.serveDashboard(res);
    }

    if (method === 'GET' && pathname === '/smart-meetings/api/status') {
      return this.handleStatus(res);
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  // ─── Dashboard HTML ──────────────────────────────────────────────────────────

  private serveDashboard(res: http.ServerResponse): void {
    const html = buildDashboardHtml();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  // ─── API: /smart-meetings/api/status ─────────────────────────────────────────

  private async handleStatus(res: http.ServerResponse): Promise<void> {
    try {
      const config = await loadSmartMeetingsConfig(this.configPath);
      const now = new Date();

      const enabledMeetings = config.meetings.filter((m) => m.enabled);
      const disabledMeetings = config.meetings.filter((m) => !m.enabled);

      // Build MeetingStatus entries for enabled meetings, sorted by debt DESC
      const enabledStatuses = enabledMeetings
        .map((m) => buildMeetingStatus(m, now))
        .sort((a, b) => {
          const debtA = a.cadenceDebt.debtDays ?? 0;
          const debtB = b.cadenceDebt.debtDays ?? 0;
          return debtB - debtA;
        });

      // Disabled meetings go at the end
      const disabledStatuses = disabledMeetings.map((m) => buildMeetingStatus(m, now));

      const meetings: MeetingStatus[] = [...enabledStatuses, ...disabledStatuses];

      const response: SmartMeetingsStatusResponse = {
        generatedAt: now.toISOString(),
        meetings,
        timePortfolio: this.portfolioRef.current,
      };

      this.sendJson(res, 200, response);
    } catch (err) {
      logger.error({
        operation: 'smart_meetings_status_error',
        error: (err as Error).message,
        message: 'Failed to build smart-meetings status',
      });
      this.sendJson(res, 500, { ok: false, error: (err as Error).message });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}

// ─── MeetingStatus builder ────────────────────────────────────────────────────

function buildMeetingStatus(meeting: MeetingDefinition, now: Date): MeetingStatus {
  const cadenceDebt = calculateCadenceDebt(meeting, now);

  // Derive last occurrence from history
  const lastOccurrence =
    meeting.history
      .filter((h) => h.status === 'occurred' || h.status === 'scheduled')
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;

  return {
    meetingId: meeting.id,
    title: meeting.title,
    enabled: meeting.enabled,
    cadence: meeting.cadence,
    lastOccurrence,
    nextScheduled: null, // Requires live calendar query — not available in the dashboard
    cadenceDebt,
    attendees: meeting.attendees,
  };
}

// ─── Dashboard HTML (self-contained) ─────────────────────────────────────────

function buildDashboardHtml(): string {
  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <circle cx="11" cy="3"  r="2.5" fill="#58a6ff"/>
        <circle cx="3"  cy="17" r="2.5" fill="#58a6ff"/>
        <circle cx="19" cy="17" r="2.5" fill="#58a6ff"/>
        <circle cx="11" cy="11" r="2"   fill="#58a6ff" fill-opacity="0.45"/>
        <line x1="11" y1="5.5" x2="11"    y2="9"    stroke="#58a6ff" stroke-width="1.2" stroke-opacity="0.65"/>
        <line x1="9.3"  y1="12.3" x2="5.2"  y2="15"  stroke="#58a6ff" stroke-width="1.2" stroke-opacity="0.65"/>
        <line x1="12.7" y1="12.3" x2="16.8" y2="15"  stroke="#58a6ff" stroke-width="1.2" stroke-opacity="0.65"/>
        <line x1="3"  y1="14.5" x2="11" y2="5.5"  stroke="#58a6ff" stroke-width="1" stroke-opacity="0.28"/>
        <line x1="11" y1="5.5"  x2="19" y2="14.5" stroke="#58a6ff" stroke-width="1" stroke-opacity="0.28"/>
        <line x1="3"  y1="17"   x2="19" y2="17"   stroke="#58a6ff" stroke-width="1" stroke-opacity="0.28"/>
      </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Meetings</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
    }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: #21262d;
      border: 1px solid #30363d;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.88em;
    }
    strong { color: #e6edf3; }

    /* ── Nav ── */
    #main-nav {
      height: 48px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      padding: 0 16px;
      flex-shrink: 0;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: #e6edf3;
    }
    .nav-brand:hover { text-decoration: none; }
    .nav-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: #e6edf3; }
    .nav-links { display: flex; list-style: none; gap: 4px; margin-left: auto; }
    .nav-link {
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #8b949e;
      text-decoration: none;
      transition: background 0.15s, color 0.15s;
    }
    .nav-link:hover { background: #21262d; color: #e6edf3; text-decoration: none; }
    .nav-link.active { background: #21262d; color: #e6edf3; }

    /* ── Page layout ── */
    #page-content {
      flex: 1;
      overflow-y: auto;
      padding: 28px 24px;
      max-width: 1040px;
      width: 100%;
      margin: 0 auto;
    }
    .page-heading {
      font-size: 18px;
      font-weight: 600;
      color: #58a6ff;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .last-updated {
      font-size: 12px;
      font-weight: 400;
      color: #8b949e;
    }

    /* ── Warning banner ── */
    .warning-banner {
      background: #2d1f00;
      border: 1px solid #d29922;
      border-left: 3px solid #d29922;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 16px;
      color: #d29922;
      font-size: 13px;
    }
    .warning-banner strong { color: #f0c040; }

    /* ── Portfolio section ── */
    .portfolio-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 20px;
    }
    .portfolio-section h2 {
      font-size: 13px;
      font-weight: 600;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
    .portfolio-rows { display: flex; flex-direction: column; gap: 8px; }
    .portfolio-row {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
    }
    .portfolio-row-label {
      width: 80px;
      color: #8b949e;
      font-size: 12px;
    }
    .portfolio-bars { display: flex; gap: 8px; flex: 1; }
    .portfolio-bar-item { display: flex; align-items: center; gap: 6px; }
    .bar-label { font-size: 12px; color: #8b949e; width: 60px; }
    .bar-track {
      width: 80px;
      height: 8px;
      background: #21262d;
      border-radius: 4px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .bar-fill.focus    { background: #58a6ff; }
    .bar-fill.recurring { background: #d29922; }
    .bar-fill.adhoc    { background: #8b949e; }
    .bar-pct { font-size: 12px; color: #e6edf3; width: 36px; }
    .portfolio-unavailable { color: #8b949e; font-size: 13px; font-style: italic; }

    /* ── Meetings table ── */
    .meetings-table-wrap {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    thead th {
      background: #21262d;
      color: #8b949e;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid #30363d;
    }
    tbody tr {
      border-bottom: 1px solid #21262d;
    }
    tbody tr:last-child { border-bottom: none; }
    tbody td {
      padding: 10px 14px;
      vertical-align: middle;
    }
    .row-red  { background: #fee2e2; color: #7f1d1d; }
    .row-red  td { color: #7f1d1d; }
    .row-amber { background: #fef3c7; color: #78350f; }
    .row-amber td { color: #78350f; }
    .row-disabled { opacity: 0.5; }
    .row-disabled td { color: #8b949e; }
    .title-cell { font-weight: 500; max-width: 240px; }
    .attendee-cell { color: #8b949e; font-size: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .debt-cell { font-weight: 600; }
    .debt-none { color: #3fb950; }
    .date-cell { color: #8b949e; font-size: 12px; }
    .loading-row td { text-align: center; color: #8b949e; padding: 32px; }
    .error-row td { text-align: center; color: #f85149; padding: 32px; }

    @media (max-width: 768px) {
      #page-content { padding: 16px; }
      table { font-size: 12px; }
      thead th, tbody td { padding: 8px 10px; }
    }
  </style>
</head>
<body>
  <nav id="main-nav">
    <a class="nav-brand" href="/">
      ${logoSvg}
      <span class="nav-title">Cerebro</span>
    </a>
    <ul class="nav-links">
      <li><a href="/"              class="nav-link">Auth</a></li>
      <li><a href="/triage"        class="nav-link">Triage</a></li>
      <li><a href="/smart-meetings" class="nav-link active">Smart Meetings</a></li>
    </ul>
  </nav>

  <div id="page-content">

    <h1 class="page-heading">
      <span>&#128197; Smart Meetings</span>
      <span class="last-updated" id="last-updated"></span>
    </h1>

    <div id="warning-banners"></div>

    <div class="portfolio-section" id="portfolio-section">
      <h2>Time Portfolio</h2>
      <div id="portfolio-content">
        <p class="portfolio-unavailable">Loading&#8230;</p>
      </div>
    </div>

    <div class="meetings-table-wrap">
      <table id="meetings-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Attendees</th>
            <th>Cadence</th>
            <th>Cadence Debt</th>
            <th>Last Occurrence</th>
            <th>Next Scheduled</th>
          </tr>
        </thead>
        <tbody id="meetings-body">
          <tr class="loading-row"><td colspan="6">Loading&#8230;</td></tr>
        </tbody>
      </table>
    </div>

  </div>

  <script>
    // ── Relative date helper ───────────────────────────────────────────────────
    function relativeDate(isoDate) {
      if (!isoDate) return '—';
      const now = new Date();
      const target = new Date(isoDate);
      const diffMs = target.getTime() - now.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'tomorrow';
      if (diffDays === -1) return 'yesterday';
      if (diffDays > 0) {
        if (diffDays < 7) return 'in ' + diffDays + ' days';
        const weeks = Math.round(diffDays / 7);
        return 'in ' + weeks + (weeks === 1 ? ' week' : ' weeks');
      } else {
        const absDays = Math.abs(diffDays);
        if (absDays < 7) return absDays + ' days ago';
        const weeks = Math.round(absDays / 7);
        return weeks + (weeks === 1 ? ' week ago' : ' weeks ago');
      }
    }

    // ── Cadence display ────────────────────────────────────────────────────────
    function cadenceLabel(frequency) {
      switch (frequency) {
        case 'weekly':      return 'Weekly';
        case 'fortnightly': return 'Fortnightly';
        case 'monthly':     return 'Monthly';
        default:            return frequency;
      }
    }

    // ── Debt display ───────────────────────────────────────────────────────────
    function debtDisplay(debt) {
      if (!debt) return { text: '—', cls: 'debt-none' };
      const days = debt.debtDays;
      if (days === null) return { text: 'No history', cls: 'debt-none' };
      if (days <= 0) return { text: 'On schedule', cls: 'debt-none' };
      if (days >= 14) return { text: days + 'd overdue', cls: '' };
      return { text: days + 'd overdue', cls: '' };
    }

    // ── Row class ──────────────────────────────────────────────────────────────
    function rowClass(meeting) {
      if (!meeting.enabled) return 'row-disabled';
      const days = meeting.cadenceDebt && meeting.cadenceDebt.debtDays;
      if (days === null || days === undefined) return '';
      if (days >= 14) return 'row-red';
      if (days >= 1)  return 'row-amber';
      return '';
    }

    // ── Render portfolio ───────────────────────────────────────────────────────
    function renderPortfolio(portfolio) {
      const container = document.getElementById('portfolio-content');
      if (!portfolio) {
        container.innerHTML = '<p class="portfolio-unavailable">Portfolio data not yet available.</p>';
        return;
      }

      function rowHtml(label, slice) {
        return \`<div class="portfolio-row">
          <span class="portfolio-row-label">\${label}</span>
          <div class="portfolio-bars">
            <div class="portfolio-bar-item">
              <span class="bar-label">Focus</span>
              <div class="bar-track"><div class="bar-fill focus" style="width:\${Math.min(100,slice.focusPct)}%"></div></div>
              <span class="bar-pct">\${slice.focusPct.toFixed(0)}%</span>
            </div>
            <div class="portfolio-bar-item">
              <span class="bar-label">Recurring</span>
              <div class="bar-track"><div class="bar-fill recurring" style="width:\${Math.min(100,slice.recurringPct)}%"></div></div>
              <span class="bar-pct">\${slice.recurringPct.toFixed(0)}%</span>
            </div>
            <div class="portfolio-bar-item">
              <span class="bar-label">Ad-hoc</span>
              <div class="bar-track"><div class="bar-fill adhoc" style="width:\${Math.min(100,slice.adHocPct)}%"></div></div>
              <span class="bar-pct">\${slice.adHocPct.toFixed(0)}%</span>
            </div>
          </div>
        </div>\`;
      }

      container.innerHTML = \`
        <div class="portfolio-rows">
          \${rowHtml('This week', portfolio.thisWeek)}
          \${rowHtml('Last week', portfolio.lastWeek)}
        </div>
      \`;
    }

    // ── Render warnings ────────────────────────────────────────────────────────
    function renderWarnings(portfolio) {
      const container = document.getElementById('warning-banners');
      if (!portfolio || !portfolio.warnings || portfolio.warnings.length === 0) {
        container.innerHTML = '';
        return;
      }

      const imbalanceWarnings = portfolio.warnings.filter(w => w.warningType === 'imbalance');
      if (imbalanceWarnings.length === 0) {
        container.innerHTML = '';
        return;
      }

      const html = imbalanceWarnings.map(w => \`
        <div class="warning-banner">
          <strong>Portfolio imbalance detected:</strong> \${w.message}
        </div>
      \`).join('');

      container.innerHTML = html;
    }

    // ── Render meetings table ──────────────────────────────────────────────────
    function renderMeetings(meetings) {
      const tbody = document.getElementById('meetings-body');
      if (!meetings || meetings.length === 0) {
        tbody.innerHTML = '<tr class="loading-row"><td colspan="6">No managed meetings configured.</td></tr>';
        return;
      }

      const rows = meetings.map(m => {
        const cls = rowClass(m);
        const debt = debtDisplay(m.cadenceDebt);
        const attendees = (m.attendees || []).join(', ') || '—';
        const lastOcc = relativeDate(m.cadenceDebt && m.cadenceDebt.lastOccurrenceDate);
        const nextSched = relativeDate(m.nextScheduled);
        const cadence = m.cadence ? cadenceLabel(m.cadence.frequency) : '—';
        const debtCls = debt.cls ? \` \${debt.cls}\` : '';

        return \`<tr class="\${cls}">
          <td class="title-cell">\${escapeHtml(m.title)}</td>
          <td class="attendee-cell" title="\${escapeHtml(attendees)}">\${escapeHtml(attendees)}</td>
          <td>\${cadence}</td>
          <td class="debt-cell\${debtCls}">\${debt.text}</td>
          <td class="date-cell">\${lastOcc}</td>
          <td class="date-cell">\${nextSched}</td>
        </tr>\`;
      });

      tbody.innerHTML = rows.join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Fetch + render ─────────────────────────────────────────────────────────
    async function loadStatus() {
      try {
        const resp = await fetch('/smart-meetings/api/status');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        const updatedEl = document.getElementById('last-updated');
        if (updatedEl) {
          updatedEl.textContent = 'Updated ' + relativeDate(data.generatedAt);
        }

        renderWarnings(data.timePortfolio);
        renderPortfolio(data.timePortfolio);
        renderMeetings(data.meetings);
      } catch (err) {
        const tbody = document.getElementById('meetings-body');
        if (tbody) {
          tbody.innerHTML = '<tr class="error-row"><td colspan="6">Failed to load: ' + escapeHtml(String(err)) + '</td></tr>';
        }
      }
    }

    // Initial load + auto-refresh every 60s
    loadStatus();
    setInterval(loadStatus, 60000);
  </script>
</body>
</html>`;
}
