"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { candidateByKey } from "@/lib/live-election/derive";
import { formatTimestamp } from "@/lib/live-election/format";
import { isDegraded, isFinal, showsMathematicalDefinition } from "@/lib/live-election/phase";
import { definedAt, definedLeaderKey, stageStatus, tickerItems, type PresentationConfig } from "@/lib/live-election/presentation";
import { MATH_DEFINED_LINE_2, MATH_DEFINED_TITLE } from "../Banners";
import { useLive, useNow } from "../LiveContext";
import { ModeBadge } from "../primitives";

/** Página normal da apuração (o modo apresentação é uma vista dela). */
export const LIVE_PAGE_PATH = "/apuracao/2026/presidente/segundo-turno";

/** px de 1 unidade do palco (--pm-u), para o que precisa de número (o logotipo oficial vem em tamanho fixo). */
function useStageUnit(): number {
  const [unit, setUnit] = useState(10.8);
  useEffect(() => {
    const measure = () => setUnit(Math.min(window.innerHeight * 0.01, window.innerWidth * 0.0056));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return unit;
}

// ------------------------------------------------------------------ cabeçalho

/** Relógio isolado: só ele renderiza a cada segundo. */
const Clock = memo(function Clock() {
  const now = useNow(1000);
  const iso = now === null ? null : new Date(now).toISOString();
  return (
    <time className="pm-clock tabular" dateTime={iso ?? undefined} aria-label="Horário de Brasília" data-testid="presentation-clock">
      {iso ? formatTimestamp(iso) : "--:--:--"}
    </time>
  );
});

export function PresentationHeader() {
  const unit = useStageUnit();
  const phase = useLive((s) => s.summary?.phase ?? null);
  const official = useLive((s) => s.summary?.official ?? null);
  const mode = useLive((s) => s.summary?.election.mode ?? null);
  const updated = useLive((s) => s.summaryMeta?.totalizedAt ?? s.summary?.national.totalizedAt ?? s.summary?.source.lastReceivedAt ?? null);
  const connection = useLive((s) => s.connection);
  const status = phase && official ? stageStatus({ phase, official }) : null;
  return (
    <header className="pm-header">
      <Logo variant="horizontal" height={Math.max(32, Math.round(unit * 3.4))} priority />
      <div className="pm-title">
        <h1 className="pm-title-main">APURAÇÃO PRESIDENCIAL 2026</h1>
        <p className="pm-title-sub">2º TURNO · DADOS OFICIAIS DO TSE</p>
      </div>
      {mode ? <ModeBadge mode={mode} /> : null}
      <div className="pm-header-right">
        {connection === "reconnecting" || connection === "offline" ? (
          <span className="pm-conn" role="status">
            {connection === "offline" ? "SEM CONEXÃO · ÚLTIMO DADO MANTIDO" : "RECONECTANDO…"}
          </span>
        ) : null}
        {status ? (
          <span className="pm-status" data-tone={status.tone} data-testid="presentation-status" role="status">
            {status.live || status.tone === "live" ? <span className="pm-dot" data-pulse={status.live ? "true" : undefined} aria-hidden="true" /> : null}
            {status.label}
          </span>
        ) : null}
        <div className="pm-meta">
          <span>
            Última atualização <strong className="tabular">{formatTimestamp(updated)}</strong>
          </span>
          <span>
            Fonte <strong>TSE</strong> · horário de Brasília
          </span>
        </div>
        <Clock />
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ ticker

/** Faixa inferior em laço contínuo (só transform). Os itens trocam sem reiniciar o movimento. */
export function PresentationTicker() {
  const summary = useLive((s) => s.summary);
  const meta = useLive((s) => s.summaryMeta);
  const states = useLive((s) => s.states?.states ?? null);
  const leadChanges = useLive((s) => s.leadChanges);
  const items = useMemo(() => (summary ? tickerItems(summary, meta, states ?? [], leadChanges) : []), [summary, meta, states, leadChanges]);
  // Duração em degraus de 15 s: mudar a duração a cada evento faria o texto saltar.
  const duration = Math.max(45, Math.ceil((items.length * 4) / 15) * 15);
  // "AO VIVO" só com a apuração andando: no resultado final, antes do início ou com a fonte parada, nunca.
  const status = summary ? stageStatus(summary) : null;
  const tag = status?.live ? "AO VIVO · TSE" : status?.tone === "final" ? "RESULTADO FINAL · TSE" : "DADOS OFICIAIS · TSE";
  return (
    <div className="pm-ticker" data-testid="presentation-ticker">
      <span className="pm-ticker-tag" data-testid="presentation-ticker-tag">
        {tag}
      </span>
      <div className="pm-ticker-window">
        <div className="pm-ticker-track" data-run={items.length > 0 ? "true" : undefined} style={{ ["--pm-ticker-duration" as string]: `${duration}s` }}>
          {[0, 1].map((copy) => (
            <div key={copy} className="pm-ticker-group" aria-hidden={copy === 1 ? "true" : undefined}>
              {items.map((item) => (
                <span key={item.id} className="pm-ticker-item" data-tone={item.tone}>
                  {item.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ avisos de estado

/** Uma cena grande quando o estado chega; depois ela recolhe (o cabeçalho e o ticker seguem dizendo). */
function useMoment(active: boolean, holdMs: number): { show: boolean; scene: number } {
  const [scene, setScene] = useState(0);
  const [show, setShow] = useState(false);
  const was = useRef(false);
  useEffect(() => {
    if (active && !was.current) {
      setScene((n) => n + 1);
      setShow(true);
    }
    if (!active) setShow(false);
    was.current = active;
  }, [active]);
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => setShow(false), holdMs);
    return () => clearTimeout(id);
  }, [show, scene, holdMs]);
  return { show, scene };
}

export function PresentationStatusOverlay() {
  const summary = useLive((s) => s.summary);
  const unavailable = useLive((s) => s.summary === null && s.syncStatus === 404);
  const defined = summary ? showsMathematicalDefinition(summary) : false;
  const final = summary ? isFinal(summary) : false;
  const mdMoment = useMoment(defined && !final, 9000);
  const finalMoment = useMoment(final, 9000);
  const scene = mdMoment.scene + finalMoment.scene;
  const stale = summary ? isDegraded(summary.phase) : false;
  const banners: ReactNode[] = [];
  if (summary && finalMoment.show) {
    banners.push(
      <div key="final" className="pm-banner" data-kind="final" role="status" data-testid="presentation-final-banner">
        <h2>RESULTADO FINAL</h2>
        <p>Totalização final registrada pelo TSE{summary.national.totalizedAt ? ` às ${formatTimestamp(summary.national.totalizedAt)}` : ""}.</p>
        {summary.official.noElectedAttribution ? <p>Totalização sem atribuição de eleito.</p> : null}
      </div>,
    );
  } else if (summary && mdMoment.show) {
    const leader = candidateByKey(summary.candidates, definedLeaderKey(summary));
    const at = definedAt(summary);
    banners.push(
      <div key="md" className="pm-banner" data-kind="md" role="status" data-testid="presentation-md-banner">
        <h2>{MATH_DEFINED_TITLE}</h2>
        {leader ? <p>{leader.ballotName}</p> : null}
        <p>
          {MATH_DEFINED_LINE_2}
          {at ? ` Sinal oficial às ${formatTimestamp(at)}.` : ""}
        </p>
      </div>,
    );
  }
  if (summary && stale) {
    const last = summary.source.lastFileGeneratedAt ?? summary.source.lastReceivedAt;
    banners.push(
      <div key="stale" className="pm-banner" data-kind="stale" role="status" data-testid="presentation-stale-banner">
        <h2>AGUARDANDO NOVA ATUALIZAÇÃO OFICIAL</h2>
        {last ? <p>Último dado oficial recebido às {formatTimestamp(last, "time-seconds")}. Os números na tela são os últimos válidos.</p> : null}
      </div>,
    );
  }
  if (summary?.official.nonFinalReason) {
    banners.push(
      <div key="mntf" className="pm-banner" data-kind="stale" role="status">
        <h2>REPROCESSAMENTO PENDENTE DE TOTALIZAÇÃO FINAL</h2>
        <p>Motivo informado pelo TSE: {summary.official.nonFinalReason}</p>
      </div>,
    );
  }
  return (
    <>
      <div key={scene} className="pm-veil" data-run={scene > 0 ? "true" : undefined} aria-hidden="true" />
      {banners.length ? <div className="pm-banners">{banners}</div> : null}
      {unavailable ? (
        <div className="pm-map-note pm-map-note-fixed" role="status">
          <h2>Acompanhamento em tempo real ainda não disponível</h2>
          <p>A tela passa a exibir os dados oficiais do TSE assim que o acompanhamento ao vivo do 2º turno for ativado. Não é preciso recarregar.</p>
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ ícones (traço simples, 20px)

function Icon({ d }: Readonly<{ d: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICON = {
  enter: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  exit: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  pause: "M8 5v14M16 5v14",
  play: "M7 4l13 8-13 8z",
  rotate: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5",
  prev: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  national: "M3 11l9-7 9 7M5 10v10h14V10",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  hide: "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.8M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6a9 9 0 0 0 4-.9",
  back: "M10 6l-6 6 6 6M4 12h16",
} as const;

export function FullscreenIcon() {
  return <Icon d={ICON.enter} />;
}

// ------------------------------------------------------------------ controles

interface ControlsProps {
  hidden: boolean;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  rotation: boolean;
  paused: boolean;
  config: PresentationConfig;
  onCommand: (command: "toggle-fullscreen" | "toggle-pause" | "toggle-rotation" | "prev" | "next" | "national" | "toggle-controls") => void;
  onConfig: (config: PresentationConfig) => void;
}

/** Barra de controles com auto-ocultação (volta com mouse, toque ou teclado; fica visível com foco dentro). */
export function PresentationControls({ hidden, fullscreen, fullscreenSupported, rotation, paused, config, onCommand, onConfig }: Readonly<ControlsProps>) {
  const [settings, setSettings] = useState(false);
  const select = (key: "nationalSeconds" | "stateSeconds" | "statesPerCycle", options: number[], label: string, unit: string) => (
    <label>
      {label}
      <select value={config[key]} onChange={(e) => onConfig({ ...config, [key]: Number(e.target.value) })}>
        {options.map((n) => (
          <option key={n} value={n}>
            {n} {unit}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="pm-controls" data-hidden={hidden ? "true" : undefined} role="toolbar" aria-label="Controles da apresentação" data-testid="presentation-controls">
      {settings ? (
        <div className="pm-settings" role="group" aria-label="Intervalos da rotação">
          {select("nationalSeconds", [15, 20, 25, 30, 45, 60], "Visão nacional", "s")}
          {select("stateSeconds", [6, 8, 10, 12, 15, 20], "Cada UF", "s")}
          {select("statesPerCycle", [3, 4, 5, 6, 8, 10], "UFs por ciclo", "UFs")}
        </div>
      ) : null}
      {fullscreenSupported ? (
        <button type="button" className="pm-ctrl" onClick={() => onCommand("toggle-fullscreen")} aria-label={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"} title={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}>
          <Icon d={fullscreen ? ICON.exit : ICON.enter} />
        </button>
      ) : null}
      <button type="button" className="pm-ctrl" onClick={() => onCommand("toggle-pause")} aria-label={paused ? "Retomar apresentação (Espaço)" : "Pausar apresentação (Espaço)"} title={paused ? "Retomar (Espaço)" : "Pausar (Espaço)"}>
        <Icon d={paused ? ICON.play : ICON.pause} />
      </button>
      <button type="button" className="pm-ctrl" onClick={() => onCommand("toggle-rotation")} aria-pressed={rotation} aria-label="Rotação automática das UFs (A)" title="Rotação automática (A)">
        <Icon d={ICON.rotate} />
        <span>{rotation ? "Rotação" : "Fixa"}</span>
      </button>
      <span className="pm-ctrl-sep" aria-hidden="true" />
      <button type="button" className="pm-ctrl" onClick={() => onCommand("prev")} aria-label="UF anterior (←)" title="UF anterior (←)">
        <Icon d={ICON.prev} />
      </button>
      <button type="button" className="pm-ctrl" onClick={() => onCommand("national")} aria-label="Visão nacional (R)" title="Visão nacional (R)">
        <Icon d={ICON.national} />
      </button>
      <button type="button" className="pm-ctrl" onClick={() => onCommand("next")} aria-label="Próxima UF (→)" title="Próxima UF (→)">
        <Icon d={ICON.next} />
      </button>
      <span className="pm-ctrl-sep" aria-hidden="true" />
      <button type="button" className="pm-ctrl" onClick={() => setSettings((v) => !v)} aria-expanded={settings} aria-label="Intervalos da rotação" title="Intervalos da rotação">
        <Icon d={ICON.settings} />
      </button>
      <button type="button" className="pm-ctrl" onClick={() => onCommand("toggle-controls")} aria-label="Ocultar controles (M)" title="Ocultar controles (M)">
        <Icon d={ICON.hide} />
      </button>
      <Link href={LIVE_PAGE_PATH} className="pm-ctrl" aria-label="Voltar à página da apuração" title="Voltar à página da apuração">
        <Icon d={ICON.back} />
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ entrada

export function PresentationIntro({ leaving, onStart }: Readonly<{ leaving: boolean; onStart: () => void }>) {
  const unit = useStageUnit();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="pm-intro" data-leaving={leaving ? "true" : undefined} role="dialog" aria-modal="true" aria-labelledby="pm-intro-title" data-testid="presentation-intro">
      <div className="pm-intro-card">
        <Logo variant="signature" height={Math.max(45, Math.round(unit * 6))} priority />
        <p className="pm-intro-kicker">MODO APRESENTAÇÃO</p>
        <h1 id="pm-intro-title" className="pm-intro-title">
          APURAÇÃO PRESIDENCIAL 2026
        </h1>
        <p className="pm-intro-sub">2º turno · dados oficiais do TSE, atualizados em tempo real</p>
        <button ref={button} type="button" className="pm-start" onClick={onStart} data-testid="presentation-start">
          <FullscreenIcon />
          INICIAR APRESENTAÇÃO
        </button>
        <p className="pm-intro-note">
          A tela entra em modo cheio e fica sempre ligada, quando o navegador permite. Atalhos: F tela cheia · Espaço pausa · ← → UFs · R visão
          nacional · A rotação · M controles.
        </p>
        <Link href={LIVE_PAGE_PATH} className="pm-intro-back">
          Voltar à página da apuração
        </Link>
      </div>
    </div>
  );
}
