import { User, EncryptedMessage } from '../types';

export interface AuthResult {
  user: User;
  token: string;
}

const LOCAL_USERS_KEY = 'ciphercall_registered_accounts';
const LOCAL_CONTACTS_KEY = 'ciphercall_user_contacts_';
const LOCAL_MESSAGES_KEY = 'ciphercall_local_messages_';

/**
 * Check if a response is JSON, preventing "Unexpected token '<', <!DOCTYPE... is not valid JSON"
 * which happens when hosted on static platforms like Netlify.
 */
async function parseJsonResponse<T>(res: Response): Promise<{ isJson: boolean; data: T | null; text: string }> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (contentType.includes('application/json') || (text.trim().startsWith('{') || text.trim().startsWith('['))) {
    try {
      const data = JSON.parse(text) as T;
      return { isJson: true, data, text };
    } catch {
      return { isJson: false, data: null, text };
    }
  }
  return { isJson: false, data: null, text };
}

function getLocalAccounts(): Record<string, { user: User; passwordHash: string }> {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalAccounts(accounts: Record<string, { user: User; passwordHash: string }>) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(accounts));
}

export const FAIZAN_AI_USER: User = {
  id: 'user_faizan_ai',
  username: 'faizan_ai',
  name: 'Faizan AI',
  avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
  status: 'online',
  isAi: true,
  roleTitle: 'Built-in AI Friend & Cyber Intelligence',
  createdAt: 1700000000000,
};

