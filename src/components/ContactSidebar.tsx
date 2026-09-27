import React, { useState } from 'react';
import { User } from '../types';
import {
  Search,
  Phone,
  Video,
  ShieldCheck,
  Headphones,
  UserPlus,
  Lock,
  Share2,
  Check,
  X,
  UserCheck,
} from 'lucide-react';

interface ContactSidebarProps {
  contacts: User[];
  currentUserId: string;
  currentUsername: string;
  selectedContact: User | null;
  onSelectContact: (contact: User) => void;
  onStartCall: (contact: User, type: 'audio' | 'video') => void;
  onStartLoopbackTest: () => void;
  onAddContactByUsername: (username: string) => Promise<{ success: boolean; message?: string }>;
  unreadMap?: Record<string, number>;
}

export const ContactSidebar: React.FC<ContactSidebarProps> = ({
  contacts,
  currentUserId,
  currentUsername,
  selectedContact,
  onSelectContact,
  onStartCall,
  onStartLoopbackTest,
  onAddContactByUsername,
  unreadMap = {},
}) => {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUsernameInput, setAddUsernameInput] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addStatus, setAddStatus] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const filtered = contacts
    .filter((c) => c.id !== currentUserId)
    .filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.username.toLowerCase().includes(search.toLowerCase());
      return matchSearch;
    });

  const handleCopyInvite = () => {
    const inviteUrl = `${window.location.origin}?invite=${encodeURIComponent(currentUsername)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2500);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = addUsernameInput.trim().toLowerCase().replace(/^@/, '');
    if (!clean) return;

    if (clean === currentUsername.toLowerCase()) {
      setAddStatus({ type: 'error', text: 'You cannot add yourself as a contact.' });
      return;
    }

    setAddLoading(true);
    setAddStatus(null);
    try {
      const result = await onAddContactByUsername(clean);
      if (result.success) {
        setAddStatus({ type: 'success', text: `@${clean} added to your encrypted contacts!` });
        setAddUsernameInput('');
        setTimeout(() => {
          setShowAddModal(false);
          setAddStatus(null);
        }, 1200);
      } else {
        setAddStatus({ type: 'error', text: result.message || `No user found with username @${clean}` });
      }
    } catch (err: any) {
      setAddStatus({ type: 'error', text: err.message || 'Error adding contact' });
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <aside className="w-80 border-r border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Contacts
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setShowAddModal(true);
                setAddStatus(null);
              }}
              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors text-xs flex items-center gap-1"
              title="Add contact by username"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium pr-0.5">Add</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search peer or @username..."
            className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
          />
        </div>

        {/* Hardware Audio/Video Echo Test Button */}
        <button
          onClick={onStartLoopbackTest}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-800 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors text-xs font-medium group"
        >
          <div className="flex items-center gap-2">
            <Headphones className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
            <span>Mic & Camera Echo Test</span>
          </div>
          <span className="text-[10px] font-mono uppercase bg-slate-900 px-1.5 py-0.5 rounded text-slate-400 border border-slate-800">
            Check
          </span>
        </button>
      </div>

      {/* Add Contact Modal / Inline Sheet */}
      {showAddModal && (
        <div className="p-4 bg-slate-950 border-b border-slate-800 animate-in slide-in-from-top-2 duration-150 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
              Add User by Username
            </span>
            <button
              onClick={() => setShowAddModal(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleAddSubmit} className="space-y-2">
            <div className="relative">
              <span className="absolute left-3 top-2 text-slate-500 text-xs font-mono">@</span>
              <input
                type="text"
                autoFocus
                value={addUsernameInput}
                onChange={(e) => setAddUsernameInput(e.target.value)}
                placeholder="Enter exact username..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
              />
            </div>

            {addStatus && (
              <div
                className={`text-[11px] p-2 rounded-lg ${
                  addStatus.type === 'success'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-red-950 text-red-300 border border-red-800'
                }`}
              >
                {addStatus.text}
              </div>
            )}

            <button
              type="submit"
              disabled={addLoading || !addUsernameInput.trim()}
              className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition-colors disabled:opacity-40"
            >
              {addLoading ? 'Searching directory...' : 'Connect & Add Contact'}
            </button>
          </form>
        </div>
      )}

      {/* Contacts List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
        {filtered.length === 0 ? (
          <div className="p-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-500">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300">
                {search ? `No contact matching "${search}"` : 'No contacts yet'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Connect with another user by username or invite a peer with your link.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  setShowAddModal(true);
                  setAddStatus(null);
                }}
                className="w-full py-1.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors"
              >
                Add by Username
              </button>
              <button
                onClick={handleCopyInvite}
                className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                {copiedInvite ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Invite Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Copy My Invite Link</span>
                  </>
                )}
              </button>
            </div>
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
