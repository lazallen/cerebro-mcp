/**
 * Microsoft Token Storage
 *
 * Handles OAuth token exchange and refresh for Microsoft Graph API
 */

import * as https from 'https';
import * as querystring from 'querystring';
import { BaseTokenStorage } from '../../common/base-token-storage';
import { TokenData } from '../../types/token';
import { APIError } from '../../types/api';
import { ServiceConfig } from '../../types/service';

export class MicrosoftTokenStorage extends BaseTokenStorage {
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
      grant_type: 'authorization_code',
      scope: oauth.scopes?.join(' ') ?? '',
    });

    const tokenData = await this.makeTokenRequest(body);
    await this.saveTokens(tokenData);
    return tokenData;
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenData> {
    const { oauth } = this.config;

    const body = querystring.stringify({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: oauth.scopes?.join(' ') ?? '',
    });

    const tokenData = await this.makeTokenRequest(body);
    await this.saveTokens(tokenData);
    return tokenData;
  }

  /**
   * Make token request to Microsoft token endpoint
   */
  private async makeTokenRequest(body: string): Promise<TokenData> {
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
                access_token?: string;
                refresh_token?: string;
                expires_in?: number;
                token_type?: string;
                scope?: string;
                error?: string;
                error_description?: string;
              };

              if (parsed.error) {
                throw new APIError(
                  `Microsoft token error: ${parsed.error} - ${parsed.error_description ?? 'No description'}`,
                  res.statusCode ?? 400,
                  'microsoft',
                  'token_exchange'
                );
              }

              if (!parsed.access_token) {
                throw new APIError(
                  'No access token in response',
                  res.statusCode ?? 400,
                  'microsoft',
                  'token_exchange'
                );
              }

              resolve({
                accessToken: parsed.access_token,
                refreshToken: parsed.refresh_token,
                expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
                tokenType: parsed.token_type ?? 'Bearer',
                scopes: parsed.scope?.split(' '),
              });
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(
          new APIError(
            `Microsoft token request failed: ${error.message}`,
            0,
            'microsoft',
            'token_exchange'
          )
        );
      });

      req.write(body);
      req.end();
    });
  }
}
