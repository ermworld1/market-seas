import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import type { DepthOfFieldEffect } from "postprocessing";
import { view } from "./layout";
import type { QualityTier } from "@/lib/market/presentation";

/**
 * Cinema post stack, scaled by the adaptive quality tier:
 * No bloom: muzzle flashes and fires light the scene physically without neon auras.
 */
const noPost = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("nopost");
export function CinemaPost() {
  const [tier, setTier] = useState<QualityTier>(view.quality);
  const dof = useRef<DepthOfFieldEffect>(null);
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current > 1) { acc.current = 0; if (view.quality !== tier) setTier(view.quality); }
    const d = dof.current;
    if (d) {
      // focus on the subject of close shots; wide shots keep everything sharp
      const on = view.focus > 0;
      d.bokehScale += ((on ? 3 : 0) - d.bokehScale) * Math.min(1, dt * 4);
      if (on) d.cocMaterial.focusDistance = view.focus;
    }
  });
  if (noPost) return null;
  if (tier === "low")
    return (
      <EffectComposer multisampling={0}>
        <Vignette darkness={0.55} offset={0.3} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  if (tier === "medium")
    return (
      <EffectComposer multisampling={0}>
        <Noise opacity={0.06} blendFunction={BlendFunction.OVERLAY} />
        <Vignette darkness={0.6} offset={0.28} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  return (
    <EffectComposer multisampling={0}>
      <DepthOfField ref={dof} worldFocusDistance={10} worldFocusRange={6} bokehScale={0} />
      <Noise opacity={0.06} blendFunction={BlendFunction.OVERLAY} />
      <Vignette darkness={0.6} offset={0.28} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
