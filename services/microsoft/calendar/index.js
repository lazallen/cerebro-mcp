/**
 * Calendar module for Outlook MCP server
 */
const handleListEvents = require('./list');
const handleDeclineEvent = require('./decline');
const handleCreateEvent = require('./create');
const handleCancelEvent = require('./cancel');
const handleDeleteEvent = require('./delete');
const handleFindMeetingTimes = require('./find-meeting-times');

// Calendar tool definitions
const calendarTools = [
  {
    name: "list-events",
    description: "Lists upcoming events from your calendar",
    inputSchema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of events to retrieve (default: 10, max: 50)"
        }
      },
      required: []
    },
    handler: handleListEvents
  },
  {
    name: "decline-event",
    description: "Declines a calendar event",
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The ID of the event to decline"
        },
        comment: {
          type: "string",
          description: "Optional comment for declining the event"
        }
      },
      required: ["eventId"]
    },
    handler: handleDeclineEvent
  },
  {
    name: "create-event",
    description: "Creates a new calendar event",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "The subject of the event"
        },
        start: {
          type: "string",
          description: "The start time of the event in ISO 8601 format"
        },
        end: {
          type: "string",
          description: "The end time of the event in ISO 8601 format"
        },
        attendees: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of attendee email addresses"
        },
        body: {
          type: "string",
          description: "Optional body content for the event"
        }
      },
      required: ["subject", "start", "end"]
    },
    handler: handleCreateEvent
  },
  {
    name: "cancel-event",
    description: "Cancels a calendar event",
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The ID of the event to cancel"
        },
        comment: {
          type: "string",
          description: "Optional comment for cancelling the event"
        }
      },
      required: ["eventId"]
    },
    handler: handleCancelEvent
  },
  {
    name: "delete-event",
    description: "Deletes a calendar event",
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The ID of the event to delete"
        }
      },
      required: ["eventId"]
    },
    handler: handleDeleteEvent
  },
  {
    name: "find-meeting-times",
    description: "Find available meeting times using the Scheduling Assistant. Suggests meeting times based on attendee availability, working hours, and time constraints.",
    inputSchema: {
      type: "object",
      properties: {
        attendees: {
          type: "array",
          items: {
            type: "string"
          },
          description: "List of attendee email addresses to check availability for"
        },
        requiredAttendees: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Subset of attendees who are required (vs optional)"
        },
        startDateTime: {
          type: "string",
          description: "Start of the time window to search (ISO 8601 format, e.g., '2026-01-14T09:00:00'). Defaults to now."
        },
        endDateTime: {
          type: "string",
          description: "End of the time window to search (ISO 8601 format, e.g., '2026-01-14T17:00:00'). Defaults to 5 days from now."
        },
        duration: {
          type: "string",
          description: "Meeting duration in ISO 8601 duration format (e.g., 'PT30M' for 30 minutes, 'PT1H' for 1 hour). Default: 'PT30M'"
        },
        timeZone: {
          type: "string",
          description: "Time zone for the meeting (e.g., 'Europe/London'). Default: 'Europe/London'"
        },
        maxCandidates: {
          type: "number",
          description: "Maximum number of meeting time suggestions to return (default: 5, max: 20)"
        },
        returnSuggestionReasons: {
          type: "boolean",
          description: "Include reasons why each time slot was suggested (default: false)"
        }
      },
      required: []
    },
    handler: handleFindMeetingTimes
  }
];

module.exports = {
  calendarTools,
  handleListEvents,
  handleDeclineEvent,
  handleCreateEvent,
  handleCancelEvent,
  handleDeleteEvent,
  handleFindMeetingTimes
};
