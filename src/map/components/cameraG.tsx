import { ReactNode } from "react";
import Animated, { useAnimatedProps } from "react-native-reanimated";
import { G } from "react-native-svg";

import { CameraSv } from "../hooks/useMapCamera";

const AnimatedG = Animated.createAnimatedComponent(G);

// the camera transform for the whole edge layer, evaluated on the UI
// thread: world-anchored content (edges, grid dots, the connect preview)
// follows pan/pinch without a single React render. The formula mirrors
// composedCam (base × pinch zoom, pan on top)
export function CameraG(props: { sv: CameraSv; children: ReactNode }) {
  // the worklet must capture ONLY the shareable sv bundle: closing over
  // `props` would pull children (FiberNodes) onto the UI thread, which
  // the worklet runtime cannot copy
  const { sv, children } = props;
  const animatedProps = useAnimatedProps(() => {
    const us = sv.userScale.value;
    const scale = sv.baseScale.value * us;
    const cx =
      (sv.screenW.value / 2) * (1 - us) + us * sv.baseX.value + sv.panX.value;
    const cy =
      (sv.screenH.value / 2) * (1 - us) + us * sv.baseY.value + sv.panY.value;
    return { transform: `translate(${cx}, ${cy}) scale(${scale})` };
  });
  return <AnimatedG animatedProps={animatedProps}>{children}</AnimatedG>;
}
