import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// In-Memory Database for Users and Messages
export interface UserRecord {
  id: string;
  username: string;
  name: string;
  avatar: string;
  status: 'online' | 'in-call' | 'away' | 'offline';
  publicKeyJwk?: any;
  passwordHash: string;
  verifiedContacts?: string[];
  createdAt: number;
}

export interface EncryptedMessageRecord {
  id: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  iv: string;
  isOneTime?: boolean;
  burnAfterSeconds?: number;
  isBurned?: boolean;
  timestamp: number;
  mediaType?: 'text' | 'voice' | 'file';
  fileName?: string;
  fileSize?: number;
}

const users: Map<string, UserRecord> = new Map();
const messages: EncryptedMessageRecord[] = [];

// Seed Initial Demo Accounts
const seedUsers: UserRecord[] = [
  {
    id: 'user_alice',
    username: 'alice',
    name: 'Alice Vance',
    avatar: '/src/assets/images/avatar_alice_1790514166458.jpg',
    status: 'online',
    passwordHash: 'password123',
    verifiedContacts: ['user_bob'],
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'user_bob',
    username: 'bob',
    name: 'Bob Martin',
    avatar: '/src/assets/images/avatar_bob_1790514176036.jpg',
    status: 'online',
    passwordHash: 'password123',
    verifiedContacts: ['user_alice'],
    createdAt: Date.now() - 86400000 * 4,
  },
  {
    id: 'user_charlie',
    username: 'charlie',
    name: 'Charlie Chen',
    avatar: '/src/assets/images/avatar_charlie_1790514186867.jpg',
    status: 'online',
    passwordHash: 'password123',
    verifiedContacts: [],
    createdAt: Date.now() - 86400000 * 3,
  },
];

seedUsers.forEach((u) => users.set(u.id, u));

// Track connected WebSockets by User ID (Supports multiple tabs/devices per user)
const userSockets = new Map<string, Set<WebSocket>>();
const socketToUserId = new Map<WebSocket, string>();

// API Routes
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = Array.from(users.values()).find(
    (u) => (u.username.toLowerCase() === (username || '').toLowerCase() || u.id === username)
  );

  if (!user || user.passwordHash !== password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token: `token_${user.id}_${Date.now()}` });
});

app.post('/api/auth/register', (req, res) => {
  const { username, name, password, avatar, publicKeyJwk } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Missing required credentials' });
  }

  const existing = Array.from(users.values()).find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const newUser: UserRecord = {
    id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    username: username.toLowerCase().trim(),
    name: name.trim(),
    avatar: avatar || '/src/assets/images/avatar_alice_1790514166458.jpg',
    status: 'online',
    passwordHash: password,
    publicKeyJwk: publicKeyJwk || undefined,
    verifiedContacts: [],
    createdAt: Date.now(),
  };

  users.set(newUser.id, newUser);
  const { passwordHash: _, ...safeUser } = newUser;
  broadcastUserDirectory();
  res.status(201).json({ user: safeUser, token: `token_${newUser.id}_${Date.now()}` });
});

app.get('/api/users', (_req, res) => {
  const safeList = Array.from(users.values()).map(({ passwordHash, ...u }) => ({
    ...u,
    status: userSockets.has(u.id) && userSockets.get(u.id)!.size > 0 ? (u.status === 'in-call' ? 'in-call' : 'online') : 'offline',
  }));
  res.json(safeList);
});

app.put('/api/users/:id/key', (req, res) => {
  const { id } = req.params;
  const { publicKeyJwk } = req.body;
  const user = users.get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.publicKeyJwk = publicKeyJwk;
  broadcastUserDirectory();
  res.json({ success: true });
});

app.get('/api/messages/:userId', (req, res) => {
  const { userId } = req.params;
  const peerId = req.query.peerId as string;
  if (!peerId) return res.status(400).json({ error: 'peerId required' });

  // Get active encrypted messages between these two peers (exclude destroyed one-time messages)
  const conversation = messages.filter(
    (m) =>
      !m.isBurned &&
      ((m.senderId === userId && m.recipientId === peerId) ||
        (m.senderId === peerId && m.recipientId === userId))
  );

  res.json(conversation);
});

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function sendToUser(userId: string, payload: any) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    const data = JSON.stringify(payload);
    sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

function broadcastAll(payload: any, excludeWs?: WebSocket) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function broadcastUserDirectory() {
  const safeList = Array.from(users.values()).map(({ passwordHash, ...u }) => ({
    ...u,
    status: userSockets.has(u.id) && userSockets.get(u.id)!.size > 0 ? (u.status === 'in-call' ? 'in-call' : 'online') : 'offline',
  }));
  broadcastAll({ type: 'users:update', users: safeList });
}

