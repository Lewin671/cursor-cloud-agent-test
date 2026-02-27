const http = require("node:http");
const { app } = require("./app");
const { syncManager } = require("./ws");
const { getDb } = require("./db");

const PORT = process.env.PORT || 3000;

// Initialize database on startup
getDb();

const server = http.createServer(app);

// Attach WebSocket server
syncManager.attach(server);

server.listen(PORT, () => {
  console.log(`Pomodoro Sync server running on http://localhost:${PORT}`);
});
