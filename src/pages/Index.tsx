import { useEffect, useRef, useState } from "react";
import FartVisualizer from "@/components/FartVisualizer";

const FARTS = [
  "Pffffffrrrrrtttt!",
  "Brrrraaaaaapppp!",
  "Pooot.",
  "Thhhbbbbpppp~",
  "FFFFFFFFFFFFFRRRRRRT!!!",
  "*squeak*",
  "ppppfffft...",
  "BLAAAAART!",
  "phhhhrrrrpt-pt-pt",
  "(silent but deadly)",
  "Tooooooot!",
  "BRAP BRAP BRAP",
  "fwip.",
  "PPPPPPPPPPHHHHHHHT!",
  "...bloop?",
];

const ASCII_FART = String.raw`
       _.--""--._
     .'  _.--._  '.
    /  .'      '.  \   ~~ p f f f t ~~
   |  |  >  <   |  |
   |  |   __    |  |    ~ b r r r a p ~
    \  '.____.'  /
     '._      _.'
        ''--''
`;

const Index = () => {
  const [lines, setLines] = useState<string[]>([
    "GAS-DOS v0.420  (c) 1987 Methane Industries",
    "Loading flatulence drivers...... OK",
    "Calibrating cheek sensors....... OK",
    'Type "fart" and press ENTER. Or just hit ENTER. We are not picky.',
    "",
  ]);
  const [input, setInput] = useState("");
  const [count, setCount] = useState(0);
  const [muted, setMuted] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const mutedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    bootScrollRef.current?.scrollTo({ top: bootScrollRef.current.scrollHeight });
  }, [bootLines]);

  // Boot sequence
  useEffect(() => {
    const steps = [
      "FARTR BIOS v0.420",
      "(c) 1987 Methane Industries",
      "",
      "Detecting colon..................... OK",
      "Loading flatulence drivers.......... OK",
      "Calibrating cheek sensors........... OK",
      "Mounting /dev/butt.................. OK",
      "Pressurizing methane chambers....... OK",
      "Initializing GAS-DOS kernel......... OK",
      "",
      "READY.",
      "Launching terminal...",
    ];
    let i = 0;
    const id = setInterval(() => {
      setBootLines((prev) => [...prev, steps[i]]);
      i++;
      if (i >= steps.length) {
        clearInterval(id);
        setTimeout(() => setBooting(false), 600);
      }
    }, 220);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (booting) return;
    const i = setInterval(() => {
      rip();
    }, 2200);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting]);


  const analyserRef = useRef<AnalyserNode | null>(null);

  const getCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
      }
    }
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playFartSound = () => {
    if (mutedRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const dest = analyserRef.current ?? ctx.destination;
    const now = ctx.currentTime;
    const duration = 0.18 + Math.random() * 0.55;

    // Noise buffer for the "brap" texture
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const wobble = Math.sign(Math.sin(i * (0.04 + Math.random() * 0.05)));
      data[i] = (Math.random() * 2 - 1) * 0.6 + wobble * 0.4;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.playbackRate.value = 0.5 + Math.random() * 0.8;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400 + Math.random() * 600, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + duration);
    lp.Q.value = 6;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const baseFreq = 70 + Math.random() * 90;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(lp);
    lp.connect(gain);
    osc.connect(gain);
    gain.connect(dest);

    noise.start(now);
    osc.start(now);
    noise.stop(now + duration);
    osc.stop(now + duration);
  };

  const rip = (label?: string) => {
    const fart = FARTS[Math.floor(Math.random() * FARTS.length)];
    setCount((c) => c + 1);
    playFartSound();
    setLines((prev) => [
      ...prev,
      label ? `> ${label}` : "> [auto]",
      fart,
      ...(Math.random() < 0.18 ? [ASCII_FART] : []),
      "",
    ]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim().toLowerCase();
    if (cmd === "clear" || cmd === "cls") {
      setLines([""]);
    } else if (cmd === "help") {
      setLines((p) => [...p, "> help", "commands: fart, rip, brap, clear, help, count, mute, unmute", ""]);
    } else if (cmd === "count") {
      setLines((p) => [...p, "> count", `Total emissions: ${count}`, ""]);
    } else if (cmd === "mute") {
      setMuted(true);
      setLines((p) => [...p, "> mute", "Audio muted. The farts continue silently.", ""]);
    } else if (cmd === "unmute") {
      setMuted(false);
      getCtx();
      setLines((p) => [...p, "> unmute", "Audio unmuted. Brace yourself.", ""]);
    } else {
      getCtx();
      rip(cmd || "fart");
    }
    setInput("");
  };

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8 terminal-font"
      style={{ background: "hsl(var(--terminal-bg))" }}
      onClick={() => {
        getCtx();
        inputRef.current?.focus();
      }}
    >
      <div
        className="relative w-full max-w-4xl h-[80vh] rounded-lg overflow-hidden scanlines crt-flicker shadow-2xl"
        style={{
          background:
            "radial-gradient(ellipse at center, hsl(var(--terminal-bg)) 0%, hsl(120 40% 2%) 100%)",
          boxShadow:
            "0 0 60px hsl(var(--terminal-glow) / 0.25), inset 0 0 120px hsl(0 0% 0% / 0.7)",
          border: "1px solid hsl(var(--terminal-dim) / 0.5)",
        }}
      >
        {booting && (
          <div
            ref={bootScrollRef}
            className="absolute inset-0 z-20 overflow-y-auto px-4 py-6 text-base sm:text-lg leading-snug whitespace-pre-wrap"
            style={{
              color: "hsl(var(--terminal-fg))",
              background:
                "radial-gradient(ellipse at center, hsl(var(--terminal-bg)) 0%, hsl(120 40% 2%) 100%)",
            }}
          >
            <pre className="terminal-glow text-xs sm:text-sm mb-4 leading-tight">{`
 ███████╗ █████╗ ██████╗ ████████╗██████╗
 ██╔════╝██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗
 █████╗  ███████║██████╔╝   ██║   ██████╔╝
 ██╔══╝  ██╔══██║██╔══██╗   ██║   ██╔══██╗
 ██║     ██║  ██║██║  ██║   ██║   ██║  ██║
 ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
`}</pre>
            {bootLines.map((l, i) => (
              <div key={i} className="terminal-glow">
                {l || "\u00A0"}
              </div>
            ))}
            <span className="cursor-blink terminal-glow">█</span>
          </div>
        )}

        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-2 text-sm border-b"
          style={{
            color: "hsl(var(--terminal-fg))",
            borderColor: "hsl(var(--terminal-dim) / 0.4)",
            background: "hsl(120 50% 6%)",
          }}
        >
          <span className="terminal-glow">FART-TERMINAL ~ /dev/butt</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                getCtx();
                setMuted((m) => !m);
                inputRef.current?.focus();
              }}
              className="terminal-glow opacity-80 hover:opacity-100 transition-opacity"
              aria-label={muted ? "unmute audio" : "mute audio"}
            >
              [{muted ? "SOUND: OFF" : "SOUND: ON"}]
            </button>
            <span className="terminal-glow opacity-70">CA: Pending… | emissions: {count}</span>
          </div>
        </div>

        {/* Output */}
        <div
          ref={scrollRef}
          className="h-[calc(100%-7rem)] overflow-y-auto px-4 py-3 text-lg sm:text-xl leading-snug whitespace-pre-wrap relative z-[1]"
          style={{ color: "hsl(var(--terminal-fg))" }}
        >
          {lines.map((l, i) => (
            <div key={i} className="terminal-glow">
              {l || "\u00A0"}
            </div>
          ))}
        </div>

        {/* Prompt */}
        <form
          onSubmit={handleSubmit}
          className="absolute bottom-8 left-0 right-0 flex items-center gap-2 px-4 py-3 border-t text-lg sm:text-xl"
          style={{
            color: "hsl(var(--terminal-fg))",
            borderColor: "hsl(var(--terminal-dim) / 0.4)",
            background: "hsl(120 50% 5%)",
          }}
        >
          <span className="terminal-glow">C:\BUTT&gt;</span>
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent outline-none terminal-glow terminal-font"
            style={{ color: "hsl(var(--terminal-fg))", caretColor: "hsl(var(--terminal-glow))" }}
            placeholder="fart"
            aria-label="terminal input"
          />
          <span className="cursor-blink terminal-glow">█</span>
        </form>

        {/* Social Links */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 px-4 py-2 text-sm"
          style={{
            color: "hsl(var(--terminal-dim))",
            background: "hsl(120 50% 4%)",
            borderTop: "1px solid hsl(var(--terminal-dim) / 0.3)",
          }}
        >
          <a
            href="https://x.com/fartrcoin"
            target="_blank"
            rel="noopener noreferrer"
            className="terminal-glow hover:opacity-80 transition-opacity"
            style={{ color: "hsl(var(--terminal-fg))" }}
          >
            [X/Twitter]
          </a>
          <span style={{ color: "hsl(var(--terminal-dim))" }}>|</span>
          <span className="terminal-glow" style={{ color: "hsl(var(--terminal-dim))" }}>
            CA: Pending…
          </span>
        </div>
      </div>
    </main>
  );
};

export default Index;
