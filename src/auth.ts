#!/usr/bin/env node
/**
 * Standalone QuickBooks OAuth flow.
 * Run once per company to obtain a refresh token and realm ID.
 *
 * Usage (from the extension folder or project root):
 *   node dist/auth.js
 *
 * Reads:  QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT
 *         QUICKBOOKS_REDIRECT_URI  (optional — defaults to the Vercel callback URL)
 * Writes: QUICKBOOKS_REFRESH_TOKEN and QUICKBOOKS_REALM_ID back into .env
 */

import dotenv from 'dotenv';
import OAuthClient from 'intuit-oauth';
import open from 'open';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  clientId:    client_id,
  clientSecret: client_secret,
  environment,
  redirectUri: redirect_uri,
});

const authUri = oauthClient.authorizeUri({
  scope: [OAuthClient.scopes.Accounting as string],
  state: 'qbo-auth',
}).toString();

console.log('\n──────────────────────────────────────────────────');
console.log('  QuickBooks OAuth — production token setup');
console.log('──────────────────────────────────────────────────');
console.log('\n1. Opening Intuit authorisation page in your browser…');
console.log('   (If the browser does not open, visit the URL below manually)\n');
console.log('   ' + authUri + '\n');

await open(authUri);

console.log('2. Sign in to the QuickBooks company you want to connect.');
console.log('   Approve the Accounting scope when prompted.');
console.log('\n3. After approving, your browser will land on the Vercel callback page.');
console.log('   Copy the FULL URL from your browser address bar and paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const rawUrl: string = await new Promise(resolve => {
  rl.question('   Paste full callback URL: ', resolve);
});
rl.close();

let callbackUrl: URL;
try {
  callbackUrl = new URL(rawUrl.trim());
} catch {
  console.error('\n✗  That does not look like a valid URL. Exiting.');
  process.exit(1);
}

const code    = callbackUrl.searchParams.get('code');
const realmId = callbackUrl.searchParams.get('realmId');
const error   = callbackUrl.searchParams.get('error');

if (error) {
  console.error('\n✗  Intuit returned an error:', error,
    callbackUrl.searchParams.get('error_description') || '');
  process.exit(1);
}

if (!code || !realmId) {
  console.error('\n✗  Could not find "code" and "realmId" in that URL.');
  console.error('   Received:', rawUrl.trim());
  process.exit(1);
}

console.log('\n4. Exchanging authorisation code for tokens…');

let authResponse: any;
try {
  authResponse = await oauthClient.createToken(rawUrl.trim());
} catch (err: any) {
  console.error('\n✗  Token exchange failed:', err.message || err);
  process.exit(1);
}

const refresh_token = authResponse.token.refresh_token as string;

if (!refresh_token) {
  console.error('\n✗  No refresh token returned. Check your app scopes and credentials.');
  process.exit(1);
}

// Write tokens back into .env (one level up from dist/)
const envPath = path.join(__dirname, '..', '.env');
let envContent = '';
try {
  envContent = fs.readFileSync(envPath, 'utf-8');
} catch {
  envContent = '';
}

const setEnvVar = (content: string, key: string, value: string): string => {
  const lines = content.split('\n');
  const idx   = lines.findIndex(l => l.startsWith(`${key}=`));
  if (idx !== -1) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  return lines.join('\n');
};

envContent = setEnvVar(envContent, 'QUICKBOOKS_REFRESH_TOKEN', refresh_token);
envContent = setEnvVar(envContent, 'QUICKBOOKS_REALM_ID', realmId);

fs.writeFileSync(envPath, envContent, 'utf-8');

console.log('\n✓  Tokens saved to .env');
console.log('   realm ID      :', realmId);
console.log('   refresh token : [saved — not printed]');
console.log('\n──────────────────────────────────────────────────');
console.log('  Next: update manifest.json with the values below');
console.log('  then restart Claude Desktop.');
console.log('──────────────────────────────────────────────────');
console.log('\n  QUICKBOOKS_REALM_ID    =', realmId);
console.log('  QUICKBOOKS_REFRESH_TOKEN = [read from .env]\n');