wss.on('connection', (ws) => {
  let authenticatedUserId: string | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'auth': {
          authenticatedUserId = msg.userId;
          if (!authenticatedUserId) return;
          if (!userSockets.has(authenticatedUserId)) {
            userSockets.set(authenticatedUserId, new Set());
          }
          userSockets.get(authenticatedUserId)!.add(ws);
          socketToUserId.set(ws, authenticatedUserId);

          // Update user status
          const user = users.get(authenticatedUserId);
          if (user) {
            user.status = 'online';
            if (msg.publicKeyJwk) {
              user.publicKeyJwk = msg.publicKeyJwk;
            }
          }
          broadcastUserDirectory();
          ws.send(JSON.stringify({ type: 'auth:success', userId: authenticatedUserId }));
          break;
        }

        case 'user:status': {
          if (!authenticatedUserId) return;
          const user = users.get(authenticatedUserId);
          if (user && msg.status) {
            user.status = msg.status;
            broadcastUserDirectory();
          }
          break;
        }

        case 'chat:send': {
          // Encrypted message relay
          const record: EncryptedMessageRecord = {
            id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            senderId: msg.senderId,
            recipientId: msg.recipientId,
            ciphertext: msg.ciphertext,
            iv: msg.iv,
            isOneTime: !!msg.isOneTime,
            burnAfterSeconds: msg.burnAfterSeconds || 10,
            isBurned: false,
            timestamp: msg.timestamp || Date.now(),
            mediaType: msg.mediaType || 'text',
            fileName: msg.fileName,
            fileSize: msg.fileSize,
          };

          messages.push(record);

          // Forward to recipient
          sendToUser(msg.recipientId, {
            type: 'chat:received',
            message: record,
          });

          // Echo back confirmation to sender
          ws.send(JSON.stringify({
            type: 'chat:sent',
            message: record,
          }));
          break;
        }

        case 'chat:burn': {
          // One-time message destruction event
          const { messageId } = msg;
          const target = messages.find((m) => m.id === messageId);
          if (target) {
            target.isBurned = true;
            target.ciphertext = '[DESTROYED]'; // Cryptographic purge
          }

          // Notify both sender and recipient to wipe locally
          sendToUser(msg.recipientId, { type: 'chat:burned', messageId });
          sendToUser(msg.senderId, { type: 'chat:burned', messageId });
          break;
        }

        case 'chat:typing': {
          sendToUser(msg.recipientId, {
            type: 'chat:typing',
            senderId: msg.senderId,
            isTyping: msg.isTyping,
          });
          break;
        }

        // WebRTC Signaling Events
        case 'call:invite': {
          // Caller sends SDP Offer or call request to Callee
          sendToUser(msg.calleeId, {
            type: 'call:incoming',
            callId: msg.callId,
            caller: msg.caller,
            callType: msg.callType, // 'audio' | 'video'
            sdp: msg.sdp,
          });
          break;
        }

        case 'call:accept': {
          // Callee accepts with SDP Answer
          const caller = users.get(msg.callerId);
          const callee = users.get(authenticatedUserId || '');
          if (caller) caller.status = 'in-call';
          if (callee) callee.status = 'in-call';
          broadcastUserDirectory();

          sendToUser(msg.callerId, {
            type: 'call:accepted',
            callId: msg.callId,
            calleeId: msg.calleeId,
            sdp: msg.sdp,
          });
          break;
        }

        case 'call:reject': {
          sendToUser(msg.callerId, {
            type: 'call:rejected',
            callId: msg.callId,
            reason: msg.reason || 'declined',
          });
          break;
        }

        case 'call:hangup': {
          const user1 = users.get(msg.targetUserId);
          const user2 = users.get(authenticatedUserId || '');
          if (user1) user1.status = 'online';
          if (user2) user2.status = 'online';
          broadcastUserDirectory();

          sendToUser(msg.targetUserId, {
            type: 'call:ended',
            callId: msg.callId,
          });
          break;
        }

        case 'call:ice-candidate': {
          sendToUser(msg.targetUserId, {
            type: 'call:ice-candidate',
            callId: msg.callId,
            candidate: msg.candidate,
          });
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });

  ws.on('close', () => {
    if (authenticatedUserId) {
      const set = userSockets.get(authenticatedUserId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          userSockets.delete(authenticatedUserId);
          const user = users.get(authenticatedUserId);
          if (user) {
            user.status = 'offline';
            broadcastUserDirectory();
          }
        }
      }
      socketToUserId.delete(ws);
    }
  });
});

// Configure Vite or Static Assets
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`CipherCall Server running on http://localhost:${port}`);
  });
}

startServer();
