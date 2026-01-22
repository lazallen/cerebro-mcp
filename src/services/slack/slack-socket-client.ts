/**
 * Slack Socket Mode Client
 *
 * Establishes a WebSocket connection to Slack for receiving interactive events
 * like message shortcuts (message_action payloads).
 *
 * Uses Socket Mode instead of HTTP webhooks, eliminating the need for a
 * publicly accessible endpoint.
 */

import WebSocket from 'ws';
import { logger } from '../../common';
import type { SlackMessageActionPayload } from '../../types/slack-message-action';

/**
 * Socket Mode envelope structure
 */
interface SocketModeEnvelope {
  envelope_id: string;
  type: string;
  accepts_response_payload?: boolean;
  payload?: SlackMessageActionPayload | Record<string, unknown>;
}

/**
 * Hello message received on connection
 */
interface HelloMessage {
  type: 'hello';
  connection_info: {
    app_id: string;
  };
  approximate_connection_time: number;
}

/**
 * Disconnect message received before connection close
 */
interface DisconnectMessage {
  type: 'disconnect';
  reason: string;
  debug_info?: {
    host?: string;
  };
}

/**
 * apps.connections.open API response
 */
interface ConnectionOpenResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Configuration options for Socket Mode client
 */
export interface SlackSocketModeClientOptions {
  /** App Level Token (xapp-...) */
  appToken: string;
  /** Handler for message_action payloads */
  onMessageAction: (payload: SlackMessageActionPayload) => void;
  /** Optional handler for connection events */
  onConnected?: () => void;
  /** Optional handler for disconnection events */
  onDisconnected?: () => void;
}

/**
 * Slack Socket Mode Client
 *
 * Connects to Slack via WebSocket to receive interactive events.
 */
export class SlackSocketModeClient {
  private ws: WebSocket | null = null;
  private readonly appToken: string;
  private readonly onMessageAction: (payload: SlackMessageActionPayload) => void;
  private readonly onConnected?: () => void;
  private readonly onDisconnected?: () => void;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SlackSocketModeClientOptions) {
    this.appToken = options.appToken;
    this.onMessageAction = options.onMessageAction;
    this.onConnected = options.onConnected;
    this.onDisconnected = options.onDisconnected;
  }

  /**
   * Connect to Slack via Socket Mode
   */
  async connect(): Promise<void> {
    if (this.isConnecting) {
      logger.debug({
        operation: 'socket_connect_skip',
        msg: 'Connection already in progress',
      });
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      const url = await this.getWebSocketUrl();

      logger.info({
        operation: 'socket_connecting',
        msg: 'Connecting to Slack Socket Mode...',
      });

      this.ws = new WebSocket(url);
      this.setupEventHandlers();
    } catch (error) {
      this.isConnecting = false;
      logger.error({
        operation: 'socket_connect_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to connect to Slack Socket Mode',
      });
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Disconnect from Slack
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      logger.info({
        operation: 'socket_disconnecting',
        msg: 'Disconnecting from Slack Socket Mode...',
      });

      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get WebSocket URL from apps.connections.open
   */
  private async getWebSocketUrl(): Promise<string> {
    logger.debug({
      operation: 'socket_get_url',
      msg: 'Requesting WebSocket URL from apps.connections.open',
    });

    const response = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ConnectionOpenResponse;

    if (!data.ok || !data.url) {
      throw new Error(`Slack API error: ${data.error ?? 'unknown error'}`);
    }

    logger.debug({
      operation: 'socket_url_received',
      msg: 'WebSocket URL received from Slack',
    });

    return data.url;
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;

      logger.info({
        operation: 'socket_open',
        msg: 'WebSocket connection established',
      });
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(String(data));
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      logger.info({
        operation: 'socket_close',
        code,
        reason: reason.toString(),
        msg: `WebSocket closed: ${code} - ${reason.toString()}`,
      });

      this.ws = null;
      this.isConnecting = false;

      if (this.onDisconnected) {
        this.onDisconnected();
      }

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      logger.error({
        operation: 'socket_error',
        error: error.message,
        msg: `WebSocket error: ${error.message}`,
      });
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    let message: SocketModeEnvelope | HelloMessage | DisconnectMessage;

    try {
      message = JSON.parse(data) as SocketModeEnvelope | HelloMessage | DisconnectMessage;
    } catch (error) {
      logger.warn({
        operation: 'socket_parse_error',
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to parse WebSocket message',
      });
      return;
    }

    // Handle hello message
    if (message.type === 'hello') {
      const helloMsg = message as HelloMessage;
      logger.info({
        operation: 'socket_hello',
        appId: helloMsg.connection_info.app_id,
        connectionTime: helloMsg.approximate_connection_time,
        msg: `Connected to Slack Socket Mode (app: ${helloMsg.connection_info.app_id}, connection lifetime: ${helloMsg.approximate_connection_time}s)`,
      });

      if (this.onConnected) {
        this.onConnected();
      }
      return;
    }

    // Handle disconnect message
    if (message.type === 'disconnect') {
      const disconnectMsg = message as DisconnectMessage;
      logger.info({
        operation: 'socket_disconnect_requested',
        reason: disconnectMsg.reason,
        msg: `Slack requested disconnect: ${disconnectMsg.reason}`,
      });
      return;
    }

    // Handle envelope messages (interactive events)
    const envelope = message as SocketModeEnvelope;

    if (envelope.envelope_id) {
      // Acknowledge immediately
      this.acknowledge(envelope.envelope_id);

      // Process message actions
      if (
        envelope.payload &&
        (envelope.payload as SlackMessageActionPayload).type === 'message_action'
      ) {
        const payload = envelope.payload as SlackMessageActionPayload;

        logger.info({
          operation: 'socket_message_action_received',
          callbackId: payload.callback_id,
          channel: payload.channel?.name,
          user: payload.user?.username,
          msg: `Message action received: ${payload.callback_id} from #${payload.channel?.name ?? 'unknown'}`,
        });

        try {
          this.onMessageAction(payload);
        } catch (error) {
          logger.error({
            operation: 'socket_handler_error',
            error: error instanceof Error ? error.message : String(error),
            msg: 'Error in message action handler',
          });
        }
      } else {
        // Log other event types for debugging
        logger.debug({
          operation: 'socket_event_ignored',
          eventType: envelope.type,
          payloadType: envelope.payload
            ? (envelope.payload as Record<string, unknown>)['type']
            : undefined,
          msg: `Ignoring event type: ${envelope.type}`,
        });
      }
    }
  }

  /**
   * Send acknowledgement for an envelope
   */
  private acknowledge(envelopeId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({
        operation: 'socket_ack_failed',
        envelopeId,
        msg: 'Cannot acknowledge: WebSocket not connected',
      });
      return;
    }

    const ack = JSON.stringify({ envelope_id: envelopeId });
    this.ws.send(ack);

    logger.debug({
      operation: 'socket_ack_sent',
      envelopeId,
      msg: `Acknowledged envelope: ${envelopeId}`,
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error({
        operation: 'socket_reconnect_exhausted',
        attempts: this.reconnectAttempts,
        msg: `Max reconnection attempts (${this.maxReconnectAttempts}) reached`,
      });
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    logger.info({
      operation: 'socket_reconnect_scheduled',
      attempt: this.reconnectAttempts,
      delay,
      msg: `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      void this.connect().catch((error) => {
        logger.error({
          operation: 'socket_reconnect_failed',
          error: error instanceof Error ? error.message : String(error),
          msg: 'Reconnection attempt failed',
        });
      });
    }, delay);
  }
}
