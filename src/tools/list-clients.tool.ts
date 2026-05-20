import { ToolDefinition } from "../types/tool-definition.js";
import { readStore } from "../helpers/client-store.js";
import { z } from "zod";

const toolSchema = z.object({});

const toolHandler = async (_args: { [x: string]: any }) => {
  const store = readStore();

  if (!store || Object.keys(store.clients).length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: "No QuickBooks clients stored yet. Run `node dist/auth.js` to add one.",
      }],
    };
  }

  const lines = Object.entries(store.clients).map(([realmId, entry]) => {
    const active = realmId === store.active ? " ← active" : "";
    return `• ${entry.displayName} (realm: ${realmId})${active}`;
  });

  return {
    content: [{
      type: "text" as const,
      text: `QuickBooks clients (${Object.keys(store.clients).length}):\n\n${lines.join("\n")}`,
    }],
  };
};

export const ListClientsTool: ToolDefinition<typeof toolSchema> = {
  name: "list_clients",
  description: "List all authorised QuickBooks Online companies and show which one is currently active.",
  schema: toolSchema,
  handler: toolHandler,
};
