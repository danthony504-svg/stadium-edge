export type TourFocusRoute = "/simulator" | "/arbitrage";
export type TourMenuFocus = {
  route: TourFocusRoute;
  step: 4 | 5;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
};
type Listener = (focus: TourMenuFocus | null) => void;
const listeners = new Set<Listener>();
let current: TourMenuFocus | null = null;
export function setTourMenuFocus(focus: TourMenuFocus | null) {
  current = focus;
  listeners.forEach((listener) => listener(focus));
}
export function subscribeTourMenuFocus(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}
