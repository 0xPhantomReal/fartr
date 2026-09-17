import { useState } from "react";
import { Twitter, Send, Eye } from "lucide-react";

/* ---- palette: detective corkboard ---- */
const C = {
  cork: "#b07e4e", cork2: "#9a6a3c", paper: "#f4ecd6", note: "#f6e05e",
  ink: "#2a2016", red: "#c62f27", redHot: "#ff3b2f", tape: "#d9cf9e",
};
const CAT = "/catspiracy-cat.png";
const PHRASES = ["THE CAT KNOWS.", "WAKE UP.", "IT WAS NEVER JUST A NAP.", "THE RED DOT IS A LIE.", "3AM ZOOMIES = COORDINATES.", "TRUST NO WHISKER.", "THEY SEE YOU BLINK."];

/* pinned evidence scattered around the edges (center stays clear for the SUSPECT) */
const EV: { t: "note" | "clip" | "photo" | "stamp" | "doc"; x: string; y: string; r: number; h?: string; b?: string }[] = [
  { t: "note", x: "3%", y: "16%", r: -6, b: "who moved my food bowl at 3AM??" },
  { t: "clip", x: "2%", y: "50%", r: 4, h: "LOCAL CAT", b: "'just happened' to sit on the keyboard DURING the wire transfer" },
  { t: "photo", x: "6%", y: "76%", r: -8, h: "SUSPECT · DAY 4", b: "🐈" },
  { t: "stamp", x: "16%", y: "6%", r: -12, b: "TOP SECRET" },
  { t: "note", x: "80%", y: "12%", r: 7, b: "16h of sleep = they're LULLING us" },
  { t: "doc", x: "78%", y: "40%", r: -4, h: "FIELD REPORT", b: "subject stared at empty wall 40 min. wall was empty. OR WAS IT." },
  { t: "photo", x: "83%", y: "70%", r: 9, h: "EVIDENCE #7", b: "[REDACTED]" },
  { t: "stamp", x: "70%", y: "82%", r: 8, b: "CLASSIFIED" },
  { t: "note", x: "40%", y: "4%", r: -3, b: "the red dot is GOVERNMENT" },
];

