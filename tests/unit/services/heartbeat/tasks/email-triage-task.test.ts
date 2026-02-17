/**
 * Unit tests for email-triage-task
 * Tests email processing, LLM integration, and batch processing
 */

import { EmailTriageTask } from '../../../../../src/services/heartbeat/tasks/email-triage-task';
import type { TaskConfig } from '../../../../../src/types/heartbeat';

// Mock dependencies
jest.mock('../../../../../src/services/microsoft/microsoft-service');
jest.mock('../../../../../src/services/localfoundry/localfoundry-client');
jest.mock('../../../../../src/services/heartbeat/event-bus/event-writer');

describe('EmailTriageTask', () => {
  let emailTriageTask: EmailTriageTask;
  let mockGraphClient: any;
  let mockLfClient: any;
  let mockEventWriter: any;

  beforeEach(() => {
    // Mock Graph API client
    mockGraphClient = {
      getUnreadEmails: jest.fn().mockResolvedValue([
        {
          id: 'msg1',
          from: { emailAddress: { address: 'alice@company.com', name: 'Alice' } },
          subject: 'Q2 Planning Meeting',
          receivedDateTime: '2026-02-17T09:15:00Z',
          bodyPreview: 'Let us schedule our Q2 planning session...',
          body: { content: 'Let us schedule our Q2 planning session. Can you share your availability?' },
        },
      ]),
    };

    // Mock LocalFoundry client
    mockLfClient = {
      sendMessage: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action_items: [
                  {
                    description: 'Respond with availability',
                    priority: 'high',
                    category: 'request',
                  },
                ],
                questions: ['Can you share your availability?'],
                requests: ['Schedule Q2 planning session'],
                deadlines: [],
                summary: 'Q2 planning meeting request',
              }),
            },
          },
        ],
      }),
    };

    // Mock event writer
    mockEventWriter = {
      writeEvent: jest.fn().mockResolvedValue('20260217-email-0001.md'),
    };

    emailTriageTask = new EmailTriageTask(mockGraphClient, mockLfClient, mockEventWriter);
  });

  describe('execute', () => {
    it('should process emails and create event files', async () => {
      const taskConfig: TaskConfig = {
        id: 'email-triage-test',
        name: 'Test Email Triage',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {
          maxEmails: 10,
          markAsRead: false,
          eventType: 'email',
        },
      };

      await emailTriageTask.execute(taskConfig);

      expect(mockGraphClient.getUnreadEmails).toHaveBeenCalled();
      expect(mockLfClient.sendMessage).toHaveBeenCalled();
      expect(mockEventWriter.writeEvent).toHaveBeenCalled();
    });

    it('should respect maxEmails limit', async () => {
      // Mock to simulate Microsoft Graph API respecting top parameter
      mockGraphClient.getUnreadEmails.mockImplementation((params?: { top?: number }) => {
        const allEmails = Array.from({ length: 100 }, (_, i) => ({
          id: `msg${i}`,
          from: { emailAddress: { address: 'test@test.com' } },
          subject: `Test ${i}`,
          receivedDateTime: '2026-02-17T09:15:00Z',
          body: { content: 'Test' },
        }));
        const top = params?.top ?? allEmails.length;
        return Promise.resolve(allEmails.slice(0, top));
      });

      const taskConfig: TaskConfig = {
        id: 'email-triage-test',
        name: 'Test',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {
          maxEmails: 10,
        },
      };

      await emailTriageTask.execute(taskConfig);

      // Should only process 10 emails
      expect(mockEventWriter.writeEvent).toHaveBeenCalledTimes(10);
    }, 30000); // Increase timeout to 30 seconds

    it('should process emails in batches for concurrency', async () => {
      const emails = Array.from({ length: 25 }, (_, i) => ({
        id: `msg${i}`,
        from: { emailAddress: { address: 'test@test.com' } },
        subject: `Test ${i}`,
        receivedDateTime: '2026-02-17T09:15:00Z',
        body: { content: 'Test' },
      }));

      mockGraphClient.getUnreadEmails.mockResolvedValue(emails);

      const taskConfig: TaskConfig = {
        id: 'email-triage-test',
        name: 'Test',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {
          maxEmails: 25,
          batchSize: 10,
        },
      };

      await emailTriageTask.execute(taskConfig);

      expect(mockEventWriter.writeEvent).toHaveBeenCalledTimes(25);
    });

    it('should handle LLM failures gracefully', async () => {
      mockLfClient.sendMessage.mockRejectedValue(new Error('LLM timeout'));

      const taskConfig: TaskConfig = {
        id: 'email-triage-test',
        name: 'Test',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {
          maxEmails: 10,
        },
      };

      // Should not throw, should handle error gracefully
      await expect(emailTriageTask.execute(taskConfig)).resolves.not.toThrow();
    });

    it('should handle empty email list', async () => {
      mockGraphClient.getUnreadEmails.mockResolvedValue([]);

      const taskConfig: TaskConfig = {
        id: 'email-triage-test',
        name: 'Test',
        type: 'email-triage',
        schedule: '0 * * * *',
        enabled: true,
        config: {
          maxEmails: 10,
        },
      };

      await emailTriageTask.execute(taskConfig);

      expect(mockEventWriter.writeEvent).not.toHaveBeenCalled();
    });
  });
});
