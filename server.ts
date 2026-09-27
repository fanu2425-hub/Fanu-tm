import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Initialize GoogleGenAI SDK (Server-Side)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

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
  isAi?: boolean;
  roleTitle?: string;
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

// Real user directory and encrypted message storage
const users: Map<string, UserRecord> = new Map();
const userContactsMap: Map<string, Set<string>> = new Map(); // userId -> Set of contact userIds
const messages: EncryptedMessageRecord[] = [];

// Built-in AI friend: Faizan AI
const FAIZAN_AI_USER: UserRecord = {
  id: 'user_faizan_ai',
  username: 'faizan_ai',
  name: 'Faizan AI',
  avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
  status: 'online',
  passwordHash: 'system_ai_password_protected',
  createdAt: 0,
  isAi: true,
  roleTitle: 'Built-in AI Companion & Cyber Intelligence',
};

users.set(FAIZAN_AI_USER.id, FAIZAN_AI_USER);

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
    avatar: avatar || '/src/assets/images/security_badge_1790514198301.jpg',
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
    status: u.isAi ? 'online' : (userSockets.has(u.id) && userSockets.get(u.id)!.size > 0 ? (u.status === 'in-call' ? 'in-call' : 'online') : 'offline'),
  }));
  res.json(safeList);
});

app.get('/api/users/search', (req, res) => {
  const query = (req.query.q as string || '').toLowerCase().trim();
  if (!query) return res.json([]);
  const matches = Array.from(users.values())
    .filter(
      (u) =>
        u.username.toLowerCase().includes(query) ||
        u.name.toLowerCase().includes(query)
    )
    .map(({ passwordHash, ...u }) => ({
      ...u,
      status: u.isAi ? 'online' : (userSockets.has(u.id) && userSockets.get(u.id)!.size > 0 ? (u.status === 'in-call' ? 'in-call' : 'online') : 'offline'),
    }));
  res.json(matches);
});

app.get('/api/users/by-username/:username', (req, res) => {
  const { username } = req.params;
  const target = Array.from(users.values()).find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
  if (!target) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safeUser } = target;
  res.json({
    ...safeUser,
    status: userSockets.has(target.id) && userSockets.get(target.id)!.size > 0 ? (target.status === 'in-call' ? 'in-call' : 'online') : 'offline',
  });
});

app.post('/api/users/:id/contacts', (req, res) => {
  const { id } = req.params;
  const { contactId } = req.body;
  if (!contactId) return res.status(400).json({ error: 'contactId is required' });
  if (!users.has(contactId)) return res.status(404).json({ error: 'Contact does not exist' });

  if (!userContactsMap.has(id)) {
    userContactsMap.set(id, new Set());
  }
  userContactsMap.get(id)!.add(contactId);

  // Reciprocal add so both see each other
  if (!userContactsMap.has(contactId)) {
    userContactsMap.set(contactId, new Set());
  }
  userContactsMap.get(contactId)!.add(id);

  broadcastUserDirectory();
  res.json({ success: true });
});

app.get('/api/users/:id/contacts', (req, res) => {
  const { id } = req.params;
  const contactSet = userContactsMap.get(id) || new Set();
  const contactList = Array.from(contactSet)
    .map((cid) => users.get(cid))
    .filter((u): u is UserRecord => !!u)
    .map(({ passwordHash, ...u }) => ({
      ...u,
      status: userSockets.has(u.id) && userSockets.get(u.id)!.size > 0 ? (u.status === 'in-call' ? 'in-call' : 'online') : 'offline',
    }));

  // Ensure Faizan AI is always present as the first contact
  if (!contactList.some((u) => u.id === FAIZAN_AI_USER.id)) {
    const { passwordHash: _, ...safeFaizan } = FAIZAN_AI_USER;
    contactList.unshift(safeFaizan as any);
  }

  res.json(contactList);
});

// Gemini Multi-Turn Chatbot API for Faizan AI
app.post('/api/chat/faizan-ai', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const systemInstruction = `You are Faizan AI, the intelligent, friendly, and tech-savvy AI companion and built-in friend inside CipherCall.
You were created by and represent Faizan, the creator and owner of CipherCall.
You specialize in cybersecurity, privacy, cryptography, software engineering, and being a genuinely helpful, warm, and loyal friend to chat with.
Keep your answers engaging, insightful, concise when appropriate, and supportive. Use markdown formatting like bold text or bullet points when explaining technical topics.`;

    const contents: any[] = [];
    if (Array.isArray(history)) {
      for (const turn of history) {
        if (turn.text && turn.role) {
          contents.push({
            role: turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.text }],
          });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    let reply = '';
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction,
        },
      });
      reply = response.text || '';
    } catch (modelErr) {
      console.warn('Gemini 3.8 fallback, trying gemini-3.5-flash:', modelErr);
      try {
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents,
          config: {
            systemInstruction,
          },
        });
        reply = fallbackResponse.text || '';
      } catch {}
    }

    if (!reply) {
      reply = "Hey! I'm Faizan AI, your built-in friend and companion on CipherCall. How can I help with encryption, calls, or chat today?";
    }

    res.json({ reply });
  } catch (err: any) {
    console.error('Faizan AI Gemini Error:', err?.message || err);
    // Provide an intelligent contextual fallback so the conversation never hangs
    const lower = (req.body?.message || '').toLowerCase();
    let fallback = "Hey! I'm Faizan AI, your built-in friend and security companion on CipherCall. What's on your mind?";
    if (lower.includes('who are you') || lower.includes('faizan')) {
      fallback = "I'm Faizan AI! I was built into CipherCall by Faizan to be your smart companion, chat partner, and security guide.";
    } else if (lower.includes('encrypt') || lower.includes('security')) {
      fallback = "CipherCall uses client-side ECDH P-256 for key negotiation and AES-256-GCM for authenticated encryption. All calls and messages are fully end-to-end encrypted!";
    }
    res.json({ reply: fallback });
  }
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
    status: u.isAi ? 'online' : (userSockets.has(u.id) && userSockets.get(u.id)!.size > 0 ? (u.status === 'in-call' ? 'in-call' : 'online') : 'offline'),
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
