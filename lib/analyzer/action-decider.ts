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
 * 상태 스냅샷 (Stuck 감지용)
 */
interface StateSnapshot {
  timestamp: number;
  url: string;
  emptyFieldCount: number;
  filledFieldCount: number;
  targetButtonEnabled: boolean;
  hash: string;  // 상태 비교용 해시
}

/**
 * Stuck 감지 결과
 */
interface StuckDetectionResult {
  isStuck: boolean;
  consecutiveSameStates: number;
  reason?: string;
}

/**
 * 행동 결정기 - 상태를 분석하여 다음 행동 결정
 */
export class ActionDecider {
  private page: Page;
  private analyzer: PageStateAnalyzer;
  private fieldStrategies: FieldStrategy[] = [];
  private actionHistory: Action[] = [];

  // Orchestration 개선: State 추적
  private stateSnapshots: StateSnapshot[] = [];
  private maxSnapshotHistory: number = 10;
  private stuckThreshold: number = 3;  // 동일 상태 반복 횟수

  constructor(page: Page) {
    this.page = page;
    this.analyzer = new PageStateAnalyzer(page);
    this.initDefaultStrategies();
  }

  /**
   * 기본 필드 입력 전략 등록
   *
   * 주의: addFieldStrategy는 unshift()를 사용하므로
   * 나중에 등록된 패턴이 먼저 체크됨 (높은 우선순위)
   *
   * 등록 순서 (일반 -> 구체적):
   * 1. 일반 패턴 먼저 (낮은 우선순위)
   * 2. 구체적 패턴 나중 (높은 우선순위)
   */
  private initDefaultStrategies() {
    // === 일반 패턴 (낮은 우선순위) - 먼저 등록 ===

    // 전화번호 필드
    this.addFieldStrategy({
      fieldPattern: /phone|전화|휴대폰/i,
      valueGenerator: () => '010-1234-5678'
    });

    // 이메일 필드
    this.addFieldStrategy({
      fieldPattern: /email|이메일/i,
      valueGenerator: () => `test_${Date.now()}@example.com`
    });

    // URL 필드 (더 구체적인 패턴 - "트래킹 링크"와 구분)
    // "웹 URL", "목적지 URL", "리다이렉트 URL" 등만 매칭
    this.addFieldStrategy({
      fieldPattern: /웹.*url|목적지.*url|리다이렉트|redirect|http|https|website/i,
      valueGenerator: () => 'https://example.com/test'
    });

    // 이름/명칭 필드 (영문으로)
    this.addFieldStrategy({
      fieldPattern: /이름|name|title/i,
      valueGenerator: () => `test_name_${Date.now()}`
    });

    // === 구체적 패턴 (높은 우선순위) - 나중에 등록 ===
    // 패턴은 필드의 "주어"를 정확히 매칭해야 함
    // (예: "캠페인의 이름" vs "채널에서 운영할 캠페인")

    // 광고 소재 필드 - "광고 소재의 이름" 또는 "소재를 입력"
    this.addFieldStrategy({
      fieldPattern: /광고.*소재의|소재를.*입력|ad.*creative|creative/i,
      valueGenerator: () => `test_creative_${Date.now()}`
    });

    // 광고 그룹 필드 - "광고 그룹의 이름" 또는 "그룹을 입력"
    this.addFieldStrategy({
      fieldPattern: /광고.*그룹의|그룹을.*입력|ad.*group/i,
      valueGenerator: () => `test_adgroup_${Date.now()}`
    });

    // 캠페인 필드 - "캠페인의 이름" (채널에서 운영할 캠페인)
    this.addFieldStrategy({
      fieldPattern: /캠페인의 이름|캠페인을.*입력|campaign/i,
      valueGenerator: () => `test_campaign_${Date.now()}`
    });

    // 채널 필드 - "채널을 선택" 또는 "채널의 이름" (가장 높은 우선순위)
    // 짧은 고정 접두사 + 짧은 랜덤 문자열 사용 (API 검증 최적화)
    this.addFieldStrategy({
      fieldPattern: /채널을 선택|채널의 이름|channel/i,
      valueGenerator: () => `ch_${Math.random().toString(36).slice(2, 8)}`
    });

    // === 기본값 (가장 낮은 우선순위) - push로 배열 끝에 추가 ===
    this.fieldStrategies.push({
      fieldPattern: /.*/,
      valueGenerator: () => `test_value_${Date.now()}`
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

    // 2. 성공 지표 먼저 확인 (버튼 클릭 후 페이지 이동 감지)
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

    // 3. 목표 버튼 확인
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

  /**
   * 현재 상태 스냅샷 기록
   */
  async recordStateSnapshot(goal?: Goal): Promise<StateSnapshot> {
    const state = await this.analyzer.analyze();
    const form = state.forms[0];

    const targetButton = goal?.targetButton
      ? state.buttons.find(b => b.text.includes(goal.targetButton!))
      : undefined;

    const emptyFieldCount = form?.inputs.filter(i => !i.value && i.visible && !i.disabled).length ?? 0;
    const filledFieldCount = form?.inputs.filter(i => i.value && i.visible).length ?? 0;

    // 상태 해시 생성 (빈 필드 수, 채워진 필드 수, 버튼 상태 조합)
    const hash = `${state.url}|${emptyFieldCount}|${filledFieldCount}|${targetButton?.disabled ?? 'na'}`;

    const snapshot: StateSnapshot = {
      timestamp: Date.now(),
      url: state.url,
      emptyFieldCount,
      filledFieldCount,
      targetButtonEnabled: targetButton ? !targetButton.disabled : false,
      hash
    };

    // 히스토리 관리
    this.stateSnapshots.push(snapshot);
    if (this.stateSnapshots.length > this.maxSnapshotHistory) {
      this.stateSnapshots.shift();
    }

    return snapshot;
  }

  /**
   * Stuck 상태 감지 (동일 상태 반복 감지)
   */
  detectStuckState(): StuckDetectionResult {
    if (this.stateSnapshots.length < this.stuckThreshold) {
      return { isStuck: false, consecutiveSameStates: 0 };
    }

    // 최근 N개의 스냅샷 해시 비교
    const recentSnapshots = this.stateSnapshots.slice(-this.stuckThreshold);
    const hashes = recentSnapshots.map(s => s.hash);

    // 모든 해시가 동일한지 확인
    const allSame = hashes.every(h => h === hashes[0]);

    if (allSame) {
      return {
        isStuck: true,
        consecutiveSameStates: this.stuckThreshold,
        reason: `동일한 상태가 ${this.stuckThreshold}회 반복됨. 진행이 없습니다.`
      };
    }

    // 연속으로 동일한 상태 카운트
    let consecutiveCount = 1;
    for (let i = this.stateSnapshots.length - 2; i >= 0; i--) {
      if (this.stateSnapshots[i].hash === this.stateSnapshots[this.stateSnapshots.length - 1].hash) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    return {
      isStuck: consecutiveCount >= this.stuckThreshold,
      consecutiveSameStates: consecutiveCount,
      reason: consecutiveCount >= this.stuckThreshold
        ? `동일한 상태가 ${consecutiveCount}회 반복됨`
        : undefined
    };
  }

  /**
   * 마지막 액션의 효과 검증
   */
  async verifyLastActionEffect(lastAction: Action): Promise<boolean> {
    if (this.stateSnapshots.length < 2) {
      return true; // 비교할 스냅샷이 없으면 효과 있다고 가정
    }

    const previousSnapshot = this.stateSnapshots[this.stateSnapshots.length - 2];
    const currentSnapshot = this.stateSnapshots[this.stateSnapshots.length - 1];

    // 상태가 변경되었는지 확인
    if (previousSnapshot.hash !== currentSnapshot.hash) {
      return true; // 상태 변경됨 = 효과 있음
    }

    // 동일한 상태라도 특정 액션은 효과가 있을 수 있음
    switch (lastAction.type) {
      case 'wait':
        return true; // wait은 상태 변화 없어도 OK
      case 'escape':
        return true; // escape도 상태 변화 없을 수 있음
      case 'fill':
        // 필드 값이 변경되었는지 더 세밀하게 확인
        return currentSnapshot.filledFieldCount > previousSnapshot.filledFieldCount;
      case 'click':
        // 버튼 상태나 URL 변경 확인
        return currentSnapshot.targetButtonEnabled !== previousSnapshot.targetButtonEnabled ||
               currentSnapshot.url !== previousSnapshot.url;
      default:
        return previousSnapshot.hash !== currentSnapshot.hash;
    }
  }

  /**
   * Stuck 상태 탈출을 위한 액션 추천
   */
  suggestEscapeAction(): Action {
    // 1. 모달이 열려있으면 ESC
    // 2. 포커스된 요소가 있으면 blur
    // 3. 스크롤하여 숨겨진 요소 찾기
    // 4. 페이지 새로고침 (최후 수단)

    const lastActions = this.actionHistory.slice(-3);
    const actionTypes = lastActions.map(a => a.type);

    // ESC를 최근에 시도하지 않았으면 ESC
    if (!actionTypes.includes('escape')) {
      return {
        type: 'escape',
        reason: 'Stuck 상태 탈출: 모달/드롭다운 닫기 시도',
        confidence: 0.5
      };
    }

    // Tab을 시도하지 않았으면 Tab (blur 이벤트)
    if (!actionTypes.includes('tab')) {
      return {
        type: 'tab',
        reason: 'Stuck 상태 탈출: blur 이벤트 발생 시도',
        confidence: 0.4
      };
    }

    // 대기 후 재시도
    return {
      type: 'wait',
      value: '2000',
      reason: 'Stuck 상태 탈출: 2초 대기 후 재시도',
      confidence: 0.3
    };
  }

  /**
   * 스냅샷 히스토리 초기화
   */
  clearSnapshotHistory(): void {
    this.stateSnapshots = [];
  }

  /**
   * 스냅샷 히스토리 조회
   */
  getSnapshotHistory(): StateSnapshot[] {
    return [...this.stateSnapshots];
  }

  /**
   * 진행 상황 요약
   */
  getProgressSummary(): {
    totalActions: number;
    successfulActions: number;
    currentState: string;
    isStuck: boolean;
  } {
    const stuckResult = this.detectStuckState();
    const latestSnapshot = this.stateSnapshots[this.stateSnapshots.length - 1];

    return {
      totalActions: this.actionHistory.length,
      successfulActions: this.actionHistory.filter(a =>
        a.type !== 'blocked' && a.type !== 'explore'
      ).length,
      currentState: latestSnapshot
        ? `빈필드: ${latestSnapshot.emptyFieldCount}, 채운필드: ${latestSnapshot.filledFieldCount}, 버튼활성화: ${latestSnapshot.targetButtonEnabled}`
        : '상태 정보 없음',
      isStuck: stuckResult.isStuck
    };
  }
}
