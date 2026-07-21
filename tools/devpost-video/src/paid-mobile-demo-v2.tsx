import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const ink = "#13223b";
const blue = "#2468df";
const pale = "#edf3fc";
const timelineFps = 25;
const actualVideoEndFrame = 4361;
const candidateReadyFrame = 3910;
const candidateOpenedFrame = 4225;
const worksheetDetachStartFrame = 4290;
const worksheetZoomStartFrame = 4355;

type Stage = {
  start: number;
  until: number;
  eyebrow: string;
  title: string;
  copy: string;
  points?: string[];
  accent?: string;
};

const stages: Stage[] = [
  {start: 0, until: 360, eyebrow: "PRIVATE BETA", title: "Per Pass direkt anfangen", copy: "Ein persönlicher Zugang öffnet einen getrennten Arbeitsbereich – ohne neues Konto und Passwort."},
  {start: 360, until: 775, eyebrow: "NATÜRLICHE EINGABE", title: "Die Unterrichtsidee beschreiben", copy: "Fach, Lerngruppe, Material und Aufgabenfolge entstehen aus einer normalen Beschreibung statt aus einem starren Formular."},
  {start: 775, until: 1487, eyebrow: "GPT-5.6 · MODELLROUTING", title: "Eine Aufgabe, mehrere passende Rollen", copy: "Nicht jeder Schritt braucht denselben Modelllauf.", points: ["Schneller Pfad ordnet die Anfrage", "Reasoning-Pfad entwickelt das Konzept", "Leichter Pfad formuliert die Chat-Rückmeldung"]},
  {start: 1487, until: 1763, eyebrow: "PLANNING V2 · BUILD WEEK", title: "Weniger Aufrufe, messbar geprüft", copy: "Codex analysierte den gewachsenen Planungsweg und baute einen reproduzierbaren Vergleich.", points: ["27 → 14 Modellaufrufe", "28,32 % weniger Tokens im Test", "Legacy-Pfad bleibt als Rollback"]},
  {start: 1763, until: 2075, eyebrow: "CODEX · CLOSED BETA", title: "Vom privaten Tool zur echten Beta", copy: "Die Woche machte aus dem persönlichen Arbeitsstand einen zugänglichen Testweg.", points: ["QR-Zugang statt Account-Hürde", "Getrennte Arbeitsbereiche und Credits", "Realer Weg von Einladung bis Bild"]},
  {start: 2075, until: 2475, eyebrow: "KONTROLLE VOR DEM RENDERN", title: "Den Bauplan zuerst verstehen", copy: "Texte, Materialien und die didaktische Abfolge werden geprüft, bevor eine kostenpflichtige Bildgenerierung startet."},
  {start: 2475, until: 3175, eyebrow: "GPT-IMAGE-2 · KONTROLLIERT", title: "Das Modell gestaltet – das System begrenzt", copy: "Die Unterhaltung bleibt flexibel, aber eine teure Aktion braucht eine gültige Freigabe.", points: ["Lehrkraft bestätigt das Konzept", "Code prüft Stand, Seiten und Credits", "GPT Image rendert erst danach"]},
  {start: 3175, until: candidateReadyFrame, eyebrow: "IMAGE-FIRST · EXPERIMENT", title: "Das Bildmodell gezielt zähmen", copy: "Gute und schlechte Artefakte werden zur Grundlage schneller Iteration.", points: ["Entwurf beobachten", "konkretes Darstellungsproblem benennen", "Designregel ableiten", "mit GPT-5.6 und Codex erneut prüfen"]},
  {start: candidateReadyFrame, until: candidateOpenedFrame, eyebrow: "RENDERING ABGESCHLOSSEN", title: "Der Entwurf ist fertig", copy: "Sheetify meldet den Kandidaten zurück. Jetzt wird er bewusst geöffnet und geprüft.", accent: "ready"},
  {start: candidateOpenedFrame, until: Number.POSITIVE_INFINITY, eyebrow: "ECHTER ENTWURF", title: "Prüfen statt automatisch akzeptieren", copy: "Erst jetzt ist die vollständige Seite sichtbar. Sie bleibt ein Kandidat, den die Lehrkraft beurteilt und weiterentwickelt."},
];

const voiceSegments = [
  {id: "vo-01", startMs: 700, endMs: 9980},
  {id: "vo-02", startMs: 14500, endMs: 25940},
  {id: "vo-03", startMs: 33000, endMs: 56200},
  {id: "vo-04", startMs: 59500, endMs: 80620},
  {id: "vo-05", startMs: 83500, endMs: 102060},
  {id: "vo-06", startMs: 102500, endMs: 126020},
  {id: "vo-07", startMs: 127000, endMs: 152840},
  {id: "vo-08-ready", startMs: 156500, endMs: 162980},
  {id: "vo-09-final", startMs: 169500, endMs: 178060},
];

