/**
 * Mock Data for Slack API
 *
 * Provides mock responses for test mode.
 */

/**
 * Get mock response for a Slack API method
 * @param {string} method - Slack API method (e.g., 'conversations.list')
 * @param {object} params - Request parameters
 * @returns {object} - Mock Slack API response
 */
function getMockResponse(method, params) {
  switch (method) {
    case 'conversations.list':
      return getMockChannelsList(params);

    case 'conversations.history':
      return getMockChannelHistory(params);

    case 'conversations.replies':
      return getMockThreadReplies(params);

    default:
      return {
        ok: false,
        error: 'method_not_mocked'
      };
  }
}

/**
 * Mock response for conversations.list
 * @param {object} params - Request parameters
 * @returns {object} - Mock response
 */
function getMockChannelsList(params) {
  const mockChannels = [
    {
      id: 'C12345678',
      name: 'general',
      is_channel: true,
      is_group: false,
      is_im: false,
      is_mpim: false,
      is_private: false,
      created: 1614556800,
      is_archived: false,
      is_general: true,
      name_normalized: 'general',
      is_shared: false,
      is_org_shared: false,
      is_member: true,
      is_pending_ext_shared: false,
      pending_shared: [],
      context_team_id: 'T12345678',
      num_members: 10,
      topic: {
        value: 'General discussion',
        creator: 'U12345678',
        last_set: 1614556800
      },
      purpose: {
        value: 'This is the one channel that will always include everyone.',
        creator: 'U12345678',
        last_set: 1614556800
      }
    },
    {
      id: 'C23456789',
      name: 'random',
      is_channel: true,
      is_group: false,
      is_im: false,
      is_mpim: false,
      is_private: false,
      created: 1614556800,
      is_archived: false,
      is_general: false,
      name_normalized: 'random',
      is_shared: false,
      is_org_shared: false,
      is_member: true,
      is_pending_ext_shared: false,
      pending_shared: [],
      context_team_id: 'T12345678',
      num_members: 8,
      topic: {
        value: 'Off-topic conversations',
        creator: 'U12345678',
        last_set: 1614556800
      },
      purpose: {
        value: 'A place for non-work-related flimflam.',
        creator: 'U12345678',
        last_set: 1614556800
      }
    },
    {
      id: 'C34567890',
      name: 'development',
      is_channel: true,
      is_group: false,
      is_im: false,
      is_mpim: false,
      is_private: false,
      created: 1614556800,
      is_archived: false,
      is_general: false,
      name_normalized: 'development',
      is_shared: false,
      is_org_shared: false,
      is_member: true,
      is_pending_ext_shared: false,
      pending_shared: [],
      context_team_id: 'T12345678',
      num_members: 5,
      topic: {
        value: 'Development discussions',
        creator: 'U12345678',
        last_set: 1614556800
      },
      purpose: {
        value: 'Discuss development tasks and code reviews.',
        creator: 'U12345678',
        last_set: 1614556800
      }
    }
  ];

  const limit = params.limit || 20;
  const channels = mockChannels.slice(0, limit);

  return {
    ok: true,
    channels: channels,
    response_metadata: {
      next_cursor: '' // No more pages in mock data
    }
  };
}

/**
 * Mock response for conversations.history
 * @param {object} params - Request parameters
 * @returns {object} - Mock response
 */
function getMockChannelHistory(params) {
  const mockMessages = [
    {
      type: 'message',
      user: 'U12345678',
      text: 'Hello everyone! Welcome to the team.',
      ts: '1614556801.000100',
      thread_ts: '1614556801.000100',
      reply_count: 2,
      reply_users_count: 2,
      latest_reply: '1614556803.000300',
      reply_users: ['U23456789', 'U34567890']
    },
    {
      type: 'message',
      user: 'U23456789',
      text: 'Thanks for having me!',
      ts: '1614556802.000200'
    },
    {
      type: 'message',
      user: 'U34567890',
      text: 'Great to be here! Looking forward to working with everyone.',
      ts: '1614556803.000300'
    },
    {
      type: 'message',
      user: 'U12345678',
      text: 'Just pushed the latest changes to the repo. Please review when you get a chance.',
      ts: '1614556804.000400'
    },
    {
      type: 'message',
      user: 'U23456789',
      text: 'Will do! I should have time this afternoon.',
      ts: '1614556805.000500'
    }
  ];

  const limit = params.limit || 10;
  const messages = mockMessages.slice(0, limit);

  return {
    ok: true,
    messages: messages,
    has_more: false,
    pin_count: 0,
    response_metadata: {
      next_cursor: ''
    }
  };
}

/**
 * Mock response for conversations.replies
 * @param {object} params - Request parameters
 * @returns {object} - Mock response
 */
function getMockThreadReplies(params) {
  const mockReplies = [
    {
      type: 'message',
      user: 'U12345678',
      text: 'Hello everyone! Welcome to the team.',
      ts: '1614556801.000100',
      thread_ts: '1614556801.000100',
      reply_count: 2,
      reply_users_count: 2
    },
    {
      type: 'message',
      user: 'U23456789',
      text: 'Thanks! Excited to be part of the team.',
      ts: '1614556802.000200',
      thread_ts: '1614556801.000100',
      parent_user_id: 'U12345678'
    },
    {
      type: 'message',
      user: 'U34567890',
      text: 'Same here! This is going to be great.',
      ts: '1614556803.000300',
      thread_ts: '1614556801.000100',
      parent_user_id: 'U12345678'
    }
  ];

  return {
    ok: true,
    messages: mockReplies,
    has_more: false,
    response_metadata: {
      next_cursor: ''
    }
  };
}

module.exports = {
  getMockResponse,
  getMockChannelsList,
  getMockChannelHistory,
  getMockThreadReplies
};
