import type {
  CoachLearningState,
  CoachScanStatus,
  CoachSportIdOrCustom,
  CoachV2SlateResponse,
  CoachV2TicketQuery,
  CoachV2TicketResponse,
} from "@workspace/coach-types";
import type { CoachSportRegistry } from "@workspace/coach-types";
import type { CoachSimService } from "@workspace/coach-sim";
import type { CoachSnapshotCache } from "@workspace/coach-cache";
import { buildCoachV2SlateResponse, isSnapshotFresh, isSnapshotInstantServeable } from "@workspace/coach-cache";
import {
  coachBackgroundTick,
  type CoachBackgroundTickResult,
  type ScanStatusStore,
} from "@workspace/coach-background";
import type { CoachScanOptions, CoachGateContextResolver } from "@workspace/coach-scan";

import type { CoachSlateLoader } from "./slateLoader";
import { buildTicketResponseFromSnapshot } from "./ticketResponse";
import { nearestParlaySize } from "./parse";

export type CoachRuntimeOptions = {
  snapshotCache: CoachSnapshotCache;
  statusStore: ScanStatusStore;
  slateLoader: CoachSlateLoader;
  registry: CoachSportRegistry;
  sim: CoachSimService;
  sportContext: CoachScanOptions["sportContext"];
  resolveGateContext?: CoachGateContextResolver;
  sports?: CoachSportIdOrCustom[];
  learning?: CoachLearningState | null;
};

export class CoachRuntime {
  private readonly opts: CoachRuntimeOptions;
  private refreshInFlight = false;

  constructor(opts: CoachRuntimeOptions) {
    this.opts = opts;
  }

  async getScanStatus(): Promise<CoachScanStatus> {
    return this.opts.statusStore.get();
  }

  async getSlate(nowMs = Date.now()): Promise<CoachV2SlateResponse> {
    const snapshot = await this.opts.snapshotCache.get();
    const fresh = snapshot ? isSnapshotFresh(snapshot, nowMs) : false;
    const instantServe = snapshot ? isSnapshotInstantServeable(snapshot, nowMs) : false;
    const hasUsableSnapshot = Boolean(snapshot?.serveable && (fresh || instantServe));
    const needsRefresh = !fresh && (!snapshot || instantServe);
    const status = await this.opts.statusStore.get();

    if (needsRefresh && !status.jobRunning) {
      this.scheduleRefresh(hasUsableSnapshot ? "stale-while-revalidate" : "cold-miss");
    }

    return buildCoachV2SlateResponse({
      snapshot: hasUsableSnapshot ? snapshot : null,
      nowMs,
      refreshing: needsRefresh,
    });
  }

  async getTicket(
    query: CoachV2TicketQuery,
    nowMs = Date.now(),
  ): Promise<CoachV2TicketResponse | null> {
    const snapshot = await this.opts.snapshotCache.get();
    if (!snapshot?.serveable) return null;

    const fresh = isSnapshotFresh(snapshot, nowMs);
    const instantServe = isSnapshotInstantServeable(snapshot, nowMs);
    if (!fresh && !instantServe) return null;

    const legs = query.legs ? nearestParlaySize(query.legs) : 5;
    const status = await this.opts.statusStore.get();
    return buildTicketResponseFromSnapshot(snapshot, legs, query.sport ?? null, status.jobRunning);
  }

  async runCronTick(nowMs = Date.now()): Promise<CoachBackgroundTickResult> {
    const rawSlate = await this.opts.slateLoader.load();
    return coachBackgroundTick({
      rawSlate,
      snapshotCache: this.opts.snapshotCache,
      statusStore: this.opts.statusStore,
      registry: this.opts.registry,
      sim: this.opts.sim,
      sportContext: this.opts.sportContext,
      resolveGateContext: this.opts.resolveGateContext,
      sports: this.opts.sports,
      learning: this.opts.learning ?? null,
      nowMs,
    });
  }

  scheduleRefresh(_reason: string): void {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    void this.runCronTick()
      .catch(() => undefined)
      .finally(() => {
        this.refreshInFlight = false;
      });
  }
}
