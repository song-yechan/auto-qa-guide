// QA 자동화 오케스트레이션 시스템
// 각 모듈을 통합하여 제공

// 기존 모듈
export { DOMExplorer, type ElementInfo, type ExplorationResult } from './explorer/dom-explorer';
export { ModalHandler, type ModalPattern } from './modal/modal-handler';
export { TestDataManager, type TestDataRecord, type DataManagerConfig } from './data/test-data-manager';
export { FlowRecorder, type FlowStep, type FlowRecord } from './flow/flow-recorder';
export { TestHelper, retry, skipIf, type AppConfig } from './utils/test-helpers';

// DOM 기반 자동화 모듈 (신규)
export {
  PageStateAnalyzer,
  ActionDecider,
  AutoPilot,
  type PageState,
  type ButtonState,
  type InputState,
  type FormState,
  type AlertState,
  type ModalState,
  type Action,
  type ActionType,
  type Goal,
  type FieldStrategy,
  type AutoPilotConfig,
  type ExecutionStep,
  type ExecutionResult
} from './analyzer';
