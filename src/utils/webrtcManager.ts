/**
 * Real WebRTC PeerConnection Manager
 * Manages audio/video streams, ICE candidate exchange, SDP offers/answers,
 * screen sharing, and local audio visualization.
 */

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private onRemoteStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onIceCandidateCallback: ((candidate: RTCIceCandidate) => void) | null = null;
  private onConnectionStateChangeCallback: ((state: RTCPeerConnectionState) => void) | null = null;

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  public setCallbacks(
    onRemoteStream: (stream: MediaStream) => void,
    onIceCandidate: (candidate: RTCIceCandidate) => void,
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
  ) {
    this.onRemoteStreamCallback = onRemoteStream;
    this.onIceCandidateCallback = onIceCandidate;
    this.onConnectionStateChangeCallback = onConnectionStateChange || null;
  }

  /**
   * Acquire local user media (Mic / Camera)
   */
  async startLocalMedia(video: boolean): Promise<MediaStream> {
    if (this.localStream) {
      this.stopLocalMedia();
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: video
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            }
          : false,
      });
      return this.localStream;
    } catch (err: any) {
      console.warn('Media capture error:', err);
      // Fallback: If video failed or permission denied, try audio-only
      if (video) {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          return this.localStream;
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Initialize RTCPeerConnection
   */
  initPeerConnection(): RTCPeerConnection {
    if (this.pc) {
      this.closePeerConnection();
    }

    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.remoteStream = new MediaStream();
    this.pendingCandidates = [];

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidateCallback) {
        this.onIceCandidateCallback(event.candidate);
      }
    };

    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          this.remoteStream?.addTrack(track);
        });
      } else if (event.track) {
        this.remoteStream?.addTrack(event.track);
      }
      if (this.remoteStream && this.onRemoteStreamCallback) {
        this.onRemoteStreamCallback(this.remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc && this.onConnectionStateChangeCallback) {
        this.onConnectionStateChangeCallback(this.pc.connectionState);
      }
    };

    // Add local tracks to PeerConnection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.pc?.addTrack(track, this.localStream!);
      });
    }

    return this.pc;
  }

  /**
   * Create SDP Offer (Caller side)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) this.initPeerConnection();
    const offer = await this.pc!.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc!.setLocalDescription(offer);
    return offer;
  }

  /**
   * Handle incoming Offer and generate SDP Answer (Callee side)
   */
  async handleOfferAndCreateAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) this.initPeerConnection();
    await this.pc!.setRemoteDescription(new RTCSessionDescription(offer));

    // Process any queued candidates
    await this.flushPendingCandidates();

    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    return answer;
  }

  /**
   * Set remote answer (Caller receives callee's answer)
   */
  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushPendingCandidates();
  }

  /**
   * Add ICE candidate from peer
   */
  async addIceCandidate(candidateInit: RTCIceCandidateInit) {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(candidateInit);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (e) {
      console.warn('Error adding ice candidate:', e);
    }
  }

  private async flushPendingCandidates() {
    if (!this.pc) return;
    while (this.pendingCandidates.length > 0) {
      const candidateInit = this.pendingCandidates.shift();
      if (candidateInit) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (e) {
          console.warn('Error flushing candidate:', e);
        }
      }
    }
  }

  /**
   * Toggle mute for local audio
   */
  toggleMute(): boolean {
    if (!this.localStream) return true;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // true if muted
    }
    return true;
  }

  /**
   * Toggle local camera stream
   */
  toggleVideo(): boolean {
    if (!this.localStream) return true;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // true if camera is off
    }
    return true;
  }

  /**
   * Screen sharing toggle
   */
  async toggleScreenShare(isCurrentlySharing: boolean): Promise<boolean> {
    if (isCurrentlySharing) {
      // Revert to camera
      if (this.screenStream) {
        this.screenStream.getTracks().forEach((t) => t.stop());
        this.screenStream = null;
      }
      if (this.localStream && this.pc) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      }
      return false;
    } else {
      // Start screen capture
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this.screenStream = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        screenTrack.onended = () => {
          this.toggleScreenShare(true);
        };

        if (this.pc) {
          const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          } else if (this.localStream) {
            this.pc.addTrack(screenTrack, this.localStream);
          }
        }
        return true;
      } catch (e) {
        console.warn('Screen share canceled or denied:', e);
        return false;
      }
    }
  }

  /**
   * Stop local media tracks
   */
  stopLocalMedia() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
  }

  /**
   * Close PeerConnection and cleanup
   */
  closePeerConnection() {
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.stopLocalMedia();
    this.remoteStream = null;
    this.pendingCandidates = [];
  }
}
