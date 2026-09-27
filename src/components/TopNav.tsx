import React from 'react';
import { User } from '../types';
import { Shield, KeyRound, Activity, LogOut, RefreshCw, Lock } from 'lucide-react';

interface TopNavProps {
  currentUser: User;
  onLogout: () => void;
  onOpenDiagnostics: () => void;
  onOpenKeyManagement: () => void;
  activeView: 'chats' | 'diagnostics' | 'security';
  setActiveView: (view: 'chats' | 'diagnostics' | 'security') => void;
  allUsers: User[];
  onSwitchUser: (user: User) => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentUser,
  onLogout,
  onOpenDiagnostics,
  onOpenKeyManagement,
  activeView,
  setActiveView,
  allUsers,
  onSwitchUser,
}) => {
  return (
    <header className="h-16 px-6 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
      {/* Zone 1: Brand title, one line */}
      <div className="flex items-center gap-3">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('chats');
          }}
          className="text-lg font-bold tracking-tight text-white flex items-center gap-2"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Shield className="w-4 h-4" />
          </div>
          CipherCall
        </a>
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
          Diagnostics & Loopback
        </button>
      </nav>

      {/* Zone 3: User Identity & Actions */}
      <div className="flex items-center gap-3">
        {/* User Switcher Dropdown for Testing Multi-User Calling */}
        <div className="relative group">
          <button
            title="Switch Persona for testing multi-user calling"
            className="flex items-center gap-2 p-1.5 pr-2.5 rounded-lg bg-slate-800/70 border border-slate-700 hover:border-slate-600 transition-all text-left"
          >
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full object-cover ring-1 ring-emerald-500/50"
            />
            <div className="hidden sm:block text-xs">
              <span className="font-semibold text-slate-200 block leading-tight truncate max-w-[90px]">
                {currentUser.name}
              </span>
              <span className="text-[10px] text-emerald-400 block leading-none font-mono">
                @{currentUser.username}
              </span>
            </div>
            <RefreshCw className="w-3 h-3 text-slate-400 group-hover:rotate-180 transition-transform duration-300 ml-1" />
          </button>

          {/* Persona quick switch menu */}
          <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50 p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 mb-1">
              Switch Persona (Test Calling)
            </div>
            {allUsers
              .filter((u) => u.id !== currentUser.id)
              .map((u) => (
                <button
                  key={u.id}
                  onClick={() => onSwitchUser(u)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800 text-left transition-colors text-xs text-slate-300 hover:text-white"
                >
                  <img
                    src={u.avatar}
                    alt={u.name}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full object-cover"
                  />
                  <div className="truncate">
                    <div className="font-medium text-slate-200">{u.name}</div>
                    <div className="text-[10px] text-slate-500">@{u.username}</div>
                  </div>
                </button>
              ))}
          </div>
        </div>

        {/* Log Out */}
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
