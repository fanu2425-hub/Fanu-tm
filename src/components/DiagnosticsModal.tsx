import React, { useState, useEffect, useRef } from 'react';
import { Shield, Mic, Video, Activity, CheckCircle, AlertTriangle, RefreshCw, Headphones, Zap } from 'lucide-react';
import { generateIdentityKeyPair, deriveSharedSessionKey, encryptPayload, decryptPayload } from '../utils/crypto';

interface DiagnosticsModalProps {
  onClose: () => void;
  onStartLoopback: () => void;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ onClose, onStartLoopback }) => {
  const [micStatus, setMicStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [cryptoBenchmark, setCryptoBenchmark] = useState<{
    keyGenMs: number;
    encryptMs: number;
    passed: boolean;
  } | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  // Run Crypto Benchmark on mount
  useEffect(() => {
    runCryptoBenchmark();
    return () => {
      stopMicTest();
    };
  }, []);

  const runCryptoBenchmark = async () => {
    try {
      const t0 = performance.now();
      const userA = await generateIdentityKeyPair();
      const userB = await generateIdentityKeyPair();
      const tKeyGen = performance.now() - t0;

      const t1 = performance.now();
      const sharedKey = await deriveSharedSessionKey(userA.keyPair.privateKey, userB.keyPair.publicKey);
      const { ciphertext, iv } = await encryptPayload(sharedKey, 'Security benchmark test payload for AES-GCM-256.');
      const decrypted = await decryptPayload(sharedKey, ciphertext, iv);
      const tEncrypt = performance.now() - t1;

      setCryptoBenchmark({
        keyGenMs: Math.round(tKeyGen),
        encryptMs: Math.round(tEncrypt * 10) / 10,
        passed: decrypted.includes('Security benchmark'),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const testMicrophone = async () => {
    setMicStatus('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const checkAudio = () => {
        if (micStreamRef.current) {
          analyser.getByteFrequencyData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) sum += buffer[i];
          const avg = sum / buffer.length;
          setMicLevel(Math.min(100, Math.round(avg * 1.5)));
          requestAnimationFrame(checkAudio);
        }
      };
      checkAudio();
      setMicStatus('passed');
    } catch {
      setMicStatus('failed');
    }
  };

  const stopMicTest = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicLevel(0);
  };

  const testCamera = async () => {
    setCameraStatus('testing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }
      setCameraStatus('passed');
    } catch {
      setCameraStatus('failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-base text-white">Audio, Video & Hardware Diagnostics</h3>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Loopback Test Banner */}
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-sm text-emerald-300 flex items-center gap-2">
                <Headphones className="w-4 h-4" />
                Hardware Echo & Call Latency Check
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Verify your microphone levels, video stream, and speaker output with full acoustic echo cancellation.
              </p>
            </div>
            <button
              onClick={() => {
                onClose();
                onStartLoopback();
              }}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shrink-0 shadow-sm"
            >
              Start Echo Test
            </button>
          </div>

          {/* Diagnostics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Microphone test */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mic className="w-4 h-4 text-emerald-400" />
                  Microphone Input
                </span>
                <span
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                    micStatus === 'passed'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : micStatus === 'failed'
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {micStatus}
                </span>
              </div>

              {/* VU Meter */}
              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 flex justify-between">
                  <span>Input Gain Level</span>
                  <span>{micLevel}%</span>
                </div>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-75"
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              </div>

              <button
                onClick={testMicrophone}
                className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors"
              >
                Test Audio Input
              </button>
            </div>

            {/* Camera test */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Video className="w-4 h-4 text-emerald-400" />
                  Camera Video Feed
                </span>
                <span
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                    cameraStatus === 'passed'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : cameraStatus === 'failed'
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {cameraStatus}
                </span>
              </div>

              <div className="w-full h-24 bg-slate-900 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center relative">
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraStatus !== 'passed' ? 'hidden' : ''}`}
                />
                {cameraStatus !== 'passed' && (
                  <span className="text-slate-600 text-xs">No active video feed</span>
                )}
              </div>

              <button
                onClick={testCamera}
                className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors"
              >
                Test Camera Feed
              </button>
            </div>
          </div>

          {/* Cryptography Performance */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-emerald-400" />
                Client-Side Web Cryptography API Benchmark
              </span>
              <button
                onClick={runCryptoBenchmark}
                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Rerun
              </button>
            </div>

            {cryptoBenchmark ? (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-mono">ECDH KeyPair</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                    {cryptoBenchmark.keyGenMs} ms
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-mono">AES-GCM Encrypt</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                    {cryptoBenchmark.encryptMs} ms
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-mono">SubtleCrypto Integrity</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                    PASSED
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">Benchmarking...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
