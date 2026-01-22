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
