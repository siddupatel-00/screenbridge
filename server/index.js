import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import QRCode from 'qrcode';
import Bonjour from 'bonjour-service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow port from env or args
const portArg = process.argv.find((a, i) => process.argv[i - 1] === '--port' || a.startsWith('--port='));
const parsedPort = portArg ? parseInt(portArg.replace('--port=', '') || process.argv[process.argv.indexOf(portArg) + 1]) : null;
const PORT = process.env.PORT || parsedPort || 8787;

const app = express();
app.use(cors());
app.use(express.json());

// ---- state ----
const hosts = new Map(); // hostId -> { id, name, ip, port, clients:Set, ws }
const rooms = new Map(); // roomId -> { hostId, clients:Set<ws> }

function getLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip);
  const isLanIface = (name) => /^(en\d+|eth\d+|wlan\d+|wi-fi|ethernet)/i.test(name);

  const best = candidates.find(c => isLanIface(c.name) && isPrivate(c.address))
            || candidates.find(c => isPrivate(c.address))
            || candidates.find(c => isLanIface(c.name))
            || candidates[0];

  return best ? best.address : '127.0.0.1';
}

const LAN_IP = getLanIp();

// ---- REST ----
app.get('/api/info', (req, res) => {
  res.json({ ip: LAN_IP, port: PORT, url: `http://${LAN_IP}:${PORT}`, platform: os.platform() });
});

app.get('/api/hosts', (req, res) => {
  const list = [];
  for (const h of hosts.values()) {
    list.push({ id: h.id, name: h.name, ip: h.ip, port: h.port, clients: h.clients.size });
  }
  res.json({ hosts: list, server: { ip: LAN_IP, port: PORT } });
});

app.get('/api/qr', async (req, res) => {
  const url = req.query.url || `http://${LAN_IP}:${PORT}`;
  try {
    const png = await QRCode.toBuffer(url, { width: 256, margin: 1 });
    res.type('image/png').send(png);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

// serve built web if present
const webDist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
}
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  const indexPath = path.join(webDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath, (err) => { if (err) next(); });
  } else {
    res.status(200).send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:50px;">
          <h2>ScreenBridge Server is Running</h2>
          <p>Web client not compiled yet. Run <code>npm run build</code> in the project directory.</p>
        </body>
      </html>
    `);
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.meta = { id: null, role: null, room: null, hostId: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'register-host': {
        const id = msg.id || ('host_' + Math.random().toString(36).slice(2, 10));
        ws.meta.id = id;
        ws.meta.role = 'host';
        ws.meta.room = id;
        const host = { id, name: msg.name || os.hostname(), ip: LAN_IP, port: PORT, clients: new Set(), ws };
        hosts.set(id, host);
        rooms.set(id, { hostId: id, clients: new Set() });
        send(ws, { type: 'registered', id, url: `http://${LAN_IP}:${PORT}` });
        broadcastHosts();
        break;
      }
      case 'unregister-host': {
        if (ws.meta.role === 'host' && ws.meta.id) {
          const h = hosts.get(ws.meta.id);
          if (h) {
            const room = rooms.get(ws.meta.id);
            if (room) for (const c of room.clients) send(c, { type: 'host-gone' });
            hosts.delete(ws.meta.id);
            rooms.delete(ws.meta.id);
          }
        }
        broadcastHosts();
        break;
      }
      case 'join-host': {
        const hostId = msg.hostId;
        const host = hosts.get(hostId);
        if (!host) { send(ws, { type: 'error', message: 'Host not found or offline' }); return; }
        ws.meta.role = 'client';
        ws.meta.hostId = hostId;
        ws.meta.id = msg.id || ('client_' + Math.random().toString(36).slice(2, 10));
        const room = rooms.get(hostId);
        if (room) room.clients.add(ws);
        host.clients.add(ws);
        send(ws, { type: 'joined', hostId, clientId: ws.meta.id });
        send(host.ws, { type: 'client-joined', clientId: ws.meta.id });
        broadcastHosts();
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice': {
        const targetId = msg.to;
        let target = null;
        for (const c of wss.clients) {
          if (c.meta && c.meta.id === targetId) { target = c; break; }
        }
        if (target) send(target, { ...msg, from: ws.meta.id });
        break;
      }
      case 'input': {
        const host = hosts.get(ws.meta.hostId);
        if (host) send(host.ws, { type: 'input', from: ws.meta.id, payload: msg.payload });
        break;
      }
      case 'list-hosts': {
        send(ws, { type: 'hosts', hosts: [...hosts.values()].map(h => ({ id: h.id, name: h.name, ip: h.ip, port: h.port, clients: h.clients.size })) });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.meta.role === 'host' && ws.meta.id) {
      const h = hosts.get(ws.meta.id);
      if (h) {
        const room = rooms.get(ws.meta.id);
        if (room) for (const c of room.clients) send(c, { type: 'host-gone' });
        hosts.delete(ws.meta.id);
        rooms.delete(ws.meta.id);
      }
    } else if (ws.meta.role === 'client' && ws.meta.hostId) {
      const host = hosts.get(ws.meta.hostId);
      if (host) {
        host.clients.delete(ws);
        const room = rooms.get(ws.meta.hostId);
        if (room) room.clients.delete(ws);
        if (host.ws) send(host.ws, { type: 'client-left', clientId: ws.meta.id });
      }
    }
    broadcastHosts();
  });
});

function broadcastHosts() {
  const list = [...hosts.values()].map(h => ({ id: h.id, name: h.name, ip: h.ip, port: h.port, clients: h.clients.size }));
  const msg = JSON.stringify({ type: 'hosts', hosts: list });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

// mDNS
try {
  const bonjour = new Bonjour();
  bonjour.publish({ name: 'ScreenBridge', type: 'screenbridge', protocol: 'tcp', port: PORT });
  console.log('mDNS advertised _screenbridge._tcp');
} catch (e) {
  // Ignore mDNS if network permissions restrict multicast
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ScreenBridge server running on http://${LAN_IP}:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
});
