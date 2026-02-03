import { FieldType, FieldPurpose } from './smart-field-analyzer';

/**
 * 필드 식별 방법
 */
export interface FieldIdentifier {
  // 이 중 하나 이상 제공
  selector?: string;           // 직접 셀렉터
  name?: string;               // name 속성
  label?: string | RegExp;     // 라벨 텍스트 (정확히 또는 패턴)
  placeholder?: string | RegExp;
  ariaLabel?: string | RegExp;
  purpose?: FieldPurpose;      // 자동 분석된 목적으로 찾기
  nthOfType?: number;          // 같은 타입 중 n번째 (0부터)
}

/**
 * 단일 필드 지시
 */
export interface FieldInstruction {
  // 필드 식별
  field: FieldIdentifier;

  // 입력할 값
  value: string | (() => string);  // 고정값 또는 동적 생성

  // 필드 타입 힌트 (자동 감지 override)
  type?: FieldType;

  // 옵션
  required?: boolean;          // 이 필드 입력 실패 시 전체 실패
  skipIfFilled?: boolean;      // 이미 값이 있으면 건너뛰기 (기본: true)
  clearBefore?: boolean;       // 입력 전 기존 값 지우기 (기본: true)

  // 드롭다운/콤보박스 옵션
  selectExact?: boolean;       // 정확히 일치하는 옵션 선택
  createIfNotExists?: boolean; // 옵션 없으면 새로 생성 ("추가" 버튼)
}

/**
 * 버튼 클릭 지시
 */
export interface ButtonInstruction {
  // 버튼 식별
  text?: string | RegExp;      // 버튼 텍스트
  selector?: string;           // 직접 셀렉터
  ariaLabel?: string | RegExp;
  role?: string;               // role 속성 (기본: button)

  // 옵션
  waitForEnabled?: boolean;    // 활성화될 때까지 대기 (기본: true)
  timeout?: number;            // 대기 타임아웃
  scrollIntoView?: boolean;    // 뷰포트로 스크롤 (기본: true)
}

/**
 * 확장된 Goal 인터페이스
 */
export interface ExtendedGoal {
  // 기본 정보
  name: string;
  description?: string;

  // 목표 버튼 (기존 호환)
  targetButton?: string | ButtonInstruction;

  // 성공 지표 (기존 호환)
  successIndicator?: string | RegExp | SuccessCondition;

  // 명시적 필드 지시 (신규)
  fieldInstructions?: FieldInstruction[];

  // 실행 전 단계 (신규)
  preSteps?: PreStep[];

  // 필수 필드 (기존 호환, 이름 기반)
  requiredFields?: string[];

  // 옵션
  options?: GoalOptions;
}

/**
 * 성공 조건 (상세)
 */
export interface SuccessCondition {
  type: 'url' | 'text' | 'element' | 'custom';
  value: string | RegExp;
  timeout?: number;
}

/**
 * 실행 전 단계
 */
export interface PreStep {
  type: 'click' | 'wait' | 'navigate' | 'escape';
  target?: string;             // 셀렉터 또는 URL
  timeout?: number;
}

/**
 * Goal 옵션
 */
export interface GoalOptions {
  maxSteps?: number;           // 최대 실행 단계
  stepDelay?: number;          // 단계 간 딜레이
  autoFillUnknown?: boolean;   // 명시되지 않은 필드도 자동 채우기 (기본: true)
  strictMode?: boolean;        // 명시된 필드만 처리 (기본: false)
  retryOnError?: boolean;      // 에러 시 재시도
  maxRetries?: number;
}

/**
 * 명시적 지시를 처리하는 유틸리티 함수들
 */

/**
 * FieldIdentifier로 필드 매칭 확인
 */
export function matchesFieldIdentifier(
  identifier: FieldIdentifier,
  fieldInfo: {
    selector?: string;
    name?: string;
    label?: string;
    placeholder?: string;
    ariaLabel?: string;
    purpose?: FieldPurpose;
  },
  index?: number
): boolean {
  // selector 직접 매칭
  if (identifier.selector && fieldInfo.selector === identifier.selector) {
    return true;
  }

  // name 매칭
  if (identifier.name && fieldInfo.name === identifier.name) {
    return true;
  }

  // label 매칭 (문자열 또는 정규식)
  if (identifier.label && fieldInfo.label) {
    if (typeof identifier.label === 'string') {
      if (fieldInfo.label.includes(identifier.label)) return true;
    } else {
      if (identifier.label.test(fieldInfo.label)) return true;
    }
  }

  // placeholder 매칭
  if (identifier.placeholder && fieldInfo.placeholder) {
    if (typeof identifier.placeholder === 'string') {
      if (fieldInfo.placeholder.includes(identifier.placeholder)) return true;
    } else {
      if (identifier.placeholder.test(fieldInfo.placeholder)) return true;
    }
  }

  // ariaLabel 매칭
  if (identifier.ariaLabel && fieldInfo.ariaLabel) {
    if (typeof identifier.ariaLabel === 'string') {
      if (fieldInfo.ariaLabel.includes(identifier.ariaLabel)) return true;
    } else {
      if (identifier.ariaLabel.test(fieldInfo.ariaLabel)) return true;
    }
  }

  // purpose 매칭
  if (identifier.purpose && fieldInfo.purpose === identifier.purpose) {
    return true;
  }

  // nthOfType 매칭 (index가 제공된 경우)
  if (identifier.nthOfType !== undefined && index !== undefined) {
    return identifier.nthOfType === index;
  }

  return false;
}

/**
 * value가 함수인 경우 실행하여 문자열 반환
 */
export function resolveValue(value: string | (() => string)): string {
  if (typeof value === 'function') {
    return value();
  }
  return value;
}

/**
 * Goal을 ExtendedGoal로 변환 (하위 호환성)
 */
export function normalizeGoal(goal: ExtendedGoal | {
  name: string;
  targetButton?: string;
  successIndicator?: string;
  requiredFields?: string[];
}): ExtendedGoal {
  return {
    ...goal,
    options: {
      autoFillUnknown: true,
      strictMode: false,
      retryOnError: true,
      maxRetries: 2,
      ...((goal as ExtendedGoal).options || {})
    }
  };
}

/**
 * 예시: 트래킹 링크 생성 Goal
 */
export const EXAMPLE_TRACKING_LINK_GOAL: ExtendedGoal = {
  name: '트래킹 링크 생성',
  description: '커스텀 채널로 트래킹 링크를 생성합니다',

  targetButton: {
    text: /링크 생성/,
    waitForEnabled: true,
    timeout: 10000
  },

  successIndicator: {
    type: 'url',
    value: '/done/',
    timeout: 15000
  },

  fieldInstructions: [
    {
      field: { label: /채널.*선택/, purpose: 'channel' },
      value: () => `ch_${Date.now()}`,
      type: 'combobox',
      createIfNotExists: true
    },
    {
      field: { label: /웹.*URL/, purpose: 'url' },
      value: 'https://example.com/test',
      type: 'text',
      skipIfFilled: true
    }
  ],

  options: {
    maxSteps: 15,
    autoFillUnknown: true
  }
};
