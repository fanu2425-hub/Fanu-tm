import React, { useState } from 'react';
import { User } from '../types';
import { Shield, KeyRound, Activity, LogOut, Lock, Share2, Check, User as UserIcon } from 'lucide-react';

interface TopNavProps {
  currentUser: User;
  onLogout: () => void;
  onOpenDiagnostics: () => void;
  onOpenKeyManagement: () => void;
  activeView: 'chats' | 'diagnostics' | 'security';
  setActiveView: (view: 'chats' | 'diagnostics' | 'security') => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentUser,
  onLogout,
  onOpenDiagnostics,
  onOpenKeyManagement,
  activeView,
  setActiveView,
}) => {
  const [copiedInvite, setCopiedInvite] = useState(false);

  const handleCopyInviteLink = () => {
    const inviteUrl = `${window.location.origin}?invite=${encodeURIComponent(currentUser.username)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2500);
  };

  return (
    <header className="h-16 px-4 sm:px-6 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
      {/* Zone 1: Brand title, one line */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveView('chats')}
          className="text-lg font-bold tracking-tight text-white flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Shield className="w-4 h-4" />
          </div>
          <span>CipherCall</span>
        </button>

        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-[11px] text-emerald-400 font-mono">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>E2EE Active</span>
        </div>
      </div>

      {/* Zone 2: Navigation links */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
        <button
          onClick={() => setActiveView('chats')}
          className={`transition-colors hover:text-white ${
            activeView === 'chats' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          Chats & Calling
        </button>
        <button
          onClick={onOpenKeyManagement}
          className={`transition-colors hover:text-white flex items-center gap-1.5 ${
            activeView === 'security' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          Key Verification
        </button>
        <button
          onClick={onOpenDiagnostics}
          className={`transition-colors hover:text-white flex items-center gap-1.5 ${
            activeView === 'diagnostics' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Echo & Audio Test
        </button>
      </nav>

      {/* Zone 3: Real User Profile & Invite Actions */}
      <div className="flex items-center gap-2.5">
        {/* Share / Invite Link Button */}
        <button
          onClick={handleCopyInviteLink}
          title="Copy invite link to connect with someone"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/60 transition-colors text-xs font-medium"
        >
          {copiedInvite ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Link Copied!</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Invite Friend / Second User</span>
              <span className="sm:hidden">Invite</span>
            </>
          )}
        </button>

        {/* Current User Chip */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60">
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-full object-cover ring-1 ring-emerald-500/50"
          />
          <div className="hidden sm:block text-left text-xs">
            <span className="font-semibold text-slate-200 block leading-tight truncate max-w-[100px]">
              {currentUser.name}
            </span>
            <span className="text-[10px] text-emerald-400 block leading-none font-mono">
              @{currentUser.username}
            </span>
          </div>
        </div>

        {/* Sign Out */}
        <button
          onClick={onLogout}
          title="Sign Out"
          className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800/80 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