export const apiService = {
  isStaticDeployment: false,

  async register(payload: {
    username: string;
    password: string;
    name: string;
    avatar: string;
    publicKeyJwk?: JsonWebKey;
  }): Promise<AuthResult> {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const { isJson, data } = await parseJsonResponse<any>(res);
      if (res.ok && isJson && data?.user) {
        return { user: data.user, token: data.token };
      }
      if (isJson && data?.error) {
        throw new Error(data.error);
      }
      // If response is HTML or 404 (e.g. Netlify static hosting), fallback to client-side storage
      console.info('Backend /api not present (Static / Netlify hosting). Using client-side identity.');
      this.isStaticDeployment = true;
    } catch (err: any) {
      if (err.message && err.message !== 'Failed to fetch' && !err.message.includes('JSON')) {
        // Specific error thrown from backend
        if (err.message === 'Username already taken') throw err;
      }
      this.isStaticDeployment = true;
    }

    // --- NETLIFY / SERVERLESS CLIENT-SIDE FALLBACK ---
    const accounts = getLocalAccounts();
    const cleanUsername = payload.username.toLowerCase().trim();

    if (accounts[cleanUsername]) {
      throw new Error('Username already taken. Please choose another or sign in.');
    }

    const newUser: User = {
      id: `usr_${cleanUsername}`,
      username: cleanUsername,
      name: payload.name || cleanUsername,
      avatar: payload.avatar,
      status: 'online',
      publicKeyJwk: payload.publicKeyJwk,
      verifiedContacts: [],
      createdAt: Date.now(),
    };

    accounts[cleanUsername] = {
      user: newUser,
      passwordHash: payload.password,
    };
    saveLocalAccounts(accounts);

    return {
      user: newUser,
      token: `token_static_${newUser.id}`,
    };
  },

  async login(payload: { username: string; password: string }): Promise<AuthResult> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const { isJson, data } = await parseJsonResponse<any>(res);
      if (res.ok && isJson && data?.user) {
        return { user: data.user, token: data.token };
      }
      if (isJson && data?.error) {
        throw new Error(data.error);
      }
      this.isStaticDeployment = true;
    } catch (err: any) {
      if (err.message && err.message !== 'Failed to fetch' && !err.message.includes('JSON')) {
        if (err.message === 'Invalid username or password') throw err;
      }
      this.isStaticDeployment = true;
    }

    // --- NETLIFY / SERVERLESS CLIENT-SIDE FALLBACK ---
    const accounts = getLocalAccounts();
    const cleanUsername = payload.username.toLowerCase().trim();
    const record = accounts[cleanUsername];

    if (!record || record.passwordHash !== payload.password) {
      // If user hasn't registered locally yet, provide clear instruction
      if (!record) {
        throw new Error(`Username @${cleanUsername} is not registered yet. Please click "Create Account" first.`);
      }
      throw new Error('Invalid username or password.');
    }

    return {
      user: record.user,
      token: `token_static_${record.user.id}`,
    };
  },

  async getContacts(userId: string): Promise<User[]> {
    let list: User[] = [];
    try {
      const res = await fetch(`/api/users/${userId}/contacts`);
      const { isJson, data } = await parseJsonResponse<User[]>(res);
      if (res.ok && isJson && Array.isArray(data)) {
        list = data;
      }
    } catch {}

    if (list.length === 0) {
      // Fallback: LocalStorage
      try {
        const raw = localStorage.getItem(`${LOCAL_CONTACTS_KEY}${userId}`);
        list = raw ? JSON.parse(raw) : [];
      } catch {
        list = [];
      }
    }

    // Always include Faizan AI as the primary built-in friend & companion
    const hasFaizan = list.some((u) => u.id === FAIZAN_AI_USER.id || u.username === FAIZAN_AI_USER.username);
    if (!hasFaizan) {
      list = [FAIZAN_AI_USER, ...list];
    } else {
      list = list.map((u) =>
        u.id === FAIZAN_AI_USER.id || u.username === FAIZAN_AI_USER.username
          ? { ...FAIZAN_AI_USER, ...u, isAi: true, status: 'online' }
          : u
      );
    }

    return list;
  },

  async addContact(userId: string, targetUsername: string): Promise<User> {
    const cleanUsername = targetUsername.toLowerCase().trim().replace(/^@/, '');

    // 1. Try server endpoint
    try {
      const res = await fetch(`/api/users/by-username/${encodeURIComponent(cleanUsername)}`);
      const { isJson, data: foundUser } = await parseJsonResponse<User>(res);
      if (res.ok && isJson && foundUser) {
        await fetch(`/api/users/${userId}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: foundUser.id }),
        });
        return foundUser;
      }
    } catch {}

    // 2. Fallback: Search in local registered accounts or create peer stub
    const accounts = getLocalAccounts();
    const existing = accounts[cleanUsername]?.user;

    const contactUser: User = existing || {
      id: `usr_${cleanUsername}`,
      username: cleanUsername,
      name: cleanUsername.charAt(0).toUpperCase() + cleanUsername.slice(1),
      avatar: '/src/assets/images/security_badge_1790514198301.jpg',
      status: 'offline', // will be updated via PeerJS connection
      createdAt: Date.now(),
    };

    // Save to user contacts list
    const currentList = await this.getContacts(userId);
    if (!currentList.some((c) => c.username.toLowerCase() === cleanUsername)) {
      const updated = [...currentList, contactUser];
      localStorage.setItem(`${LOCAL_CONTACTS_KEY}${userId}`, JSON.stringify(updated));
    }

    return contactUser;
  },

  async saveMessages(userId: string, peerId: string, messages: EncryptedMessage[]) {
    try {
      const key = `${LOCAL_MESSAGES_KEY}${userId}_${peerId}`;
      localStorage.setItem(key, JSON.stringify(messages));
    } catch {}
  },

  async loadMessages(userId: string, peerId: string): Promise<EncryptedMessage[]> {
    // Try backend first
    try {
      const res = await fetch(`/api/messages/${userId}?peerId=${peerId}`);
      const { isJson, data } = await parseJsonResponse<EncryptedMessage[]>(res);
      if (res.ok && isJson && Array.isArray(data)) {
        return data;
      }
    } catch {}

    // Fallback: LocalStorage
    try {
      const key = `${LOCAL_MESSAGES_KEY}${userId}_${peerId}`;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async chatWithFaizanAi(
    message: string,
    history: { role: 'user' | 'model'; text: string }[] = []
  ): Promise<string> {
    // 1. Try server-side Gemini API route first
    try {
      const res = await fetch('/api/chat/faizan-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const { isJson, data } = await parseJsonResponse<any>(res);
      if (res.ok && isJson && data?.reply) {
        return data.reply;
      }
      if (isJson && data?.fallback) {
        return data.fallback;
      }
    } catch {}

    // 2. Intelligent client-side fallback if running purely on static host without backend
    const lower = message.toLowerCase().trim();
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      return "Hey there! I'm Faizan AI, your built-in friend and security companion on CipherCall. How's everything going today?";
    } else if (lower.includes('who are you') || lower.includes('faizan') || lower.includes('creator')) {
      return "I'm Faizan AI! I was created to represent Faizan, the creator and owner of CipherCall. I'm here to chat, keep you company, answer cybersecurity and privacy questions, and help test encrypted calls!";
    } else if (lower.includes('how does encryption work') || lower.includes('e2ee') || lower.includes('security')) {
      return "CipherCall secures every conversation using ECDH (Elliptic Curve Diffie-Hellman) P-256 for key agreement and AES-256-GCM for authenticated symmetric encryption. Your private keys never leave your browser!";
    } else if (lower.includes('call') || lower.includes('video') || lower.includes('voice')) {
      return "You can start an encrypted Voice or Video call with any contact using the buttons at the top of the chat, or tap 'Hardware Test' to run an echo test!";
    } else {
      return `I hear you! As your built-in companion Faizan AI, I'm always online whenever you need advice, want to test encrypted messaging, or just hang out. What else would you like to explore?`;
    }
  },
};
