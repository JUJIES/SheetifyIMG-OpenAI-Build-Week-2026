import React from "react";
import {
  AbsoluteFill,
  Audio,
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
const paper = "#f6f8fc";

const Brand: React.FC<{light?: boolean}> = ({light = false}) => (
  <div
    style={{
      position: "absolute",
      left: 58,
      top: 42,
      color: light ? "#ffffff" : ink,
      fontFamily: "Arial, sans-serif",
      fontSize: 25,
      fontWeight: 900,
      letterSpacing: 0.3,
    }}
  >
    Sheetify<span style={{color: light ? "#9dc2ff" : blue}}>IMG</span>
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 17, stiffness: 105}});
  const y = interpolate(enter, [0, 1], [42, 0]);

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(125deg, #0d1b35 0%, #173d82 58%, #2874e4 100%)",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <Brand light />
      <div
        style={{
          margin: "auto",
          width: 1560,
          transform: `translateY(${y}px)`,
          opacity: enter,
        }}
      >
        <div style={{fontSize: 25, fontWeight: 800, letterSpacing: 4, color: "#a9c8ff"}}>
          OPENAI BUILD WEEK · PIPELINE TEST 01
        </div>
        <div style={{fontSize: 83, fontWeight: 900, lineHeight: 1.02, marginTop: 24, maxWidth: 1450}}>
          What if the image model renders the entire worksheet?
        </div>
        <div style={{fontSize: 34, lineHeight: 1.35, marginTop: 34, maxWidth: 1220, color: "#e1ebff"}}>
          An image-first experiment built by a teacher — with control before and after generation.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 180,
          bottom: 72,
          width: 360,
          height: 7,
          borderRadius: 8,
          background: "linear-gradient(90deg, #8ab8ff, #ffffff, #ffb187)",
        }}
      />
    </AbsoluteFill>
  );
};

const UiFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 22, stiffness: 95}});
  const scale = interpolate(enter, [0, 1], [0.965, 1]);

  const label = frame < 255
    ? "One pass. No signup maze."
    : frame < 555
      ? "The concept remains a decision point."
      : "A real worksheet candidate in the real UI.";

  return (
    <AbsoluteFill style={{backgroundColor: "#eaf0fa", fontFamily: "Arial, sans-serif"}}>
      <Brand />
      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          top: 104,
          bottom: 90,
          borderRadius: 30,
          overflow: "hidden",
          boxShadow: "0 28px 80px rgba(24, 45, 85, 0.24)",
          border: "1px solid rgba(19,34,59,0.14)",
          backgroundColor: "white",
          transform: `scale(${scale})`,
        }}
      >
        <OffthreadVideo
          src={staticFile("media/prototype-v1-ui-flow.webm")}
          muted
          style={{width: "100%", height: "100%", objectFit: "cover"}}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 138,
          bottom: 46,
          color: "white",
          backgroundColor: "rgba(19, 34, 59, 0.94)",
          padding: "15px 23px",
          borderRadius: 14,
          fontSize: 27,
          fontWeight: 800,
          boxShadow: "0 10px 30px rgba(19,34,59,0.22)",
        }}
      >
        {label}
      </div>
      <div style={{position: "absolute", right: 120, bottom: 55, color: "#52627d", fontSize: 20}}>
        Automated local demo · synthetic workspace · no provider call
      </div>
    </AbsoluteFill>
  );
};

const Result: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 95}});
  const imageScale = interpolate(frame, [0, 300], [1.035, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{backgroundColor: paper, fontFamily: "Arial, sans-serif", color: ink}}>
      <Brand />
      <div
        style={{
          position: "absolute",
          left: 68,
          top: 110,
          width: 1275,
          height: 885,
          overflow: "hidden",
          borderRadius: 25,
          boxShadow: "0 24px 68px rgba(28, 46, 79, 0.2)",
          border: "1px solid #d7deeb",
        }}
      >
        <Img
          src={staticFile("media/prototype-v1-desktop.png")}
          style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${imageScale})`}}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 90,
          top: 235,
          width: 420,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [35, 0])}px)`,
        }}
      >
        <div style={{color: blue, fontSize: 22, fontWeight: 900, letterSpacing: 3}}>THE BUILD WEEK SHIFT</div>
        <div style={{fontSize: 54, lineHeight: 1.05, fontWeight: 900, marginTop: 20}}>
          Private experiment → usable beta
        </div>
        <div style={{fontSize: 29, lineHeight: 1.38, color: "#52627d", marginTop: 28}}>
          A pass, an isolated workspace, a concept, and a reviewable draft — assembled into one reproducible journey.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 18, stiffness: 105}});
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(125deg, #0e1c36, #1d57b5)",
        color: "white",
        fontFamily: "Arial, sans-serif",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div style={{opacity: enter, transform: `scale(${interpolate(enter, [0, 1], [0.94, 1])})`}}>
        <div style={{fontSize: 27, color: "#a9c8ff", fontWeight: 800, letterSpacing: 4}}>FIRST VERTICAL SLICE</div>
        <div style={{fontSize: 72, fontWeight: 900, marginTop: 22}}>The pipeline works.</div>
        <div style={{fontSize: 31, color: "#e1ebff", marginTop: 22}}>
          Now the story, evidence, voice and final captures can improve independently.
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const PrototypeV1: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: paper}}>
    <Audio src={staticFile("media/prototype-v1-voice-local-timing.mp3")} volume={0.92} />
    <Sequence from={0} durationInFrames={120} premountFor={30}>
      <Intro />
    </Sequence>
    <Sequence from={120} durationInFrames={934} premountFor={30}>
      <UiFlow />
    </Sequence>
    <Sequence from={1054} durationInFrames={256} premountFor={30}>
      <Result />
    </Sequence>
    <Sequence from={1310} durationInFrames={130} premountFor={30}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);
