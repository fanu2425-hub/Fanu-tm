/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, EncryptedMessage, ActiveCall } from './types';
import {
  getOrCreateUserKeys,
  importPeerPublicKey,
  deriveSharedSessionKey,
  encryptPayload,
  decryptPayload,
} from './utils/crypto';
import { WebRTCManager } from './utils/webrtcManager';
import { soundManager } from './utils/sound';
import { AuthModal } from './components/AuthModal';
import { TopNav } from './components/TopNav';
import { ContactSidebar } from './components/ContactSidebar';
import { ChatPanel } from './components/ChatPanel';
import { CallModal } from './components/CallModal';
import { SafetyNumberModal } from './components/SafetyNumberModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { SecurityView } from './components/SecurityView';
import { Shield, MessageSquare, Headphones } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedContact, setSelectedContact] = useState<User | null>(null);
  const [messages, setMessages] = useState<EncryptedMessage[]>([]);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // Modals & Views
  const [activeView, setActiveView] = useState<'chats' | 'diagnostics' | 'security'>('chats');
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [verifiedContactIds, setVerifiedContactIds] = useState<string[]>([]);
  const [peerTypingMap, setPeerTypingMap] = useState<Record<string, boolean>>({});
  const [pendingInviteUsername, setPendingInviteUsername] = useState<string | null>(null);

  // WebRTC & Cryptography instances
  const webrtcManager = useRef<WebRTCManager>(new WebRTCManager());
  const socketRef = useRef<WebSocket | null>(null);
  const userKeysRef = useRef<{
    publicKeyJwk: JsonWebKey;
    privateKey: CryptoKey;
    publicKey: CryptoKey;
  } | null>(null);

  // Shared derived session keys cache: peerId -> CryptoKey
  const sessionKeysCache = useRef<Map<string, CryptoKey>>(new Map());

  // Burn timers cache: messageId -> intervalId
  const burnTimersRef = useRef<Map<string, number>>(new Map());

  // Check URL parameters for peer invite
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      setPendingInviteUsername(invite.trim().toLowerCase());
    }
  }, []);

  // 1. Initial Load: Check session or auto-select default persona
  useEffect(() => {
    const savedUser = localStorage.getItem('ciphercall_user');
    const savedToken = localStorage.getItem('ciphercall_token');
    if (savedUser && savedToken) {
      try {
        const u = JSON.parse(savedUser);
        setCurrentUser(u);
        setAuthToken(savedToken);
      } catch {}
    }
  }, []);

  // Fetch users directory
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const list: User[] = await res.json();
        setAllUsers(list);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 10000);
    return () => clearInterval(interval);
  }, [fetchUsers]);

  // 2. Initialize Crypto Keys when Current User logs in
  useEffect(() => {
    if (!currentUser) return;
    async function initKeys() {
      if (!currentUser) return;
      const keys = await getOrCreateUserKeys(currentUser.id);
      userKeysRef.current = keys;

      // Ensure server has latest public key
      try {
        await fetch(`/api/users/${currentUser.id}/key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKeyJwk: keys.publicKeyJwk }),
        });
      } catch {}

      // If user object doesn't have public key yet, update locally
      if (!currentUser.publicKeyJwk) {
        const updated = { ...currentUser, publicKeyJwk: keys.publicKeyJwk };
        setCurrentUser(updated);
        localStorage.setItem('ciphercall_user', JSON.stringify(updated));
      }
    }
    initKeys();
  }, [currentUser?.id]);

  // Derive or fetch shared AES-GCM key for a peer
  const getSharedKeyForPeer = async (peer: User): Promise<CryptoKey | null> => {
    if (!userKeysRef.current) return null;
    if (sessionKeysCache.current.has(peer.id)) {
      return sessionKeysCache.current.get(peer.id)!;
    }

    if (!peer.publicKeyJwk) {
      // Find latest peer data from allUsers
      const latestPeer = allUsers.find((u) => u.id === peer.id);
      if (!latestPeer?.publicKeyJwk) return null;
      peer = latestPeer;
    }

    try {
      const peerCryptoKey = await importPeerPublicKey(peer.publicKeyJwk!);
      const derived = await deriveSharedSessionKey(userKeysRef.current.privateKey, peerCryptoKey);
      sessionKeysCache.current.set(peer.id, derived);
      return derived;
    } catch (e) {
      console.warn('Could not derive key for peer:', e);
      return null;
    }
  };

  // 3. Connect WebSocket
  useEffect(() => {
    if (!currentUser) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'auth',
          userId: currentUser.id,
          publicKeyJwk: currentUser.publicKeyJwk || userKeysRef.current?.publicKeyJwk,
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'users:update':
            setAllUsers(data.users);
            break;

          case 'chat:received':
          case 'chat:sent': {
            const rawMsg: EncryptedMessage = data.message;
            const peerId = rawMsg.senderId === currentUser.id ? rawMsg.recipientId : rawMsg.senderId;
            const peerUser = allUsers.find((u) => u.id === peerId) || selectedContact;

            let decryptedText = '[Decryption failed: Key mismatch]';
            if (peerUser) {
              const sharedKey = await getSharedKeyForPeer(peerUser);
              if (sharedKey) {
                try {
                  decryptedText = await decryptPayload(sharedKey, rawMsg.ciphertext, rawMsg.iv);
                } catch {
                  decryptedText = rawMsg.ciphertext;
                }
              }
            }

            const formattedMsg: EncryptedMessage = {
              ...rawMsg,
              decryptedContent: decryptedText,
              revealed: rawMsg.senderId === currentUser.id || !rawMsg.isOneTime,
              remainingBurnSeconds: rawMsg.burnAfterSeconds || 10,
            };

            setMessages((prev) => {
              const exists = prev.some((m) => m.id === formattedMsg.id);
              if (exists) return prev;
              return [...prev, formattedMsg];
            });
            break;
          }

          case 'chat:burned': {
            const { messageId } = data;
            setMessages((prev) =>
              prev.map((m) => (m.id === messageId ? { ...m, isBurned: true, decryptedContent: '' } : m))
            );
            soundManager.playBurnTone();
            break;
          }

          case 'chat:typing': {
            setPeerTypingMap((prev) => ({
              ...prev,
              [data.senderId]: data.isTyping,
            }));
            break;
          }

          // WebRTC Signaling
          case 'call:incoming': {
            // Someone is calling current user
            const callerUser: User = data.caller;
            setActiveCall({
              callId: data.callId,
              callType: data.callType,
              peer: callerUser,
              isInitiator: false,
              status: 'incoming',
              isMuted: false,
              isVideoOff: false,
              isScreenSharing: false,
            });
            // Buffer offer for accept
            (webrtcManager.current as any).pendingOffer = data.sdp;
            break;
          }

          case 'call:accepted': {
            // Callee accepted call
            if (activeCall && activeCall.callId === data.callId) {
              await webrtcManager.current.handleAnswer(data.sdp);
              setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
            }
            break;
          }

          case 'call:rejected':
          case 'call:ended': {
            webrtcManager.current.closePeerConnection();
            setLocalStream(null);
            setRemoteStream(null);
            setActiveCall(null);
            soundManager.playEndedTone();
            break;
          }

          case 'call:ice-candidate': {
            if (data.candidate) {
              await webrtcManager.current.addIceCandidate(data.candidate);
            }
            break;
          }

          default:
            break;
        }
      } catch (e) {
        console.error('WS Error:', e);
      }
    };

    ws.onclose = () => {
      // Reconnect after brief pause
    };

    return () => {
      ws.close();
    };
  }, [currentUser?.id, allUsers.length]);

  // Load message history when selecting contact
  useEffect(() => {
    if (!currentUser || !selectedContact) return;

    async function loadConversation() {
      if (!currentUser || !selectedContact) return;
      try {
        const res = await fetch(`/api/messages/${currentUser.id}?peerId=${selectedContact.id}`);
        if (!res.ok) return;
        const history: EncryptedMessage[] = await res.json();

        const sharedKey = await getSharedKeyForPeer(selectedContact);

        const decryptedList = await Promise.all(
          history.map(async (m) => {
            let text = '[Decryption failed]';
            if (sharedKey) {
              try {
                text = await decryptPayload(sharedKey, m.ciphertext, m.iv);
              } catch {
                text = m.ciphertext;
              }
            }
            return {
              ...m,
              decryptedContent: text,
              revealed: m.senderId === currentUser.id || !m.isOneTime,
              remainingBurnSeconds: m.burnAfterSeconds || 10,
            };
          })
        );

        setMessages(decryptedList);
      } catch {}
    }

    loadConversation();
  }, [selectedContact?.id, currentUser?.id]);

  // Send encrypted message
  const handleSendMessage = async (
    text: string,
    isOneTime: boolean,
    mediaType: 'text' | 'voice' = 'text',
    voiceData?: string
  ) => {
    if (!currentUser || !selectedContact || !socketRef.current) return;

    const payload = mediaType === 'voice' && voiceData ? voiceData : text;
    const sharedKey = await getSharedKeyForPeer(selectedContact);

    let ciphertext = payload;
    let iv = '';

    if (sharedKey) {
      const encrypted = await encryptPayload(sharedKey, payload);
      ciphertext = encrypted.ciphertext;
      iv = encrypted.iv;
    }

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    socketRef.current.send(
      JSON.stringify({
        type: 'chat:send',
        id: msgId,
        senderId: currentUser.id,
        recipientId: selectedContact.id,
        ciphertext,
        iv,
        isOneTime,
        burnAfterSeconds: 10,
        mediaType,
        timestamp: Date.now(),
      })
    );
  };

  // Reveal one-time message & start countdown
  const handleRevealOneTime = (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, revealed: true } : m))
    );

    // Start 10-second burn countdown
    let remaining = 10;
    const timer = window.setInterval(() => {
      remaining -= 1;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, remainingBurnSeconds: remaining } : m
        )
      );

      if (remaining <= 0) {
        clearInterval(timer);
        burnTimersRef.current.delete(messageId);
        handleBurnMessage(messageId);
      }
    }, 1000);

    burnTimersRef.current.set(messageId, timer);
  };

  // Burn one-time message permanently
  const handleBurnMessage = (messageId: string) => {
    if (socketRef.current && currentUser && selectedContact) {
      socketRef.current.send(
        JSON.stringify({
          type: 'chat:burn',
          messageId,
          recipientId: selectedContact.id,
          senderId: currentUser.id,
        })
      );
    }
  };

  // Send typing notification
  const handleTyping = (isTyping: boolean) => {
    if (!socketRef.current || !currentUser || !selectedContact) return;
    socketRef.current.send(
      JSON.stringify({
        type: 'chat:typing',
        senderId: currentUser.id,
        recipientId: selectedContact.id,
        isTyping,
      })
    );
  };

  // WebRTC Call Handlers
  const handleStartCall = async (peer: User, callType: 'audio' | 'video') => {
    if (!currentUser || !socketRef.current) return;

    try {
      const stream = await webrtcManager.current.startLocalMedia(callType === 'video');
      setLocalStream(stream);

      const callId = `call_${Date.now()}`;
      setActiveCall({
        callId,
        callType,
        peer,
        isInitiator: true,
        status: 'calling',
        isMuted: false,
        isVideoOff: false,
        isScreenSharing: false,
      });

      webrtcManager.current.setCallbacks(
        (remStream) => setRemoteStream(remStream),
        (candidate) => {
          socketRef.current?.send(
            JSON.stringify({
              type: 'call:ice-candidate',
              callId,
              targetUserId: peer.id,
              candidate,
            })
          );
        }
      );

      const offer = await webrtcManager.current.createOffer();
      socketRef.current.send(
        JSON.stringify({
          type: 'call:invite',
          callId,
          caller: currentUser,
          calleeId: peer.id,
          callType,
          sdp: offer,
        })
      );
    } catch (err: any) {
      alert('Unable to access camera or microphone: ' + (err.message || 'Permission denied'));
    }
  };

  // Accept incoming call
  const handleAcceptCall = async (withVideo: boolean) => {
    if (!activeCall || !socketRef.current || !currentUser) return;
    try {
      const stream = await webrtcManager.current.startLocalMedia(withVideo);
      setLocalStream(stream);

      webrtcManager.current.setCallbacks(
        (remStream) => setRemoteStream(remStream),
        (candidate) => {
          socketRef.current?.send(
            JSON.stringify({
              type: 'call:ice-candidate',
              callId: activeCall.callId,
              targetUserId: activeCall.peer.id,
              candidate,
            })
          );
        }
      );

      const pendingOffer = (webrtcManager.current as any).pendingOffer;
      const answer = await webrtcManager.current.handleOfferAndCreateAnswer(pendingOffer);

      socketRef.current.send(
        JSON.stringify({
          type: 'call:accept',
          callId: activeCall.callId,
          callerId: activeCall.peer.id,
          calleeId: currentUser.id,
          sdp: answer,
        })
      );

      setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
    } catch (err: any) {
      alert('Could not start media: ' + (err.message || 'Permission denied'));
    }
  };

  // Reject incoming call
  const handleRejectCall = () => {
    if (!activeCall || !socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: 'call:reject',
        callId: activeCall.callId,
        callerId: activeCall.peer.id,
      })
    );
    webrtcManager.current.closePeerConnection();
    setActiveCall(null);
  };

  // Hangup call
  const handleHangupCall = () => {
    if (activeCall && socketRef.current) {
      socketRef.current.send(
        JSON.stringify({
          type: 'call:hangup',
          callId: activeCall.callId,
          targetUserId: activeCall.peer.id,
        })
      );
    }
    webrtcManager.current.closePeerConnection();
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    soundManager.playEndedTone();
  };

  // In-call toggles
  const handleToggleMute = () => {
    const isMuted = webrtcManager.current.toggleMute();
    setActiveCall((prev) => (prev ? { ...prev, isMuted } : null));
  };

  const handleToggleVideo = () => {
    const isVideoOff = webrtcManager.current.toggleVideo();
    setActiveCall((prev) => (prev ? { ...prev, isVideoOff } : null));
  };

  const handleToggleScreenShare = async () => {
    if (!activeCall) return;
    const isSharing = await webrtcManager.current.toggleScreenShare(activeCall.isScreenSharing);
    setActiveCall((prev) => (prev ? { ...prev, isScreenSharing: isSharing } : null));
  };

  // Single-user WebRTC loopback call
  const handleStartLoopbackTest = async () => {
    try {
      const stream = await webrtcManager.current.startLocalMedia(true);
      setLocalStream(stream);
      setRemoteStream(stream); // loopback onto remote display

      const dummyPeer: User = {
        id: 'test_loopback',
        username: 'loopback',
        name: 'Echo Test (Loopback)',
        avatar: currentUser?.avatar || '/src/assets/images/security_badge_1790514198301.jpg',
        status: 'online',
      };

      setActiveCall({
        callId: 'call_loopback',
        callType: 'video',
        peer: dummyPeer,
        isInitiator: true,
        status: 'connected',
        isMuted: false,
        isVideoOff: false,
        isScreenSharing: false,
        isLoopbackTest: true,
      });
    } catch (err: any) {
      alert('Could not start loopback media: ' + (err.message || 'Permission denied'));
    }
  };

  // Add contact by username
  const handleAddContactByUsername = async (username: string) => {
    if (!currentUser) return { success: false, message: 'Not authenticated' };
    try {
      const res = await fetch(`/api/users/by-username/${encodeURIComponent(username)}`);
      if (!res.ok) {
        return { success: false, message: `No user found with username @${username}` };
      }
      const foundUser: User = await res.json();
      if (foundUser.id === currentUser.id) {
        return { success: false, message: 'You cannot add yourself.' };
      }

      await fetch(`/api/users/${currentUser.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: foundUser.id }),
      });

      await fetchUsers();
      setSelectedContact(foundUser);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Lookup failed' };
    }
  };

  // Auto connect if user landed from an invite link
  useEffect(() => {
    if (currentUser && pendingInviteUsername) {
      handleAddContactByUsername(pendingInviteUsername).then((res) => {
        if (res.success) {
          setPendingInviteUsername(null);
        }
      });
    }
  }, [currentUser?.id, pendingInviteUsername]);

  const handleLogout = () => {
    localStorage.removeItem('ciphercall_user');
    localStorage.removeItem('ciphercall_token');
    setCurrentUser(null);
    setAuthToken(null);
    setSelectedContact(null);
    setMessages([]);
    if (socketRef.current) socketRef.current.close();
  };

  const handleToggleVerify = (contactId: string) => {
    setVerifiedContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    );
  };

  // Auto-select first available contact if none selected
  useEffect(() => {
    if (!selectedContact && currentUser && allUsers.length > 0) {
      const first = allUsers.find((u) => u.id !== currentUser.id);
      if (first) setSelectedContact(first);
    }
  }, [allUsers, currentUser, selectedContact]);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 1. Real Auth Modal if not logged in */}
      {!currentUser && (
        <AuthModal
          initialUsername={pendingInviteUsername || ''}
          onLoginSuccess={(user, token) => {
            setCurrentUser(user);
            setAuthToken(token);
            localStorage.setItem('ciphercall_user', JSON.stringify(user));
            localStorage.setItem('ciphercall_token', token);
          }}
        />
      )}

      {/* 2. Top Navigation */}
      {currentUser && (
        <TopNav
          currentUser={currentUser}
          onLogout={handleLogout}
          onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
          onOpenKeyManagement={() => setActiveView('security')}
          activeView={activeView}
          setActiveView={setActiveView}
        />
      )}

      {/* 3. Main Workspace Area */}
      {currentUser && (
        <div className="flex-1 flex overflow-hidden">
          {activeView === 'security' ? (
            <SecurityView
              currentUser={currentUser}
              allUsers={allUsers}
              verifiedContactIds={verifiedContactIds}
              onToggleVerify={handleToggleVerify}
              onRefreshKeys={() => {}}
            />
          ) : (
            <>
              {/* Sidebar with Contacts */}
              <ContactSidebar
                contacts={allUsers}
                currentUserId={currentUser.id}
                currentUsername={currentUser.username}
                selectedContact={selectedContact}
                onSelectContact={(c) => setSelectedContact(c)}
                onStartCall={handleStartCall}
                onStartLoopbackTest={handleStartLoopbackTest}
                onAddContactByUsername={handleAddContactByUsername}
              />

              {/* Chat View */}
              {selectedContact ? (
                <ChatPanel
                  currentUser={currentUser}
                  contact={selectedContact}
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  onBurnMessage={handleBurnMessage}
                  onRevealOneTime={handleRevealOneTime}
                  onStartCall={handleStartCall}
                  onOpenSafetyNumbers={() => setShowSafetyModal(true)}
                  isVerified={verifiedContactIds.includes(selectedContact.id)}
                  isPeerTyping={peerTypingMap[selectedContact.id]}
                  onTyping={handleTyping}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                  <MessageSquare className="w-12 h-12 text-slate-700 mb-3" />
                  <h3 className="text-base font-semibold text-slate-300">No Contact Selected</h3>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Select a peer from the left sidebar to start an end-to-end encrypted audio call, video call, or private one-time chat.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 4. Active Call Screen / Modal */}
      {activeCall && (
        <CallModal
          call={activeCall}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={handleAcceptCall}
          onReject={handleRejectCall}
          onHangup={handleHangupCall}
          onToggleMute={handleToggleMute}
          onToggleVideo={handleToggleVideo}
          onToggleScreenShare={handleToggleScreenShare}
        />
      )}

      {/* 5. Safety Numbers Verification Modal */}
      {showSafetyModal && currentUser && selectedContact && (
        <SafetyNumberModal
          currentUser={currentUser}
          contact={selectedContact}
          onClose={() => setShowSafetyModal(false)}
          isVerified={verifiedContactIds.includes(selectedContact.id)}
          onToggleVerify={handleToggleVerify}
        />
      )}

      {/* 6. Diagnostics & Loopback Modal */}
      {showDiagnosticsModal && (
        <DiagnosticsModal
          onClose={() => setShowDiagnosticsModal(false)}
          onStartLoopback={handleStartLoopbackTest}
        />
      )}
    </div>
  );
}
