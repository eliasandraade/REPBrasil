"use client";

import { useEffect, useState } from "react";

const FULL = "Inteligência pública sobre agentes políticos brasileiros.";
const BRAND_PHRASE = "agentes políticos";
const BRAND_START = FULL.indexOf(BRAND_PHRASE);
const BRAND_END = BRAND_START + BRAND_PHRASE.length;
const CHAR_MS = 32;

export function TypewriterTitle() {
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState(true);
  const done = count >= FULL.length;

  // Typing effect
  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setCount((c) => c + 1), CHAR_MS);
    return () => clearTimeout(id);
  }, [count, done]);

  // After done: blink 6 times then hide cursor
  useEffect(() => {
    if (!done) return;
    let blinks = 0;
    const id = setInterval(() => {
      setCursor((v) => !v);
      blinks++;
      if (blinks >= 6) {
        clearInterval(id);
        setCursor(false);
      }
    }, 380);
    return () => clearInterval(id);
  }, [done]);

  // Split displayed text into: before brand / brand / after brand
  const text = FULL.slice(0, count);
  let before = text;
  let brand = "";
  let after = "";

  if (count > BRAND_START) {
    before = FULL.slice(0, BRAND_START);
    brand = FULL.slice(BRAND_START, Math.min(count, BRAND_END));
    if (count > BRAND_END) after = FULL.slice(BRAND_END, count);
  }

  return (
    <h1 className="mb-4 text-center text-3xl font-bold leading-tight tracking-tight text-slate-100 sm:text-4xl md:text-5xl">
      {before}
      {brand && <span className="text-gradient-brand">{brand}</span>}
      {after}
      <span
        aria-hidden="true"
        className="ml-0.5 inline-block translate-y-[-0.06em] align-middle"
        style={{
          width: "2px",
          height: "0.82em",
          background: cursor ? "#0dd48e" : "transparent",
          borderRadius: "1px",
          transition: "background 60ms",
        }}
      />
    </h1>
  );
}
