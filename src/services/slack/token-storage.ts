/**
 * Slack Token Storage
 *
 * Manages Slack OAuth tokens. User tokens don't expire.
 */

import * as https from 'https';
import * as querystring from 'querystring';
import { BaseTokenStorage } from '../../common/base-token-storage';
import { TokenData } from '../../types/token';
import { APIError } from '../../types/api';
import { ServiceConfig } from '../../types/service';

export interface SlackTokenData {
  access_token: string;
  team_id: string;
  team_name: string;
  user_id: string;
  user_name?: string;
  scope: string;
}

export class SlackTokenStorage extends BaseTokenStorage {
  private readonly config: ServiceConfig;

  constructor(config: ServiceConfig) {
    super(config.tokenStorePath, config.name);
    this.config = config;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<TokenData> {
    const { oauth } = this.config;

    const body = querystring.stringify({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      code,
      redirect_uri: oauth.redirectUri,
    });

    const slackTokenData = await this.makeTokenRequest(body);
    const tokenData: TokenData = {
      accessToken: slackTokenData.access_token,
      refreshToken: undefined, // Slack user tokens don't expire
      expiresAt: undefined, // No expiration
      tokenType: 'Bearer',
      scopes: slackTokenData.scope.split(','),
    };

    await this.saveTokens(tokenData);
    return tokenData;
  }

  /**
   * Refresh access token - not needed for Slack user tokens
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async refreshAccessToken(_refreshToken: string): Promise<TokenData> {
    throw new Error('Slack user tokens do not expire and cannot be refreshed');
  }

  /**
   * Get valid access token - Slack tokens don't expire
   */
  override async getValidAccessToken(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const tokens = await this.loadTokens();
    if (!tokens) {
      throw new Error('No Slack tokens found. Please authenticate first.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return tokens.accessToken;
  }

  /**
   * Make token request to Slack token endpoint
   */
  private async makeTokenRequest(body: string): Promise<SlackTokenData> {
    const { oauth } = this.config;
    const tokenUrl = oauth.tokenEndpoint;

    return new Promise((resolve, reject) => {
      const req = https.request(
        tokenUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as {
                ok?: boolean;
                access_token?: string;
                authed_user?: {
                  id?: string;
                  access_token?: string;
                  token_type?: string;
                  scope?: string;
                };
                team?: { id?: string; name?: string };
                scope?: string;
                error?: string;
              };

              if (!parsed.ok || parsed.error) {
                throw new APIError(
                  `Slack token error: ${parsed.error ?? 'Unknown error'}`,
                  res.statusCode ?? 400,
                  'slack',
                  'token_exchange'
                );
              }

              // When using user_scope, the access token is in authed_user.access_token
              // When using scope (bot scopes), the access token is at the top level
              const accessToken = parsed.authed_user?.access_token ?? parsed.access_token;
              const scope = parsed.authed_user?.scope ?? parsed.scope ?? '';
              const userId = parsed.authed_user?.id ?? '';

              if (!accessToken) {
                throw new APIError(
                  'No access token in response',
                  res.statusCode ?? 400,
                  'slack',
                  'token_exchange'
                );
              }

              resolve({
                access_token: accessToken,
                team_id: parsed.team?.id ?? '',
                team_name: parsed.team?.name ?? '',
                user_id: userId,
                user_name: undefined,
                scope,
              });
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(
          new APIError(`Slack token request failed: ${error.message}`, 0, 'slack', 'token_exchange')
        );
      });

      req.write(body);
      req.end();
    });
  }
}
