/**
 * Procedural ambient layers per emotion (Web Audio API).
 * No external audio files; starts only after a user gesture.
 */

const FADE_SEC = 1.2;

const moodParams = {
  neutral: { baseHz: 220, detune: 0, filter: 800, gain: 0.06 },
  happy: { baseHz: 330, detune: 8, filter: 2200, gain: 0.07 },
  sad: { baseHz: 165, detune: -5, filter: 400, gain: 0.055 },
  angry: { baseHz: 185, detune: 18, filter: 1200, gain: 0.065 },
  fearful: { baseHz: 200, detune: 22, filter: 600, gain: 0.05 },
  surprised: { baseHz: 440, detune: 12, filter: 2800, gain: 0.06 },
  disgusted: { baseHz: 155, detune: -8, filter: 500, gain: 0.052 },
};

export class EmotionAmbientAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.active = null;
    this.muted = false;
    this.currentEmotion = "neutral";
  }

  async unlockFromUserGesture() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.startLayer("neutral");
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(
        muted ? 0 : 0.85,
        now + 0.25,
      );
    }
  }

  startLayer(emotion) {
    if (!this.ctx || !this.master) return;
    const params = moodParams[emotion] ?? moodParams.neutral;
    const t = this.ctx.currentTime;

    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    oscA.type = "triangle";
    oscB.type = "sine";
    oscA.frequency.setValueAtTime(params.baseHz, t);
    oscB.frequency.setValueAtTime(params.baseHz * 1.5 + params.detune, t);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(params.filter, t);
    filter.Q.setValueAtTime(0.7, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(params.gain, t + FADE_SEC);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    oscA.start(t);
    oscB.start(t);

    const layer = { oscA, oscB, filter, gain, stopAt: null };
    this.active = layer;
    this.currentEmotion = emotion;
  }

  crossfadeTo(emotion) {
    if (!this.ctx || !this.master) return;
    if (emotion === this.currentEmotion && this.active) return;

    const old = this.active;
    const t = this.ctx.currentTime;
    const params = moodParams[emotion] ?? moodParams.neutral;

    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    oscA.type = "triangle";
    oscB.type = "sine";
    oscA.frequency.setValueAtTime(params.baseHz, t);
    oscB.frequency.setValueAtTime(params.baseHz * 1.5 + params.detune, t);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(params.filter, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(params.gain, t + FADE_SEC);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    oscA.start(t);
    oscB.start(t);

    if (old) {
      const end = t + FADE_SEC;
      try {
        old.gain.gain.setValueAtTime(old.gain.gain.value, t);
        old.gain.gain.exponentialRampToValueAtTime(0.0001, end);
      } catch {
        old.gain.gain.linearRampToValueAtTime(0, end);
      }
      old.stopAt = end;
      window.setTimeout(() => {
        try {
          old.oscA.stop();
          old.oscB.stop();
        } catch {
          /* already stopped */
        }
        old.oscA.disconnect();
        old.oscB.disconnect();
        old.filter.disconnect();
        old.gain.disconnect();
      }, (FADE_SEC + 0.05) * 1000);
    }

    this.active = { oscA, oscB, filter, gain, stopAt: null };
    this.currentEmotion = emotion;
  }

  syncEmotion(emotion) {
    if (!this.ctx) return;
    if (!this.active) {
      this.startLayer(emotion);
      return;
    }
    this.crossfadeTo(emotion);
  }
}
