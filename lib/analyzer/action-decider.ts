import { Page } from '@playwright/test';
import {
  PageStateAnalyzer,
  PageState,
  InputState,
  ButtonState,
  FormState
} from './page-state-analyzer';

/**
 * 행동 타입
 */
export type ActionType =
  | 'fill'      // 입력 필드 채우기
  | 'click'     // 버튼/요소 클릭
  | 'select'    // 드롭다운 선택
  | 'wait'      // 대기
  | 'escape'    // ESC 키 (모달 닫기)
  | 'tab'       // Tab 키 (blur 이벤트)
  | 'done'      // 목표 달성
  | 'blocked'   // 진행 불가
  | 'explore';  // 추가 탐색 필요

/**
 * 행동 정의
 */
export interface Action {
  type: ActionType;
  selector?: string;
  value?: string;
  reason: string;
  confidence: number; // 0-1, 이 행동이 올바를 확률
}

/**
 * 목표 정의
 */
export interface Goal {
  name: string;
  targetButton?: string;     // 최종적으로 클릭할 버튼
  requiredFields?: string[]; // 반드시 채워야 하는 필드
  successIndicator?: string; // 성공 확인 텍스트/셀렉터
}

/**
 * 필드 입력 전략
 */
export interface FieldStrategy {
  fieldPattern: RegExp;      // 필드 이름 패턴
  valueGenerator: (fieldName: string, state: PageState) => string;
}

/**
 * 행동 결정기 - 상태를 분석하여 다음 행동 결정
 */
export class ActionDecider {
  private page: Page;
  private analyzer: PageStateAnalyzer;
  private fieldStrategies: FieldStrategy[] = [];
  private actionHistory: Action[] = [];

  constructor(page: Page) {
    this.page = page;
    this.analyzer = new PageStateAnalyzer(page);
    this.initDefaultStrategies();
  }

  /**
   * 기본 필드 입력 전략 등록
   */
  private initDefaultStrategies() {
    // 채널 필드
    this.addFieldStrategy({
      fieldPattern: /채널|channel/i,
      valueGenerator: () => `테스트_채널_${Date.now()}`
    });

    // 이름 필드
    this.addFieldStrategy({
      fieldPattern: /이름|name|title/i,
      valueGenerator: () => `테스트_${Date.now()}`
    });

    // URL 필드
    this.addFieldStrategy({
      fieldPattern: /url|링크|주소/i,
      valueGenerator: () => 'https://example.com/test'
    });

    // 이메일 필드
    this.addFieldStrategy({
      fieldPattern: /email|이메일/i,
      valueGenerator: () => `test_${Date.now()}@example.com`
    });

    // 전화번호 필드
    this.addFieldStrategy({
      fieldPattern: /phone|전화|휴대폰/i,
      valueGenerator: () => '010-1234-5678'
    });

    // 일반 텍스트 필드 (기본값)
    this.addFieldStrategy({
      fieldPattern: /.*/,
      valueGenerator: (fieldName) => `테스트_${fieldName}_${Date.now()}`
    });
  }

  /**
   * 필드 입력 전략 추가
   */
  addFieldStrategy(strategy: FieldStrategy) {
    // 앞에 추가하여 우선순위 부여
    this.fieldStrategies.unshift(strategy);
  }

  /**
   * 목표 기반 다음 행동 결정
   */
  async decideNextAction(goal: Goal): Promise<Action> {
    const state = await this.analyzer.analyze();

    // 1. 모달이 있으면 먼저 처리
    if (state.modals.length > 0) {
      return this.handleModal(state);
    }

    // 2. 목표 버튼 확인
    const targetButton = this.findTargetButton(state, goal);

    // 3. 버튼이 활성화되어 있으면 클릭
    if (targetButton && !targetButton.disabled) {
      return {
        type: 'click',
        selector: targetButton.selector,
        reason: `목표 버튼 "${targetButton.text}" 활성화됨`,
        confidence: 0.95
      };
    }

    // 4. 버튼이 비활성화되어 있으면 필드 채우기
    if (targetButton && targetButton.disabled) {
      const nextInput = this.findNextInputToFill(state, goal);

      if (nextInput) {
        const value = this.generateValue(nextInput, state);
        return {
          type: 'fill',
          selector: nextInput.selector,
          value,
          reason: `필드 "${nextInput.name}" 입력 필요 (버튼 활성화를 위해)`,
          confidence: 0.8
        };
      }

      // 모든 필드가 채워졌는데 버튼이 비활성화
      // blur 이벤트 발생 시도
      if (this.shouldTriggerBlur()) {
        return {
          type: 'tab',
          reason: 'blur 이벤트 발생을 위해 Tab 키 입력',
          confidence: 0.6
        };
      }

      // 추가 탐색 필요
      return {
        type: 'explore',
        reason: `버튼 "${targetButton.text}"이 여전히 비활성화. 추가 조건 탐색 필요`,
        confidence: 0.3
      };
    }

    // 5. 목표 버튼을 찾을 수 없음
    if (goal.targetButton) {
      return {
        type: 'blocked',
        reason: `목표 버튼 "${goal.targetButton}"을 찾을 수 없음`,
        confidence: 0.9
      };
    }

    // 6. 성공 지표 확인
    if (goal.successIndicator) {
      const success = await this.checkSuccessIndicator(goal.successIndicator);
      if (success) {
        return {
          type: 'done',
          reason: '목표 달성됨',
          confidence: 1.0
        };
      }
    }

    return {
      type: 'blocked',
      reason: '다음 행동을 결정할 수 없음',
      confidence: 0.5
    };
  }

