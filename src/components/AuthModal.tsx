import React, { useState } from 'react';
import { User } from '../types';
import { Shield, Lock, UserPlus, LogIn, CheckCircle2, User as UserIcon, Sparkles } from 'lucide-react';
import { generateIdentityKeyPair } from '../utils/crypto';
import { apiService } from '../services/apiService';

interface AuthModalProps {
  onLoginSuccess: (user: User, token: string) => void;
  initialUsername?: string;
}

// Modern privacy-themed SVG avatar badges
const AVATAR_OPTIONS = [
  { id: 'emerald', label: 'Emerald Shield', bg: 'from-emerald-600 to-teal-800', border: 'border-emerald-500' },
  { id: 'cyan', label: 'Cyan Cipher', bg: 'from-cyan-600 to-blue-800', border: 'border-cyan-500' },
  { id: 'indigo', label: 'Indigo Stealth', bg: 'from-indigo-600 to-violet-800', border: 'border-indigo-500' },
  { id: 'amber', label: 'Amber Vault', bg: 'from-amber-600 to-orange-800', border: 'border-amber-500' },
  { id: 'rose', label: 'Ruby Node', bg: 'from-rose-600 to-red-800', border: 'border-rose-500' },
  { id: 'slate', label: 'Titanium Lock', bg: 'from-slate-700 to-zinc-900', border: 'border-slate-500' },
];

export const AuthModal: React.FC<AuthModalProps> = ({ onLoginSuccess, initialUsername = '' }) => {
  const [isRegister, setIsRegister] = useState(!initialUsername);
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [selectedAvatarId, setSelectedAvatarId] = useState('emerald');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingKeys, setGeneratingKeys] = useState(false);

  const getAvatarDataUri = (nameStr: string, avatarId: string) => {
    const initials = (nameStr || 'User').trim().slice(0, 2).toUpperCase();
    const avatar = AVATAR_OPTIONS.find((a) => a.id === avatarId) || AVATAR_OPTIONS[0];
    const colors: Record<string, [string, string]> = {
      emerald: ['#059669', '#115e59'],
      cyan: ['#0891b2', '#1e40af'],
      indigo: ['#4f46e5', '#5b21b6'],
      amber: ['#d97706', '#9a3412'],
      rose: ['#e11d48', '#991b1b'],
      slate: ['#475569', '#18181b'],
    };
    const [c1, c2] = colors[avatar.id] || colors.emerald;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}" />
          <stop offset="100%" stop-color="${c2}" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill="url(#grad)" />
      <text x="50" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initials}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
    if (!cleanUsername) {
      setError('Please choose a valid username (letters, numbers, underscore).');
      setLoading(false);
      return;
    }

    try {
      if (isRegister) {
        setGeneratingKeys(true);
        // Generate ECDH P-256 keys on client
        const keys = await generateIdentityKeyPair();
        setGeneratingKeys(false);

        const avatarDataUri = getAvatarDataUri(name, selectedAvatarId);

        const result = await apiService.register({
          username: cleanUsername,
          password,
          name: name.trim() || cleanUsername,
          avatar: avatarDataUri,
          publicKeyJwk: keys.publicKeyJwk,
        });

        // Store keys locally mapped to user id
        localStorage.setItem(
          `ciphercall_keys_${result.user.id}`,
          JSON.stringify({
            publicKeyJwk: keys.publicKeyJwk,
            privateKeyJwk: keys.privateKeyJwk,
          })
        );

        onLoginSuccess(result.user, result.token);
      } else {
        const result = await apiService.login({
          username: cleanUsername,
          password,
        });
        onLoginSuccess(result.user, result.token);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setLoading(false);
      setGeneratingKeys(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                CipherCall
                <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded">
                  E2EE P-256
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Peer-to-Peer Calling & End-to-End Encrypted Chat
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex rounded-lg bg-slate-950 p-1 mt-4 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setIsRegister(false);
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                !isRegister
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegister(true);
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                isRegister
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl text-xs text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Your Display Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. John Doe or Sarah"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                {/* Avatar Badge Selection */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Profile Badge Theme
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {AVATAR_OPTIONS.map((avatar) => {
                      const isSelected = selectedAvatarId === avatar.id;
                      return (
                        <button
                          key={avatar.id}
                          type="button"
                          onClick={() => setSelectedAvatarId(avatar.id)}
                          className={`h-10 rounded-xl bg-gradient-to-br ${avatar.bg} border-2 flex items-center justify-center transition-all ${
                            isSelected
                              ? 'border-white scale-105 shadow-md'
                              : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                          title={avatar.label}
                        >
                          <span className="text-[11px] font-bold text-white uppercase">
                            {(name || 'U').trim().slice(0, 1)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Username
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-slate-500 text-sm font-mono">@</span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g. sarah_k"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Others can call or message you directly using this username.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading || generatingKeys}
              className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-all shadow-lg disabled:opacity-50 ${
                isRegister
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
              }`}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>{generatingKeys ? 'Generating Cryptographic Keys...' : 'Authenticating...'}</span>
                </div>
              ) : isRegister ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create Real Identity & Generate Keys
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign In to CipherCall
                </>
              )}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>256-bit ECDH private keys are generated and saved securely in your browser.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
