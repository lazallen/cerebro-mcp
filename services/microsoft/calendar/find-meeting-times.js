/**
 * Find meeting times functionality using Microsoft Graph findMeetingTimes API
 */
const config = require('../config');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Find meeting times handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleFindMeetingTimes(args) {
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build the request body for findMeetingTimes API
    const requestBody = {
      attendees: [],
      timeConstraint: {
        timeslots: []
      },
      meetingDuration: args.duration || 'PT30M', // Default 30 minutes
      maxCandidates: args.maxCandidates || 5
    };

    // Add attendees if provided
    if (args.attendees && Array.isArray(args.attendees)) {
      requestBody.attendees = args.attendees.map(email => ({
        emailAddress: {
          address: email
        },
        type: args.requiredAttendees?.includes(email) ? 'required' : 'optional'
      }));
    }

    // Set up time constraints
    if (args.startDateTime && args.endDateTime) {
      requestBody.timeConstraint.timeslots.push({
        start: {
          dateTime: args.startDateTime,
          timeZone: args.timeZone || 'Europe/London'
        },
        end: {
          dateTime: args.endDateTime,
          timeZone: args.timeZone || 'Europe/London'
        }
      });
    } else {
      // Default: search within the next 5 working days, 9 AM to 5 PM
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 5);

      requestBody.timeConstraint.timeslots.push({
        start: {
          dateTime: start.toISOString(),
          timeZone: args.timeZone || 'Europe/London'
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: args.timeZone || 'Europe/London'
        }
      });
    }

    // Add return suggestion reasons if requested
    if (args.returnSuggestionReasons) {
      requestBody.returnSuggestionReasons = true;
    }

    // Make API call
    const endpoint = 'me/findMeetingTimes';
    const response = await callGraphAPI(accessToken, 'POST', endpoint, requestBody);

    if (!response.meetingTimeSuggestions || response.meetingTimeSuggestions.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No available meeting times found for the specified criteria."
        }]
      };
    }

    // Format results
    const suggestions = response.meetingTimeSuggestions.map((suggestion, index) => {
      const startTime = new Date(suggestion.meetingTimeSlot.start.dateTime).toLocaleString('en-GB', {
        timeZone: suggestion.meetingTimeSlot.start.timeZone,
        dateStyle: 'full',
        timeStyle: 'short'
      });
      const endTime = new Date(suggestion.meetingTimeSlot.end.dateTime).toLocaleString('en-GB', {
        timeZone: suggestion.meetingTimeSlot.end.timeZone,
        timeStyle: 'short'
      });

      const confidence = suggestion.confidence || 'unknown';
      const score = suggestion.suggestionReason ? ` (Score: ${suggestion.suggestionReason})` : '';

      let attendeeAvailability = '';
      if (suggestion.attendeeAvailability && suggestion.attendeeAvailability.length > 0) {
        attendeeAvailability = '\n  Attendees: ' + suggestion.attendeeAvailability.map(a => {
          const status = a.availability || 'unknown';
          return `${a.attendee?.emailAddress?.address || 'unknown'} (${status})`;
        }).join(', ');
      }

      return `${index + 1}. ${startTime} - ${endTime}
  Confidence: ${confidence}${score}${attendeeAvailability}
  Start: ${suggestion.meetingTimeSlot.start.dateTime}
  End: ${suggestion.meetingTimeSlot.end.dateTime}`;
    }).join('\n\n');

    return {
      content: [{
        type: "text",
        text: `Found ${response.meetingTimeSuggestions.length} available time slot(s):\n\n${suggestions}\n\nEmpty time slot reason: ${response.emptySuggestionsReason || 'N/A'}`
      }]
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [{
          type: "text",
          text: "Authentication required. Please use the 'authenticate' tool first."
        }]
      };
    }

    return {
      content: [{
        type: "text",
        text: `Error finding meeting times: ${error.message}`
      }]
    };
  }
}

module.exports = handleFindMeetingTimes;
