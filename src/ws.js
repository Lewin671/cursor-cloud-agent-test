const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "pomodoro-sync-secret-key";

class SyncManager {
  constructor() {
    this.clients = new Map(); // userId -> Set<ws>
    this.wss = null;
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws) => {
      ws.userId = null;
      ws.isAlive = true;

      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(ws, msg);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        }
      });

      ws.on("close", () => {
        this._removeClient(ws);
      });

      ws.on("error", () => {
        this._removeClient(ws);
      });
    });

    // Heartbeat to detect broken connections
    this._heartbeatInterval = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          this._removeClient(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  _handleMessage(ws, msg) {
    if (msg.type === "auth") {
      try {
        const decoded = jwt.verify(msg.token, JWT_SECRET);
        ws.userId = decoded.userId;

        if (!this.clients.has(ws.userId)) {
          this.clients.set(ws.userId, new Set());
        }
        this.clients.get(ws.userId).add(ws);

        const deviceCount = this.clients.get(ws.userId).size;
        ws.send(JSON.stringify({ type: "sync:connected", deviceCount }));

        // Notify other devices
        this.broadcast(ws.userId, { type: "sync:device_joined", deviceCount }, ws);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
      }
    }
  }

  _removeClient(ws) {
    if (ws.userId && this.clients.has(ws.userId)) {
      const userClients = this.clients.get(ws.userId);
      userClients.delete(ws);

      if (userClients.size === 0) {
        this.clients.delete(ws.userId);
      } else {
        this.broadcast(ws.userId, {
          type: "sync:device_left",
          deviceCount: userClients.size,
        });
      }
    }
  }

  broadcast(userId, data, excludeWs = null) {
    const userClients = this.clients.get(userId);
    if (!userClients) return;

    const message = JSON.stringify(data);
    for (const client of userClients) {
      if (client !== excludeWs && client.readyState === 1) {
        client.send(message);
      }
    }
  }

  broadcastAll(userId, data) {
    const userClients = this.clients.get(userId);
    if (!userClients) return;

    const message = JSON.stringify(data);
    for (const client of userClients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  getDeviceCount(userId) {
    const userClients = this.clients.get(userId);
    return userClients ? userClients.size : 0;
  }

  close() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
  }
}

const syncManager = new SyncManager();

module.exports = { syncManager, JWT_SECRET };
