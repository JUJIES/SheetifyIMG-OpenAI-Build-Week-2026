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

const ink = "#13223b";
const blue = "#2468df";
const pale = "#edf3fc";

const STEPS = [
  {until: 400, eyebrow: "PRIVATE BETA", title: "Ohne Anmeldehürden starten", copy: "Der persönliche Pass öffnet direkt den eigenen Arbeitsbereich."},
  {until: 675, eyebrow: "VOR DER GENERIERUNG", title: "Das Arbeitsblatt zuerst verstehen", copy: "Der Bauplan macht Texte, Aufgaben und ihre didaktische Abfolge sichtbar."},
  {until: 900, eyebrow: "KONTROLLE DER LEHRKRAFT", title: "Wichtige Details gezielt prüfen", copy: "Jedes Element bleibt eine bewusste Entscheidung statt unsichtbarer Prompt-Kontext."},
  {until: Number.POSITIVE_INFINITY, eyebrow: "IMAGE-FIRST ENTWURF", title: "Die vollständig gerenderte Seite prüfen", copy: "Das erste Bild bleibt ein Entwurf: ansehen, überarbeiten, vergleichen oder verwerfen."},
];

const Brand: React.FC = () => (
  <div style={{fontSize: 27, fontWeight: 900, letterSpacing: 0.2}}>
    Sheetify<span style={{color: blue}}>IMG</span>
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 19, stiffness: 95}});
  return (
    <AbsoluteFill style={{background: "linear-gradient(125deg, #0d1b35, #164895 58%, #2c79df)", color: "white", fontFamily: "Arial, sans-serif"}}>
      <div style={{position: "absolute", left: 70, top: 52}}><Brand /></div>
      <div style={{margin: "auto", width: 1530, opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [34, 0])}px)`}}>
        <div style={{fontSize: 23, letterSpacing: 4, fontWeight: 800, color: "#b5d0ff"}}>MOBILES PRODUKT-TUTORIAL</div>
        <div style={{fontSize: 78, lineHeight: 1.03, fontWeight: 900, maxWidth: 1320, marginTop: 22}}>Von der Unterrichtsidee zum prüfbaren Arbeitsblatt-Entwurf.</div>
        <div style={{fontSize: 30, color: "#e5edff", marginTop: 30}}>Ein echter, automatisierter Ablauf durch die Sheetify-Oberfläche.</div>
      </div>
    </AbsoluteFill>
  );
};

const Walkthrough: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const step = STEPS.find((candidate) => frame < candidate.until) ?? STEPS[STEPS.length - 1];
  const enter = spring({frame, fps, config: {damping: 22, stiffness: 90}});

  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 24% 20%, #ffffff 0%, ${pale} 48%, #dfe9f8 100%)`, color: ink, fontFamily: "Arial, sans-serif"}}>
      <div style={{position: "absolute", left: 70, top: 46}}><Brand /></div>
      <div style={{position: "absolute", left: 270, top: 96, width: 430, height: 920, borderRadius: 56, padding: 12, background: "#101827", boxShadow: "0 35px 90px rgba(19,34,59,0.28)", transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`, opacity: enter}}>
        <div style={{position: "absolute", zIndex: 3, left: "50%", top: 16, width: 112, height: 25, transform: "translateX(-50%)", borderRadius: 18, background: "#101827"}} />
        <div style={{width: "100%", height: "100%", overflow: "hidden", borderRadius: 47, background: "white"}}>
          <OffthreadVideo
            src={staticFile("media/mobile-product-test-ui.webm")}
            muted
            playbackRate={0.9}
            style={{width: "100%", height: "100%", objectFit: "contain", background: "white"}}
          />
        </div>
      </div>
      <div style={{position: "absolute", left: 805, top: 235, width: 850}}>
        <div style={{fontSize: 21, fontWeight: 900, letterSpacing: 3.4, color: blue}}>{step.eyebrow}</div>
        <div style={{fontSize: 62, lineHeight: 1.06, fontWeight: 900, marginTop: 18, maxWidth: 820}}>{step.title}</div>
        <div style={{fontSize: 30, lineHeight: 1.42, color: "#53627b", marginTop: 28, maxWidth: 760}}>{step.copy}</div>
        <div style={{display: "flex", gap: 13, marginTop: 52, flexWrap: "wrap"}}>
          {["Pass", "Bauplan", "Entwurf", "Prüfung"].map((label, index) => (
            <div key={label} style={{padding: "12px 18px", borderRadius: 999, fontSize: 20, fontWeight: 800, color: index <= STEPS.indexOf(step) ? "white" : "#5a6980", background: index <= STEPS.indexOf(step) ? blue : "rgba(255,255,255,0.75)", border: `1px solid ${index <= STEPS.indexOf(step) ? blue : "#cbd7e8"}`}}>{label}</div>
          ))}
        </div>
      </div>
      <div style={{position: "absolute", right: 70, bottom: 42, fontSize: 18, color: "#65748b"}}>Automatisierter Playwright-Ablauf · synthetischer Arbeitsbereich · providerfreie Aufnahme</div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 18, stiffness: 100}});
  return (
    <AbsoluteFill style={{background: "linear-gradient(125deg, #0d1b35, #174b9c)", color: "white", fontFamily: "Arial, sans-serif", alignItems: "center", justifyContent: "center", textAlign: "center"}}>
      <div style={{opacity: enter, transform: `scale(${interpolate(enter, [0, 1], [0.95, 1])})`, maxWidth: 1420}}>
        <div style={{fontSize: 24, fontWeight: 900, letterSpacing: 4, color: "#b5d0ff"}}>KONTROLLE VOR UND NACH DEM RENDERN</div>
        <div style={{fontSize: 68, lineHeight: 1.05, fontWeight: 900, marginTop: 24}}>Visuelle Freiheit, ohne das erste Bild zum automatischen Endergebnis zu machen.</div>
      </div>
    </AbsoluteFill>
  );
};

export const MobileProductTest: React.FC = () => (
  <AbsoluteFill style={{background: pale}}>
    <Audio src={staticFile("media/mobile-product-test-voice-local-timing.mp3")} volume={0.96} />
    <Sequence from={0} durationInFrames={75} premountFor={25}><Intro /></Sequence>
    <Sequence from={75} durationInFrames={1150} premountFor={25}><Walkthrough /></Sequence>
    <Sequence from={1225} durationInFrames={125} premountFor={25}><Outro /></Sequence>
  </AbsoluteFill>
);
