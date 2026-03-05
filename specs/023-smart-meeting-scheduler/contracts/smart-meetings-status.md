# MCP Tool Contract: smart_meetings_status

**Tool name**: `smart_meetings_status`
**Namespace**: `smart-meetings` (registered as `smart-meetings.smart_meetings_status` in the MCP server)
**Implemented in**: `src/services/smart-meetings/smart-meetings-service.ts`

---

## Description

Returns the current scheduling state of all configured smart meetings, including cadence debt for each meeting and a time portfolio summary for the trailing and current calendar weeks.

The response is designed to be consumed directly by downstream skills (e.g. `morning-calendar`) without requiring additional tool calls. It is a read-only snapshot — it does not trigger any scheduling actions.

---

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "meetingId": {
      "type": "string",
      "description": "If provided, return status for only this meeting (references MeetingDefinition.id). Omit to return all meetings."
    }
  },
  "required": []
}
```

All parameters are optional. Calling the tool with an empty object `{}` returns the full status response.

---

## Output Schema

```json
{
  "type": "object",
  "required": ["generatedAt", "meetings", "timePortfolio"],
  "properties": {
    "generatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp when this response was generated"
    },
    "meetings": {
      "type": "array",
      "description": "Status for each meeting in smart-meetings-config.json. Sorted: enabled meetings by cadenceDebt DESC (most overdue first), then disabled meetings.",
      "items": {
        "type": "object",
        "required": ["meetingId", "title", "enabled", "cadence", "lastOccurrence", "nextScheduled", "cadenceDebt", "attendees"],
        "properties": {
          "meetingId":     { "type": "string" },
          "title":         { "type": "string" },
          "enabled":       { "type": "boolean" },
          "cadence": {
            "type": "object",
            "properties": {
              "frequency":  { "type": "string", "enum": ["weekly", "fortnightly", "monthly"] },
              "idealDays":  { "type": "array", "items": { "type": "string" } }
            }
          },
          "lastOccurrence":  { "type": ["string", "null"], "format": "date-time" },
          "nextScheduled":   { "type": ["string", "null"], "format": "date-time" },
          "attendees":       { "type": "array", "items": { "type": "string" } },
          "cadenceDebt": {
            "type": "object",
            "required": ["meetingId", "daysSinceLastOccurrence", "expectedCadenceDays", "debtDays", "targetHorizonDays", "lastOccurrenceDate"],
            "properties": {
              "meetingId":                { "type": "string" },
              "daysSinceLastOccurrence":  { "type": ["number", "null"] },
              "expectedCadenceDays":      { "type": "number" },
              "debtDays":                 { "type": ["number", "null"] },
              "targetHorizonDays":        { "type": "number" },
              "lastOccurrenceDate":       { "type": ["string", "null"] }
            }
          }
        }
      }
    },
    "timePortfolio": {
      "type": ["object", "null"],
      "description": "Time portfolio summary. Null if the rebalance pass has never run since server start.",
      "properties": {
        "thisWeek": { "$ref": "#/$defs/WeeklyPortfolioSlice" },
        "lastWeek": { "$ref": "#/$defs/WeeklyPortfolioSlice" },
        "trend": {
          "type": "object",
          "properties": {
            "focus":     { "type": "string", "enum": ["improving", "stable", "worsening"] },
            "recurring": { "type": "string", "enum": ["improving", "stable", "worsening"] },
            "adHoc":     { "type": "string", "enum": ["improving", "stable", "worsening"] }
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "warningType":      { "type": "string", "enum": ["imbalance", "stale-data"] },
              "category":         { "type": "string", "enum": ["focus", "recurring", "adHoc"] },
              "consecutiveWeeks": { "type": "number" },
              "thresholdPct":     { "type": "number" },
              "message":          { "type": "string" }
            },
            "required": ["warningType", "category", "consecutiveWeeks", "thresholdPct", "message"]
          }
        }
      }
    }
  },
  "$defs": {
    "WeeklyPortfolioSlice": {
      "type": "object",
      "properties": {
        "weekStart":    { "type": "string", "format": "date" },
        "focusPct":     { "type": "number" },
        "recurringPct": { "type": "number" },
        "adHocPct":     { "type": "number" },
        "focusMins":    { "type": "number" },
        "recurringMins":{ "type": "number" },
        "adHocMins":    { "type": "number" },
        "workingMins":  { "type": "number" }
      }
    }
  }
}
```

---

## Example Response

Three meetings: one on-schedule (green), one amber (1–13 days overdue), one red (14+ days overdue). Portfolio has an active imbalance warning.

```json
{
  "generatedAt": "2026-03-05T08:14:22.000Z",
  "meetings": [
    {
      "meetingId": "dorin-laz-121",
      "title": "Dorin:Laz 1:21",
      "enabled": true,
      "cadence": {
        "frequency": "weekly",
        "idealDays": ["tuesday", "wednesday"]
      },
      "lastOccurrence": "2026-02-25T10:00:00.000Z",
      "nextScheduled": "2026-03-24T10:00:00.000Z",
      "attendees": ["laz.allen@skyscanner.net", "dorin.ionescu@skyscanner.net"],
      "cadenceDebt": {
        "meetingId": "dorin-laz-121",
        "daysSinceLastOccurrence": 8,
        "expectedCadenceDays": 7,
        "debtDays": 1,
        "targetHorizonDays": 14,
        "lastOccurrenceDate": "2026-02-25"
      }
    },
    {
      "meetingId": "tim-laz-121",
      "title": "Tim:Laz 1:1",
      "enabled": true,
      "cadence": {
        "frequency": "fortnightly",
        "idealDays": ["thursday"]
      },
      "lastOccurrence": "2026-02-05T14:00:00.000Z",
      "nextScheduled": null,
      "attendees": ["laz.allen@skyscanner.net", "tim.brownjohn@skyscanner.net"],
      "cadenceDebt": {
        "meetingId": "tim-laz-121",
        "daysSinceLastOccurrence": 28,
        "expectedCadenceDays": 14,
        "debtDays": 14,
        "targetHorizonDays": 2,
        "lastOccurrenceDate": "2026-02-05"
      }
    },
    {
      "meetingId": "squad-sync",
      "title": "Flights Growth Squad Sync",
      "enabled": true,
      "cadence": {
        "frequency": "weekly",
        "idealDays": ["monday", "tuesday"]
      },
      "lastOccurrence": "2026-03-02T09:00:00.000Z",
      "nextScheduled": "2026-03-23T09:00:00.000Z",
      "attendees": [
        "laz.allen@skyscanner.net",
        "alice.nguyen@skyscanner.net",
        "bob.harris@skyscanner.net"
      ],
      "cadenceDebt": {
        "meetingId": "squad-sync",
        "daysSinceLastOccurrence": 3,
        "expectedCadenceDays": 7,
        "debtDays": -4,
        "targetHorizonDays": 21,
        "lastOccurrenceDate": "2026-03-02"
      }
    }
  ],
  "timePortfolio": {
    "thisWeek": {
      "weekStart": "2026-03-02",
      "focusPct": 28,
      "recurringPct": 55,
      "adHocPct": 17,
      "focusMins": 135,
      "recurringMins": 264,
      "adHocMins": 81,
      "workingMins": 480
    },
    "lastWeek": {
      "weekStart": "2026-02-23",
      "focusPct": 22,
      "recurringPct": 58,
      "adHocPct": 20,
      "focusMins": 106,
      "recurringMins": 278,
      "adHocMins": 96,
      "workingMins": 480
    },
    "trend": {
      "focus": "stable",
      "recurring": "improving",
      "adHoc": "stable"
    },
    "warnings": [
      {
        "warningType": "imbalance",
        "category": "recurring",
        "consecutiveWeeks": 3,
        "thresholdPct": 50,
        "message": "Recurring meetings have accounted for more than 50% of working hours for 3 consecutive weeks (current week: 55%, last week: 58%). Consider protecting more focus time."
      }
    ]
  }
}
```

**Reading the example**:

- `tim-laz-121`: `debtDays: 14`, `targetHorizonDays: 2` — red in the dashboard, scheduler will attempt to book this at the earliest available slot (today + 48h minimum notice). `nextScheduled: null` because no event exists in the 21-day window yet.
- `dorin-laz-121`: `debtDays: 1`, `targetHorizonDays: 14` — amber in the dashboard, slightly late but a slot has been found 3 weeks out.
- `squad-sync`: `debtDays: -4` — green, comfortably on schedule, next occurrence already booked.
- Portfolio warning: recurring meetings have been above 50% for 3 weeks. The scheduler does not act on this — it is surfaced for awareness only.

---

## Error Cases

### Config file missing or unreadable

```json
{
  "content": [{
    "type": "text",
    "text": "Error: smart-meetings-config.json not found at ./smart-meetings-config.json. Create the config file to use smart meeting scheduling."
  }],
  "isError": true
}
```

The tool returns an MCP error result (`isError: true`) with a descriptive message. It does not throw.

### Graph API unavailable (stale portfolio data)

When the Microsoft Graph `calendarView` call fails during a tool invocation, the tool falls back to the cached `portfolioRef.current` value (populated by the last successful rebalance pass) and appends a warning flag:

```json
{
  "generatedAt": "2026-03-05T08:14:22.000Z",
  "meetings": [ "... (cadenceDebt calculated from history only, nextScheduled: null for all meetings)" ],
  "timePortfolio": {
    "thisWeek": { "weekStart": "2026-03-02", "...": "stale values from last rebalance" },
    "lastWeek":  { "...": "stale values" },
    "trend": { "...": "stale values" },
    "warnings": [
      {
        "category": "recurring",
        "consecutiveWeeks": 3,
        "thresholdPct": 50,
        "message": "Recurring meetings have accounted for more than 50% of working hours for 3 consecutive weeks (current week: 55%, last week: 58%). Consider protecting more focus time."
      },
      {
        "warningType": "stale-data",
        "category": "focus",
        "consecutiveWeeks": 0,
        "thresholdPct": 50,
        "message": "WARNING: Graph API unavailable. Portfolio data is stale (last updated: 2026-03-04T08:01:11Z). Meeting next-scheduled times could not be refreshed."
      }
    ]
  }
}
```

The stale-data warning always uses `warningType: "stale-data"` to distinguish it from genuine imbalance warnings (`warningType: "imbalance"`). It is always appended last in `warnings[]`.

If `portfolioRef.current` is also null (rebalance pass has never run), `timePortfolio` is returned as `null` and the error is reported only in the MCP result metadata:

```json
{
  "generatedAt": "2026-03-05T08:14:22.000Z",
  "meetings": [ "..." ],
  "timePortfolio": null,
  "_meta": {
    "portfolioUnavailable": true,
    "reason": "Graph API unavailable and no cached portfolio data. Run the rebalance pass to populate portfolio data."
  }
}
```

### meetingId not found

```json
{
  "content": [{
    "type": "text",
    "text": "Error: No meeting with id 'unknown-id' found in smart-meetings-config.json."
  }],
  "isError": true
}
```
