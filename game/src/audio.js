// Duskline Depot sound: every sound is synthesised with WebAudio oscillators
// and filtered noise, so the game ships no audio files and makes no network
// request. AudioContext is created on the first user gesture (unlock()).
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (!ensure() || !ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  function noise(dur, gain, lowpass) {
    if (!ensure() || !ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(id) {
      if (id === 'needle') { noise(0.16, 0.5, 3200); tone(220, 0.1, 'square', 0.12, 60); }
      else if (id === 'riot') { noise(0.22, 0.65, 1400); tone(140, 0.14, 'sawtooth', 0.16, 50); }
      else if (id === 'saw') { noise(0.2, 0.55, 2000); tone(110, 0.12, 'sawtooth', 0.14, 55); }
      else if (id === 'mako') { noise(0.09, 0.4, 2600); tone(320, 0.06, 'square', 0.1, 90); }
      else if (id === 'frag' || id === 'smoke') { noise(0.12, 0.3, 1800); }
      else { noise(0.14, 0.5, 2400); tone(180, 0.09, 'square', 0.12, 70); }
    },
    enemyShot() { noise(0.1, 0.16, 1600); },
    dryFire() { tone(1400, 0.03, 'square', 0.08); },
    hit(killed) { tone(killed ? 880 : 660, 0.07, 'sine', 0.2); },
    hurt() { tone(160, 0.18, 'sawtooth', 0.2, 70); },
    reload() { tone(500, 0.05, 'square', 0.08); tone(700, 0.05, 'square', 0.08); },
    buy() { tone(660, 0.08, 'sine', 0.16); tone(990, 0.1, 'sine', 0.16); },
    plantBeep() { tone(1200, 0.09, 'sine', 0.18); },
    explosion() { noise(0.7, 0.9, 500); tone(60, 0.6, 'sine', 0.4, 28); },
    smokePop() { noise(0.4, 0.35, 900); },
    roundWin() { tone(523, 0.14, 'sine', 0.2); tone(659, 0.14, 'sine', 0.2); tone(784, 0.24, 'sine', 0.22); },
    roundLoss() { tone(392, 0.18, 'sine', 0.2); tone(311, 0.3, 'sine', 0.2); },
  };
}
