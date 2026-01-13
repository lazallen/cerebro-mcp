/**
 * List events functionality
 */
const config = require('../config');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * List events handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleListEvents(args) {
  const count = Math.min(args.count || 10, config.MAX_RESULT_COUNT);

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Build API endpoint using calendarView (recommended for date-range queries)
    // calendarView handles recurring events properly and is optimized for time-based queries
    let endpoint = 'me/calendar/calendarView';

    // Set up date range - from now to 5 days in the future
    const startDateTime = new Date();
    const endDateTime = new Date();
    endDateTime.setDate(endDateTime.getDate() + 5);

    // Add query parameters
    // Note: calendarView requires startDateTime and endDateTime query parameters
    const queryParams = {
      startDateTime: startDateTime.toISOString(),
      endDateTime: endDateTime.toISOString(),
      $top: count,
      $orderby: 'start/dateTime',
      $select: config.CALENDAR_SELECT_FIELDS
    };
    
    // Make API call
    const response = await callGraphAPI(accessToken, 'GET', endpoint, null, queryParams);
    
    if (!response.value || response.value.length === 0) {
      return {
        content: [{ 
          type: "text", 
          text: "No calendar events found."
        }]
      };
    }
    
    // Format results
    const eventList = response.value.map((event, index) => {
      const startDate = new Date(event.start.dateTime).toLocaleString(event.start.timeZone);
      const endDate = new Date(event.end.dateTime).toLocaleString(event.end.timeZone);
      const location = event.location.displayName || 'No location';
      
      return `${index + 1}. ${event.subject} - Location: ${location}\nStart: ${startDate}\nEnd: ${endDate}\nSubject: ${event.subject}\nSummary: ${event.bodyPreview}\nID: ${event.id}\n`;
    }).join("\n");
    
    return {
      content: [{ 
        type: "text", 
        text: `Found ${response.value.length} events:\n\n${eventList}`
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
        text: `Error listing events: ${error.message}`
      }]
    };
  }
}

module.exports = handleListEvents;
