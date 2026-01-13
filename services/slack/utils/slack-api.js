/**
 * Slack API Client
 *
 * Handles HTTP requests to the Slack Web API.
 * Unlike Microsoft Graph, Slack uses POST for all methods.
 */

const https = require('https');
const url = require('url');
const querystring = require('querystring');
const config = require('../config');

/**
 * Make a request to the Slack API
 * @param {string} accessToken - Slack access token
 * @param {string} method - Slack API method (e.g., 'conversations.list')
 * @param {object} params - Request parameters
 * @returns {Promise<object>} - API response
 */
async function callSlackAPI(accessToken, method, params = {}) {
  // Check for test mode
  if (config.USE_TEST_MODE) {
    console.log(`Slack API (test mode): ${method}`);
    const mockData = require('./mock-data');
    return mockData.getMockResponse(method, params);
  }

  return new Promise((resolve, reject) => {
    const endpoint = `${config.SLACK_API_ENDPOINT}${method}`;
    const parsedUrl = url.parse(endpoint);

    // Slack API uses POST with JSON body for all methods
    const requestBody = JSON.stringify(params);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);

          // Check Slack's ok field
          if (!response.ok) {
            console.error(`Slack API error (${method}):`, response.error);
            reject(new Error(`Slack API error: ${response.error}`));
            return;
          }

          resolve(response);
        } catch (error) {
          console.error(`Error parsing Slack API response:`, error);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`Slack API request error:`, error);
      reject(error);
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Make a paginated request to Slack API
 * @param {string} accessToken - Slack access token
 * @param {string} method - Slack API method
 * @param {object} params - Request parameters
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Promise<object>} - Aggregated API response
 */
async function callSlackAPIPaginated(accessToken, method, params = {}, maxResults = null) {
  const results = [];
  let cursor = null;
  const limit = maxResults ? Math.min(params.limit || config.MAX_PAGE_SIZE, config.MAX_PAGE_SIZE) : (params.limit || config.DEFAULT_PAGE_SIZE);

  do {
    const requestParams = {
      ...params,
      limit: limit
    };

    if (cursor) {
      requestParams.cursor = cursor;
    }

    const response = await callSlackAPI(accessToken, method, requestParams);

    // Extract items based on method
    let items = [];
    if (response.channels) {
      items = response.channels;
    } else if (response.messages) {
      items = response.messages;
    } else if (response.members) {
      items = response.members;
    }

    results.push(...items);

    // Check for next page
    cursor = response.response_metadata?.next_cursor;

    // Stop if we have enough results or no more pages
    if (maxResults && results.length >= maxResults) {
      break;
    }

    if (!cursor || cursor === '') {
      break;
    }
  } while (cursor);

  // Trim to max results if specified
  const finalResults = maxResults ? results.slice(0, maxResults) : results;

  return {
    ok: true,
    items: finalResults,
    count: finalResults.length
  };
}

module.exports = {
  callSlackAPI,
  callSlackAPIPaginated
};
