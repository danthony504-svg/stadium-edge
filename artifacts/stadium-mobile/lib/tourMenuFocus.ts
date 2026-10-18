type FocusRoute = "/simulator" | "/arbitrage";
type Listener = (route: FocusRoute | null) => void;
const listeners = new Set<Listener>();
let current: FocusRoute | null = null;
export function setTourMenuFocus(route: FocusRoute | null) {
  current = route;
  listeners.forEach((listener) => listener(route));
}
export function subscribeTourMenuFocus(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}
