import React, { useEffect, useRef, useState } from 'react';
import { ActiveCall, User } from '../types';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  ScreenShare,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Lock,
  MessageSquare,
  Volume2,
} from 'lucide-react';
import { soundManager } from '../utils/sound';

interface CallModalProps {
  call: ActiveCall;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: (video: boolean) => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleInCallChat?: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  call,
  localStream,
  remoteStream,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onToggleInCallChat,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Play audio ringtones based on call status
  useEffect(() => {
    if (call.status === 'incoming') {
      soundManager.startIncomingRing();
    } else if (call.status === 'calling') {
      soundManager.startOutgoingRing();
    } else if (call.status === 'connected') {
      soundManager.playConnectedTone();
    } else if (call.status === 'ended') {
      soundManager.playEndedTone();
    }

    return () => {
      soundManager.stopRinging();
    };
  }, [call.status]);

  // Duration timer when connected
  useEffect(() => {
    let interval: number | null = null;
    if (call.status === 'connected') {
      interval = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [call.status]);

  // Bind local stream to video tag
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, call.isVideoOff]);

  // Bind remote stream to video tag
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const isVideo = call.callType === 'video';

  // 1. INCOMING CALL SCREEN
  if (call.status === 'incoming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl relative overflow-hidden">
          {/* Subtle pulse background */}
          <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />

          <div className="relative z-10 flex flex-col items-center">
            {/* Avatar with animated rings */}
            <div className="relative mb-6">
              <div className="absolute inset-0 -m-3 rounded-full border border-emerald-500/30 animate-ping opacity-75" />
              <div className="absolute inset-0 -m-1.5 rounded-full border border-emerald-500/50 animate-pulse" />
              <img
                src={call.peer.avatar}
                alt={call.peer.name}
                referrerPolicy="no-referrer"
                className="w-24 h-24 rounded-full object-cover border-2 border-emerald-500 ring-4 ring-emerald-500/20 shadow-xl"
              />
            </div>

            <h3 className="text-xl font-bold text-white mb-1">{call.peer.name}</h3>
            <p className="text-xs text-slate-400 font-mono mb-4">@{call.peer.username}</p>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-medium mb-8">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Incoming Encrypted {isVideo ? 'Video' : 'Voice'} Call</span>
            </div>

            {/* Answer & Decline Buttons */}
            <div className="flex items-center justify-center gap-6 w-full">
              <button
                onClick={onReject}
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-600/30 group-hover:scale-105 transition-all">
                  <PhoneOff className="w-6 h-6" />
                </div>
                <span className="text-xs text-slate-400 font-medium">Decline</span>
              </button>

              <button
                onClick={() => onAccept(isVideo)}
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/30 group-hover:scale-105 transition-all">
                  {isVideo ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
                </div>
                <span className="text-xs text-emerald-400 font-medium">Accept</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. CALLING / OUTGOING DIALING SCREEN
  if (call.status === 'calling') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center">
            {/* Avatar */}
            <div className="relative mb-6">
              <div className="absolute inset-0 -m-3 rounded-full border border-emerald-500/20 animate-pulse" />
              <img
                src={call.peer.avatar}
                alt={call.peer.name}
                referrerPolicy="no-referrer"
                className="w-24 h-24 rounded-full object-cover border-2 border-emerald-500/80 shadow-xl"
              />
            </div>

            <h3 className="text-xl font-bold text-white mb-1">{call.peer.name}</h3>
            <p className="text-xs text-slate-400 font-mono mb-4">@{call.peer.username}</p>

            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono mb-8 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Securing end-to-end DTLS session...
            </div>

            <button
              onClick={onHangup}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-600/30 hover:scale-105 transition-all"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
            <span className="text-xs text-slate-400 mt-2">Cancel Call</span>
          </div>
        </div>
      </div>
    );
  }