const soundCues = [
  {id: "click-create", frame: 275, file: "sound-select-click.mp3", volume: 0.1},
  {id: "click-submit", frame: 775, file: "sound-select-click.mp3", volume: 0.09},
  {id: "transition-planning", frame: 790, file: "sound-soft-transition.mp3", volume: 0.055},
  {id: "click-confirm", frame: 2425, file: "sound-select-click.mp3", volume: 0.1},
  {id: "transition-render", frame: 2475, file: "sound-soft-transition.mp3", volume: 0.055},
  {id: "render-complete", frame: candidateReadyFrame, file: "sound-completion-chime.mp3", volume: 0.1},
  {id: "transition-result", frame: candidateOpenedFrame, file: "sound-soft-transition.mp3", volume: 0.06},
];

type FocusCue = {
  start: number;
  end: number;
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
};

const focusCues: FocusCue[] = [
  {start: 650, end: 790, left: 67, top: 82, width: 28, height: 12, radius: 18},
  {start: 2075, end: 2475, left: 5, top: 78, width: 90, height: 17, radius: 18},
  {start: candidateReadyFrame + 55, end: candidateOpenedFrame - 5, left: 9, top: 31, width: 82, height: 42, radius: 22},
];

const clamp = {extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const};

const windowProgress = (frame: number, start: number, end: number, transition = 20) => {
  const enter = interpolate(frame, [start, start + transition], [0, 1], clamp);
  const exit = interpolate(frame, [end - transition, end], [1, 0], clamp);
  return Math.min(enter, exit);
};

const musicVolumeAtFrame = (frame: number, fps: number) => {
  const currentMs = frame / fps * 1000;
  const speechActivity = Math.max(...voiceSegments.map((segment) => windowProgress(currentMs, segment.startMs, segment.endMs, 260)));
  return interpolate(speechActivity, [0, 1], [0.22, 0.072], clamp);
};

const FocusGuide: React.FC<{frame: number}> = ({frame}) => {
  const cue = focusCues.find((candidate) => frame >= candidate.start && frame < candidate.end);
  if (!cue) return null;
  const opacity = windowProgress(frame, cue.start, cue.end, 12);
  return (
    <div
      style={{
        position: "absolute",
        left: `${cue.left}%`,
        top: `${cue.top}%`,
        width: `${cue.width}%`,
        height: `${cue.height}%`,
        borderRadius: cue.radius,
        border: "2px solid rgba(89,151,255,.9)",
        boxShadow: "0 0 0 999px rgba(12,24,43,.22), 0 0 0 5px rgba(82,145,255,.14), 0 10px 34px rgba(36,104,223,.24)",
        opacity,
        transform: `scale(${interpolate(opacity, [0, 1], [0.985, 1], clamp)})`,
        pointerEvents: "none",
        zIndex: 8,
      }}
    />
  );
};

const Brand: React.FC = () => (
  <div style={{fontSize: 27, fontWeight: 900, letterSpacing: 0.2}}>
    Sheetify<span style={{color: blue}}>IMG</span>
  </div>
);

const TechnicalPoints: React.FC<{stage: Stage; frame: number; fps: number}> = ({stage, frame, fps}) => {
  if (!stage.points?.length) return null;
  const localFrame = frame - stage.start;
  return (
    <div style={{display: "grid", gap: 12, marginTop: 30, maxWidth: 890}}>
      {stage.points.map((point, index) => {
        const reveal = spring({frame: localFrame - index * Math.round(fps * 1.35), fps, config: {damping: 25, stiffness: 105}});
        return (
          <div key={point} style={{display: "flex", alignItems: "center", gap: 16, opacity: reveal, transform: `translateY(${interpolate(reveal, [0, 1], [12, 0])}px)`, background: "rgba(255,255,255,.76)", border: "1px solid #cad7e9", borderRadius: 16, padding: "13px 18px"}}>
            <span style={{width: 28, height: 28, flex: "0 0 auto", borderRadius: 99, display: "grid", placeItems: "center", color: "white", background: blue, fontSize: 15, fontWeight: 900}}>{index + 1}</span>
            <span style={{fontSize: 23, lineHeight: 1.25, fontWeight: 750, color: ink}}>{point}</span>
          </div>
        );
      })}
    </div>
  );
};

