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
    try {
      const res = await fetch(`/api/users/${userId}/contacts`);
      const { isJson, data } = await parseJsonResponse<User[]>(res);
      if (res.ok && isJson && Array.isArray(data)) {
        return data;
      }
    } catch {}

    // Fallback: LocalStorage
    try {
      const raw = localStorage.getItem(`${LOCAL_CONTACTS_KEY}${userId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
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
};
