// Integration test for the LSP server
// Spawns the server, sends initialize request, opens a document, then shuts down

import { spawn } from "child_process";
import path from "path";
import { Logger } from "../logger";

const logger = new Logger("lsp/server.test.ts");

const server = spawn("bun", [path.join(import.meta.dir, "server.ts"), "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let responseReceived = false;

function send(msg: object) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  server.stdin.write(header + json);
}

server.stdout.on("data", (data) => {
  buffer += data.toString();
  // Parse LSP response
  const match = buffer.match(/Content-Length: (\d+)\r\n\r\n/);
  if (match) {
    const len = parseInt(match[1]);
    const start = match[0].length;
    if (buffer.length >= start + len) {
      const json = buffer.slice(start, start + len);
      const msg = JSON.parse(json);
      if (msg.id === 1) {
        // Initialize response
        if (msg.result?.capabilities) {
          logger.info("LSP initialized: OK");
          responseReceived = true;
        } else {
          logger.info("LSP initialized: FAIL - no capabilities");
          process.exit(1);
        }
        // Send initialized notification
        send({ jsonrpc: "2.0", method: "initialized", params: {} });
        // Open a document
        send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: "file:///test.us",
              languageId: "unsound",
              version: 1,
              text: "let x = 1 in x",
            },
          },
        });
        // Give it a moment to process, then exit
        setTimeout(() => {
          send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
          setTimeout(() => {
            send({ jsonrpc: "2.0", method: "exit", params: null });
            process.exit(0);
          }, 100);
        }, 500);
      }
      buffer = buffer.slice(start + len);
    }
  }
});

server.stderr.on("data", (data) => {
  // LSP servers log to stderr, that's fine
});

server.on("error", (err) => {
  logger.error("LSP server error:", err.message);
  process.exit(1);
});

server.on("exit", (code) => {
  if (!responseReceived) {
    logger.error("LSP server exited before responding");
    process.exit(1);
  }
});

// Send initialize request
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    processId: process.pid,
    capabilities: {},
    rootUri: null,
  },
});

// Timeout after 5 seconds
setTimeout(() => {
  if (!responseReceived) {
    logger.error("LSP server timeout");
    server.kill();
    process.exit(1);
  }
}, 5000);
