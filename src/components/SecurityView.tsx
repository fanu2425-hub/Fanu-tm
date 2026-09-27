import React, { useState } from 'react';
import { User } from '../types';
import { ShieldCheck, Key, Lock, Copy, Check, RefreshCw, UserCheck } from 'lucide-react';
import { getOrCreateUserKeys } from '../utils/crypto';

interface SecurityViewProps {
  currentUser: User;
  allUsers: User[];
  verifiedContactIds: string[];
  onToggleVerify: (contactId: string) => void;
  onRefreshKeys: () => void;
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  currentUser,
  allUsers,
  verifiedContactIds,
  onToggleVerify,
  onRefreshKeys,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);

  const jwkString = currentUser.publicKeyJwk
    ? JSON.stringify(currentUser.publicKeyJwk, null, 2)
    : '{\n  "kty": "EC",\n  "crv": "P-256",\n  "x": "...",\n  "y": "..."\n}';

  const handleCopy = () => {
    navigator.clipboard.writeText(jwkString);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          End-to-End Cryptographic Security & Keys
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Your identity is anchored in client-side Elliptic Curve Cryptography (P-256). Private keys never leave your browser sandbox.
        </p>
      </div>

      {/* Identity Key Overview Card */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Your ECDH P-256 Public Identity Key</h3>
              <p className="text-xs text-slate-400">
                Shared with peers to derive symmetric AES-GCM session keys.
              </p>
            </div>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition-colors"
          >
            {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedKey ? 'Copied JWK' : 'Copy Public JWK'}
          </button>
        </div>

        {/* Code block */}
        <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono text-[11px] text-emerald-300 overflow-x-auto">
          {jwkString}
        </pre>
      </div>

      {/* Verified Peer Contacts List */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-400" />
            Verified Peer Contacts
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Contacts whose 30-digit cryptographic safety numbers you have verified.
          </p>
        </div>

        <div className="divide-y divide-slate-800">
          {allUsers
            .filter((u) => u.id !== currentUser.id)
            .map((user) => {
              const isVerified = verifiedContactIds.includes(user.id);
              return (
                <div key={user.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.avatar}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full object-cover border border-slate-700"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{user.name}</div>
                      <div className="text-[11px] font-mono text-slate-500">@{user.username}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => onToggleVerify(user.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isVerified
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/60'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {isVerified ? 'Verified Fingerprint' : 'Mark Verified'}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
