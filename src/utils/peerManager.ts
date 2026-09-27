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

  constructor(events: PeerManagerEvents) {
    this.events = events;
  }

  public static getPeerIdForUsername(username: string): string {
    const clean = username.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    return `ciphercall_usr_${clean}`;
  }

  public init(username: string, publicKeyJwk?: JsonWebKey): Promise<string> {
    this.currentUsername = username.toLowerCase().trim();
    const myPeerId = PeerManager.getPeerIdForUsername(this.currentUsername);

    return new Promise((resolve) => {
      // Connect to reliable public WebRTC broker
      this.peer = new Peer(myPeerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        },
      });

      this.peer.on('open', (id) => {
        if (this.events.onPeerReady) this.events.onPeerReady(id);
        resolve(id);
      });

      this.peer.on('error', (err: any) => {
        console.warn('PeerJS connection event:', err.type, err.message);
        if (err.type === 'unavailable-id') {
          // Username peer ID already active in another tab, retry with suffix
          const fallbackId = `${myPeerId}_${Math.random().toString(36).substring(2, 6)}`;
          this.peer = new Peer(fallbackId, { debug: 1 });
          this.peer.on('open', (id) => resolve(id));
        }
      });

      // Handle incoming Data Connection (E2EE Chat & Signaling)
      this.peer.on('connection', (conn) => {
        this.setupDataConnection(conn, publicKeyJwk);
      });

      // Handle incoming Media Call (Audio & Video)
      this.peer.on('call', (mediaConn) => {
        const metadata = mediaConn.metadata || {};
        if (this.events.onIncomingCall) {
          this.events.onIncomingCall(mediaConn, {
            username: metadata.callerUsername || 'Peer',
            callType: metadata.callType || 'audio',
          });
        }
      });
    });
  }

  private setupDataConnection(conn: DataConnection, myPublicKeyJwk?: JsonWebKey) {
    conn.on('open', () => {
      this.activeDataConnections.set(conn.peer, conn);

      // Exchange our ECDH Public Key
      if (myPublicKeyJwk) {
        conn.send({
          type: 'key:exchange',
          senderUsername: this.currentUsername,
          publicKeyJwk: myPublicKeyJwk,
        });
      }
    });

    conn.on('data', (data: any) => {
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'chat:send':
          if (this.events.onIncomingMessage) {
            this.events.onIncomingMessage(data.message);
          }
          break;

        case 'chat:burn':
          if (this.events.onMessageBurned) {
            this.events.onMessageBurned(data.messageId);
          }
          break;

        case 'chat:typing':
          if (this.events.onTyping) {
            this.events.onTyping(data.senderUsername, data.isTyping);
          }
          break;

        case 'key:exchange':
          if (this.events.onPeerKeyExchange && data.publicKeyJwk) {
            this.events.onPeerKeyExchange(data.senderUsername, data.publicKeyJwk);
          }
          break;

        default:
          break;
      }
    });

    conn.on('close', () => {
      this.activeDataConnections.delete(conn.peer);
    });
  }

  /**
   * Connect or get existing DataConnection with peer
   */
  public async connectToPeer(targetUsername: string, myPublicKeyJwk?: JsonWebKey): Promise<DataConnection | null> {
    if (!this.peer) return null;
    const targetPeerId = PeerManager.getPeerIdForUsername(targetUsername);

    const existing = this.activeDataConnections.get(targetPeerId);
    if (existing && existing.open) return existing;

    const conn = this.peer.connect(targetPeerId, {
      metadata: { senderUsername: this.currentUsername },
      reliable: true,
    });

    this.setupDataConnection(conn, myPublicKeyJwk);

    return new Promise((resolve) => {
      conn.on('open', () => resolve(conn));
      setTimeout(() => resolve(conn.open ? conn : null), 3000);
    });
  }

  /**
   * Send an encrypted chat message over WebRTC DataChannel
   */
  public async sendMessage(targetUsername: string, message: EncryptedMessage, myPublicKeyJwk?: JsonWebKey) {
    const conn = await this.connectToPeer(targetUsername, myPublicKeyJwk);
    if (conn && conn.open) {
      conn.send({
        type: 'chat:send',
        message,
      });
      return true;
    }
    return false;
  }

  /**
   * Send burn message signal
   */
  public async sendBurnSignal(targetUsername: string, messageId: string) {
    const conn = await this.connectToPeer(targetUsername);
    if (conn && conn.open) {
      conn.send({
        type: 'chat:burn',
        messageId,
      });
    }
  }

  /**
   * Send typing notification
   */
  public async sendTyping(targetUsername: string, isTyping: boolean) {
    const targetPeerId = PeerManager.getPeerIdForUsername(targetUsername);
    const conn = this.activeDataConnections.get(targetPeerId);
    if (conn && conn.open) {
      conn.send({
        type: 'chat:typing',
        senderUsername: this.currentUsername,
        isTyping,
      });
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
    if (!this.peer) return null;
    const targetPeerId = PeerManager.getPeerIdForUsername(targetUsername);

    const mediaConn = this.peer.call(targetPeerId, localStream, {
      metadata: {
        callerUsername: this.currentUsername,
        callType,
      },
    });

    this.activeMediaCall = mediaConn;
    return mediaConn;
  }

  public answerCall(mediaConn: MediaConnection, localStream: MediaStream) {
    this.activeMediaCall = mediaConn;
    mediaConn.answer(localStream);
  }

  public endCall() {
    if (this.activeMediaCall) {
      this.activeMediaCall.close();
      this.activeMediaCall = null;
    }
  }

  public destroy() {
    this.endCall();
    this.activeDataConnections.forEach((conn) => conn.close());
    this.activeDataConnections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