function Index() {
  const [flash, setFlash] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const [glitch, setGlitch] = useState(false);
  const poke = () => { setFlash(PHRASES[Math.floor(Math.random() * PHRASES.length)]); setGlitch(true); setTimeout(() => setGlitch(false), 320); setTimeout(() => setFlash(null), 1400); };

  return (
    <div id="board">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Special+Elite&family=Anton&display=swap');
        html,body,#root{ height:100%; margin:0; overflow:hidden; }
        #board{ position:fixed; inset:0; overflow:hidden; font-family:'Special Elite',ui-monospace,monospace; color:${C.ink};
          background:
            radial-gradient(circle at 30% 20%, #00000018 0 2px, transparent 3px),
            radial-gradient(circle at 70% 60%, #00000014 0 2px, transparent 3px),
            radial-gradient(120% 90% at 50% 0%, ${C.cork} 0%, ${C.cork2} 70%, #7d5730 100%);
          background-size:22px 22px, 30px 30px, 100% 100%; }
        #board:before{ content:""; position:absolute; inset:0; pointer-events:none; opacity:.06;
          background:repeating-linear-gradient(0deg,#000 0 1px,transparent 1px 3px); }
        .vign{ position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 220px #000a; }

        .pin{ position:absolute; width:14px; height:14px; border-radius:50%; background:radial-gradient(circle at 35% 30%, #ff8a80, ${C.red} 60%, #6b120d); box-shadow:0 2px 4px #0007; top:-7px; left:50%; transform:translateX(-50%); z-index:2; }
        .ev{ position:absolute; z-index:2; transform-origin:top center; filter:drop-shadow(0 8px 10px #0006); max-width:190px; }
        .ev .card{ position:relative; padding:10px 12px; font-size:12px; line-height:1.25; }
        .note .card{ background:${C.note}; color:#3a2f10; box-shadow:0 1px 0 #0002; }
        .clip .card,.doc .card,.photo .card{ background:${C.paper}; }
        .clip h4,.doc h4,.photo h4{ margin:0 0 4px; font-family:'Anton',sans-serif; letter-spacing:.5px; font-weight:400; }
        .clip .card{ border:1px solid #0002; }
        .photo .card{ text-align:center; padding:8px 8px 20px; }
        .photo .pic{ height:70px; display:grid; place-items:center; font-size:40px; background:#dcd2b6; margin-bottom:6px; color:#6b5a34; }
        .stamp{ position:absolute; z-index:3; font-family:'Anton',sans-serif; font-size:20px; letter-spacing:2px; color:${C.red}; border:3px solid ${C.red}; padding:2px 8px; opacity:.82; border-radius:4px; text-shadow:1px 1px 0 #0002; }
        .tape{ position:absolute; top:-9px; left:50%; transform:translateX(-50%) rotate(-3deg); width:52px; height:16px; background:${C.tape}; opacity:.75; }

        /* title */
        .hdr{ position:absolute; top:2.5vh; left:50%; transform:translateX(-50%); text-align:center; z-index:6; width:96%; }
        .hdr h1{ font-family:'Anton',sans-serif; font-weight:400; font-size:clamp(40px,10vw,104px); letter-spacing:3px; margin:0; color:${C.paper};
          text-shadow:0 0 2px #000, 4px 4px 0 ${C.red}, 6px 6px 0 #000; }
        .hdr .sub{ margin-top:2px; font-size:clamp(11px,2.2vw,15px); color:#ffe9c2; letter-spacing:2px; }
        .hdr .tag{ margin-top:4px; color:${C.redHot}; font-size:clamp(12px,2.4vw,17px); text-shadow:1px 1px 0 #000; }

        /* the SUSPECT (rises from bottom-middle to center, enlarged) */
        .catwrap{ position:absolute; left:50%; top:52%; z-index:5; cursor:pointer; animation:rise 1.7s cubic-bezier(.18,.85,.25,1) forwards; }
        @keyframes rise{ 0%{ transform:translate(-50%, calc(-50% + 64vh)) scale(1.16); opacity:0 } 22%{ opacity:1 } 100%{ transform:translate(-50%,-50%) scale(1); opacity:1 } }
        .cat{ height:min(60vh,540px); width:auto; display:block; animation:bob 3.8s ease-in-out 1.7s infinite; filter:drop-shadow(0 20px 30px #000b); }
        .cat.emoji{ font-size:min(48vh,420px); line-height:1; }
        @keyframes bob{ 0%,100%{ transform:translateY(0) rotate(0) } 50%{ transform:translateY(-12px) rotate(-1deg) } }
        .glow{ position:absolute; left:50%; bottom:-4vh; transform:translateX(-50%); width:70%; height:24px; background:radial-gradient(ellipse, #000 0%, transparent 70%); opacity:.5; }
        .glitch{ animation:gl .3s steps(2) 2; }
        @keyframes gl{ 0%{ filter:hue-rotate(0) } 50%{ transform:translate(-50%,-50%) translateX(6px); filter:hue-rotate(40deg) contrast(1.4) } 100%{} }

        /* suspect markings */
        .ring{ position:absolute; left:50%; top:34%; transform:translate(-50%,-50%); width:min(34vh,300px); height:min(34vh,300px); border:4px dashed ${C.redHot}; border-radius:50%; z-index:4; pointer-events:none; opacity:.9; animation:spin 22s linear infinite; }
        @keyframes spin{ to{ transform:translate(-50%,-50%) rotate(360deg) } }
        .suspect{ position:absolute; left:calc(50% + min(20vh,180px)); top:20%; z-index:6; color:${C.paper}; background:${C.red}; font-family:'Anton',sans-serif; padding:3px 10px; transform:rotate(6deg); box-shadow:3px 3px 0 #0007; letter-spacing:1px; }
        .arrow{ position:absolute; z-index:5; color:${C.redHot}; font-size:34px; font-family:'Anton',sans-serif; text-shadow:2px 2px 0 #000; }

        .flash{ position:absolute; left:50%; top:44%; transform:translate(-50%,-50%) rotate(-4deg); z-index:9; font-family:'Anton',sans-serif; font-size:clamp(28px,6vw,64px); color:${C.redHot}; text-shadow:0 0 18px ${C.red}, 3px 3px 0 #000; pointer-events:none; animation:pop .2s steps(3); }
        @keyframes pop{ from{ opacity:0; transform:translate(-50%,-50%) rotate(-4deg) scale(.6) } to{} }

        .rec{ position:absolute; top:14px; right:16px; z-index:7; font-size:13px; color:${C.redHot}; letter-spacing:1px; }
        .rec b{ display:inline-block; width:9px; height:9px; border-radius:50%; background:${C.redHot}; margin-right:6px; animation:blink 1s steps(1) infinite; }
        @keyframes blink{ 50%{ opacity:.2 } }

        /* bottom bar */
        .bar{ position:absolute; bottom:0; left:0; right:0; z-index:7; display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:wrap; padding:8px 12px;
          background:linear-gradient(0deg,#00000066,transparent); }
        .bar .tk{ font-size:12px; color:#ffe9c2; }
        .bar .tk b{ color:${C.redHot}; }
        .btn{ font-family:'Anton',sans-serif; letter-spacing:1px; border:none; cursor:pointer; padding:9px 16px; border-radius:6px; background:${C.red}; color:${C.paper}; box-shadow:0 4px 0 #0007; transition:transform .08s; }
        .btn:active{ transform:translateY(3px); box-shadow:0 1px 0 #0007; }
        .ic{ display:grid; place-items:center; width:36px; height:36px; border-radius:8px; background:#00000055; color:#ffe9c2; border:1px solid #ffffff22; }
      `}</style>

      <div className="rec"><b/>REC · SURVEILLANCE ACTIVE</div>

      {/* red string connecting the evidence */}
      <svg style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }} width="100%" height="100%" preserveAspectRatio="none">
        {[["8%", "22%", "42%", "10%"], ["42%", "10%", "84%", "18%"], ["8%", "55%", "50%", "50%"], ["50%", "50%", "86%", "46%"], ["12%", "80%", "50%", "50%"], ["50%", "50%", "74%", "86%"]].map((l, i) => (
          <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={C.red} strokeWidth="2" opacity="0.75" />
        ))}
      </svg>

      {/* evidence */}
      {EV.map((e, i) => (
        <div key={i} className={"ev " + e.t} style={{ left: e.x, top: e.y, transform: `rotate(${e.r}deg)` }}>
          {e.t === "stamp" ? (
            <div className="stamp">{e.b}</div>
          ) : (
            <div className="card">
              <span className="pin" />
              {e.t === "photo" && <div className="pic">{e.b}</div>}
              {e.h && <h4>{e.h}</h4>}
              {e.t !== "photo" ? <div>{e.b}</div> : <div style={{ fontSize: 11 }}>{e.h}</div>}
            </div>
          )}
        </div>
      ))}

      {/* title */}
      <div className="hdr">
        <h1>CATSPIRACY</h1>
        <div className="sub">// CASE FILE #9 · THE FELINE AGENDA</div>
        <div className="tag">wake up. the cats know. 🔺</div>
      </div>

      {/* suspect markings */}
      <div className="ring" />
      <div className="suspect">SUSPECT&nbsp;#1</div>
      <div className="arrow" style={{ left: "24%", top: "58%", transform: "rotate(-18deg)" }}>➜</div>
      <div className="arrow" style={{ right: "24%", top: "62%", transform: "scaleX(-1) rotate(-16deg)" }}>➜</div>
      {flash && <div className="flash">{flash}</div>}

      {/* the cat */}
      <div className={"catwrap" + (glitch ? " glitch" : "")} onClick={poke} title="do not look directly at the subject">
        {imgOk ? (
          <img className="cat" src={CAT} alt="Catspiracy — the subject" onError={() => setImgOk(false)} />
        ) : (
          <div className="cat emoji" style={{ height: "min(48vh,420px)" }}>🐱</div>
        )}
        <div className="glow" />
      </div>

      {/* bottom bar */}
      <div className="bar">
        <span className="tk">$CATSPIRACY <b>+337%</b></span>
        <button className="btn" onClick={poke}><Eye size={14} style={{ marginBottom: -2, marginRight: 4 }} />JOIN THE INVESTIGATION</button>
        <a className="ic" href="#" aria-label="x"><Twitter size={18} /></a>
        <a className="ic" href="#" aria-label="tg"><Send size={18} /></a>
      </div>

      <div className="vign" />
    </div>
  );
}

export default Index;
