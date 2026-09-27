export interface User {
  id: string;
  username: string;
  name: string;
  avatar: string;
  status: 'online' | 'in-call' | 'away' | 'offline';
  publicKeyJwk?: JsonWebKey;
  verifiedContacts?: string[];
  createdAt?: number;
}

export interface EncryptedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  iv: string;
  isOneTime?: boolean;
  burnAfterSeconds?: number;
  isBurned?: boolean;
  timestamp: number;
  mediaType?: 'text' | 'voice' | 'file';
  fileName?: string;
  fileSize?: number;
  // Local client state
  decryptedContent?: string;
  revealed?: boolean;
  remainingBurnSeconds?: number;
  isDecrypted?: boolean;
  decryptError?: boolean;
}

export type CallType = 'audio' | 'video';

export interface ActiveCall {
  callId: string;
  callType: CallType;
  peer: User;
  isInitiator: boolean;
  status: 'calling' | 'incoming' | 'connected' | 'ended';
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  startedAt?: number;
  isLoopbackTest?: boolean;
}
