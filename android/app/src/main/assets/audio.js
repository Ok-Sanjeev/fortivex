/**
 * Procedural Audio Synthesizer for Barricade
 * Zero-latency Web Audio API sound effects
 */
class SoundEffects {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this.volume = 0.55;
    }

    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggleMute() {
        this.muted = !this.muted;
        return this.muted;
    }

    playPawnMove() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

        gain.gain.setValueAtTime(0.28 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.08);
    }

    playPawnJump() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(540, now + 0.12);

        gain.gain.setValueAtTime(0.3 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.14);
    }

    playWallPlace() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        
        // Solid thud
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.14);

        gain.gain.setValueAtTime(0.4 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.14);

        // Click snap
        const click = this.ctx.createOscillator();
        const clickGain = this.ctx.createGain();
        click.type = 'sine';
        click.frequency.setValueAtTime(880, now);
        click.frequency.exponentialRampToValueAtTime(320, now + 0.05);

        clickGain.gain.setValueAtTime(0.25 * this.volume, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        click.connect(clickGain);
        clickGain.connect(this.ctx.destination);

        click.start(now);
        click.stop(now + 0.05);
    }

    // Custom Mechanic: Shatter / Break Barricade
    playBreakWall() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;

        // Low smash punch
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.25);

        gain.gain.setValueAtTime(0.5 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.25);

        // High glass/stone shattering shards
        for (let i = 0; i < 3; i++) {
            const shard = this.ctx.createOscillator();
            const shardGain = this.ctx.createGain();
            shard.type = 'sine';
            const startF = 1200 + i * 400;
            shard.frequency.setValueAtTime(startF, now + i * 0.04);
            shard.frequency.exponentialRampToValueAtTime(200, now + 0.18 + i * 0.04);

            shardGain.gain.setValueAtTime(0.25 * this.volume, now + i * 0.04);
            shardGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22 + i * 0.04);

            shard.connect(shardGain);
            shardGain.connect(this.ctx.destination);

            shard.start(now + i * 0.04);
            shard.stop(now + 0.22 + i * 0.04);
        }
    }

    playRotate() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(950, now + 0.04);

        gain.gain.setValueAtTime(0.15 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.04);
    }

    playIllegal() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.setValueAtTime(95, now + 0.08);

        gain.gain.setValueAtTime(0.25 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.18);
    }

    playTurnStart() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.08); // E5

        gain.gain.setValueAtTime(0.15 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.12);
    }

    playVictory() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const notes = [440, 554.37, 659.25, 880];
        const start = this.ctx.currentTime;

        notes.forEach((freq, idx) => {
            const time = start + idx * 0.12;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);

            const duration = idx === notes.length - 1 ? 0.6 : 0.2;
            gain.gain.setValueAtTime(0.3 * this.volume, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(time);
            osc.stop(time + duration);
        });
    }
}

const sounds = new SoundEffects();
