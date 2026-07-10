// Cross-sport prop engine client — re-exports from api.ts.

export {
  analyzeEventProps,
  analyzeEventPropsBatch,
  analyzeTennisMatchProps,
  getPropEngineStatus,
  getTennisPropEngineStatus,
  propEngineAvailable,
  tennisPropsEngineAvailable,
  ENGINE_PROP_SPORTS,
  type PropEngineAnalyzeResult,
  type PropEngineRecommendation,
  type PropLearningRow,
  type TennisPropAnalyzeResult,
  type TennisPropEngineRecommendation,
} from "./api.ts";
