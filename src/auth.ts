#!/usr/bin/env node
/**
 * Standalone QuickBooks OAuth flow.
 * Run once per company to obtain a refresh token and realm ID.
 * Credentials are stored in clients.json (one entry per company).
 *
 * Usage (from the extension folder or project root):
 *   node dist/auth.js
 */

import dotenv from 'dotenv';
import OAuthClient from 'intuit-oauth';
import open from 'open';
import readline from 'readline';
import { upsertClient, readStore } from './helpers/client-store.js';

dotenv.config();

const client_id     = process.env.QUICKBOOKS_CLIENT_ID;
const client_secret = process.env.QUICKBOOKS_CLIENT_SECRET;
const environment   = process.env.QUICKBOOKS_ENVIRONMENT || 'production';
const redirect_uri  = process.env.QUICKBOOKS_REDIRECT_URI
  || 'https://qbo-oauth-callback-orcin.vercel.app/api/qbo/callback';

if (!client_id || !client_secret) {
  console.error('✗  QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const oauthClient = new OAuthClient({
  clientId:     client_id,
  clientSecret: client_secret,
  environment,
  redirectUri:  redirect_uri,
});

const authUri = oauthClient.authorizeUri({
  scope: [OAuthClient.scopes.Accounting as string],
  state: 'qbo-auth',
}).toString();

console.log('\n──────────────────────────────────────────────────');
console.log('  QuickBooks OAuth — add / refresh a company');
console.log('──────────────────────────────────────────────────');
console.log('\n1. Opening Intuit authorisation page in your browser…');
console.log('   (If the browser does not open, visit the URL below manually)\n');
console.log('   ' + authUri + '\n');

await open(authUri);

console.log('2. Sign in to the QuickBooks company you want to connect.');
console.log('   Approve the Accounting scope when prompted.\n');
console.log('3. After approving, copy the FULL URL from your browser address bar.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (q: string): Promise<string> =>
  new Promise(resolve => rl.question(q, resolve));

const rawUrl  = await ask('   Paste full callback URL: ');

let callbackUrl: URL;
try {
  callbackUrl = new URL(rawUrl.trim());
} catch {
  console.error('\n✗  That does not look like a valid URL. Exiting.');
  rl.close(); process.exit(1);
}

const code    = callbackUrl.searchParams.get('code');
const realmId = callbackUrl.searchParams.get('realmId');
const error   = callbackUrl.searchParams.get('error');

if (error) {
  console.error('\n✗  Intuit returned an error:', error,
    callbackUrl.searchParams.get('error_description') || '');
  rl.close(); process.exit(1);
}

if (!code || !realmId) {
  console.error('\n✗  Could not find "code" and "realmId" in that URL.');
  rl.close(); process.exit(1);
}

console.log('\n4. Exchanging authorisation code for tokens…');

let authResponse: any;
try {
  authResponse = await oauthClient.createToken(rawUrl.trim());
} catch (err: any) {
  console.error('\n✗  Token exchange failed:', err.message || err);
  rl.close(); process.exit(1);
}

const refresh_token = authResponse.token.refresh_token as string;
if (!refresh_token) {
  console.error('\n✗  No refresh token returned. Check your app scopes and credentials.');
  rl.close(); process.exit(1);
}

// Suggest existing display name if this realm is already stored
const existing = readStore()?.clients[realmId];
const nameSuggestion = existing ? ` [${existing.displayName}]` : '';

const displayName = (await ask(
  `\n5. Enter a display name for this company${nameSuggestion}: `
)).trim() || existing?.displayName || realmId;

rl.close();

const store = upsertClient(realmId, refresh_token, displayName, true);

console.log('\n✓  Saved to clients.json');
console.log('   Company       :', displayName);
console.log('   Realm ID      :', realmId);
console.log('   Active client :', store.active);
console.log('\n   Stored companies:');
Object.entries(store.clients).forEach(([id, e]) => {
  const marker = id === store.active ? ' ← active' : '';
  console.log(`   • ${e.displayName} (${id})${marker}`);
});

console.log('\n──────────────────────────────────────────────────');
console.log('  Restart Claude Desktop to load the new active');
console.log('  client, or use switch_client from within Claude.');
console.log('──────────────────────────────────────────────────\n');
