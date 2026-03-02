"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface MobileInputBarProps {
  sendInput: (data: string) => void;
}

const B =
  "flex items-center justify-center rounded-md text-[12px] font-medium select-none active:scale-95 transition-transform touch-manipulation h-9";

/** Wider monospace font with slight letter-spacing */
const _FONT = { fontFamily: "Menlo, 'JetBrains Mono', 'Courier New', monospace", letterSpacing: "0.05em" };

const S: React.CSSProperties = {
  ..._FONT,
  backgroundColor: "oklch(0.20 0.01 260)",
  color: "oklch(0.80 0.005 260)",
  border: "1px solid oklch(0.28 0.01 260)",
};

const S_CTRL: React.CSSProperties = {
  ..._FONT,
  backgroundColor: "oklch(0.25 0.08 270)",
  color: "oklch(0.92 0.04 270)",
  border: "1px solid oklch(0.40 0.12 270)",
};

const S_CANCEL: React.CSSProperties = {
  ..._FONT,
  backgroundColor: "oklch(0.22 0.06 15)",
  color: "oklch(0.85 0.06 15)",
  border: "1px solid oklch(0.35 0.08 15)",
};

// QWERTY rows
const QR1 = "QWERTYUIOP".split("");
const QR2 = "ASDFGHJKL".split("");
const QR3 = "ZXCVBNM".split("");

function useVisualViewportHeight() {
  const [h, setH] = useState(() =>
    typeof window !== "undefined"
      ? window.visualViewport?.height ?? window.innerHeight
      : 800
  );
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const u = () => setH(vv.height);
    vv.addEventListener("resize", u);
    vv.addEventListener("scroll", u);
    return () => {
      vv.removeEventListener("resize", u);
      vv.removeEventListener("scroll", u);
    };
  }, []);
  return h;
}

