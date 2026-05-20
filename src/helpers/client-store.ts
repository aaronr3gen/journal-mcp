/**
 * Persistent credential store for multiple QuickBooks companies.
 * Stored as clients.json in the project/extension root.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/helpers/ → up 2 levels → project/extension root
export const STORE_PATH = path.join(__dirname, '..', '..', 'clients.json');

export interface ClientEntry {
  displayName: string;
  refreshToken: string;
}

export interface ClientStore {
  active: string;
  clients: Record<string, ClientEntry>;
}

export function readStore(): ClientStore | null {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as ClientStore;
  } catch {
    return null;
  }
}

export function writeStore(store: ClientStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export function upsertClient(
  realmId: string,
  refreshToken: string,
  displayName: string,
  setActive = true
): ClientStore {
  const store: ClientStore = readStore() ?? { active: '', clients: {} };
  store.clients[realmId] = { displayName, refreshToken };
  if (setActive || !store.active) store.active = realmId;
  writeStore(store);
  return store;
}
