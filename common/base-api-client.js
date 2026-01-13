/**
 * Base API Client Class
 *
 * Abstract base class for making API requests to different services.
 * Each service should extend this class and implement service-specific API logic.
 */

const https = require('https');

class BaseAPIClient {
  /**
   * @param {object} config - Configuration for the API client
   * @param {string} config.apiEndpoint - Base API endpoint URL
   * @param {function} config.getAccessToken - Function to retrieve access token
   * @param {boolean} [config.useTestMode=false] - Whether to use test mode
   */
  constructor(config) {
    if (this.constructor === BaseAPIClient) {
      throw new Error('BaseAPIClient is an abstract class and cannot be instantiated directly');
    }

    this.config = {
      useTestMode: false,
      ...config
    };

    if (!this.config.apiEndpoint) {
      throw new Error('apiEndpoint is required in configuration');
    }

    if (!this.config.getAccessToken || typeof this.config.getAccessToken !== 'function') {
      throw new Error('getAccessToken function is required in configuration');
    }
  }

  /**
   * Make an HTTP request to the API
   * @param {string} method - HTTP method (GET, POST, PATCH, PUT, DELETE)
   * @param {string} path - API endpoint path or full URL
   * @param {object} [data=null] - Request body data
   * @param {object} [queryParams={}] - Query parameters
   * @returns {Promise<object>} - API response
   */
  async makeRequest(method, path, data = null, queryParams = {}) {
    // Get access token
    const accessToken = await this.config.getAccessToken();

    if (!accessToken) {
      throw new Error('UNAUTHORIZED: No valid access token available');
    }

    // Check for test mode
    if (this.config.useTestMode && this.shouldMockRequest(accessToken)) {
      console.error(`${this.constructor.name}: TEST MODE - Simulating ${method} ${path} API call`);
      return this.mockRequest(method, path, data, queryParams);
    }

    console.error(`${this.constructor.name}: Making API call: ${method} ${path}`);

    // Build final URL
    const finalUrl = this.buildRequestUrl(path, queryParams);
    console.error(`${this.constructor.name}: Full URL: ${finalUrl}`);

    // Make the request
    return this._makeHttpsRequest(method, finalUrl, data, accessToken);
  }

