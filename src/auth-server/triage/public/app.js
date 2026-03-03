/**
 * Triage Review UI — app.js
 *
 * Vanilla JS, no build step.
 * Handles: item list rendering, item selection, resolution (Done/Defer/Delegate),
 * auto-advance, and configurable auto-refresh poll loop.
 */

'use strict';

// ── Source badge configuration ───────────────────────────────────────────────

const SOURCE_LABELS = {
  'email':          'email',
  'slack':          'slack',
  'meeting-invite': 'meeting',
  'calendar':       'cal',
  'journal':        'journal',
};

function badgeClass(source) {
  const key = (source || '').toLowerCase().replace(/[^a-z-]/g, '');
  return 'badge-' + (SOURCE_LABELS[key] ? key : 'other');
}

function badgeLabel(source) {
  return SOURCE_LABELS[source] || source || 'other';
}

// ── State ─────────────────────────────────────────────────────────────────────

var items = [];
var selectedId = null;
var deferInFlight = false;

// ── DOM references ────────────────────────────────────────────────────────────

var elItemList      = document.getElementById('item-list');
var elItemCount     = document.getElementById('item-count');
var elEmptyState    = document.getElementById('empty-state');
var elDetailEmpty   = document.getElementById('detail-empty');
var elDetailContent = document.getElementById('detail-content');
var elDetailTitle   = document.getElementById('detail-title');
var elMetaSource    = document.getElementById('meta-source');
var elMetaDate      = document.getElementById('meta-date');
var elItemBody      = document.getElementById('item-body');
var elBtnDone         = document.getElementById('btn-done');
var elBtnDefer        = document.getElementById('btn-defer');
var elDelegateInput   = document.getElementById('delegate-input');
var elBtnAccept       = document.getElementById('btn-accept');
var elBtnExecute      = document.getElementById('btn-execute');
var elErrorBanner     = document.getElementById('error-banner');
var elResolutionControls = document.getElementById('resolution-controls');
var elCalendarControls   = document.getElementById('calendar-controls');
var elBtnCalAccept    = document.getElementById('btn-cal-accept');
var elBtnCalTentative = document.getElementById('btn-cal-tentative');
var elBtnCalDecline   = document.getElementById('btn-cal-decline');
var elItemMetaFooter  = document.getElementById('item-meta-footer');
var elCalWidget       = document.getElementById('cal-widget');
var elCalDateLabel    = document.getElementById('cal-date-label');
var elCalLoading      = document.getElementById('cal-loading');
var elCalScroll       = document.getElementById('cal-scroll');
var elCalTimeline     = document.getElementById('cal-timeline');
var elCalError        = document.getElementById('cal-error');
var elCalRecurrence   = document.getElementById('cal-recurrence');

// ── Fetch and reconcile items ─────────────────────────────────────────────────

function fetchItems() {
  fetch('/triage/api/items')
    .then(function(res) {
      if (!res.ok) throw new Error('Server error ' + res.status);
      return res.json();
    })
    .then(function(data) {
      reconcileItems(data.items || []);
    })
    .catch(function(err) {
      console.warn('Poll failed:', err.message);
    });
}

function reconcileItems(newItems) {
  var newIds = new Set(newItems.map(function(i) { return i.id; }));
  var selectedStillExists = selectedId && newIds.has(selectedId);

  items = newItems;
  renderList();

  if (!selectedStillExists && selectedId) {
    autoAdvance();
  } else if (selectedId && selectedStillExists) {
    var li = document.querySelector('[data-id="' + selectedId + '"]');
    if (li) li.classList.add('selected');
  }
}

// ── Render list ───────────────────────────────────────────────────────────────

function renderList() {
  elItemList.innerHTML = '';
  elItemCount.textContent = String(items.length);

  if (items.length === 0) {
    elEmptyState.classList.add('visible');
    return;
  }
  elEmptyState.classList.remove('visible');

  items.forEach(function(item) {
    var li = document.createElement('li');
    li.dataset.id = item.id;
    if (item.id === selectedId) li.classList.add('selected');

    var badge = document.createElement('span');
    badge.className = 'item-badge ' + badgeClass(item.source);
    badge.textContent = badgeLabel(item.source);

    var meta = document.createElement('div');
    meta.className = 'item-meta';

    var title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = item.title || 'Untitled';

    var date = document.createElement('div');
    date.className = 'item-date';
    date.textContent = item.createdAt ? formatDate(item.createdAt) : '';

    meta.appendChild(title);
    meta.appendChild(date);
    li.appendChild(badge);
    li.appendChild(meta);

    li.addEventListener('click', (function(id) {
      return function() { selectItem(id); };
    })(item.id));

    elItemList.appendChild(li);
  });
}