export function MobileInputBar({ sendInput }: MobileInputBarProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [ctrl, setCtrl] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const vpH = useVisualViewportHeight();

  const handleSend = useCallback(() => {
    const t = promptText.trim();
    if (!t) return;
    sendInput(t + "\r");
    setPromptText("");
    setPromptOpen(false);
  }, [promptText, sendInput]);

  /** Send Ctrl+letter: A=0x01 … Z=0x1A */
  const sendCtrl = useCallback(
    (ch: string) => {
      sendInput(String.fromCharCode(ch.charCodeAt(0) - 64));
      setCtrl(false);
    },
    [sendInput]
  );

  const fire = (data: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    sendInput(data);
  };

  // ── Ctrl-mode: QWERTY keyboard ──
  if (ctrl) {
    const letterBtn = (ch: string) => (
      <button
        key={ch}
        type="button"
        className={`${B} flex-1`}
        style={S_CTRL}
        onPointerDown={(e) => { e.preventDefault(); sendCtrl(ch); }}
      >
        {ch}
      </button>
    );

    return (
      <div
        className="shrink-0 flex flex-col gap-1.5 px-2 py-2"
        style={{
          backgroundColor: "oklch(0.12 0.005 260)",
          borderTop: "1px solid oklch(0.22 0.01 260)",
        }}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="flex gap-1 justify-center">
          {QR1.map(letterBtn)}
        </div>
        <div className="flex gap-1 justify-center px-3">
          {QR2.map(letterBtn)}
        </div>
        <div className="flex gap-1 justify-center px-6">
          {QR3.map(letterBtn)}
          <button
            type="button"
            className={`${B} flex-[1.3]`}
            style={S_CANCEL}
            onPointerDown={(e) => { e.preventDefault(); setCtrl(false); }}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // ── Normal mode: 3-row pad ──
  return (
    <>
      <div
        className="shrink-0 flex flex-col gap-1.5 px-2 py-2"
        style={{
          backgroundColor: "oklch(0.12 0.005 260)",
          borderTop: "1px solid oklch(0.22 0.01 260)",
        }}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Row 1: Esc + navigation */}
        <div className="flex gap-1.5">
          <button type="button" className={`${B} flex-1`} style={S} onPointerDown={fire("\x1b")}>Esc</button>
          <button type="button" className={`${B} flex-1`} style={S} onPointerDown={fire("\x1b[5~")}>PgUp</button>
          <button type="button" className={`${B} flex-1`} style={S} onPointerDown={fire("\x1b[6~")}>PgDn</button>
          <button type="button" className={`${B} flex-1 text-[16px]`} style={S} onPointerDown={fire("\x1b[A")}>↑</button>
          <button type="button" className={`${B} flex-1 text-[16px]`} style={S} onPointerDown={fire("\x1b[B")}>↓</button>
        </div>
        {/* Row 2: Ctrl + symbols + Backspace */}
        <div className="flex gap-1.5">
          <button
            type="button"
            className={`${B} flex-1`}
            style={S}
            onPointerDown={(e) => { e.preventDefault(); setCtrl(true); }}
          >
            Ctrl
          </button>
          <button type="button" className={`${B} flex-1`} style={S} onPointerDown={fire("@")}>@</button>
          <button type="button" className={`${B} flex-1`} style={S} onPointerDown={fire("/")}>/</button>
          <button type="button" className={`${B} flex-1 text-[16px]`} style={S} onPointerDown={fire("\x7f")}>⌫</button>
        </div>
        {/* Row 3: ⌃C + Prompt + Enter */}
        <div className="flex gap-1.5">
          <button type="button" className={`${B} flex-1`} style={S} onPointerDown={fire("\x03")}>⌃C</button>
          <button
            type="button"
            className={`${B} flex-[2]`}
            style={{
              ..._FONT,
              backgroundColor: "oklch(0.22 0.04 180)",
              color: "oklch(0.90 0.04 180)",
              border: "1px solid oklch(0.35 0.06 180)",
            }}
            onClick={() => { setPromptOpen(true); textareaRef.current?.focus(); }}
          >
            ✍️ Prompt
          </button>
          <button type="button" className={`${B} flex-[1.2]`} style={S} onPointerDown={fire("\r")}>Enter</button>
        </div>
      </div>

      {/* ── Prompt overlay ── */}
      <div
        className="fixed left-0 right-0 z-50 flex flex-col"
        style={{
          top: 0,
          height: promptOpen ? `${vpH}px` : "0px",
          overflow: "hidden",
          backgroundColor: "oklch(0.10 0.005 260)",
          transition: "height 0.2s ease-out",
          opacity: promptOpen ? 1 : 0,
          pointerEvents: promptOpen ? "auto" : "none",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid oklch(0.22 0.01 260)" }}
        >
          <span className="text-sm font-mono font-medium text-foreground">Prompt</span>
          <button
            type="button"
            className="text-xs font-mono text-muted-foreground/60 active:text-foreground px-2 py-1 rounded active:scale-95 transition-transform"
            onClick={() => { setPromptOpen(false); setPromptText(""); textareaRef.current?.blur(); }}
          >
            Cancel
          </button>
        </div>
        <div className="flex-1 min-h-0 p-3">
          <textarea
            ref={textareaRef}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Type text to send to terminal…"
            className="w-full h-full resize-none rounded-lg p-3 font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
            style={{
              fontSize: "16px", lineHeight: "1.5",
              backgroundColor: "oklch(0.14 0.01 260)",
              border: "1px solid oklch(0.25 0.01 260)",
              overflowX: "hidden", wordBreak: "break-word", overflowWrap: "break-word",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
            }}
          />
        </div>
        <div className="shrink-0 px-3 py-2" style={{ borderTop: "1px solid oklch(0.22 0.01 260)" }}>
          <button
            type="button"
            className="w-full rounded-lg py-2.5 font-mono font-semibold active:scale-[0.98] transition-transform"
            style={{
              fontSize: "15px",
              backgroundColor: promptText.trim() ? "oklch(0.72 0.15 180)" : "oklch(0.25 0.01 260)",
              color: promptText.trim() ? "oklch(0.13 0.005 260)" : "oklch(0.50 0.01 260)",
            }}
            disabled={!promptText.trim()}
            onClick={handleSend}
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
