import { useEffect, useRef, useState } from "react";
import { Bike, Skull, Copy, Check, Send, Twitter, Send as Tg, Flame, Rocket, Ear } from "lucide-react";

/* ============================ palette (self-contained boxing-degen) ============================ */
const C = {
  bg: "#0a0a08",
  panel: "#15140f",
  panel2: "#1c1a12",
  border: "#2a2718",
  text: "#f6f4ea",
  muted: "#8f897a",
  gold: "#ffcb1e",
  green: "#38ff9d",
  red: "#ff3b3b",
  blue: "#43b7ff",
};
const glow = (c: string, s = 20) => ({ boxShadow: `0 0 ${s}px ${c}44, 0 0 ${s * 2}px ${c}22` });
const tglow = (c: string, s = 14) => ({ textShadow: `0 0 ${s}px ${c}cc` });
const CA = "BiKE7yoNmikEeAtsYoUrEaR4Wh33Lz0nSol4nApump";

/* ============================ Bike Tyson's brain (lisp, memeable, degen) ============================ */
const LINES: Record<string, string[]> = {
  hi: [
    "Thup. I'm Bike Tython. Mind the thpoketh.",
    "Ayy. You talkin' to the baddeth man on two wheelth. *revth pedalth*",
    "Hello thweetheart. Wanna go for a ride? Hop on the pegth.",
  ],
  who: [
    "I'm Bike Tython. Iron Mike, but they welded me to a Huffy. Now I'm unthtoppable, baby.",
    "Thome men got legth. I got a drivetrain and a bad attitude.",
    "Handth of a champion. Wheelth of a BMX. Do the math, thucker.",
  ],
  fight: [
    "Everybody got a plan till I pedal into their fathe.",
    "I'll hit you tho hard your CHAIN fallth off.",
    "My thtyle ith impetuouth, my defenthe ith impregnable, and my braketh are BROKEN.",
    "I'll knock you into next Tuethday then bunny-hop over the body. Ferothiouth.",
  ],
  ear: [
    "Don't tempt me. I'll bite your ear AND your bike bell.",
    "Holyfield thtill lookin' for hith ear. I keep it in the thaddlebag with my thnackth.",
    "You got two earth? One for me, one for later. Ath a treat.",
  ],
  bike: [
    "Wheelth don't lie, playboy. I do 40 in a thchool zone.",
    "Flat tire? I'll run on the RIMTH outta pure thpite.",
    "*pullth a wheelie* Thith ith my meditation. Namathte, thucker.",
    "Carbon fiber legth. Titanium temper. One thpeed: ferothiouth.",
  ],
  crypto: [
    "$BIKE goin' to the moon and I'm pedalin' it there mythelf.",
    "Diamond handth? I got diamond HANDLEBARTH. HODL or get run over.",
    "Wen moon? When I THAY tho. Buy the dip or I bite the dip.",
    "You didn't ape into $BIKE? Weak. Ath weak ath a training wheel.",
    "Number go up 'cauthe I told it to. Ferothiouthly.",
  ],
  fart: [
    "Fartr? That thite wath GATH. Now we pedal. But I'll thtill clear a room.",
    "The old branding wath a lil' thtinky. I'm here to blow you away DIFFERENTLY.",
  ],
  love: [
    "Awww. You'th thweet. I won't eat your ear TODAY.",
    "Baithed. Get on the pegth, we ridin' into the thunthet.",
  ],
  rude: [
    "Talk to me like that again and I'll DEFLATE you, thmall fry.",
    "You got the thpine of a wet noodle and the wheelth of a thoppin' cart.",
    "I've thparred with tougher TRAINING WHEELTH.",
  ],
  bye: ["Thmell you later, playboy. Keep it greathy-thide down.", "Pedal thafe. Or don't. I don't care, I'm ferothiouth."],
  default: [
    "Thpeak up, I got my helmet on.",
    "That'th cute. Now go buy $BIKE.",
    "Everybody got a plan till they hear the thpoketh clickin'.",
    "I don't fully underthtand but I rethpect the energy. Pedal on.",
    "Hmm. *chewth on a handlebar* Thay more.",
  ],
};
const KW: [string, RegExp][] = [
  ["bye", /\b(bye|later|cya|gtg|leave|goodbye)\b/],
  ["who", /\b(who|what).{0,12}(you|ur|are|is bike)|your name|about you|bike tyson\b/],
  ["fight", /\b(fight|box|punch|hit|knock|beat|scared|smoke|beef|jab|spar|tough)\b/],
  ["ear", /\b(ear|bite|eat|chew|holyfield)\b/],
  ["bike", /\b(bike|wheel|pedal|ride|spoke|chain|tire|cycl|wheelie|handlebar)\b/],
  ["crypto", /\b(buy|moon|pump|token|coin|\$bike|crypto|price|chart|rug|ape|wen|when|invest|hodl|dip|market|ca\b|contract)\b/],
  ["fart", /\b(fart|fartr|stink|smell|gas|poot)\b/],
  ["love", /\b(love|nice|cute|good|cool|based|goat|legend|king|respect|lol|lmao|haha)\b/],
  ["rude", /\b(idiot|dumb|stupid|hate|trash|suck|weak|loser|ugly|shut up)\b/],
  ["hi", /\b(hi|hey|yo|sup|hello|wassup|whatup|gm)\b/],
];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
function bikeSays(input: string): string {
  const s = input.toLowerCase();
  for (const [k, re] of KW) if (re.test(s)) return pick(LINES[k]);
  return pick(LINES.default);
}

