/**
 * Universal Serverless Peer-to-Peer Manager for Netlify & Static Deployments
 * Utilizes PeerJS over WebRTC (DataChannel for E2EE chat + MediaStream for Calling)
 * Connects directly between browsers worldwide using standard STUN/TURN servers.
 */

import { Peer, DataConnection, MediaConnection } from 'peerjs';
import { User, EncryptedMessage } from '../types';

export interface PeerManagerEvents {
  onPeerReady?: (peerId: string) => void;
  onIncomingCall?: (call: MediaConnection, callerInfo: { username: string; callType: 'audio' | 'video' }) => void;
  onIncomingMessage?: (msg: EncryptedMessage) => void;
  onMessageBurned?: (messageId: string) => void;
  onTyping?: (senderUsername: string, isTyping: boolean) => void;
  onPeerKeyExchange?: (senderUsername: string, publicKeyJwk: JsonWebKey) => void;
  onPeerStatusChange?: (username: string, status: 'online' | 'offline') => void;
}

export class PeerManager {
  private peer: Peer | null = null;
  private activeDataConnections: Map<string, DataConnection> = new Map();
  private activeMediaCall: MediaConnection | null = null;
  private events: PeerManagerEvents = {};
  public currentUsername: string = '';
  public myPeerId: string = '';
  private myPublicKeyJwk?: JsonWebKey;
  private isDestroyed = false;

  constructor(events: PeerManagerEvents) {
    this.events = events;
  }

  public updateEvents(events: PeerManagerEvents) {
    this.events = events;
  }

  public static getPeerIdForUsername(username: string): string {
    const clean = username.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    return `ciphercall_usr_${clean}`;
  }

  public init(username: string, publicKeyJwk?: JsonWebKey): Promise<string> {
    this.isDestroyed = false;
    this.currentUsername = username.toLowerCase().trim();
    this.myPublicKeyJwk = publicKeyJwk;
    this.myPeerId = PeerManager.getPeerIdForUsername(this.currentUsername);

    return new Promise((resolve) => {
      this.createPeerInstance(this.myPeerId, resolve);
    });
  }

  private createPeerInstance(peerIdToUse: string, onReady?: (id: string) => void) {
    if (this.isDestroyed) return;

    // Clean up existing peer if any
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch {}
    }

