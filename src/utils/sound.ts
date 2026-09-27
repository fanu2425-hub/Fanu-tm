/**
 * Audio synthesis for calling and E2EE message effects
 * Uses Web Audio API oscillator nodes for realistic phone ringing,
 * incoming chime, connect, disconnect, and one-time burn audio.
 */

class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private ringOscillator1: OscillatorNode | null = null;
  private ringOscillator2: OscillatorNode | null = null;
  private ringGain: GainNode | null = null;
  private ringInterval: number | null = null;

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Play outgoing ringback tone (Standard North American/European dual tone ~440Hz + 480Hz)
   */
  startOutgoingRing() {
    this.stopRinging();
    try {
      const ctx = this.getContext();
      const playBurst = () => {
        if (!this.ringInterval) return;
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;

        gain.gain.setValueAtTime(0.06, now);
        gain.gain.setValueAtTime(0.06, now + 1.8);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 2.0);
        osc2.stop(now + 2.0);
      };

      this.ringInterval = window.setInterval(playBurst, 4000);
      playBurst();
    } catch {
      // Audio autoplay might be blocked before user gesture
    }
  }

  /**
   * Play incoming melody ringtone (Modern high-tech chime sequence)
   */
  startIncomingRing() {
    this.stopRinging();
    try {
      const ctx = this.getContext();
      const playMelody = () => {
        if (!this.ringInterval) return;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
          const now = ctx.currentTime + idx * 0.16;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.value = freq;

          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now);
          osc.stop(now + 0.35);
        });
      };

      this.ringInterval = window.setInterval(playMelody, 2500);
      playMelody();
    } catch {
      // Ignore audio block
    }
  }

  /**
   * Stop any running ringtones
   */
  stopRinging() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.ringOscillator1) {
      try { this.ringOscillator1.stop(); } catch {}
      this.ringOscillator1 = null;
    }
    if (this.ringOscillator2) {
      try { this.ringOscillator2.stop(); } catch {}
      this.ringOscillator2 = null;
    }
  }

  /**
   * Play short call connected chime
   */
  playConnectedTone() {
    this.stopRinging();
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      [440, 554.37, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.3);
      });
    } catch {}
  }

  /**
   * Play call ended / hangup tone
   */
  playEndedTone() {
    this.stopRinging();
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      [480, 400].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.25);
      });
    } catch {}
  }

  /**
   * Play "Burn-After-Reading" / Self-Destruct whoosh-sizzle sound
   */
  playBurnTone() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      // White noise buffer for sizzle/flame
      const bufferSize = ctx.sampleRate * 0.35;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(100, now + 0.35);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      whiteNoise.start(now);
      whiteNoise.stop(now + 0.35);
    } catch {}
  }
}

export const soundManager = new AudioSynthesizer();
