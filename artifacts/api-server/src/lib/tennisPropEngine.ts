// Backward-compatible re-exports — use propEngine/analyze.ts for new code.

export {
  analyzeEventProps,
  analyzeTennisMatchProps,
  propEngineEnabled,
} from "./propEngine/analyze.js";

export type {
  PropEngineResult,
  PropLine,
  PropGrade,
  PropRecommendation,
  PropSimResult,
  PropLearningRow,
  AnalyzePropsInput,
} from "./propEngine/types.js";

export { gradeProp as gradeTennisProp, PROP_ENGINE_MIN_GRADE } from "./propEngine/grade.js";
export {
  propLearningWeight as tennisPropLearningWeight,
  buildPropLearningMap as buildTennisPropLearningMap,
} from "./propEngine/learning.js";