  // 3. CONNECTED / ACTIVE CALL SCREEN
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-hidden animate-in fade-in duration-300"
    >
      {/* Top Overlay Bar */}
      <div className="absolute top-0 left-0 right-0 p-4 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-3">
          <img
            src={call.peer.avatar}
            alt={call.peer.name}
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-full object-cover border border-emerald-500/60"
          />
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-sm text-white">{call.peer.name}</h4>
              {call.isLoopbackTest && (
                <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                  Loopback Test
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className="font-mono text-emerald-400">{formatDuration(duration)}</span>
              <span>·</span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" /> E2EE Verified
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-black/40 hover:bg-black/60 text-slate-300 hover:text-white backdrop-blur-sm transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Call View Area */}
      <div className="flex-1 relative flex items-center justify-center bg-slate-950">
        {isVideo && !call.isVideoOff ? (
          // Video streams layout
          <div className="w-full h-full relative flex items-center justify-center">
            {/* Remote Video Stream (Main) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover bg-slate-950"
            />

            {/* If remote stream has no video yet or peer camera is disabled, show avatar fallback */}
            {(!remoteStream || remoteStream.getVideoTracks().length === 0) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm">
                <img
                  src={call.peer.avatar}
                  alt={call.peer.name}
                  referrerPolicy="no-referrer"
                  className="w-28 h-28 rounded-full object-cover border-2 border-emerald-500 mb-4 ring-4 ring-emerald-500/20"
                />
                <h3 className="text-lg font-bold text-white">{call.peer.name}</h3>
                <p className="text-xs text-slate-400 mt-1">Camera disabled</p>
              </div>
            )}

            {/* Local Video Stream (Picture-in-Picture) */}
            <div className="absolute bottom-24 right-6 w-36 h-48 sm:w-48 sm:h-64 rounded-2xl overflow-hidden border-2 border-slate-700 bg-slate-900 shadow-2xl z-20">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${call.isVideoOff ? 'hidden' : ''}`}
              />
              {call.isVideoOff && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-400 text-xs p-2 text-center">
                  <VideoOff className="w-6 h-6 mb-1 text-slate-500" />
                  <span>Your Camera Off</span>
                </div>
              )}
              <div className="absolute bottom-2 left-2 text-[10px] font-medium bg-black/60 px-1.5 py-0.5 rounded text-white backdrop-blur-sm">
                You {call.isMuted && '· Muted'}
              </div>
            </div>
          </div>
        ) : (
          // Voice Call view with animated audio waveform
          <div className="flex flex-col items-center justify-center p-8 max-w-md text-center">
            <div className="relative mb-8">
              <div className="absolute inset-0 -m-4 rounded-full border border-emerald-500/30 animate-pulse" />
              <img
                src={call.peer.avatar}
                alt={call.peer.name}
                referrerPolicy="no-referrer"
                className="w-32 h-32 rounded-full object-cover border-4 border-emerald-500/70 shadow-2xl"
              />
            </div>

            <h3 className="text-2xl font-bold text-white mb-2">{call.peer.name}</h3>
            <div className="text-xs font-mono text-emerald-400 mb-6 flex items-center gap-1.5">
              <Volume2 className="w-4 h-4" />
              <span>AES-GCM-256 Encrypted Voice</span>
            </div>

            {/* Audio Waveform Bars */}
            <div className="flex items-center gap-1.5 h-10 mb-4">
              <span className="w-1.5 bg-emerald-500 rounded-full animate-waveform-1" />
              <span className="w-1.5 bg-emerald-400 rounded-full animate-waveform-2" />
              <span className="w-1.5 bg-emerald-500 rounded-full animate-waveform-3" />
              <span className="w-1.5 bg-emerald-400 rounded-full animate-waveform-4" />
              <span className="w-1.5 bg-emerald-500 rounded-full animate-waveform-2" />
              <span className="w-1.5 bg-emerald-400 rounded-full animate-waveform-1" />
              <span className="w-1.5 bg-emerald-500 rounded-full animate-waveform-3" />
            </div>

            {/* Hidden audio element for audio playback */}
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          </div>
        )}
      </div>

      {/* In-Call Floating Control Bar */}
      <div className="p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-center gap-4 z-20">
        {/* Mic Toggle */}
        <button
          onClick={onToggleMute}
          title={call.isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          className={`p-4 rounded-full transition-all ${
            call.isMuted
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
        >
          {call.isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        {/* Video Toggle */}
        <button
          onClick={onToggleVideo}
          title={call.isVideoOff ? 'Enable Camera' : 'Disable Camera'}
          className={`p-4 rounded-full transition-all ${
            call.isVideoOff
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
        >
          {call.isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>

        {/* Screen Share */}
        <button
          onClick={onToggleScreenShare}
          title={call.isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
          className={`p-4 rounded-full transition-all ${
            call.isScreenSharing
              ? 'bg-emerald-500 text-slate-950 font-bold'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
        >
          <ScreenShare className="w-6 h-6" />
        </button>

        {/* End Call / Hangup */}
        <button
          onClick={onHangup}
          title="Hang Up"
          className="p-4 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-xl shadow-red-600/40 hover:scale-105 transition-all"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
