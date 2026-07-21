import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const blue = "#2468df";
const ink = "#13223b";
const clamp = {extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const};

const Brand: React.FC = () => (
  <div style={{fontSize: 27, fontWeight: 900, letterSpacing: 0.2}}>
    Sheetify<span style={{color: blue}}>IMG</span>
  </div>
);

const Wave: React.FC<{active: boolean}> = ({active}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{display: "flex", height: 42, gap: 7, alignItems: "center"}}>
      {Array.from({length: 11}, (_, index) => {
        const amplitude = active ? 9 + Math.abs(Math.sin(frame * 0.34 + index * 0.72)) * 25 : 8;
        return <div key={index} style={{width: 7, height: amplitude, borderRadius: 99, background: active ? blue : "#aebbd0"}} />;
      })}
    </div>
  );
};

export const VoiceInputDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const recordingStart = Math.round(1.732 * fps);
  const recordingStop = Math.round(11.695 * fps);
  const transcriptReady = Math.round(13.579 * fps);
  const phoneEnter = spring({frame, fps, config: {damping: 25, stiffness: 90}});
  const resultFocus = spring({frame: frame - transcriptReady, fps, config: {damping: 27, stiffness: 86}});
  const recording = frame >= recordingStart && frame < recordingStop;
  const transcribing = frame >= recordingStop && frame < transcriptReady;
  const ready = frame >= transcriptReady;
  const panelOpacity = interpolate(frame, [0, 12], [0, 1], clamp);

  const eyebrow = ready ? "TRANSKRIPT BEREIT" : transcribing ? "ECHTE TRANSKRIPTION" : recording ? "SPRACHEINGABE LÄUFT" : "NATÜRLICHER EINSTIEG";
  const title = ready ? "Gesprochenes wird zum Arbeitsauftrag" : transcribing ? "Sheetify hört nicht nur zu" : recording ? "Die Unterrichtsidee einfach aussprechen" : "Sprechen statt tippen";
  const copy = ready
    ? "Der erkannte Text landet im normalen Eingabefeld und kann vor dem Senden geprüft oder verändert werden."
    : transcribing
      ? "Nach dem Stoppen verarbeitet der echte Transkriptionspfad die Aufnahme."
      : recording
        ? "Während die Lehrkraft spricht, zeigt der reale Mikrofonknopf seinen Aufnahmezustand."
        : "Ein kurzer Klick öffnet denselben Planungsweg auch für gesprochene Unterrichtsideen.";

  return (
    <AbsoluteFill style={{background: "radial-gradient(circle at 24% 16%, #ffffff 0%, #edf3fc 50%, #dfe9f8 100%)", color: ink, fontFamily: "Arial, sans-serif"}}>
      <Sequence from={recordingStart}>
        <Audio src={staticFile("media/voice-input-demo/voice-prompt.mp3")} volume={0.98} />
      </Sequence>

      <div style={{position: "absolute", left: 70, top: 46}}><Brand /></div>

      <div style={{position: "absolute", left: interpolate(resultFocus, [0, 1], [185, 145]), top: interpolate(resultFocus, [0, 1], [92, 70]), width: interpolate(resultFocus, [0, 1], [430, 462]), height: interpolate(resultFocus, [0, 1], [920, 988]), borderRadius: 56, padding: 12, background: "#101827", boxShadow: "0 30px 90px rgba(19,34,59,.28)", transform: `translateY(${interpolate(phoneEnter, [0, 1], [22, 0])}px)`, opacity: phoneEnter}}>
        <div style={{position: "absolute", zIndex: 3, left: "50%", top: 16, width: 108, height: 24, transform: "translateX(-50%)", borderRadius: 18, background: "#101827"}} />
        <div style={{width: "100%", height: "100%", overflow: "hidden", borderRadius: 46, background: "white"}}>
          <OffthreadVideo src={staticFile("media/voice-input-demo/voice-input-ui.webm")} muted style={{width: "100%", height: "100%", objectFit: "contain", background: "white"}} />
        </div>
      </div>

      <div style={{position: "absolute", left: 740, top: 205, width: 1040, opacity: panelOpacity}}>
        <div style={{fontSize: 21, fontWeight: 900, letterSpacing: 3.1, color: ready ? "#16815a" : blue}}>{eyebrow}</div>
        <div style={{fontSize: 64, lineHeight: 1.06, fontWeight: 900, marginTop: 18, maxWidth: 980}}>{title}</div>
        <div style={{fontSize: 29, lineHeight: 1.42, color: "#53627b", marginTop: 26, maxWidth: 910}}>{copy}</div>

        <div style={{display: "flex", alignItems: "center", gap: 20, marginTop: 42, padding: "18px 24px", width: 540, borderRadius: 20, background: "rgba(255,255,255,.78)", border: `1px solid ${ready ? "#9ad8b9" : "#cad7e9"}`}}>
          {ready ? (
            <div style={{width: 42, height: 42, borderRadius: 99, display: "grid", placeItems: "center", color: "white", background: "#1f9d67", fontSize: 26, fontWeight: 900}}>✓</div>
          ) : (
            <Wave active={recording} />
          )}
          <div style={{fontSize: 22, fontWeight: 850}}>{ready ? "Text kann geprüft werden" : transcribing ? "Transkription läuft …" : recording ? "Aufnahme läuft …" : "Mikrofon auswählen"}</div>
        </div>
      </div>

      <div style={{position: "absolute", right: 70, bottom: 38, fontSize: 17, color: "#65748b"}}>Reale Sheetify-Aufnahme · echter Transkriptionspfad</div>
    </AbsoluteFill>
  );
};