// ── Select and display an item ────────────────────────────────────────────────

function selectItem(id) {
  var item = items.find(function(i) { return i.id === id; });
  if (!item) return;

  selectedId = id;

  document.querySelectorAll('#item-list li').forEach(function(li) {
    li.classList.toggle('selected', li.dataset.id === id);
  });

  elDetailTitle.textContent = item.title || 'Untitled';
  elMetaSource.textContent = item.source || 'other';
  elMetaDate.textContent = item.createdAt ? formatDate(item.createdAt) : '';
  elItemBody.innerHTML = renderMarkdown(item.bodyMarkdown || '');

  // Metadata footer: shown for meeting-invite items with a messageId
  if (item.source === 'meeting-invite' && item.messageId) {
    var shortId = '\u2026' + item.messageId.slice(-16);
    elItemMetaFooter.textContent = 'ref: ' + (item.eventRef || '\u2014') + '  \u00b7  msg: ' + shortId;
    elItemMetaFooter.classList.add('visible');
  } else {
    elItemMetaFooter.classList.remove('visible');
  }

  var isMeeting = item.source === 'meeting-invite';
  elResolutionControls.style.display = isMeeting ? 'none' : '';
  elCalendarControls.style.display   = isMeeting ? ''     : 'none';

  if (isMeeting) {
    loadCalendarWidget(item);
    setCalendarButtonsDisabled(false);
  } else {
    elCalWidget.style.display = 'none';
    elDelegateInput.value = item.question || '';
    elDelegateInput.disabled = false;
    elBtnDone.disabled = false;
    elBtnDefer.disabled = false;
    elBtnExecute.disabled = false;
    updateAcceptState();
  }

  clearError();
  elDetailEmpty.style.display = 'none';
  elDetailContent.classList.add('visible');
}

function clearSelection() {
  selectedId = null;
  elDetailContent.classList.remove('visible');
  elDetailEmpty.style.display = '';
  elBtnDone.disabled = true;
  elBtnDefer.disabled = true;
  elBtnExecute.disabled = true;
  elDelegateInput.value = '';
  elDelegateInput.disabled = true;
  elBtnAccept.disabled = true;
  setCalendarButtonsDisabled(true);
  elResolutionControls.style.display = '';
  elCalendarControls.style.display = 'none';
  elItemMetaFooter.classList.remove('visible');
  elCalWidget.style.display = 'none';
  clearError();
}

// ── Auto-advance ──────────────────────────────────────────────────────────────

function autoAdvance() {
  if (items.length === 0) { clearSelection(); return; }
  var next = items.find(function(i) { return i.id !== selectedId; }) || items[0];
  if (next) { selectItem(next.id); } else { clearSelection(); }
}

// ── Resolution: Done ─────────────────────────────────────────────────────────

elBtnDone.addEventListener('click', function() {
  if (!selectedId || elBtnDone.disabled) return;
  var id = selectedId;
  setButtonsDisabled(true);
  clearError();

  fetch('/triage/api/items/' + encodeURIComponent(id) + '/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: 'done' }),
  })
  .then(function(res) {
    if (res.status === 409) {
      items = items.filter(function(i) { return i.id !== id; });
      renderList(); autoAdvance(); return;
    }
    if (!res.ok) return res.json().then(function(d) { throw new Error(d.error || ('Server error ' + res.status)); });
    items = items.filter(function(i) { return i.id !== id; });
    renderList(); autoAdvance();
  })
  .catch(function(err) {
    showError(err.message);
    setButtonsDisabled(false);
  });
});

// ── Resolution: Defer ─────────────────────────────────────────────────────────

elBtnDefer.addEventListener('click', function() {
  if (!selectedId || elBtnDefer.disabled || deferInFlight) return;
  var id = selectedId;
  deferInFlight = true;
  setButtonsDisabled(true);
  elBtnDefer.textContent = 'Deferring\u2026';
  clearError();

  fetch('/triage/api/items/' + encodeURIComponent(id) + '/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: 'defer' }),
  })
  .then(function(res) {
    elBtnDefer.textContent = 'Defer';
    deferInFlight = false;
    if (res.status === 409) {
      items = items.filter(function(i) { return i.id !== id; });
      renderList(); autoAdvance(); return;
    }
    if (!res.ok) return res.json().then(function(d) { throw new Error(d.error || ('Server error ' + res.status)); });
    items = items.filter(function(i) { return i.id !== id; });
    renderList(); autoAdvance();
  })
  .catch(function(err) {
    elBtnDefer.textContent = 'Defer';
    deferInFlight = false;
    showError(err.message);
    setButtonsDisabled(false);
  });
});

