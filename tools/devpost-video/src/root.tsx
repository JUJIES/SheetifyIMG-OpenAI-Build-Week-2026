import React from "react";
import {Composition} from "remotion";
import {PipelineSmoke} from "./pipeline-smoke";
import {PrototypeV1} from "./prototype-v1";
import {MobileProductTest} from "./mobile-product-test";
import {PaidMobileDemoV2} from "./paid-mobile-demo-v2";
import {VoiceInputDemo} from "./voice-input-demo";

export const VideoRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PipelineSmoke"
        component={PipelineSmoke}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PrototypeV1"
        component={PrototypeV1}
        durationInFrames={1440}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="MobileProductTest"
        component={MobileProductTest}
        durationInFrames={1350}
        fps={25}
        width={1920}
        height={1080}
      />
      <Composition
        id="PaidMobileDemoV2"
        component={PaidMobileDemoV2}
        durationInFrames={4488}
        fps={25}
        width={1920}
        height={1080}
      />
      <Composition
        id="PaidMobileDemoV2Preview"
        component={PaidMobileDemoV2}
        durationInFrames={2154}
        fps={12}
        width={1920}
        height={1080}
      />
      <Composition
        id="PaidMobileDemoV2AudioReview"
        component={PaidMobileDemoV2}
        durationInFrames={1437}
        fps={8}
        width={1920}
        height={1080}
      />
      <Composition
        id="VoiceInputDemo"
        component={VoiceInputDemo}
        durationInFrames={430}
        fps={25}
        width={1920}
        height={1080}
      />
    </>
  );
};
