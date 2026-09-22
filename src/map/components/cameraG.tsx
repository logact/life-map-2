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
  const animatedProps = useAnimatedProps(() => {
    const us = props.sv.userScale.value;
    const scale = props.sv.baseScale.value * us;
    const cx =
      (props.sv.screenW.value / 2) * (1 - us) +
      us * props.sv.baseX.value +
      props.sv.panX.value;
    const cy =
      (props.sv.screenH.value / 2) * (1 - us) +
      us * props.sv.baseY.value +
      props.sv.panY.value;
    return { transform: `translate(${cx}, ${cy}) scale(${scale})` };
  });
  return <AnimatedG animatedProps={animatedProps}>{props.children}</AnimatedG>;
}
