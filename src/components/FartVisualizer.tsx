import { useEffect, useRef } from "react";

interface FartVisualizerProps {
  analyser: AnalyserNode | null;
  active: boolean;
}

/**
 * Canvas-based frequency-bar visualizer fed by a Web Audio AnalyserNode.
 * When idle, renders a gentle ambient idle wave so it never looks "dead".
 */
const FartVisualizer = ({ analyser, active }: FartVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const bars = 32;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let t = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      // Background fade for trail effect
      ctx2d.fillStyle = "hsla(120, 50%, 4%, 0.35)";
      ctx2d.fillRect(0, 0, w, h);

      let values: number[] = [];
      if (analyser && data && active) {
        analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / bars);
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += data[i * step + j];
          values.push(sum / step / 255);
        }
      } else {
        // Idle ambient wave
        t += 0.05;
        for (let i = 0; i < bars; i++) {
          const v =
            0.08 +
            0.06 * Math.sin(t + i * 0.4) +
            0.04 * Math.sin(t * 1.7 + i * 0.2);
          values.push(Math.max(0.02, v));
        }
      }

      const gap = 2;
      const barW = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        const v = values[i];
        const barH = Math.max(2, v * h * 0.95);
        const x = i * (barW + gap);
        const y = h - barH;

        // Glow
        ctx2d.shadowColor = "hsl(120, 100%, 50%)";
        ctx2d.shadowBlur = 8;
        ctx2d.fillStyle = `hsl(120, 100%, ${35 + v * 35}%)`;
        ctx2d.fillRect(x, y, barW, barH);
        ctx2d.shadowBlur = 0;

        // Bright cap
        ctx2d.fillStyle = "hsl(120, 100%, 75%)";
        ctx2d.fillRect(x, y, barW, 2);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [analyser, active]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      aria-hidden="true"
    />
  );
};

export default FartVisualizer;
