"use client";

import "../live-election.css";
import "./presentation.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrazilMapShapes } from "@/lib/live-election/map-shapes";
import { DEFAULT_CONFIG, parseConfig, stageStatus, type PresentationCommand, type PresentationConfig } from "@/lib/live-election/presentation";
import { createLiveStore, initialLiveState } from "@/lib/live-election/store";
import { LiveStreamClient } from "@/lib/live-election/stream";
import type { LiveEnvelope, LiveStatesPayload, LiveSummary, TerritoryResult } from "@/lib/live-election/types";
import { useReducedMotion } from "@/motion/reduced-motion";
import { LiveAnnouncer } from "../Extras";
import { LiveStoreProvider, useLive } from "../LiveContext";
import { PresentationControls, PresentationHeader, PresentationIntro, PresentationStatusOverlay, PresentationTicker } from "./Chrome";
import { useFrameBudget, useFullscreen, useIdle, useParallax, usePresentationKeys, useRotation, useWakeLock } from "./hooks";
import { NationalProgressPanel, PresentationKpis, StateSpotlight, StateStrip } from "./Panels";
import { PresentationBrazilMap } from "./PresentationBrazilMap";
import { AdvantageIndicator, NationalScoreboard } from "./Scoreboard";

const NO_STATES: readonly TerritoryResult[] = [];
const IDLE_MS = 3500;

/** Contador de trocas de liderança nacional (dispara as cenas depois que o novo líder já está na tela). */
function useLeadScene(): number {
  const leader = useLive((s) => s.summary?.national.leaderKey ?? null);
  const [scene, setScene] = useState(0);
  const previous = useRef(leader);
  useEffect(() => {
    if (previous.current && leader && previous.current !== leader) setScene((n) => n + 1);
    previous.current = leader;
  }, [leader]);
  return scene;
}

/** O palco sobre um store já existente (o `PresentationMode` liga o stream; os testes passam o próprio store). */
export function PresentationStage({ mapShapes }: Readonly<{ mapShapes: BrazilMapShapes }>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<PresentationConfig>(DEFAULT_CONFIG);
  const [started, setStarted] = useState(false);
  const [intro, setIntro] = useState(true);
  const [paused, setPaused] = useState(false);
  const [rotation, setRotation] = useState(true);
  const [controlsOff, setControlsOff] = useState(false);

  const reducedMotion = useReducedMotion();
  const slow = useFrameBudget(started && !reducedMotion && !config.reducedEffects);
  const reduced = reducedMotion || config.reducedEffects || slow;
  const fullscreen = useFullscreen();
  useWakeLock(started);
  const idle = useIdle(IDLE_MS, started);
  useParallax(rootRef, started && !reduced && !idle);

  const states = useLive((s) => s.states?.states ?? NO_STATES);
  const tone = useLive((s) => (s.summary ? stageStatus(s.summary).tone : "calm"));
  const ufs = useMemo(() => mapShapes.shapes.map((s) => s.uf), [mapShapes.shapes]);
  const rotate = useRotation({ states, ufs, config, enabled: started && rotation, paused });
  const leadScene = useLeadScene();
  const focusedUf = rotate.view.kind === "state" ? rotate.view.uf : null;

  // Configuração pela URL (telão montado sem teclado): lida no cliente para a rota continuar em cache.
  useEffect(() => {
    const parsed = parseConfig(new URLSearchParams(window.location.search));
    setConfig(parsed);
    setRotation(parsed.rotation);
    if (parsed.autostart) {
      setStarted(true);
      setIntro(false);
    }
  }, []);

  const start = useCallback(() => {
    void fullscreen.enter();
    setStarted(true);
    // A entrada sai por opacidade; o palco já estava vivo por trás dela.
    window.setTimeout(() => setIntro(false), 420);
  }, [fullscreen]);

  const { goNational, step, select } = rotate;
  const onCommand = useCallback(
    (command: PresentationCommand) => {
      switch (command) {
        case "toggle-fullscreen":
          void fullscreen.toggle();
          break;
        case "exit-fullscreen":
          void fullscreen.exit();
          break;
        case "toggle-pause":
          setPaused((p) => !p);
          break;
        case "toggle-rotation":
          setRotation((r) => !r);
          setPaused(false);
          break;
        case "prev":
          step(-1);
          break;
        case "next":
          step(1);
          break;
        case "national":
          goNational();
          break;
        case "toggle-controls":
          setControlsOff((v) => !v);
          break;
      }
    },
    [fullscreen, step, goNational],
  );
  usePresentationKeys(started, onCommand);

  const controlsHidden = !started || controlsOff || idle;
  return (
    <div
      ref={rootRef}
      className="pm-root"
      data-idle={started && idle ? "true" : undefined}
      data-effects={reduced ? "reduced" : "full"}
      data-tone={tone}
      data-started={started ? "true" : undefined}
      data-testid="presentation-root"
    >
      <div className="pm-backdrop" aria-hidden="true">
        <div className="pm-light" />
        <div className="pm-floor" />
        <div className="pm-vignette" />
      </div>
      <main className="pm-stage" aria-label="Apuração presidencial 2026 — modo apresentação" inert={intro && !started}>
        <PresentationHeader />
        <NationalScoreboard leadScene={leadScene} />
        <PresentationBrazilMap shapes={mapShapes} focusedUf={focusedUf} onSelect={select} leadScene={leadScene}>
          <AdvantageIndicator />
        </PresentationBrazilMap>
        <NationalProgressPanel />
        <StateSpotlight view={rotate.view} shapes={mapShapes} startedAt={rotate.startedAt} dwellMs={rotate.dwellMs} rotating={started && rotation && !paused} />
        <PresentationKpis />
        <StateStrip shapes={mapShapes} focusedUf={focusedUf} onSelect={select} />
        <PresentationTicker />
      </main>
      <PresentationStatusOverlay />
      <LiveAnnouncer />
      {started ? (
        <PresentationControls
            hidden={controlsHidden}
            fullscreen={fullscreen.active}
            fullscreenSupported={fullscreen.supported}
            rotation={rotation}
            paused={paused}
            config={config}
            onCommand={onCommand}
            onConfig={setConfig}
        />
      ) : null}
      {intro ? <PresentationIntro leaving={started} onStart={start} /> : null}
    </div>
  );
}

/**
 * Modo Apresentação (telão/TV) da apuração presidencial. Mesma fonte da página: primeiro snapshot do servidor e,
 * no cliente, o stream SSE do REPBrasil (snapshot, Last-Event-ID, troca de réplica, nova época, ressincronização
 * pelo REST). Nenhuma consulta ao TSE, nenhum pipeline novo.
 */
export function PresentationMode({
  initialSummary,
  initialStates,
  mapShapes,
}: Readonly<{ initialSummary: LiveEnvelope<LiveSummary> | null; initialStates: LiveEnvelope<LiveStatesPayload> | null; mapShapes: BrazilMapShapes }>) {
  const [store] = useState(() => createLiveStore(initialLiveState(initialSummary, initialStates)));
  useEffect(() => {
    const client = new LiveStreamClient(store);
    client.start({ resync: true });
    return () => client.stop();
  }, [store]);
  return (
    <LiveStoreProvider store={store}>
      <PresentationStage mapShapes={mapShapes} />
    </LiveStoreProvider>
  );
}
