import React, { useState } from 'react';
import { User } from '../types';
import { Shield, Key, Lock, ArrowRight, UserPlus, LogIn, CheckCircle2 } from 'lucide-react';

interface AuthModalProps {
  onLoginSuccess: (user: User, token: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onLoginSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const demoAccounts = [
    {
      id: 'user_alice',
      username: 'alice',
      name: 'Alice Vance',
      role: 'Lead Cryptographer',
      avatar: '/src/assets/images/avatar_alice_1790514166458.jpg',
      password: 'password123',
    },
    {
      id: 'user_bob',
      username: 'bob',
      name: 'Bob Martin',
      role: 'Security Engineer',
      avatar: '/src/assets/images/avatar_bob_1790514176036.jpg',
      password: 'password123',
    },
    {
      id: 'user_charlie',
      username: 'charlie',
      name: 'Charlie Chen',
      role: 'Tech Lead',
      avatar: '/src/assets/images/avatar_charlie_1790514186867.jpg',
      password: 'password123',
    },
  ];

  const handleQuickDemoLogin = async (account: typeof demoAccounts[0]) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: account.username, password: account.password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
    const payload = isRegister ? { username, password, name } : { username, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                CipherCall
                <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded">
                  E2EE v2
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                End-to-End Encrypted Calling & Ephemeral Messaging
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Quick Demo Switcher */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 tracking-wide uppercase">
                Instant Sign-In (Demo Personas)
              </span>
              <span className="text-[11px] text-emerald-400 font-mono">P-256 Ready</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {demoAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => handleQuickDemoLogin(account)}
                  disabled={loading}
                  className="flex flex-col items-center text-center p-2.5 rounded-xl border border-slate-800 bg-slate-800/40 hover:bg-slate-800 hover:border-emerald-500/50 transition-all group"
                >
                  <div className="relative mb-1.5">
                    <img
                      src={account.avatar}
                      alt={account.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-slate-700 group-hover:border-emerald-400 transition-colors"
                    />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-slate-900" />
                  </div>
                  <span className="text-xs font-medium text-slate-200 truncate w-full group-hover:text-emerald-400">
                    {account.name.split(' ')[0]}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate w-full">
                    {account.role}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-slate-800 w-full" />
            <span className="bg-slate-900 px-3 text-[11px] text-slate-500 uppercase tracking-wider shrink-0">
              Or Custom Account
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {error && (
              <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-xs text-red-300">
                {error}
              </div>
            )}

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Elena Fisher"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice or elena"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
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
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 text-sm transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : isRegister ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create Secure Identity
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign In & Load Keys
                </>
              )}
            </button>
          </form>

          {/* Toggle Login / Register */}
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
              }}
              className="text-xs text-slate-400 hover:text-emerald-400 transition-colors"
            >
              {isRegister
                ? 'Already have an account? Sign in'
                : "Don't have an identity yet? Create one"}
            </button>
          </div>

          {/* Encryption Guarantee */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-500">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>Client-side Web Cryptography ECDH key pairs stored locally.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