    const peer = new Peer(peerIdToUse, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    });

    this.peer = peer;

    peer.on('open', (id) => {
      this.myPeerId = id;
      if (onReady) onReady(id);
      if (this.events.onPeerReady) this.events.onPeerReady(id);
    });

    peer.on('disconnected', () => {
      // Reconnect if temporarily disconnected from signaling server
      if (!this.isDestroyed && peer && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch {}
      }
    });

    peer.on('error', (err: any) => {
      console.warn('PeerJS connection status:', err?.type || err?.message || err);
      if (err?.type === 'unavailable-id') {
        // Current username already in use by another tab or session; attach random suffix to allow testing across tabs
        const altId = `${this.myPeerId}_${Math.random().toString(36).substring(2, 6)}`;
        this.createPeerInstance(altId, onReady);
      }
    });

    // Handle incoming Data Connection (E2EE Chat, Typing & Key Exchange)
    peer.on('connection', (conn) => {
      this.setupDataConnection(conn);
    });

    // Handle incoming Media Call (Audio & Video)
    peer.on('call', (mediaConn) => {
      const metadata = mediaConn.metadata || {};
      const callerUsername = metadata.callerUsername || 'Peer';
      const callType: 'audio' | 'video' = metadata.callType || 'audio';

      if (this.events.onIncomingCall) {
        this.events.onIncomingCall(mediaConn, {
          username: callerUsername,
          callType,
        });
      }
    });
  }

  private setupDataConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.activeDataConnections.set(conn.peer, conn);

      // Automatically send public ECDH key for secure derivation
      if (this.myPublicKeyJwk) {
        try {
          conn.send({
            type: 'key:exchange',
            senderUsername: this.currentUsername,
            publicKeyJwk: this.myPublicKeyJwk,
          });
        } catch {}
      }
    });

    conn.on('data', (data: any) => {
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'chat:send':
          if (this.events.onIncomingMessage && data.message) {
            this.events.onIncomingMessage(data.message);
          }
          break;

        case 'chat:burn':
          if (this.events.onMessageBurned && data.messageId) {
            this.events.onMessageBurned(data.messageId);
          }
          break;

        case 'chat:typing':
          if (this.events.onTyping) {
            this.events.onTyping(data.senderUsername || '', !!data.isTyping);
          }
          break;

        case 'key:exchange':
          if (this.events.onPeerKeyExchange && data.publicKeyJwk) {
            this.events.onPeerKeyExchange(data.senderUsername || '', data.publicKeyJwk);
          }
          break;

        default:
          break;
      }
    });

    conn.on('close', () => {
      this.activeDataConnections.delete(conn.peer);
    });

    conn.on('error', () => {
      this.activeDataConnections.delete(conn.peer);
    });
  }

  /**
   * Connect or get existing DataConnection with peer
   */
  public async connectToPeer(targetUsername: string, myPublicKeyJwk?: JsonWebKey): Promise<DataConnection | null> {
    if (this.myPublicKeyJwk === undefined && myPublicKeyJwk) {
      this.myPublicKeyJwk = myPublicKeyJwk;
    }
    if (!this.peer || this.peer.destroyed) return null;

    const targetPeerId = PeerManager.getPeerIdForUsername(targetUsername);
    const existing = this.activeDataConnections.get(targetPeerId);
    if (existing && existing.open) return existing;

    try {
      const conn = this.peer.connect(targetPeerId, {
        metadata: { senderUsername: this.currentUsername },
        reliable: true,
      });

      this.setupDataConnection(conn);

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(conn.open ? conn : null);
        }, 3000);

        conn.on('open', () => {
          clearTimeout(timeout);
          resolve(conn);
        });

        conn.on('error', () => {
          clearTimeout(timeout);
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  /**
   * Send an encrypted chat message over WebRTC DataChannel
   */
  public async sendMessage(targetUsername: string, message: EncryptedMessage, myPublicKeyJwk?: JsonWebKey) {
    const conn = await this.connectToPeer(targetUsername, myPublicKeyJwk);
    if (conn && conn.open) {
      try {
        conn.send({
          type: 'chat:send',
          message,
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Send burn message signal
   */
  public async sendBurnSignal(targetUsername: string, messageId: string) {
    const conn = await this.connectToPeer(targetUsername);
    if (conn && conn.open) {
      try {
        conn.send({
          type: 'chat:burn',
          messageId,
        });
      } catch {}
    }
  }

  /**
   * Send typing notification
   */
  public async sendTyping(targetUsername: string, isTyping: boolean) {
    const targetPeerId = PeerManager.getPeerIdForUsername(targetUsername);
    const conn = this.activeDataConnections.get(targetPeerId);
    if (conn && conn.open) {
      try {
        conn.send({
          type: 'chat:typing',
          senderUsername: this.currentUsername,
          isTyping,
        });
      } catch {}
    }
  }

  /**
   * Start a media call (Voice or Video)
   */
  public startCall(
    targetUsername: string,
    localStream: MediaStream,
    callType: 'audio' | 'video'
  ): MediaConnection | null {
    if (!this.peer || this.peer.destroyed) return null;
    const targetPeerId = PeerManager.getPeerIdForUsername(targetUsername);

    try {
      const mediaConn = this.peer.call(targetPeerId, localStream, {
        metadata: {
          callerUsername: this.currentUsername,
          callType,
        },
      });

      this.activeMediaCall = mediaConn;
      return mediaConn;
    } catch (e) {
      console.warn('Could not start peer call:', e);
      return null;
    }
  }

  /**
   * Safely answer incoming MediaConnection
   */
  public answerCall(mediaConn: MediaConnection, localStream: MediaStream) {
    if (!mediaConn) {
      throw new Error('No active incoming call connection to answer.');
    }
    // Guard against call that was terminated by caller before answer
    if ((mediaConn as any)._negotiator === null) {
      throw new Error('Call was ended by the other party before being answered.');
    }

    this.activeMediaCall = mediaConn;
    mediaConn.answer(localStream);
  }

  public endCall() {
    if (this.activeMediaCall) {
      try {
        this.activeMediaCall.close();
      } catch {}
      this.activeMediaCall = null;
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.endCall();
    this.activeDataConnections.forEach((conn) => {
      try {
        conn.close();
      } catch {}
    });
    this.activeDataConnections.clear();
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch {}
      this.peer = null;
    }
  }
}
