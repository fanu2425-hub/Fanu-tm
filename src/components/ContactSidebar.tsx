import React, { useState } from 'react';
import { User } from '../types';
import { Search, Phone, Video, ShieldCheck, Headphones, UserCheck, Lock } from 'lucide-react';

interface ContactSidebarProps {
  contacts: User[];
  currentUserId: string;
  selectedContact: User | null;
  onSelectContact: (contact: User) => void;
  onStartCall: (contact: User, type: 'audio' | 'video') => void;
  onStartLoopbackTest: () => void;
  unreadMap?: Record<string, number>;
}

export const ContactSidebar: React.FC<ContactSidebarProps> = ({
  contacts,
  currentUserId,
  selectedContact,
  onSelectContact,
  onStartCall,
  onStartLoopbackTest,
  unreadMap = {},
}) => {
  const [search, setSearch] = useState('');
  const [filterOnlineOnly, setFilterOnlineOnly] = useState(false);

  const filtered = contacts
    .filter((c) => c.id !== currentUserId)
    .filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.username.toLowerCase().includes(search.toLowerCase());
      if (filterOnlineOnly) {
        return matchSearch && c.status === 'online';
      }
      return matchSearch;
    });

  return (
    <aside className="w-80 border-r border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0">
      {/* Sidebar Header & Search */}
      <div className="p-4 border-b border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Encrypted Contacts
          </h2>
          <span className="text-[11px] text-emerald-400 font-mono">
            {contacts.filter((c) => c.id !== currentUserId && c.status === 'online').length} online
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search peer or username..."
            className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
          />
        </div>

        {/* Loopback Test Call Button */}
        <button
          onClick={onStartLoopbackTest}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 hover:bg-emerald-900/40 transition-colors text-xs font-medium group"
        >
          <div className="flex items-center gap-2">
            <Headphones className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
            <span>Test Call & Echo Test</span>
          </div>
          <span className="text-[10px] font-mono uppercase bg-emerald-900/60 px-1.5 py-0.5 rounded text-emerald-300">
            Loopback
          </span>
        </button>
      </div>

      {/* Contacts List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No contacts found matching &ldquo;{search}&rdquo;
          </div>
        ) : (
          filtered.map((contact) => {
            const isSelected = selectedContact?.id === contact.id;
            const unread = unreadMap[contact.id] || 0;
            const isOnline = contact.status === 'online';
            const isInCall = contact.status === 'in-call';

            return (
              <div
                key={contact.id}
                onClick={() => onSelectContact(contact)}
                className={`flex items-center justify-between p-3 cursor-pointer transition-colors group ${
                  isSelected
                    ? 'bg-slate-800/90 border-l-2 border-emerald-500'
                    : 'hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={contact.avatar}
                      alt={contact.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-slate-700"
                    />
                    {/* Status Dot */}
                    <span
                      className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-slate-900 ${
                        isInCall
                          ? 'bg-amber-400 animate-pulse'
                          : isOnline
                          ? 'bg-emerald-500'
                          : 'bg-slate-600'
                      }`}
                      title={isInCall ? 'In active call' : isOnline ? 'Online' : 'Offline'}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-200 truncate group-hover:text-emerald-300">
                        {contact.name}
                      </span>
                      {contact.publicKeyJwk && (
                        <span title="E2EE Public Key Verified" className="inline-flex shrink-0">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono">@{contact.username}</span>
                      <span>·</span>
                      <span
                        className={
                          isInCall
                            ? 'text-amber-400'
                            : isOnline
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                        }
                      >
                        {isInCall ? 'In call' : isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Call Action Buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  {unread > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500 text-slate-950 rounded-full mr-1">
                      {unread}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartCall(contact, 'audio');
                    }}
                    title={`Encrypted Voice Call to ${contact.name}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/60 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartCall(contact, 'video');
                    }}
                    title={`Encrypted Video Call to ${contact.name}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/60 transition-colors"
                  >
                    <Video className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-500 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-emerald-500" />
          <span>ECDH P-256 / AES-GCM</span>
        </div>
        <span className="font-mono text-[10px] text-slate-400">Zero Logs</span>
      </div>
    </aside>
  );
};
