export {
  OPP_SHIFT_CAPS,
  type VacancyConfirmation,
  type WorkloadChannel,
  type ChannelApplyKind,
  type ChannelFamilyRule,
  type InjuryVacancyInput,
  type BeneficiaryUsageInput,
  type VacancyRecord,
  type ChannelContribution,
  type FamilyShiftRow,
  type OpportunityShiftTable,
  type OpportunityShiftLookup,
} from "./types.js";

export {
  opportunityMarketFamily,
  isFamilyShiftAllowed,
  NON_SEATABLE_FAMILIES,
} from "./marketFamily.js";

export {
  classifyVacancyConfirmation,
  vacancyFractionForConfirmation,
  vacancyFingerprint,
  beneficiaryId,
  normName,
  teamMatch,
} from "./confirmation.js";

export { aggregateFamilyMultiplier } from "./aggregate.js";

export {
  getOpportunityAdapter,
  nflAdapter,
  ncaafAdapter,
  nbaAdapter,
  wnbaAdapter,
  mlbAdapter,
  nhlAdapter,
  soccerAdapter,
  tennisAdapter,
  ufcAdapter,
  detectVacancyFraction,
  confidenceWeightForVacancy,
  type SportOpportunityAdapter,
} from "./adapters.js";

export {
  buildOpportunityShiftTable,
  mergeOpportunityShiftTables,
  lookupOpportunityShift,
  type BuildOpportunityShiftOpts,
} from "./engine.js";

export { explainFamilyShift } from "./explain.js";

export {
  buildOpportunityShiftForGame,
  type EspnInjuryTeamLike,
  type PropPlayerLike,
} from "./fromInjuries.js";
