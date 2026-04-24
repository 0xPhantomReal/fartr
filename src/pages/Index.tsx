import { useEffect, useRef, useState } from "react";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    const i = setInterval(() => {
      rip();
    }, 2200);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rip = (label?: string) => {
    const fart = FARTS[Math.floor(Math.random() * FARTS.length)];
    setCount((c) => c + 1);
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
      setLines((p) => [...p, "> help", "commands: fart, rip, brap, clear, help, count", ""]);
    } else if (cmd === "count") {
      setLines((p) => [...p, "> count", `Total emissions: ${count}`, ""]);
    } else {
      rip(cmd || "fart");
    }
    setInput("");
  };

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8 terminal-font"
      style={{ background: "hsl(var(--terminal-bg))" }}
      onClick={() => inputRef.current?.focus()}
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
          <span className="terminal-glow opacity-70">CA: Pending… | emissions: {count}</span>
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
          className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-4 py-3 border-t text-lg sm:text-xl"
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
      </div>
    </main>
  );
};

export default Index;