type Msg = { who: "you" | "bike"; text: string };

function Index() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { who: "bike", text: "Thup. I'm Bike Tython. Athk me anything — but watch your earth. What'th on your mind, playboy?" },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const [price, setPrice] = useState(0.000428);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, typing]);
  useEffect(() => { const t = setInterval(() => setPrice((p) => Math.max(0.00001, p * (1 + (Math.random() - 0.35) * 0.06))), 1400); return () => clearInterval(t); }, []);

  const send = (t?: string) => {
    const text = (t ?? input).trim();
    if (!text) return;
    setMsgs((m) => [...m, { who: "you", text }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setMsgs((m) => [...m, { who: "bike", text: bikeSays(text) }]);
      setTyping(false);
    }, 650 + Math.random() * 700);
  };
  const copyCA = () => { navigator.clipboard?.writeText(CA).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }} className="relative overflow-hidden">
      <style>{`
        @keyframes wobble { 0%,100%{transform:rotate(-2deg)} 50%{transform:rotate(2deg)} }
        @keyframes rollx { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes pop { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:none} }
        .wobble{ animation: wobble 2.4s ease-in-out infinite }
        .marq{ display:flex; width:max-content; animation: rollx 26s linear infinite }
        .pop{ animation: pop .2s ease-out }
        .dot{ animation: blink 1s infinite }
        .dot:nth-child(2){ animation-delay:.2s } .dot:nth-child(3){ animation-delay:.4s }
      `}</style>

      {/* grungy bg */}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: `radial-gradient(circle at 50% -10%, ${C.gold}18, transparent 55%)` }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: `repeating-linear-gradient(45deg, ${C.text} 0 2px, transparent 2px 18px)` }} />

      {/* nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.red})`, ...glow(C.gold, 12) }}>
            <Bike className="h-5 w-5" style={{ color: "#180f00" }} />
          </div>
          <span className="text-xl font-black tracking-tight" style={tglow(C.gold)}>BIKE&nbsp;TYTHON</span>
          <span className="ml-2 hidden rounded px-1.5 py-0.5 text-[10px] font-black sm:inline" style={{ background: C.green + "22", color: C.green }}>$BIKE</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-xs sm:flex" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <span style={{ color: C.muted }}>$BIKE</span><span className="font-bold" style={{ color: C.green }}>${price.toFixed(6)}</span>
          </div>
          <a href="#buy" className="rounded-lg px-3 py-2 text-sm font-black transition-transform active:scale-95" style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.red})`, color: "#180f00", ...glow(C.gold, 10) }}>BUY $BIKE</a>
        </div>
      </header>

      {/* ticker */}
      <div className="relative z-10 border-y py-2" style={{ borderColor: C.border, background: C.panel }}>
        <div className="marq gap-8 px-4 text-xs font-bold" style={{ color: C.muted }}>
          {[...Array(2)].map((_, k) => (
            <div key={k} className="flex gap-8 whitespace-nowrap">
              <span>🚴 THE BADDETH MAN ON TWO WHEELTH</span>
              <span style={{ color: C.gold }}>👂 I'LL BITE YOUR EAR AND YOUR BIKE BELL</span>
              <span style={{ color: C.green }}>💎 DIAMOND HANDLEBARTH · HODL $BIKE</span>
              <span style={{ color: C.red }}>🥊 FEROTHIOUTH · IMPREGNABLE · FULLY THUTHPENDED</span>
              <span>🌕 WEN MOON? WHEN I THAY THO</span>
            </div>
          ))}
        </div>
      </div>

      {/* hero + chat */}
      <main className="relative z-10 mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          {/* hero / character */}
          <section className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="wobble relative mb-4 w-full max-w-[340px]">
              <div className="aspect-square w-full overflow-hidden rounded-3xl" style={{ background: `linear-gradient(160deg, ${C.panel2}, ${C.panel})`, border: `2px solid ${C.gold}55`, ...glow(C.gold, 14) }}>
                {imgOk ? (
                  <img src="/bike-tyson.jpg" alt="Bike Tyson" className="h-full w-full object-cover" onError={() => setImgOk(false)} />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                    <div className="text-[92px] leading-none">🚴‍♂️🥊</div>
                    <div className="px-4 text-xs" style={{ color: C.muted }}>drop <code style={{ color: C.gold }}>bike-tyson.png</code> in <code>/public</code> and I show up here</div>
                  </div>
                )}
              </div>
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-black" style={{ background: C.red, color: "#fff", ...glow(C.red, 10) }}>👂 100% EAR-FREE GUARANTEE*</div>
            </div>
            <h1 className="text-4xl font-black leading-none sm:text-5xl" style={tglow(C.gold, 18)}>BIKE&nbsp;TYTHON</h1>
            <p className="mt-3 text-sm" style={{ color: C.muted }}>
              Mike Tython. But hith body ith on a bike. And he hath wheelth. He'th ferothiouth, he'th on-chain, and he WILL pedal through your thkull. Athk him thomething. If you dare.
            </p>
            <div className="mt-4 flex gap-2">
              <a href="#" className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: C.panel, border: `1px solid ${C.border}` }}><Twitter className="h-4 w-4" style={{ color: C.blue }} /></a>
              <a href="#" className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: C.panel, border: `1px solid ${C.border}` }}><Tg className="h-4 w-4" style={{ color: C.blue }} /></a>
              <a href="#buy" className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: C.panel, border: `1px solid ${C.border}` }}><Rocket className="h-4 w-4" style={{ color: C.green }} /></a>
            </div>
          </section>

          {/* CHAT */}
          <section className="flex flex-col rounded-2xl" style={{ background: C.panel, border: `1px solid ${C.border}`, height: "min(72vh, 640px)" }}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: C.border }}>
              <div className="grid h-8 w-8 place-items-center rounded-full text-lg" style={{ background: C.panel2, border: `1px solid ${C.gold}55` }}>🚴</div>
              <div>
                <div className="text-sm font-black">Bike Tython</div>
                <div className="flex items-center gap-1 text-[11px]" style={{ color: C.green }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: C.green }} /> online · ferothiouth</div>
              </div>
              <span className="ml-auto flex items-center gap-1 text-[11px]" style={{ color: C.muted }}><Skull className="h-3.5 w-3.5" /> AI agent (allegedly)</span>
            </div>

            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
              {msgs.map((m, i) => (
                <div key={i} className={`pop flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
                  {m.who === "bike" && <div className="mr-2 grid h-8 w-8 shrink-0 place-items-center self-end rounded-full text-base" style={{ background: C.panel2, border: `1px solid ${C.gold}55` }}>🚴</div>}
                  <div className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug" style={m.who === "you"
                    ? { background: `linear-gradient(135deg, ${C.gold}, ${C.red})`, color: "#180f00", fontWeight: 600, borderBottomRightRadius: 4 }
                    : { background: C.panel2, border: `1px solid ${C.border}`, borderBottomLeftRadius: 4 }}>
                    {m.text}
                  </div>
                </div>
              ))}
              {typing && (
                <div className="flex justify-start">
                  <div className="mr-2 grid h-8 w-8 shrink-0 place-items-center self-end rounded-full text-base" style={{ background: C.panel2, border: `1px solid ${C.gold}55` }}>🚴</div>
                  <div className="rounded-2xl px-4 py-3" style={{ background: C.panel2, border: `1px solid ${C.border}` }}>
                    <div className="flex gap-1">{[0, 1, 2].map((d) => <span key={d} className="dot h-1.5 w-1.5 rounded-full" style={{ background: C.muted }} />)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* quick prompts */}
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {["who are you?", "fight me", "wen moon?", "your ear tho", "$BIKE?"].map((q) => (
                <button key={q} onClick={() => send(q)} className="rounded-full px-2.5 py-1 text-xs font-semibold transition-colors" style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.muted }}>{q}</button>
              ))}
            </div>

            <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: C.border }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Thay thomething to Bike Tython…"
                className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}
              />
              <button onClick={() => send()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform active:scale-90" style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.red})`, ...glow(C.gold, 8) }}>
                <Send className="h-4 w-4" style={{ color: "#180f00" }} />
              </button>
            </div>
          </section>
        </div>

        {/* ===== $BIKE / degen ===== */}
        <section id="buy" className="mt-8 rounded-2xl p-5" style={{ background: `linear-gradient(160deg, ${C.green}0d, ${C.panel})`, border: `1px solid ${C.green}44`, ...glow(C.green, 6) }}>
          <div className="mb-4 flex items-center gap-2 text-lg font-black"><Flame className="h-5 w-5" style={{ color: C.green }} /> $BIKE — the officialeth token of Bike Tython</div>
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-1 text-xs" style={{ color: C.muted }}>CONTRACT ADDRETH (thend it or he findth you)</div>
              <button onClick={copyCA} className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left font-mono text-xs" style={{ background: C.panel2, border: `1px solid ${C.border}` }}>
                <span className="truncate" style={{ color: C.gold }}>{CA}</span>
                {copied ? <Check className="h-4 w-4 shrink-0" style={{ color: C.green }} /> : <Copy className="h-4 w-4 shrink-0" style={{ color: C.muted }} />}
              </button>
              <div className="flex flex-wrap gap-2">
                {["Buy on pump.fun", "Uniswap", "DexThcreener"].map((b) => (
                  <a key={b} href="#" className="rounded-xl px-4 py-2.5 text-sm font-black transition-transform active:scale-95" style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.red})`, color: "#180f00", ...glow(C.gold, 8) }}>{b} →</a>
                ))}
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ background: C.panel2, border: `1px solid ${C.border}` }}>
              <div className="mb-2 text-xs font-black" style={{ color: C.muted }}>TOKENOMICTH</div>
              {[["Thupply", "1,000,000,000 $BIKE"], ["Tax", "0% (he'th too fatht to tax)"], ["Team allocation", "1 (one) ear"], ["Utility", "he pedalth. number go up."], ["Roadmap", "wheelie → moon → your neighborhood"]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-t py-1.5 text-xs" style={{ borderColor: C.border }}>
                  <span style={{ color: C.muted }}>{k}</span><span className="font-mono font-bold" style={{ color: C.text }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* lore */}
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { i: <Bike className="h-5 w-5" />, t: "The Athident", d: "One day Iron Mike leaned into a turn too hard. The doctorth couldn't thave the legth. Tho they gave him wheelth. He hath never been faether — or angrier." },
            { i: <Ear className="h-5 w-5" />, t: "The Diet", d: "Bike Tython runth entirely on rage, protein, and the occathional ear. Do NOT offer him a helmet. He'll bite it." },
            { i: <Rocket className="h-5 w-5" />, t: "The Mithion", d: "Pedal $BIKE to the moon. Bite the nay-thayerth. Do a thick wheelie the entire way there. WAGMI, playboy." },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg" style={{ background: C.panel2, color: C.gold }}>{c.i}</div>
              <div className="mb-1 font-black">{c.t}</div>
              <p className="text-sm" style={{ color: C.muted }}>{c.d}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative z-10 mt-8 border-t px-4 py-8 text-center" style={{ borderColor: C.border }}>
        <div className="flex items-center justify-center gap-2 font-black"><Bike className="h-4 w-4" style={{ color: C.gold }} /> BIKE&nbsp;TYTHON</div>
        <p className="mx-auto mt-3 max-w-2xl text-[10px]" style={{ color: C.muted }}>
          Parody. For the memeth. Bike Tython ith a fithtional cartoon man welded to a bithycle and ith not affiliated with any real perthon, athlete, or bike. $BIKE ith a joke token with no value, no team, and no earth. Nothing here ith financial advithe. *Ear-free guarantee not guaranteed. 🚴‍♂️
        </p>
      </footer>
    </div>
  );
}

export default Index;
