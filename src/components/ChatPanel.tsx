import React, { useState, useEffect, useRef } from 'react';
import { User, EncryptedMessage } from '../types';
import {
  Send,
  Phone,
  Video,
  Flame,
  ShieldCheck,
  Lock,
  Eye,
  Check,
  CheckCheck,
  Mic,
  Square,
  Play,
  Pause,
  AlertTriangle,
  Clock,
  Sparkles,
  Info,
} from 'lucide-react';
import { soundManager } from '../utils/sound';

interface ChatPanelProps {
  currentUser: User;
  contact: User;
  messages: EncryptedMessage[];
  onSendMessage: (text: string, isOneTime: boolean, mediaType?: 'text' | 'voice', voiceData?: string) => Promise<void>;
  onBurnMessage: (messageId: string) => void;
  onRevealOneTime: (messageId: string) => void;
  onStartCall: (contact: User, type: 'audio' | 'video') => void;
  onOpenSafetyNumbers: () => void;
  isVerified: boolean;
  isPeerTyping?: boolean;
  onTyping?: (isTyping: boolean) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  currentUser,
  contact,
  messages,
  onSendMessage,
  onBurnMessage,
  onRevealOneTime,
  onStartCall,
  onOpenSafetyNumbers,
  isVerified,
  isPeerTyping = false,
  onTyping,
}) => {
  const [inputText, setInputText] = useState('');
  const [isOneTimeMode, setIsOneTimeMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPeerTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => {
        onTyping(false);
      }, 1500);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText;
    const oneTime = isOneTimeMode;
    setInputText('');
    setIsOneTimeMode(false);
    if (onTyping) onTyping(false);

    await onSendMessage(text, oneTime, 'text');
  };

  // Voice Note Recording using MediaRecorder
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());

        // Convert to Base64 for encrypted transmission
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          await onSendMessage('Voice Note', isOneTimeMode, 'voice', base64Audio);
          setIsOneTimeMode(false);
        };
      };

      recorder.start();
      setIsRecording(true);
      setRecordDuration(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('Microphone access is required to record voice notes.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const playVoiceNote = (messageId: string, audioDataUri: string) => {
    if (playingVoiceId === messageId) {
      setPlayingVoiceId(null);
      return;
    }
    const audio = new Audio(audioDataUri);
    setPlayingVoiceId(messageId);
    audio.play();
    audio.onended = () => setPlayingVoiceId(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Chat Header */}
      <div className="h-16 px-6 border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={contact.avatar}
              alt={contact.name}
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full object-cover border border-slate-700"
            />
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-slate-900 ${
                contact.status === 'in-call'
                  ? 'bg-amber-400'
                  : contact.status === 'online'
                  ? 'bg-emerald-500'
                  : 'bg-slate-500'
              }`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-slate-100">{contact.name}</h3>
              <button
                onClick={onOpenSafetyNumbers}
                title="View Cryptographic Safety Numbers"
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  isVerified
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                }`}
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>{isVerified ? 'Verified' : 'Verify'}</span>
              </button>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <span>@{contact.username}</span>
              <span>·</span>
              <span className="text-emerald-400/90 font-mono">ECDH P-256 Shared Key</span>
            </div>
          </div>
        </div>

        {/* Call Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStartCall(contact, 'audio')}
            title="Start Encrypted Voice Call"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            <Phone className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Voice Call</span>
          </button>
          <button
            onClick={() => onStartCall(contact, 'video')}
            title="Start Encrypted Video Call"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors shadow-sm"
          >
            <Video className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Video Call</span>
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {/* End-to-End Encryption Notice Banner */}
        <div className="max-w-md mx-auto p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 text-center space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-xs font-semibold">
            <Lock className="w-3.5 h-3.5" />
            <span>End-to-End Encrypted Channel</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Messages, voice notes, and calls are secured with client-side AES-GCM-256. No unencrypted content ever touches the server.
          </p>
        </div>

        {/* Message Thread */}
        {messages.map((msg) => {
          const isMe = msg.senderId === currentUser.id;
          const isOneTime = msg.isOneTime;
          const isBurned = msg.isBurned;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-sm sm:max-w-md rounded-2xl p-3.5 transition-all text-sm ${
                  isBurned
                    ? 'bg-slate-900/60 border border-slate-800 text-slate-500 italic'
                    : isOneTime
                    ? isMe
                      ? 'bg-amber-950/40 border border-amber-800/60 text-amber-200'
                      : 'bg-amber-950/60 border border-amber-700/80 text-amber-100 shadow-lg shadow-amber-950/20'
                    : isMe
                    ? 'bg-emerald-600 text-white rounded-br-none shadow-sm'
                    : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-none'
                }`}
              >
                {/* 1. Burned Message Placeholder */}
                {isBurned ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                    <Flame className="w-4 h-4 text-slate-600" />
                    <span>[Message burned and destroyed from memory]</span>
                  </div>
                ) : isOneTime ? (
                  // 2. One-Time Message (Burn After Reading)
                  <div>
                    <div className="flex items-center justify-between gap-3 pb-2 border-b border-amber-800/40 mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                        <Flame className="w-3.5 h-3.5 animate-pulse" />
                        <span>One-Time Secret</span>
                      </div>
                      <span className="text-[10px] font-mono text-amber-400/80 uppercase">
                        View Once
                      </span>
                    </div>

                    {!msg.revealed && !isMe ? (
                      // Unrevealed state for recipient
                      <div className="py-2 text-center space-y-2">
                        <p className="text-xs text-amber-300/90">
                          This encrypted secret will self-destruct 10 seconds after opening.
                        </p>
                        <button
                          onClick={() => onRevealOneTime(msg.id)}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 mx-auto"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Tap to Reveal Message
                        </button>
                      </div>
                    ) : (
                      // Revealed state (with countdown timer)
                      <div className="space-y-2">
                        <div className="text-sm font-medium leading-relaxed break-words">
                          {msg.decryptedContent || msg.ciphertext}
                        </div>

                        {/* Countdown progress bar */}
                        {msg.remainingBurnSeconds !== undefined && (
                          <div className="pt-2 border-t border-amber-800/40">
                            <div className="flex items-center justify-between text-[10px] text-amber-400 font-mono mb-1">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Self-destructing in
                              </span>
                              <span>{msg.remainingBurnSeconds}s</span>
                            </div>
                            <div className="w-full bg-amber-950/80 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-amber-400 h-full transition-all duration-1000 ease-linear"
                                style={{
                                  width: `${((msg.remainingBurnSeconds || 0) / 10) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : msg.mediaType === 'voice' ? (
                  // 3. Encrypted Voice Note
                  <div className="flex items-center gap-3 py-1">
                    <button
                      onClick={() => playVoiceNote(msg.id, msg.decryptedContent || '')}
                      className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors"
                    >
                      {playingVoiceId === msg.id ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5" />
                      )}
                    </button>
                    <div>
                      <div className="text-xs font-semibold">Encrypted Voice Note</div>
                      <div className="text-[10px] opacity-80 font-mono">
                        {playingVoiceId === msg.id ? 'Playing...' : 'Tap to listen'}
                      </div>
                    </div>
                  </div>
                ) : (
                  // 4. Standard Encrypted Text Message
                  <div className="leading-relaxed break-words">
                    {msg.decryptedContent || msg.ciphertext}
                  </div>
                )}

                {/* Message Metadata (Timestamp & Status) */}
                <div
                  className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                    isMe && !isOneTime
                      ? 'text-emerald-100'
                      : isOneTime
                      ? 'text-amber-400/80'
                      : 'text-slate-400'
                  }`}
                >
                  <span className="tabular-nums">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {isMe && (
                    <CheckCheck className="w-3 h-3 opacity-90" />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Peer Typing Indicator */}
        {isPeerTyping && (
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 w-fit px-3 py-1.5 rounded-full border border-slate-800">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.2s]" />
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]" />
            <span className="text-[11px] font-medium">{contact.name} is typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/70 shrink-0">
        {/* One-Time Mode Active Banner */}
        {isOneTimeMode && (
          <div className="mb-2 px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-800/80 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>One-Time Secret Mode: Destructs 10s after recipient opens it.</span>
            </div>
            <button
              onClick={() => setIsOneTimeMode(false)}
              className="text-[10px] font-mono text-amber-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center gap-2">
          {/* One-Time Message Toggle Button */}
          <button
            type="button"
            onClick={() => setIsOneTimeMode(!isOneTimeMode)}
            title="Send as One-Time View-Once Message"
            className={`p-2.5 rounded-xl border transition-all ${
              isOneTimeMode
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-lg shadow-amber-500/20'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-500/40'
            }`}
          >
            <Flame className="w-4 h-4" />
          </button>

          {/* Voice Record Button */}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            title={isRecording ? 'Stop and send voice note' : 'Hold to record voice note'}
            className={`p-2.5 rounded-xl border transition-all ${
              isRecording
                ? 'bg-red-600 text-white border-red-500 animate-pulse'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
            }`}
          >
            {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Text Input */}
          <div className="relative flex-1">
            {isRecording ? (
              <div className="w-full bg-slate-950 border border-red-800/60 rounded-xl px-4 py-2 text-xs text-red-400 flex items-center justify-between font-mono animate-pulse">
                <span>Recording encrypted voice note...</span>
                <span>{recordDuration}s</span>
              </div>
            ) : (
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                placeholder={
                  isOneTimeMode
                    ? 'Type a self-destructing secret...'
                    : `Message ${contact.name.split(' ')[0]} (E2EE)...`
                }
                className={`w-full bg-slate-950 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors border ${
                  isOneTimeMode
                    ? 'border-amber-500/70 focus:border-amber-400'
                    : 'border-slate-800 focus:border-emerald-500/70'
                }`}
              />
            )}
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-md shadow-emerald-500/20"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
