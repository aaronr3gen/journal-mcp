import { ToolDefinition } from "../types/tool-definition.js";
import { readStore, writeStore } from "../helpers/client-store.js";
import { quickbooksClient } from "../clients/quickbooks-client.js";
import { z } from "zod";

const toolSchema = z.object({
  realmId: z.string().describe("The realm ID of the QuickBooks company to switch to."),
});

const toolHandler = async (args: { [x: string]: any }) => {
  const realmId: string = args.params.realmId;
  const store = readStore();

  if (!store) {
    return {
      content: [{
        type: "text" as const,
        text: "No clients.json found. Run `node dist/auth.js` to authorise a company first.",
      }],
    };
  }

  const entry = store.clients[realmId];
  if (!entry) {
    const available = Object.entries(store.clients)
      .map(([id, e]) => `${e.displayName} (${id})`)
      .join(", ");
    return {
      content: [{
        type: "text" as const,
        text: `Realm ID "${realmId}" not found. Available: ${available}`,
      }],
    };
  }

  // Switch in-memory client
  quickbooksClient.switchClient(realmId, entry.refreshToken);

  // Persist active selection
  store.active = realmId;
  writeStore(store);

  return {
    content: [{
      type: "text" as const,
      text: `Switched to: ${entry.displayName} (realm: ${realmId})`,
    }],
  };
};

export const SwitchClientTool: ToolDefinition<typeof toolSchema> = {
  name: "switch_client",
  description: "Switch the active QuickBooks Online company. Use list_clients to see available realm IDs.",
  schema: toolSchema,
  handler: toolHandler,
};
