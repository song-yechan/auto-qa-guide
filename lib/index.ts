// QA 자동화 오케스트레이션 시스템
// 각 모듈을 통합하여 제공

export { DOMExplorer, type ElementInfo, type ExplorationResult } from './explorer/dom-explorer';
export { ModalHandler, type ModalPattern } from './modal/modal-handler';
export { TestDataManager, type TestDataRecord, type DataManagerConfig } from './data/test-data-manager';
export { FlowRecorder, type FlowStep, type FlowRecord } from './flow/flow-recorder';
export { TestHelper, retry, skipIf, type AppConfig } from './utils/test-helpers';
