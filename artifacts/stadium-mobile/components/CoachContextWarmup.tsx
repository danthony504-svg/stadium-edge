import { useEffect } from "react";
import { AppState, InteractionManager } from "react-native";
import { coachContextWarmer } from "@/lib/coachContextWarmup";

/** Idle-only preparation; no sign-in, push permission, native build or user action. */
export function CoachContextWarmup() {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;
    const schedule = () => {
      if (disposed || AppState.currentState !== "active") return;
      coachContextWarmer.setActive(true);
      idle = InteractionManager.runAfterInteractions(() => {
        timer = setTimeout(() => {
          void import("@/lib/coachContextWarmTasks").then(({ coachContextWarmTasks }) => {
            if (!disposed && AppState.currentState === "active") {
              return coachContextWarmer.warm(coachContextWarmTasks());
            }
          }).catch(() => {});
        }, 1500);
      });
    };
    const stop = () => {
      if (timer) clearTimeout(timer);
      idle?.cancel();
      coachContextWarmer.setActive(false);
    };
    schedule();
    const sub = AppState.addEventListener("change", state => { stop(); if (state === "active") schedule(); });
    const repeat = setInterval(schedule, 120_000);
    return () => { disposed = true; stop(); clearInterval(repeat); sub.remove(); };
  }, []);
  return null;
}