// ── Resolution: Execute with Claude ──────────────────────────────────────────

elBtnExecute.addEventListener('click', function() {
  if (!selectedId || elBtnExecute.disabled) return;
  var id = selectedId;
  setButtonsDisabled(true);
  elBtnExecute.textContent = 'Queuing\u2026';
  clearError();

  fetch('/triage/api/items/' + encodeURIComponent(id) + '/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: 'execute-with-claude' }),
  })
  .then(function(res) {
    elBtnExecute.textContent = 'Execute with Claude';
    if (res.status === 409) {
      items = items.filter(function(i) { return i.id !== id; });
      renderList(); autoAdvance(); return;
    }
    if (!res.ok) return res.json().then(function(d) { throw new Error(d.error || ('Server error ' + res.status)); });
    items = items.filter(function(i) { return i.id !== id; });
    renderList(); autoAdvance();
  })
  .catch(function(err) {
    elBtnExecute.textContent = 'Execute with Claude';
    showError(err.message);
    setButtonsDisabled(false);
  });
});

// ── Resolution: Delegate (Accept) ────────────────────────────────────────────

elBtnAccept.addEventListener('click', function() {
  if (!selectedId || elBtnAccept.disabled) return;
  var id = selectedId;
  var answer = elDelegateInput.value.trim();
  if (!answer) return;
  setButtonsDisabled(true);
  clearError();

  fetch('/triage/api/items/' + encodeURIComponent(id) + '/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: 'delegate', answer: answer }),
  })
  .then(function(res) {
    if (res.status === 409) {
      items = items.filter(function(i) { return i.id !== id; });
      renderList(); autoAdvance(); return;
    }
    if (!res.ok) return res.json().then(function(d) { throw new Error(d.error || ('Server error ' + res.status)); });
    items = items.filter(function(i) { return i.id !== id; });
    renderList(); autoAdvance();
  })
  .catch(function(err) {
    showError(err.message);
    setButtonsDisabled(false);
  });
});

elDelegateInput.addEventListener('input', updateAcceptState);

