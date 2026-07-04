import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, saveConfig } from "./config.js";
import { SyncEngine } from "./sync-engine.js";
import chokidar from "chokidar";
import { join } from "path";
import fs from "fs";
import { io } from "socket.io-client";
import os from "os";

const server = new Server(
  {
    name: "stratanote-sync",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Watcher and Socket States
let chokidarWatcher = null;
let syncTimeout = null;
let socket = null;

// Debounced synchronization function
const debouncedSync = () => {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    console.error('[Watcher] Sync trigger event, initiating synchronization...');
    try {
      const engine = new SyncEngine(loadConfig(), (stage, current, total, message) => {
        if (socket && socket.connected) {
          socket.emit('sync-agent-progress', { stage, current, total, message });
        }
      });
      await engine.runSync(false);
    } catch (err) {
      console.error('[Watcher] Sync error:', err);
    }
  }, 5000);
};

function setupWatcher(config) {
  if (chokidarWatcher) {
    chokidarWatcher.close();
    chokidarWatcher = null;
  }
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }

  if (config.SYNC_MODE !== 'auto' || !config.LOCAL_VAULT_PATH || !fs.existsSync(config.LOCAL_VAULT_PATH)) {
    console.error('[Watcher] Automatic synchronization watcher is disabled or path is invalid.');
    return;
  }

  console.error(`[Watcher] Started file watcher on: ${config.LOCAL_VAULT_PATH}`);

  chokidarWatcher = chokidar.watch(config.LOCAL_VAULT_PATH, {
    ignored: config.EXCLUDE_PATTERNS.map(p => join(config.LOCAL_VAULT_PATH, p)),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  chokidarWatcher.on('all', (event, filePath) => {
    if (filePath.endsWith('.sync_state.json') || filePath.includes('.sync_backup')) {
      return;
    }
    console.error(`[Watcher] Local file event "${event}" on: ${filePath}`);
    debouncedSync();
  });
}

function setupSocketConnection(config) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  if (!config.STRATANOTE_SERVER_URL || !config.STRATANOTE_API_TOKEN) {
    console.error('[Socket] Server URL or API Token is missing. WebSocket client is disabled.');
    return;
  }

  console.error(`[Socket] Connecting to WebSocket: ${config.STRATANOTE_SERVER_URL}...`);
  socket = io(config.STRATANOTE_SERVER_URL, {
    auth: {
      token: config.STRATANOTE_API_TOKEN
    }
  });

  socket.on('connect', () => {
    console.error('[Socket] Successfully connected to StrataNote server WebSocket.');
    
    // Register sync agent with token info
    try {
      const tokenParts = config.STRATANOTE_API_TOKEN.split('.');
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf8'));
      
      socket.emit('register-sync-agent', {
        userId: payload.id,
        username: payload.username,
        deviceName: os.hostname(),
        syncMode: config.SYNC_MODE
      });
    } catch (err) {
      console.error('[Socket] Failed to parse JWT for agent registration:', err);
    }
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
  });

  // Handle remote sync trigger from server admin panel
  socket.on('trigger-sync-request', async (callback) => {
    console.error('[Socket] Received remote sync trigger command from server.');
    console.error('[Socket] Callback type:', typeof callback);
    try {
      const engine = new SyncEngine(loadConfig(), (stage, current, total, message) => {
        if (socket && socket.connected) {
          socket.emit('sync-agent-progress', { stage, current, total, message });
        }
      });
      const result = await engine.runSync(false);
      
      console.error('[Socket] Remote sync finished. Sending response callback...');
      if (typeof callback === 'function') {
        callback({ success: true, logs: result.logs });
        console.error('[Socket] Response callback sent.');
      } else {
        console.error('[Socket] Warning: Callback is not a function! Ack skipped.');
      }
    } catch (err) {
      console.error('[Socket] Remote sync failed:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // If in 'auto' mode, listen to server changes and trigger sync immediately
  if (config.SYNC_MODE === 'auto') {
    const handleServerChange = (data) => {
      console.error(`[Socket] Server event received. Triggering sync...`);
      debouncedSync();
    };
    
    socket.on('file-create', handleServerChange);
    socket.on('file-change', handleServerChange);
    socket.on('file-delete', handleServerChange);
  }
}

// Initial setup
const config = loadConfig();
setupWatcher(config);
setupSocketConnection(config);

// 1. Register available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_sync_status",
        description: "Analyze and list differences between local vault and StrataNote server.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "trigger_sync",
        description: "Execute a bidirectional synchronization now.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_config",
        description: "Retrieve current sync settings.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "update_sync_config",
        description: "Update configuration settings (path, server url, api token, resolution strategy).",
        inputSchema: {
          type: "object",
          properties: {
            STRATANOTE_SERVER_URL: { type: "string", description: "URL of StrataNote server" },
            STRATANOTE_API_TOKEN: { type: "string", description: "JWT authorization token" },
            LOCAL_VAULT_PATH: { type: "string", description: "Absolute path to local markdown folder" },
            SYNC_MODE: { type: "string", enum: ["auto", "manual"], description: "Sync operation mode" },
            CONFLICT_RESOLUTION: { type: "string", enum: ["suggest", "local-wins", "server-wins", "interactive"], description: "Conflict resolution strategy" }
          }
        }
      }
    ]
  };
});

// 2. Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const currentConfig = loadConfig();

  try {
    switch (name) {
      case "get_sync_status": {
        const engine = new SyncEngine(currentConfig);
        const result = await engine.runSync(true); // dryRun = true
        return {
          content: [
            { 
              type: "text", 
              text: `Sync Status Analysis:\n${result.logs.join('\n')}\n\nSummary:\n${JSON.stringify(result.summary, null, 2)}` 
            }
          ]
        };
      }

      case "trigger_sync": {
        const engine = new SyncEngine(currentConfig);
        const result = await engine.runSync(false); // dryRun = false
        return {
          content: [
            { 
              type: "text", 
              text: `Sync Log:\n${result.logs.join('\n')}` 
            }
          ]
        };
      }

      case "get_config": {
        const publicConfig = { ...currentConfig, STRATANOTE_API_TOKEN: currentConfig.STRATANOTE_API_TOKEN ? "***" : "" };
        return {
          content: [{ type: "text", text: JSON.stringify(publicConfig, null, 2) }]
        };
      }

      case "update_sync_config": {
        const updated = saveConfig(args);
        setupWatcher(updated);
        setupSocketConnection(updated);
        return {
          content: [
            { 
              type: "text", 
              text: `Config updated successfully:\n${JSON.stringify({ ...updated, STRATANOTE_API_TOKEN: updated.STRATANOTE_API_TOKEN ? "***" : "" }, null, 2)}` 
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Tool execution failed: ${err.message}\n${err.stack}` }]
    };
  }
});

// Start Stdio Transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("StrataNote MCP Sync Server is running on stdio transport.");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
