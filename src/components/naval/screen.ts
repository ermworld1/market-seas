/** Screen-space positions of world anchors, written ~30 Hz by the Projector, read by the DOM label layer via rAF. */
export interface Pt {
  x: number;
  y: number;
}
export const screen = {
  flag: { bid: null as Pt | null, ask: null as Pt | null },
  near: null as Pt | null,
  strait: null as Pt | null,
  repairs: [] as Pt[],
  floaters: [] as (Pt & { id: number; text: string; tone: string; age: number })[],
};
