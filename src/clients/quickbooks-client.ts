import dotenv from "dotenv";
import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { readStore } from '../helpers/client-store.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client_id     = process.env.QUICKBOOKS_CLIENT_ID;
const client_secret = process.env.QUICKBOOKS_CLIENT_SECRET;
const environment   = process.env.QUICKBOOKS_ENVIRONMENT || 'production';
const redirect_uri  = process.env.QUICKBOOKS_REDIRECT_URI
  || 'https://qbo-oauth-callback-orcin.vercel.app/api/qbo/callback';

if (!client_id || !client_secret) {
  throw Error("QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET must be set");
}

// Resolve initial credentials: clients.json takes priority over env vars
function resolveInitialCredentials(): { refreshToken?: string; realmId?: string } {
  const store = readStore();
  if (store?.active && store.clients[store.active]) {
    return {
      refreshToken: store.clients[store.active].refreshToken,
      realmId:      store.active,
    };
  }
  // Fall back to env vars (single-client / first-time setup)
  return {
    refreshToken: process.env.QUICKBOOKS_REFRESH_TOKEN || undefined,
    realmId:      process.env.QUICKBOOKS_REALM_ID || undefined,
  };
}

class QuickbooksClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private refreshToken?: string;
  private realmId?: string;
  private readonly environment: string;
  private accessToken?: string;
  private accessTokenExpiry?: Date;
  private quickbooksInstance?: QuickBooks;
  private oauthClient: OAuthClient;
  private isAuthenticating: boolean = false;
  private redirectUri: string;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    realmId?: string;
    environment: string;
    redirectUri: string;
  }) {
    this.clientId      = config.clientId;
    this.clientSecret  = config.clientSecret;
    this.refreshToken  = config.refreshToken;
    this.realmId       = config.realmId;
    this.environment   = config.environment;
    this.redirectUri   = config.redirectUri;
    this.oauthClient   = new OAuthClient({
      clientId:     this.clientId,
      clientSecret: this.clientSecret,
      environment:  this.environment,
      redirectUri:  this.redirectUri,
    });
  }

  /** Switch to a different authorised company at runtime. */
  switchClient(realmId: string, refreshToken: string): void {
    this.realmId             = realmId;
    this.refreshToken        = refreshToken;
    this.accessToken         = undefined;
    this.accessTokenExpiry   = undefined;
    this.quickbooksInstance  = undefined;
  }

  /** Return the realm ID of the currently active client. */
  getActiveRealmId(): string | undefined {
    return this.realmId;
  }

  private async startOAuthFlow(): Promise<void> {
    if (this.isAuthenticating) return;
    this.isAuthenticating = true;
    const port = 8000;

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (req.url?.startsWith('/callback')) {
          try {
            const response = await this.oauthClient.createToken(req.url);
            const tokens   = response.token;
            this.refreshToken = tokens.refresh_token;
            this.realmId      = tokens.realmId;
            this.saveTokensToEnv();
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h2 style="font-family:Arial;color:#2E8B57;text-align:center;margin-top:20vh">✓ Connected to QuickBooks</h2>');
            setTimeout(() => { server.close(); this.isAuthenticating = false; resolve(); }, 1000);
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<h2 style="font-family:Arial;color:#d32f2f;text-align:center;margin-top:20vh">Error connecting to QuickBooks</h2>');
            this.isAuthenticating = false;
            reject(error);
          }
        }
      });

      server.listen(port, async () => {
        const authUri = this.oauthClient.authorizeUri({
          scope: [OAuthClient.scopes.Accounting as string],
          state: 'testState',
        }).toString();
        await open(authUri);
      });

      server.on('error', (error) => {
        this.isAuthenticating = false;
        reject(error);
      });
    });
  }

  private saveTokensToEnv(): void {
    const tokenPath = path.join(__dirname, '..', '..', '.env');
    let content = '';
    try { content = fs.readFileSync(tokenPath, 'utf-8'); } catch { /* first run */ }
    const lines = content.split('\n');
    const set = (name: string, value: string) => {
      const i = lines.findIndex(l => l.startsWith(`${name}=`));
      if (i !== -1) lines[i] = `${name}=${value}`; else lines.push(`${name}=${value}`);
    };
    if (this.refreshToken) set('QUICKBOOKS_REFRESH_TOKEN', this.refreshToken);
    if (this.realmId)      set('QUICKBOOKS_REALM_ID',      this.realmId);
    fs.writeFileSync(tokenPath, lines.join('\n'));
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      await this.startOAuthFlow();
      if (!this.refreshToken) throw new Error('Failed to obtain refresh token from OAuth flow');
    }
    try {
      const authResponse      = await this.oauthClient.refreshUsingToken(this.refreshToken);
      this.accessToken        = authResponse.token.access_token;
      const expiresIn         = authResponse.token.expires_in || 3600;
      this.accessTokenExpiry  = new Date(Date.now() + expiresIn * 1000);
      return { access_token: this.accessToken, expires_in: expiresIn };
    } catch (error: any) {
      throw new Error(`Failed to refresh QuickBooks token: ${error.message}`);
    }
  }

  async authenticate() {
    if (!this.refreshToken || !this.realmId) {
      await this.startOAuthFlow();
      if (!this.refreshToken || !this.realmId)
        throw new Error('Failed to obtain required tokens from OAuth flow');
    }
    const now = new Date();
    if (!this.accessToken || !this.accessTokenExpiry || this.accessTokenExpiry <= now) {
      const tokenResponse  = await this.refreshAccessToken();
      this.accessToken     = tokenResponse.access_token;
    }
    this.quickbooksInstance = new QuickBooks(
      this.clientId, this.clientSecret, this.accessToken,
      false, this.realmId!, this.environment === 'sandbox',
      false, null, '2.0', this.refreshToken
    );
    return this.quickbooksInstance;
  }

  getQuickbooks() {
    if (!this.quickbooksInstance)
      throw new Error('QuickBooks not authenticated. Call authenticate() first');
    return this.quickbooksInstance;
  }
}

const { refreshToken, realmId } = resolveInitialCredentials();

export const quickbooksClient = new QuickbooksClient({
  clientId:     client_id,
  clientSecret: client_secret,
  refreshToken,
  realmId,
  environment,
  redirectUri:  redirect_uri,
});