export const PaidMobileDemoV2: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timelineFrame = frame * timelineFps / fps;
  const stage = stages.find((candidate) => timelineFrame >= candidate.start && timelineFrame < candidate.until) ?? stages[stages.length - 1];
  const initialEnter = spring({frame, fps, config: {damping: 25, stiffness: 90}});
  const explainProgress = Math.max(
    windowProgress(timelineFrame, 775, 2075),
    windowProgress(timelineFrame, 2475, candidateReadyFrame),
  );
  const finalProgress = spring({frame: timelineFrame - candidateOpenedFrame, fps: timelineFps, config: {damping: 27, stiffness: 82, mass: 1.05}});
  const worksheetDetachProgress = interpolate(
    timelineFrame,
    [worksheetDetachStartFrame, worksheetZoomStartFrame],
    [0, 1],
    {...clamp, easing: Easing.inOut(Easing.cubic)},
  );
  const worksheetZoomProgress = interpolate(
    timelineFrame,
    [worksheetZoomStartFrame, 4488],
    [0, 1],
    {...clamp, easing: Easing.out(Easing.cubic)},
  );
  const worksheetHeroFade = interpolate(worksheetDetachProgress, [0, 0.12, 1], [0, 1, 1], clamp);
  const deviceFade = interpolate(worksheetDetachProgress, [0, 0.22, 1], [1, 1, 0], clamp);
  const readyProgress = windowProgress(timelineFrame, candidateReadyFrame, candidateOpenedFrame, 14);

  const basePhone = {left: 270, top: 96, width: 430, height: 920};
  const explainPhone = {left: 92, top: 151, width: 350, height: 748};
  const finalPhone = {left: 733, top: 55, width: 455, height: 970};
  const phoneBeforeFinal = {
    left: interpolate(explainProgress, [0, 1], [basePhone.left, explainPhone.left]),
    top: interpolate(explainProgress, [0, 1], [basePhone.top, explainPhone.top]),
    width: interpolate(explainProgress, [0, 1], [basePhone.width, explainPhone.width]),
    height: interpolate(explainProgress, [0, 1], [basePhone.height, explainPhone.height]),
  };
  const phone = {
    left: interpolate(finalProgress, [0, 1], [phoneBeforeFinal.left, finalPhone.left]),
    top: interpolate(finalProgress, [0, 1], [phoneBeforeFinal.top, finalPhone.top]),
    width: interpolate(finalProgress, [0, 1], [phoneBeforeFinal.width, finalPhone.width]),
    height: interpolate(finalProgress, [0, 1], [phoneBeforeFinal.height, finalPhone.height]),
  };
  const panelLeft = interpolate(explainProgress, [0, 1], [805, 560]);
  const panelOpacity = 1 - finalProgress;
  const freezeOpacity = interpolate(timelineFrame, [actualVideoEndFrame - 16, actualVideoEndFrame], [0, 1], clamp);

  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 25% 18%, #ffffff 0%, ${pale} 49%, #dfe9f8 100%)`, color: ink, fontFamily: "Arial, sans-serif"}}>
      <Audio src={staticFile("media/paid-mobile-demo-v2/music-bed.mp3")} volume={(audioFrame) => musicVolumeAtFrame(audioFrame, fps)} />
      {voiceSegments.map((segment) => (
        <Sequence key={segment.id} from={Math.round(segment.startMs / 1000 * fps)}>
          <Audio src={staticFile(`media/paid-mobile-demo-v2/${segment.id}.mp3`)} volume={0.98} />
        </Sequence>
      ))}
      {soundCues.map((cue) => (
        <Sequence key={cue.id} from={Math.round(cue.frame / timelineFps * fps)}>
          <Audio src={staticFile(`media/paid-mobile-demo-v2/${cue.file}`)} volume={cue.volume} />
        </Sequence>
      ))}

      <div style={{position: "absolute", left: 70, top: 46}}><Brand /></div>

      <div style={{position: "absolute", left: phone.left, top: phone.top, width: phone.width, height: phone.height, borderRadius: 56, padding: 12, background: "#101827", boxShadow: `0 ${interpolate(finalProgress, [0, 1], [28, 42])}px ${interpolate(finalProgress, [0, 1], [76, 110])}px rgba(19,34,59,0.28)`, transform: `translateY(${interpolate(initialEnter, [0, 1], [22, 0])}px)`, opacity: initialEnter * deviceFade, zIndex: 4}}>
        <div style={{position: "absolute", zIndex: 3, left: "50%", top: 16, width: 108, height: 24, transform: "translateX(-50%)", borderRadius: 18, background: "#101827"}} />
        <div style={{position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: 46, background: "white"}}>
          <Sequence durationInFrames={Math.round(actualVideoEndFrame / timelineFps * fps)}>
            <OffthreadVideo src={staticFile("media/paid-mobile-demo-v2/ui-edit-proxy.mp4")} muted style={{width: "100%", height: "100%", objectFit: "contain", background: "white", filter: `brightness(${1 - explainProgress * 0.18}) saturate(${1 - explainProgress * 0.08})`}} />
          </Sequence>
          {timelineFrame >= actualVideoEndFrame - 16 && (
            <div style={{position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#f4f6f9", opacity: freezeOpacity}}>
              <div style={{height: 68, flex: "0 0 auto", padding: "17px 18px 11px", background: "white", borderBottom: "1px solid #d9e0ea"}}>
                <div style={{fontSize: 10, letterSpacing: 1.1, color: "#6c7789"}}>ENTWURF 01</div>
                <div style={{fontSize: 20, lineHeight: 1.15, marginTop: 3, fontWeight: 900, color: ink}}>Ergebnisprüfung</div>
              </div>
              <Img src={staticFile("media/paid-mobile-demo-v2/generated-worksheet.png")} style={{width: "100%", flex: 1, minHeight: 0, objectFit: "contain", padding: "20px 15px 28px", boxSizing: "border-box"}} />
            </div>
          )}
          <FocusGuide frame={timelineFrame} />
        </div>
      </div>

      {timelineFrame >= worksheetDetachStartFrame - 4 && (
        <>
          <div style={{position: "absolute", left: "50%", top: "51%", width: interpolate(worksheetZoomProgress, [0, 1], [520, 1050], clamp), height: interpolate(worksheetZoomProgress, [0, 1], [520, 1050], clamp), transform: "translate(-50%, -50%)", borderRadius: 999, background: "radial-gradient(circle, rgba(255,255,255,.98) 0%, rgba(232,240,252,.62) 45%, rgba(223,233,248,0) 72%)", opacity: worksheetHeroFade * worksheetZoomProgress * 0.92, filter: "blur(2px)", zIndex: 5}} />
          <div style={{position: "absolute", left: interpolate(worksheetZoomProgress, [0, 1], [812, 602], clamp), top: interpolate(worksheetZoomProgress, [0, 1], [388, 47], clamp), width: interpolate(worksheetZoomProgress, [0, 1], [294, 708], clamp), height: interpolate(worksheetZoomProgress, [0, 1], [416, 1002], clamp), padding: interpolate(worksheetZoomProgress, [0, 1], [0, 12], clamp), boxSizing: "border-box", borderRadius: interpolate(worksheetZoomProgress, [0, 1], [0, 16], clamp), background: "white", border: `1px solid rgba(180,194,216,${interpolate(worksheetZoomProgress, [0, 1], [0, 0.72], clamp)})`, boxShadow: `0 ${interpolate(worksheetZoomProgress, [0, 1], [0, 38], clamp)}px ${interpolate(worksheetZoomProgress, [0, 1], [0, 100], clamp)}px rgba(19,34,59,${interpolate(worksheetZoomProgress, [0, 1], [0, 0.27], clamp)})`, opacity: worksheetHeroFade, overflow: "hidden", zIndex: 8}}>
            <Img src={staticFile("media/paid-mobile-demo-v2/generated-worksheet.png")} style={{width: "100%", height: "100%", objectFit: "contain", display: "block"}} />
          </div>
        </>
      )}

      <div style={{position: "absolute", left: panelLeft, top: interpolate(explainProgress, [0, 1], [202, 154]), width: interpolate(explainProgress, [0, 1], [900, 1210]), opacity: panelOpacity, transform: `translateX(${interpolate(finalProgress, [0, 1], [0, 40])}px)`, zIndex: 2}}>
        <div style={{fontSize: 21, fontWeight: 900, letterSpacing: 3.2, color: stage.accent === "ready" ? "#16815a" : blue}}>{stage.eyebrow}</div>
        <div style={{fontSize: interpolate(explainProgress, [0, 1], [60, 65]), lineHeight: 1.06, fontWeight: 900, marginTop: 18, maxWidth: 1080}}>{stage.title}</div>
        <div style={{fontSize: 29, lineHeight: 1.42, color: "#53627b", marginTop: 26, maxWidth: 920}}>{stage.copy}</div>
        <TechnicalPoints stage={stage} frame={timelineFrame} fps={timelineFps} />
      </div>

      {readyProgress > 0 && (
        <div style={{position: "absolute", left: 742, top: 84, display: "flex", alignItems: "center", gap: 15, padding: "15px 23px", borderRadius: 999, color: "#126943", background: "rgba(235,250,242,.96)", border: "1px solid #9ad8b9", boxShadow: "0 18px 45px rgba(21,111,72,.16)", opacity: readyProgress, transform: `translateY(${interpolate(readyProgress, [0, 1], [10, 0])}px)`, zIndex: 7}}>
          <span style={{width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 99, color: "white", background: "#1f9d67", fontSize: 20, fontWeight: 900}}>✓</span>
          <span style={{fontSize: 22, fontWeight: 900}}>Entwurf fertig gerendert</span>
        </div>
      )}

      <div style={{position: "absolute", right: 70, bottom: 38, fontSize: 17, color: "#65748b", opacity: 1 - finalProgress}}>Realer Paid-Run · GPT-5.6 · gpt-image-2 · 17. Juli 2026</div>
    </AbsoluteFill>
  );
};
