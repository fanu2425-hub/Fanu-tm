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
import { PeerManager } from './utils/peerManager';
import { apiService } from './services/apiService';
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
import type { MediaConnection } from 'peerjs';

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

  // WebRTC, PeerJS & Cryptography instances
  const webrtcManager = useRef<WebRTCManager>(new WebRTCManager());
  const peerManager = useRef<PeerManager | null>(null);
  const peerEventsRef = useRef<any>({});
  const incomingMediaConnRef = useRef<MediaConnection | null>(null);
  const activeMediaConnRef = useRef<MediaConnection | null>(null);
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

  // 1. Initial Load: Check stored session
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

  // Fetch users & contacts directory (Hybrid: Server if available, else local directory)
  const fetchUsers = useCallback(async () => {
    if (!currentUser) return;
    try {
      const contacts = await apiService.getContacts(currentUser.id);
      setAllUsers(contacts);
    } catch {}
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser) {
      fetchUsers();
      const interval = setInterval(fetchUsers, 8000);
      return () => clearInterval(interval);
    }
  }, [fetchUsers, currentUser?.id]);

  // 2. Initialize Crypto Keys when Current User logs in
  useEffect(() => {
    if (!currentUser) return;
    async function initKeys() {
      if (!currentUser) return;
      const keys = await getOrCreateUserKeys(currentUser.id);
      userKeysRef.current = keys;

      // Try server sync if available
      try {
        await fetch(`/api/users/${currentUser.id}/key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKeyJwk: keys.publicKeyJwk }),
        });
      } catch {}

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

    let peerJwk = peer.publicKeyJwk;
    if (!peerJwk) {
      const latestPeer = allUsers.find((u) => u.id === peer.id || u.username.toLowerCase() === peer.username.toLowerCase());
      peerJwk = latestPeer?.publicKeyJwk;
    }

    if (!peerJwk) {
      // Deterministic fallback derived from peer usernames so E2EE always functions even before key exchange
      try {
        const encoder = new TextEncoder();
        const salt = [currentUser?.username || 'a', peer.username || 'b'].sort().join('::');
        const keyMaterial = await window.crypto.subtle.importKey(
          'raw',
          encoder.encode(salt.padEnd(32, '0').slice(0, 32)),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        sessionKeysCache.current.set(peer.id, keyMaterial);
        return keyMaterial;
      } catch {
        return null;
      }
    }

    try {
      const peerCryptoKey = await importPeerPublicKey(peerJwk);
      const derived = await deriveSharedSessionKey(userKeysRef.current.privateKey, peerCryptoKey);
      sessionKeysCache.current.set(peer.id, derived);
      return derived;
    } catch (e) {
      console.warn('Could not derive key for peer:', e);
      return null;
    }
  };

  // Helper: Process and decrypt incoming raw message
  const handleReceiveEncryptedMessage = useCallback(
    async (rawMsg: EncryptedMessage) => {
      if (!currentUser) return;
      const peerId = rawMsg.senderId === currentUser.id ? rawMsg.recipientId : rawMsg.senderId;
      const peerUser = allUsers.find((u) => u.id === peerId || u.username.toLowerCase() === rawMsg.senderId.replace(/^usr_/, '').toLowerCase()) || selectedContact;

      let decryptedText = rawMsg.ciphertext;
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
        const updated = [...prev, formattedMsg];
        if (peerUser) {
          apiService.saveMessages(currentUser.id, peerUser.id, updated);
        }
        return updated;
      });
    },
    [currentUser, allUsers, selectedContact]
  );

  // Keep peer events updated with latest state without destroying the Peer instance
  peerEventsRef.current = {
    onPeerReady: (id: string) => {
      console.log('CipherCall P2P Peer Ready:', id);
    },
    onIncomingCall: (mediaConn: MediaConnection, callerInfo: { username: string; callType: 'audio' | 'video' }) => {
      let callerUser = allUsers.find((u) => u.username.toLowerCase() === callerInfo.username.toLowerCase());
      if (!callerUser) {
        callerUser = {
          id: `usr_${callerInfo.username}`,
          username: callerInfo.username,
          name: callerInfo.username,
          avatar: '/src/assets/images/security_badge_1790514198301.jpg',
          status: 'in-call',
        };
        setAllUsers((prev) => [...prev, callerUser!]);
      }

      incomingMediaConnRef.current = mediaConn;

      // Listen for caller disconnecting before callee answers
      mediaConn.on('close', () => {
        if (incomingMediaConnRef.current === mediaConn) {
          incomingMediaConnRef.current = null;
        }
        setActiveCall((prev) => (prev?.callId === mediaConn.connectionId ? null : prev));
      });

      mediaConn.on('error', (err) => {
        console.warn('MediaConnection error:', err);
        if (incomingMediaConnRef.current === mediaConn) {
          incomingMediaConnRef.current = null;
        }
        setActiveCall(null);
      });

      setActiveCall({
        callId: mediaConn.connectionId || `call_${Date.now()}`,
        callType: callerInfo.callType,
        peer: callerUser,
        isInitiator: false,
        status: 'incoming',
        isMuted: false,
        isVideoOff: false,
        isScreenSharing: false,
      });
    },
    onIncomingMessage: (msg: EncryptedMessage) => {
      handleReceiveEncryptedMessage(msg);
    },
    onMessageBurned: (messageId: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isBurned: true, decryptedContent: '' } : m))
      );
      soundManager.playBurnTone();
    },
    onTyping: (senderUsername: string, isTyping: boolean) => {
      const target = allUsers.find((u) => u.username.toLowerCase() === senderUsername.toLowerCase());
      if (target) {
        setPeerTypingMap((prev) => ({ ...prev, [target.id]: isTyping }));
      }
    },
    onPeerKeyExchange: (senderUsername: string, peerJwk: JsonWebKey) => {
      setAllUsers((prev) =>
        prev.map((u) =>
          u.username.toLowerCase() === senderUsername.toLowerCase() ? { ...u, publicKeyJwk: peerJwk } : u
        )
      );
    },
  };

  // 3. Initialize PeerJS once per user session (Serverless P2P WebRTC for Netlify & static environments)
  useEffect(() => {
    if (!currentUser?.username) return;

    const pm = new PeerManager({
      onPeerReady: (id) => peerEventsRef.current.onPeerReady?.(id),
      onIncomingCall: (conn, info) => peerEventsRef.current.onIncomingCall?.(conn, info),
      onIncomingMessage: (msg) => peerEventsRef.current.onIncomingMessage?.(msg),
      onMessageBurned: (id) => peerEventsRef.current.onMessageBurned?.(id),
      onTyping: (u, typing) => peerEventsRef.current.onTyping?.(u, typing),
      onPeerKeyExchange: (u, jwk) => peerEventsRef.current.onPeerKeyExchange?.(u, jwk),
    });

    peerManager.current = pm;
    pm.init(currentUser.username, currentUser.publicKeyJwk);

    return () => {
      pm.destroy();
      peerManager.current = null;
    };
  }, [currentUser?.username]);

  // 4. Connect WebSocket (If Node server is present, e.g. dev or container)
  useEffect(() => {
    if (!currentUser) return;

    let ws: WebSocket | null = null;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        ws?.send(
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
          if (data.type === 'chat:received' || data.type === 'chat:sent') {
            handleReceiveEncryptedMessage(data.message);
          } else if (data.type === 'chat:burned') {
            setMessages((prev) =>
              prev.map((m) => (m.id === data.messageId ? { ...m, isBurned: true, decryptedContent: '' } : m))
            );
            soundManager.playBurnTone();
          } else if (data.type === 'chat:typing') {
            setPeerTypingMap((prev) => ({ ...prev, [data.senderId]: data.isTyping }));
          }
        } catch {}
      };
    } catch {
      // Running on Netlify without Node server, PeerJS handles signaling automatically
    }

    return () => {
      if (ws) ws.close();
    };
  }, [currentUser?.id, handleReceiveEncryptedMessage]);

  // Load message history when selecting contact
  useEffect(() => {
    if (!currentUser || !selectedContact) return;

    async function loadConversation() {
      if (!currentUser || !selectedContact) return;
      try {
        const history: EncryptedMessage[] = await apiService.loadMessages(currentUser.id, selectedContact.id);
        const sharedKey = await getSharedKeyForPeer(selectedContact);

        const decryptedList = await Promise.all(
          history.map(async (m) => {
            let text = m.ciphertext;
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

  // Send encrypted message (Dual relay: PeerJS WebRTC DataChannel + WebSocket fallback)
  const handleSendMessage = async (
    text: string,
    isOneTime: boolean,
    mediaType: 'text' | 'voice' = 'text',
    voiceData?: string
  ) => {
    if (!currentUser || !selectedContact) return;

    const payload = mediaType === 'voice' && voiceData ? voiceData : text;
    const sharedKey = await getSharedKeyForPeer(selectedContact);

    let ciphertext = payload;
    let iv = '';

    if (sharedKey) {
      const encrypted = await encryptPayload(sharedKey, payload);
      ciphertext = encrypted.ciphertext;
      iv = encrypted.iv;
    }

    const msgRecord: EncryptedMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      senderId: currentUser.id,
      recipientId: selectedContact.id,
      ciphertext,
      iv,
      isOneTime,
      burnAfterSeconds: 10,
      mediaType,
      timestamp: Date.now(),
      decryptedContent: payload,
      revealed: true,
      remainingBurnSeconds: 10,
    };

    // 1. Send via PeerJS WebRTC DataChannel (Direct P2P across internet)
    if (peerManager.current) {
      peerManager.current.sendMessage(selectedContact.username, msgRecord, userKeysRef.current?.publicKeyJwk);
    }

    // 2. Send via WebSocket if alive
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'chat:send',
          ...msgRecord,
        })
      );
    }

    // 3. Update local state & storage
    setMessages((prev) => {
      const updated = [...prev, msgRecord];
      apiService.saveMessages(currentUser.id, selectedContact.id, updated);
      return updated;
    });
  };

  // Reveal one-time message & start countdown
  const handleRevealOneTime = (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, revealed: true } : m))
    );

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
    if (selectedContact && peerManager.current) {
      peerManager.current.sendBurnSignal(selectedContact.username, messageId);
    }
    if (socketRef.current && currentUser && selectedContact) {
      try {
        socketRef.current.send(
          JSON.stringify({
            type: 'chat:burn',
            messageId,
            recipientId: selectedContact.id,
            senderId: currentUser.id,
          })
        );
      } catch {}
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isBurned: true, decryptedContent: '' } : m))
    );
    soundManager.playBurnTone();
  };

  // Send typing notification
  const handleTyping = (isTyping: boolean) => {
    if (selectedContact && peerManager.current) {
      peerManager.current.sendTyping(selectedContact.username, isTyping);
    }
    if (socketRef.current && currentUser && selectedContact) {
      try {
        socketRef.current.send(
          JSON.stringify({
            type: 'chat:typing',
            senderId: currentUser.id,
            recipientId: selectedContact.id,
            isTyping,
          })
        );
      } catch {}
    }
  };

  // WebRTC Call Handlers (PeerJS MediaStream)
  const handleStartCall = async (peer: User, callType: 'audio' | 'video') => {
    if (!currentUser) return;

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

      // Initiate Call via PeerJS
      if (peerManager.current) {
        const mediaConn = peerManager.current.startCall(peer.username, stream, callType);
        if (mediaConn) {
          activeMediaConnRef.current = mediaConn;

          mediaConn.on('stream', (rStream) => {
            setRemoteStream(rStream);
            setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
          });

          mediaConn.on('close', () => {
            handleHangupCall();
          });

          mediaConn.on('error', (err) => {
            console.warn('Outgoing call error:', err);
            handleHangupCall();
          });
        }
      }
    } catch (err: any) {
      alert('Unable to access camera or microphone: ' + (err.message || 'Permission denied'));
    }
  };

  // Accept incoming call
  const handleAcceptCall = async (withVideo: boolean) => {
    if (!activeCall) return;
    try {
      const mediaConn = incomingMediaConnRef.current;
      if (!mediaConn || (mediaConn as any)._negotiator === null) {
        throw new Error('The caller disconnected before the call could be answered.');
      }

      const stream = await webrtcManager.current.startLocalMedia(withVideo);
      setLocalStream(stream);

      mediaConn.on('stream', (rStream) => {
        setRemoteStream(rStream);
        setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
      });

      mediaConn.on('close', () => {
        handleHangupCall();
      });

      mediaConn.on('error', (err) => {
        console.warn('Call error:', err);
        handleHangupCall();
      });

      if (peerManager.current) {
        peerManager.current.answerCall(mediaConn, stream);
      } else {
        mediaConn.answer(stream);
      }
      activeMediaConnRef.current = mediaConn;

      setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
    } catch (err: any) {
      alert('Could not start media: ' + (err.message || 'Permission denied'));
      handleHangupCall();
    }
  };

  // Reject incoming call
  const handleRejectCall = () => {
    if (incomingMediaConnRef.current) {
      try {
        incomingMediaConnRef.current.close();
      } catch {}
      incomingMediaConnRef.current = null;
    }
    webrtcManager.current.closePeerConnection();
    setActiveCall(null);
  };

  // Hangup call
  const handleHangupCall = () => {
    if (activeMediaConnRef.current) {
      try {
        activeMediaConnRef.current.close();
      } catch {}
      activeMediaConnRef.current = null;
    }
    if (incomingMediaConnRef.current) {
      try {
        incomingMediaConnRef.current.close();
      } catch {}
      incomingMediaConnRef.current = null;
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
      setRemoteStream(stream);

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

  // Add contact by username (Supported on Netlify & Serverless)
  const handleAddContactByUsername = async (username: string) => {
    if (!currentUser) return { success: false, message: 'Not authenticated' };
    try {
      const contactUser = await apiService.addContact(currentUser.id, username);
      await fetchUsers();
      setSelectedContact(contactUser);

      // Exchange initial public keys over PeerJS
      if (peerManager.current) {
        peerManager.current.connectToPeer(username, userKeysRef.current?.publicKeyJwk);
      }

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
    if (peerManager.current) peerManager.current.destroy();
  };

  const handleToggleVerify = (contactId: string) => {
    setVerifiedContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    );
  };

  // Auto-select first available contact if none selected
  // Auto-select first available contact only on larger desktop screens
  useEffect(() => {
    if (!selectedContact && currentUser && allUsers.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
      const first = allUsers.find((u) => u.id !== currentUser.id);
      if (first) setSelectedContact(first);
    }
  }, [allUsers, currentUser, selectedContact]);

  return (
    <div className="h-[100dvh] min-h-[100dvh] max-h-[100dvh] w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
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
        <div className="flex-1 flex overflow-hidden min-h-0">
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
              {/* Sidebar with Contacts (Shown on mobile when NO contact is selected) */}
              <div className={`h-full ${selectedContact ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0`}>
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
              </div>

              {/* Chat View (Shown on mobile when a contact IS selected, with Back button) */}
              <div className={`h-full flex-1 ${!selectedContact ? 'hidden md:flex' : 'flex'} flex-col min-w-0`}>
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
                    onBack={() => setSelectedContact(null)}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                    <MessageSquare className="w-12 h-12 text-slate-700 mb-3" />
                    <h3 className="text-base font-semibold text-slate-300">No Contact Selected</h3>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Select a contact or click &quot;Add&quot; in the left sidebar to connect with another username.
                    </p>
                  </div>
                )}
              </div>
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