  /**
   * 모달 처리 행동 결정
   */
  private handleModal(state: PageState): Action {
    const modal = state.modals[0];

    // 입력 필드가 있는 모달
    if (modal.inputs.length > 0) {
      const emptyInput = modal.inputs.find(i => !i.value);
      if (emptyInput) {
        return {
          type: 'fill',
          selector: emptyInput.selector,
          value: this.generateValue(emptyInput, state),
          reason: `모달 내 필드 "${emptyInput.name}" 입력`,
          confidence: 0.7
        };
      }
    }

    // 확인/닫기 버튼 찾기
    const confirmBtn = modal.buttons.find(b =>
      !b.disabled && (
        b.text.includes('확인') ||
        b.text.includes('삭제') ||
        b.text.includes('저장')
      )
    );

    if (confirmBtn) {
      return {
        type: 'click',
        selector: confirmBtn.selector,
        reason: `모달 버튼 "${confirmBtn.text}" 클릭`,
        confidence: 0.8
      };
    }

    // ESC로 닫기
    return {
      type: 'escape',
      reason: '모달 닫기 (ESC)',
      confidence: 0.5
    };
  }

  /**
   * 목표 버튼 찾기
   */
  private findTargetButton(state: PageState, goal: Goal): ButtonState | undefined {
    if (!goal.targetButton) return undefined;

    return state.buttons.find(b =>
      b.visible && (
        b.text.includes(goal.targetButton!) ||
        b.ariaLabel?.includes(goal.targetButton!)
      )
    );
  }

  /**
   * 다음으로 채워야 할 입력 필드 찾기
   */
  private findNextInputToFill(state: PageState, goal: Goal): InputState | undefined {
    const form = state.forms[0];
    if (!form) return undefined;

    // 1. 필수 필드 중 빈 필드
    if (goal.requiredFields) {
      for (const fieldName of goal.requiredFields) {
        const input = form.inputs.find(i =>
          i.visible &&
          !i.disabled &&
          !i.value &&
          (i.name.includes(fieldName) || i.ariaLabel?.includes(fieldName))
        );
        if (input) return input;
      }
    }

    // 2. 비어있는 필수 필드
    const emptyRequired = form.inputs.find(i =>
      i.visible && !i.disabled && i.required && !i.value
    );
    if (emptyRequired) return emptyRequired;

    // 3. 비어있는 일반 필드 (visible)
    const emptyVisible = form.inputs.find(i =>
      i.visible && !i.disabled && !i.value
    );

    return emptyVisible;
  }

  /**
   * 필드에 맞는 값 생성
   */
  private generateValue(input: InputState, state: PageState): string {
    const fieldName = input.name || input.ariaLabel || input.placeholder || '';

    for (const strategy of this.fieldStrategies) {
      if (strategy.fieldPattern.test(fieldName)) {
        return strategy.valueGenerator(fieldName, state);
      }
    }

    return `테스트_${Date.now()}`;
  }

  /**
   * blur 이벤트 발생이 필요한지 판단
   */
  private shouldTriggerBlur(): boolean {
    // 최근 fill 후 tab을 안 했으면 필요
    let lastFillIndex = -1;
    let lastTabIndex = -1;

    for (let i = this.actionHistory.length - 1; i >= 0; i--) {
      if (lastFillIndex === -1 && this.actionHistory[i].type === 'fill') {
        lastFillIndex = i;
      }
      if (lastTabIndex === -1 && this.actionHistory[i].type === 'tab') {
        lastTabIndex = i;
      }
      if (lastFillIndex !== -1 && lastTabIndex !== -1) break;
    }

    if (lastFillIndex === -1) return false;

    return lastFillIndex > lastTabIndex;
  }

  /**
   * 성공 지표 확인
   */
  private async checkSuccessIndicator(indicator: string): Promise<boolean> {
    try {
      // URL 패턴
      if (indicator.startsWith('/') || indicator.startsWith('http')) {
        return this.page.url().includes(indicator);
      }

      // 텍스트 또는 셀렉터
      const isVisible = await this.page.locator(`text=${indicator}`)
        .or(this.page.locator(indicator))
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      return isVisible;
    } catch {
      return false;
    }
  }

  /**
   * 행동 기록 추가
   */
  recordAction(action: Action) {
    this.actionHistory.push(action);
  }

  /**
   * 행동 기록 조회
   */
  getActionHistory(): Action[] {
    return [...this.actionHistory];
  }

  /**
   * 현재 상태 분석 (읽기용)
   */
  async getCurrentState(): Promise<PageState> {
    return this.analyzer.analyze();
  }

  /**
   * 읽기 쉬운 상태 텍스트
   */
  async getReadableState(): Promise<string> {
    return this.analyzer.getReadableState();
  }

  /**
   * 버튼 비활성화 원인 분석
   */
  async analyzeDisabledButton(buttonText: string): Promise<string[]> {
    return this.analyzer.analyzeDisabledButton(buttonText);
  }
}
