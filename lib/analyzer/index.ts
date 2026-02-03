// DOM 기반 자동화 모듈
export {
  PageStateAnalyzer,
  type PageState,
  type ButtonState,
  type InputState,
  type FormState,
  type AlertState,
  type ModalState
} from './page-state-analyzer';

export {
  ActionDecider,
  type Action,
  type ActionType,
  type Goal,
  type FieldStrategy
} from './action-decider';

export {
  AutoPilot,
  type AutoPilotConfig,
  type ExecutionStep,
  type ExecutionResult
} from './auto-pilot';

// 신규 모듈
export {
  SmartFieldAnalyzer,
  type FieldType,
  type FieldPurpose,
  type FieldContext,
  type AnalyzedField
} from './smart-field-analyzer';

export {
  InteractionHandler,
  type InteractionResult,
  type InteractionOptions
} from './interaction-handler';

export {
  WaitStrategy,
  type WaitResult,
  type BackoffOptions,
  type DomStabilityOptions
} from './wait-strategy';

export {
  SelectorGenerator,
  escapeForSelector,
  escapeForHasText,
  type GeneratedSelector,
  type SelectorStability,
  type SelectorType,
  type SelectorOptions
} from './selector-generator';

export {
  DropdownHandler,
  type DropdownResult,
  type DropdownSelectionMethod,
  type DropdownConfig
} from './dropdown-handler';

export {
  ErrorRecovery,
  type ErrorType,
  type RecoveryStrategyType,
  type RecoveryResult,
  type RecoveryOptions
} from './error-recovery';

export {
  type ExtendedGoal,
  type FieldInstruction,
  type FieldIdentifier,
  type ButtonInstruction,
  type SuccessCondition,
  type PreStep,
  type GoalOptions,
  matchesFieldIdentifier,
  resolveValue,
  normalizeGoal,
  EXAMPLE_TRACKING_LINK_GOAL
} from './instruction-types';