  /**
   * Make an HTTPS request
   * @protected
   * @param {string} method - HTTP method
   * @param {string} url - Full URL
   * @param {object} data - Request body
   * @param {string} accessToken - Access token
   * @returns {Promise<object>}
   */
  async _makeHttpsRequest(method, url, data, accessToken) {
    return new Promise((resolve, reject) => {
      const options = {
        method: method,
        headers: this.buildRequestHeaders(accessToken, data)
      };

      const req = https.request(url, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            this.handleResponse(res, responseData, resolve, reject);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error during API call: ${error.message}`));
      });

      if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Build request headers
   * Can be overridden by subclasses to add service-specific headers
   * @protected
   * @param {string} accessToken - Access token
   * @param {object} data - Request body data
   * @returns {object} - Headers object
   */
  buildRequestHeaders(accessToken, data) {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Build the complete request URL from path and query parameters
   * Can be overridden by subclasses for service-specific URL building
   * @protected
   * @param {string} path - API path or full URL
   * @param {object} queryParams - Query parameters
   * @returns {string} - Complete URL
   */
  buildRequestUrl(path, queryParams) {
    // Check if path is already a full URL (e.g., from pagination)
    if (path.startsWith('http://') || path.startsWith('https://')) {
      console.error(`${this.constructor.name}: Using full URL: ${path}`);
      return path;
    }

    // Build URL from base endpoint and path
    const queryString = this.buildQueryString(queryParams);
    return `${this.config.apiEndpoint}${path}${queryString}`;
  }

  /**
   * Build query string from parameters
   * Can be overridden by subclasses for service-specific query string building
   * @protected
   * @param {object} queryParams - Query parameters
   * @returns {string} - Query string (including leading '?')
   */
  buildQueryString(queryParams) {
    if (!queryParams || Object.keys(queryParams).length === 0) {
      return '';
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      params.append(key, value);
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Handle the HTTP response
   * Can be overridden by subclasses for service-specific response handling
   * @protected
   * @param {object} res - HTTP response object
   * @param {string} responseData - Response body as string
   * @param {function} resolve - Promise resolve function
   * @param {function} reject - Promise reject function
   */
  handleResponse(res, responseData, resolve, reject) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Success
      const jsonResponse = responseData ? JSON.parse(responseData) : {};
      resolve(jsonResponse);
    } else if (res.statusCode === 401) {
      // Unauthorized
      reject(new Error('UNAUTHORIZED'));
    } else {
      // Other error
      reject(new Error(`API call failed with status ${res.statusCode}: ${responseData}`));
    }
  }

  /**
   * Make a paginated request to retrieve all results
   * @param {string} method - HTTP method (typically GET)
   * @param {string} path - API endpoint path
   * @param {object} [queryParams={}] - Query parameters
   * @param {number} [maxCount=0] - Maximum items to retrieve (0 = all)
   * @returns {Promise<object>} - Combined response with all items
   */
  async makePaginatedRequest(method, path, queryParams = {}, maxCount = 0) {
    if (method !== 'GET') {
      throw new Error('Pagination only supports GET requests');
    }

    const allItems = [];
    let currentUrl = path;
    let currentParams = queryParams;

    do {
      const response = await this.makeRequest(method, currentUrl, null, currentParams);

      // Extract items (this assumes 'value' array, override if different)
      const items = this.extractItemsFromResponse(response);
      if (items && Array.isArray(items)) {
        allItems.push(...items);
        console.error(`${this.constructor.name}: Pagination - Retrieved ${items.length} items, total: ${allItems.length}`);
      }

      // Check if we've reached max count
      if (maxCount > 0 && allItems.length >= maxCount) {
        console.error(`${this.constructor.name}: Pagination - Reached max count of ${maxCount}`);
        break;
      }

      // Get next page URL
      const nextLink = this.getNextPageUrl(response);
      if (nextLink) {
        currentUrl = nextLink;
        currentParams = {}; // nextLink contains all params
        console.error(`${this.constructor.name}: Pagination - Following next link`);
      } else {
        break;
      }
    } while (true);

    // Trim to exact count if needed
    const finalItems = maxCount > 0 ? allItems.slice(0, maxCount) : allItems;

    console.error(`${this.constructor.name}: Pagination complete - ${finalItems.length} total items`);

    return this.buildPaginatedResponse(finalItems);
  }

  /**
   * Extract items array from API response
   * Should be overridden by subclasses if the response format differs
   * @protected
   * @param {object} response - API response
   * @returns {Array} - Array of items
   */
  extractItemsFromResponse(response) {
    return response.value || [];
  }

  /**
   * Get the next page URL from API response
   * Should be overridden by subclasses if pagination differs
   * @protected
   * @param {object} response - API response
   * @returns {string|null} - Next page URL or null
   */
  getNextPageUrl(response) {
    return response['@odata.nextLink'] || null;
  }

  /**
   * Build the final paginated response
   * Can be overridden by subclasses for different response formats
   * @protected
   * @param {Array} items - All collected items
   * @returns {object} - Final response object
   */
  buildPaginatedResponse(items) {
    return {
      value: items,
      '@odata.count': items.length
    };
  }

  /**
   * Determine if the request should be mocked (test mode)
   * Can be overridden by subclasses for service-specific test detection
   * @protected
   * @param {string} accessToken - Access token
   * @returns {boolean}
   */
  shouldMockRequest(accessToken) {
    return accessToken && accessToken.startsWith('test_access_token_');
  }

  /**
   * Mock an API request for testing
   * Must be implemented by subclasses if test mode is used
   * @protected
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {object} data - Request body
   * @param {object} queryParams - Query parameters
   * @returns {Promise<object>} - Mocked response
   */
  async mockRequest(method, path, data, queryParams) {
    throw new Error('mockRequest must be implemented by subclass if test mode is used');
  }
}

module.exports = BaseAPIClient;