function updateAcceptState() {
  elBtnAccept.disabled = !elDelegateInput.value.trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setButtonsDisabled(disabled) {
  elBtnDone.disabled = disabled;
  elBtnDefer.disabled = disabled;
  elBtnExecute.disabled = disabled;
  elDelegateInput.disabled = disabled;
  elBtnAccept.disabled = disabled || !elDelegateInput.value.trim();
}

function setCalendarButtonsDisabled(disabled) {
  elBtnCalAccept.disabled = disabled;
  elBtnCalTentative.disabled = disabled;
  elBtnCalDecline.disabled = disabled;
}

function showError(message) {
  elErrorBanner.textContent = message;
  elErrorBanner.classList.add('visible');
}

function clearError() {
  elErrorBanner.textContent = '';
  elErrorBanner.classList.remove('visible');
}

function formatDate(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch(e) { return iso; }
}

/**
 * Minimal markdown -> HTML for the body panel.
 * Handles: headings, bold, blockquotes, tables, hr, bullet lists, paragraphs.
 * Escapes HTML to prevent XSS.
 */
function renderMarkdown(md) {
  var lines = md.split('\n');
  var out = [];
  var inTable = false;
  var tableHeader = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (/^---+$/.test(line.trim())) {
      if (inTable) { out.push('</tbody></table>'); inTable = false; }
      out.push('<hr>'); continue;
    }

    if (line.trim().charAt(0) === '|') {
      if (!inTable) { out.push('<table><thead>'); inTable = true; tableHeader = true; }
      var cells = line.trim().replace(/^\||\|$/g, '').split('|');
      if (cells.every(function(c) { return /^[-:\s]+$/.test(c); })) {
        out.push('</thead><tbody>'); tableHeader = false; continue;
      }
      var tag = tableHeader ? 'th' : 'td';
      var row = cells.map(function(c) { return '<' + tag + '>' + esc(c.trim()) + '</' + tag + '>'; }).join('');
      out.push('<tr>' + row + '</tr>'); continue;
    } else if (inTable) {
      out.push('</tbody></table>'); inTable = false;
    }

    if (line.slice(0, 4) === '### ') { out.push('<h3>' + esc(line.slice(4)) + '</h3>'); continue; }
    if (line.slice(0, 3) === '## ') { out.push('<h2>' + esc(line.slice(3)) + '</h2>'); continue; }
    if (line.slice(0, 2) === '> ') { out.push('<blockquote>' + esc(line.slice(2)) + '</blockquote>'); continue; }
    if (/^[-*] /.test(line)) { out.push('<p>&bull; ' + inlineMd(esc(line.slice(2))) + '</p>'); continue; }
    if (line.trim() === '') { out.push('<br>'); continue; }
    out.push('<p>' + inlineMd(esc(line)) + '</p>');
  }

  if (inTable) out.push('</tbody></table>');
  return out.join('\n');
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function inlineMd(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ── Resolution: Calendar Response (meeting-invite items) ─────────────────────

var CAL_BTN_LABELS = {
  'btn-cal-accept':    '\u2713 Accept',
  'btn-cal-tentative': '~ Tentative',
  'btn-cal-decline':   '\u2717 Decline',
};

var CAL_RESOLUTIONS = {
  'btn-cal-accept':    'calendar-accepted',
  'btn-cal-tentative': 'calendar-tentative',
  'btn-cal-decline':   'calendar-declined',
};

['btn-cal-accept', 'btn-cal-tentative', 'btn-cal-decline'].forEach(function(btnId) {
  document.getElementById(btnId).addEventListener('click', function() {
    if (!selectedId) return;
    var btn = document.getElementById(btnId);
    if (btn.disabled) return;
    var id = selectedId;
    var resolution = CAL_RESOLUTIONS[btnId];

    setCalendarButtonsDisabled(true);
    btn.textContent = '\u2026';
    clearError();

    fetch('/triage/api/items/' + encodeURIComponent(id) + '/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: resolution }),
    })
    .then(function(res) {
      btn.textContent = CAL_BTN_LABELS[btnId];
      if (res.status === 409) {
        items = items.filter(function(i) { return i.id !== id; });
        renderList(); autoAdvance(); return;
      }
      if (!res.ok) return res.json().then(function(d) { throw new Error(d.error || ('Server error ' + res.status)); });
      items = items.filter(function(i) { return i.id !== id; });
      renderList(); autoAdvance();
    })
    .catch(function(err) {
      btn.textContent = CAL_BTN_LABELS[btnId];
      showError(err.message);
      setCalendarButtonsDisabled(false);
    });
  });
});

// ── Calendar day widget ───────────────────────────────────────────────────────

function loadCalendarWidget(item) {
  elCalWidget.style.display = 'flex';
  elCalDateLabel.textContent = '';
  elCalLoading.style.display = '';
  elCalScroll.style.display = 'none';
  elCalError.style.display = 'none';
  elCalRecurrence.style.display = 'none';
  elCalTimeline.innerHTML = '';

  fetch('/triage/api/items/' + encodeURIComponent(item.id) + '/calendar')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      elCalLoading.style.display = 'none';
      if (!data.ok) {
        elCalError.textContent = data.error || 'Failed to load calendar';
        elCalError.style.display = '';
        return;
      }
      elCalDateLabel.textContent = formatCalDate(data.date);
      renderCalTimeline(data);
      renderRecurringConflicts(data);
      elCalScroll.style.display = 'block';
    })
    .catch(function(err) {
      elCalLoading.style.display = 'none';
      elCalError.textContent = 'Calendar unavailable: ' + err.message;
      elCalError.style.display = '';
      elCalRecurrence.style.display = 'none';
    });
}

