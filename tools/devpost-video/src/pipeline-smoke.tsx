import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const colors = {
  ink: "#15233b",
  paper: "#f7f5ef",
  coral: "#ff765d",
  blue: "#4267e8",
  mint: "#9be0c0",
};

const Beat: React.FC<{
  index: string;
  title: string;
  detail: string;
  accent: string;
}> = ({index, title, detail, accent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 18, stiffness: 115}});
  const y = interpolate(enter, [0, 1], [40, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        padding: "0 180px",
        opacity: enter,
        transform: `translateY(${y}px)`,
      }}
    >
      <div
        style={{
          color: accent,
          fontFamily: "Arial, sans-serif",
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: 3,
          marginBottom: 20,
        }}
      >
        {index}
      </div>
      <div
        style={{
          color: colors.ink,
          fontFamily: "Arial, sans-serif",
          fontSize: 78,
          fontWeight: 800,
          lineHeight: 1.04,
          maxWidth: 1320,
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: "#536078",
          fontFamily: "Arial, sans-serif",
          fontSize: 34,
          lineHeight: 1.35,
          marginTop: 28,
          maxWidth: 1220,
        }}
      >
        {detail}
      </div>
    </AbsoluteFill>
  );
};

export const PipelineSmoke: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 239], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{backgroundColor: colors.paper}}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${progress}%`,
          height: 9,
          backgroundColor: colors.coral,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 72,
          top: 58,
          color: colors.ink,
          fontFamily: "Arial, sans-serif",
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: 1.2,
        }}
      >
        SHEETIFYIMG · BUILD WEEK
      </div>
      <Sequence from={0} durationInFrames={80} premountFor={20}>
        <Beat
          index="01 · THE STARTING POINT"
          title="A private worksheet experiment"
          detail="The final edit will begin with the older workflow and the classroom moment that made it feel insufficient."
          accent={colors.blue}
        />
      </Sequence>
      <Sequence from={80} durationInFrames={80} premountFor={20}>
        <Beat
          index="02 · THE WAGER"
          title="Render the complete worksheet"
          detail="Image-first generation creates visual freedom — and makes concept control and review essential."
          accent={colors.coral}
        />
      </Sequence>
      <Sequence from={160} durationInFrames={80} premountFor={20}>
        <Beat
          index="03 · BUILD WEEK"
          title="From my prototype to a live beta"
          detail="Stable narration segments, synthetic captures and verified evidence will replace these temporary cards."
          accent="#248b62"
        />
      </Sequence>
      <div
        style={{
          position: "absolute",
          left: 72,
          bottom: 54,
          width: 250,
          height: 8,
          borderRadius: 8,
          background: `linear-gradient(90deg, ${colors.blue}, ${colors.mint}, ${colors.coral})`,
        }}
      />
    </AbsoluteFill>
  );
};