function formatCalDate(dateStr) {
  try {
    var d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge cases
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch(e) { return dateStr; }
}

/**
 * Parse a Graph datetime string (no timezone suffix) as UTC and return
 * local hours + minutes for positioning on the timeline.
 */
function isoToLocalTime(isoStr) {
  var s = isoStr || '';
  var d = new Date(s.endsWith('Z') ? s : s.split('.')[0] + 'Z');
  return { h: d.getHours(), m: d.getMinutes() };
}

/** Map a local time to a 1-based slot (1 = 08:00, 20 = 17:30, 21 = 18:00 end) */
function timeToSlot(h, m) {
  return Math.floor((h * 60 + m - 480) / 30) + 1;
}

function renderCalTimeline(data) {
  elCalTimeline.innerHTML = '';

  // Column 1: time labels (one per row)
  for (var slot = 0; slot < 20; slot++) {
    var totalMins = 480 + slot * 30;
    var lh = Math.floor(totalMins / 60);
    var lm = totalMins % 60;
    var label = document.createElement('div');
    label.className = 'cal-label';
    label.style.gridRow = String(slot + 1);
    label.textContent = (lh < 10 ? '0' : '') + lh + ':' + (lm === 0 ? '00' : '30');
    elCalTimeline.appendChild(label);
  }

  // Column 2: background cells (alternating shade per hour pair)
  for (var bg = 0; bg < 20; bg++) {
    var cell = document.createElement('div');
    cell.className = 'cal-slot-bg' + (bg % 2 === 0 ? ' cal-slot-even' : '');
    cell.style.gridRow = String(bg + 1);
    elCalTimeline.appendChild(cell);
  }

  // Pre-compute meeting slot range for highlighting
  var meetStart = isoToLocalTime(data.meetingStart);
  var meetEnd   = isoToLocalTime(data.meetingEnd);
  var meetStartSlot = timeToSlot(meetStart.h, meetStart.m);
  var meetEndSlot   = timeToSlot(meetEnd.h,   meetEnd.m);

  // Column 2: event blocks spanning rows
  (data.events || []).forEach(function(ev) {
    if (ev.isAllDay) return;

    var evStart = isoToLocalTime(ev.startDateTime);
    var evEnd   = isoToLocalTime(ev.endDateTime);
    var startSlot = Math.max(1, timeToSlot(evStart.h, evStart.m));
    var endSlot   = Math.min(21, timeToSlot(evEnd.h,  evEnd.m));

    if (startSlot >= 21 || endSlot <= 1 || endSlot <= startSlot) return;

    var isThisInvite = (ev.startDateTime === data.meetingStart);
    var showAs = (ev.showAs || 'busy').toLowerCase();

    var cls = 'cal-event ';
    if (isThisInvite) {
      cls += 'cal-event-this';
    } else if (showAs === 'tentative') {
      cls += 'cal-event-tentative';
    } else if (showAs === 'oof') {
      cls += 'cal-event-oof';
    } else if (showAs === 'free') {
      cls += 'cal-event-free';
    } else {
      cls += 'cal-event-busy';
    }

    var fmtTime = function(t) { return (t.h < 10 ? '0' : '') + t.h + ':' + (t.m === 0 ? '00' : '30'); };

    var block = document.createElement('div');
    block.className = cls;
    block.style.gridRow = startSlot + ' / ' + endSlot;
    block.textContent = ev.subject;
    block.title = ev.subject + '\n' + fmtTime(evStart) + ' \u2013 ' + fmtTime(evEnd);
    elCalTimeline.appendChild(block);
  });

  // If the invite itself isn't in calendarView results, draw it anyway
  var inviteInResults = (data.events || []).some(function(ev) {
    return ev.startDateTime === data.meetingStart;
  });
  if (!inviteInResults && meetStartSlot < 21 && meetEndSlot > 1) {
    var inviteBlock = document.createElement('div');
    inviteBlock.className = 'cal-event cal-event-this';
    inviteBlock.style.gridRow = Math.max(1, meetStartSlot) + ' / ' + Math.min(21, meetEndSlot);
    inviteBlock.textContent = '(this invite)';
    elCalTimeline.appendChild(inviteBlock);
  }
}

function renderRecurringConflicts(data) {
  var rc = data.recurringConflicts;
  if (!data.isRecurring || !rc) {
    elCalRecurrence.style.display = 'none';
    return;
  }

  elCalRecurrence.innerHTML = '';

  var summary = document.createElement('div');
  summary.className = 'recurrence-summary';

  if (rc.conflictCount === 0) {
    summary.className += ' recurrence-ok';
    summary.textContent = '\u2713 No conflicts in next 90 days (' + rc.occurrencesChecked + ' occurrences checked)';
    elCalRecurrence.appendChild(summary);
  } else {
    summary.className += ' recurrence-warn';
    summary.textContent = '\u26a0 ' + rc.conflictCount + ' conflict' + (rc.conflictCount === 1 ? '' : 's') + ' across ' + rc.occurrencesChecked + ' occurrences';
    elCalRecurrence.appendChild(summary);

    var list = document.createElement('ul');
    list.className = 'recurrence-conflicts';
    rc.conflicts.forEach(function(conflict) {
      var li = document.createElement('li');
      var dateStr = '';
      try { dateStr = new Date(conflict.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
      catch(e) { dateStr = conflict.date; }
      li.textContent = dateStr + ': ' + conflict.conflictingSubject;
      list.appendChild(li);
    });
    elCalRecurrence.appendChild(list);
  }

  elCalRecurrence.style.display = '';
}

// ── Poll loop (US5) ───────────────────────────────────────────────────────────

function getPollInterval() {
  var params = new URLSearchParams(window.location.search);
  var n = parseInt(params.get('poll') || '10', 10);
  return (isNaN(n) || n < 2) ? 10000 : n * 1000;
}

fetchItems();
setInterval(fetchItems, getPollInterval());
