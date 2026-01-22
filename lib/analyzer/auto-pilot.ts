import { Page, expect } from '@playwright/test';
import { ActionDecider, Action, Goal, FieldStrategy } from './action-decider';
import { PageState } from './page-state-analyzer';
import { ModalHandler } from '../modal/modal-handler';

/**
 * 실행 단계 기록
 */
export interface ExecutionStep {
  step: number;
  timestamp: string;
  action: Action;
  success: boolean;
  error?: string;
  stateSnapshot?: Partial<PageState>;
}

/**
 * 실행 결과
 */
export interface ExecutionResult {
  success: boolean;
  steps: ExecutionStep[];
  finalState?: PageState;
  error?: string;
  totalTime: number;
}

/**
 * AutoPilot 설정
 */
export interface AutoPilotConfig {
  maxSteps?: number;          // 최대 실행 단계 (기본: 20)
  stepDelay?: number;         // 단계 간 딜레이 ms (기본: 500)
  typeDelay?: number;         // 타이핑 딜레이 ms (기본: 30)
  enableScreenshots?: boolean; // 각 단계 스크린샷 (기본: false)
  screenshotDir?: string;     // 스크린샷 저장 경로
  verbose?: boolean;          // 상세 로그 (기본: true)
  retryOnError?: boolean;     // 에러 시 재시도 (기본: true)
  maxRetries?: number;        // 최대 재시도 횟수 (기본: 2)
}

/**
 * AutoPilot - 자동화 루프 실행기
 *
 * 사용법:
 * ```typescript
 * const pilot = new AutoPilot(page);
 *
 * const result = await pilot.execute({
 *   name: '트래킹 링크 생성',
 *   targetButton: '링크 생성',
 *   successIndicator: '/done/'
 * });
 *
 * if (result.success) {
 *   console.log('성공!');
 * }
 * ```
 */
export class AutoPilot {
  private page: Page;
  private decider: ActionDecider;
  private modalHandler: ModalHandler;
  private config: Required<AutoPilotConfig>;

  constructor(page: Page, config: AutoPilotConfig = {}) {
    this.page = page;
    this.decider = new ActionDecider(page);
    this.modalHandler = new ModalHandler(page);

    this.config = {
      maxSteps: config.maxSteps ?? 20,
      stepDelay: config.stepDelay ?? 500,
      typeDelay: config.typeDelay ?? 30,
      enableScreenshots: config.enableScreenshots ?? false,
      screenshotDir: config.screenshotDir ?? './autopilot-screenshots',
      verbose: config.verbose ?? true,
      retryOnError: config.retryOnError ?? true,
      maxRetries: config.maxRetries ?? 2
    };
  }

  /**
   * 필드 입력 전략 추가
   */
  addFieldStrategy(strategy: FieldStrategy) {
    this.decider.addFieldStrategy(strategy);
  }

  /**
   * 목표 달성을 위한 자동 실행
   */
  async execute(goal: Goal): Promise<ExecutionResult> {
    const startTime = Date.now();
    const steps: ExecutionStep[] = [];
    let currentStep = 0;
    let retryCount = 0;

    this.log(`🚀 AutoPilot 시작: ${goal.name}`);
    this.log(`   목표 버튼: ${goal.targetButton || '(없음)'}`);
    this.log(`   성공 지표: ${goal.successIndicator || '(없음)'}`);

    try {
      while (currentStep < this.config.maxSteps) {
        currentStep++;

        // 1. 다음 행동 결정
        const action = await this.decider.decideNextAction(goal);
        this.log(`\n[Step ${currentStep}] ${action.type}: ${action.reason}`);

        // 2. 스크린샷 (설정된 경우)
        if (this.config.enableScreenshots) {
          await this.takeScreenshot(`step-${currentStep}`);
        }

        // 3. 행동 실행
        const step: ExecutionStep = {
          step: currentStep,
          timestamp: new Date().toISOString(),
          action,
          success: false
        };

        // 완료 조건 체크
        if (action.type === 'done') {
          step.success = true;
          steps.push(step);
          this.log('✅ 목표 달성!');

          return {
            success: true,
            steps,
            finalState: await this.decider.getCurrentState(),
            totalTime: Date.now() - startTime
          };
        }

        // 진행 불가 체크
        if (action.type === 'blocked') {
          step.success = false;
          step.error = action.reason;
          steps.push(step);

          // 재시도
          if (this.config.retryOnError && retryCount < this.config.maxRetries) {
            retryCount++;
            this.log(`⚠️ 재시도 ${retryCount}/${this.config.maxRetries}`);
            await this.page.waitForTimeout(1000);
            continue;
          }

          this.log('❌ 진행 불가');
          return {
            success: false,
            steps,
            error: action.reason,
            finalState: await this.decider.getCurrentState(),
            totalTime: Date.now() - startTime
          };
        }

        // 추가 탐색 필요
        if (action.type === 'explore') {
          this.log('🔍 추가 탐색...');

          // 현재 상태 상세 출력
          const readableState = await this.decider.getReadableState();
          this.log(readableState);

          // 버튼 비활성화 원인 분석
          if (goal.targetButton) {
            const reasons = await this.decider.analyzeDisabledButton(goal.targetButton);
            this.log(`버튼 비활성화 원인: ${reasons.join(', ')}`);
          }

          step.stateSnapshot = await this.decider.getCurrentState();
          step.success = true;
          steps.push(step);

          // 탐색 후에도 진행 안되면 종료
          if (retryCount >= this.config.maxRetries) {
            return {
              success: false,
              steps,
              error: '추가 조건을 파악할 수 없음',
              finalState: await this.decider.getCurrentState(),
              totalTime: Date.now() - startTime
            };
          }

          retryCount++;
          await this.page.waitForTimeout(1000);
          continue;
        }

        // 행동 실행
        try {
          await this.executeAction(action);
          step.success = true;
          retryCount = 0; // 성공하면 재시도 카운트 초기화
        } catch (error) {
          step.success = false;
          step.error = error instanceof Error ? error.message : String(error);
          this.log(`   ❌ 실패: ${step.error}`);

          if (this.config.retryOnError && retryCount < this.config.maxRetries) {
            retryCount++;
            this.log(`   ⚠️ 재시도 ${retryCount}/${this.config.maxRetries}`);
          }
        }

        this.decider.recordAction(action);
        steps.push(step);

        // 단계 간 딜레이
        await this.page.waitForTimeout(this.config.stepDelay);
      }

      // 최대 단계 초과
      return {
        success: false,
        steps,
        error: `최대 단계(${this.config.maxSteps}) 초과`,
        finalState: await this.decider.getCurrentState(),
        totalTime: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
        totalTime: Date.now() - startTime
      };
    }
  }

  /**
   * 단일 행동 실행
   */
  private async executeAction(action: Action): Promise<void> {
    switch (action.type) {
      case 'fill':
        if (!action.selector || !action.value) {
          throw new Error('fill 행동에 selector와 value가 필요합니다');
        }
        await this.fillInput(action.selector, action.value);
        break;

      case 'click':
        if (!action.selector) {
          throw new Error('click 행동에 selector가 필요합니다');
        }
        await this.clickElement(action.selector);
        break;

      case 'select':
        if (!action.selector || !action.value) {
          throw new Error('select 행동에 selector와 value가 필요합니다');
        }
        await this.page.selectOption(action.selector, action.value);
        break;

      case 'wait':
        await this.page.waitForTimeout(action.value ? parseInt(action.value) : 1000);
        break;

      case 'escape':
        await this.page.keyboard.press('Escape');
        break;

      case 'tab':
        await this.page.keyboard.press('Tab');
        break;

      default:
        throw new Error(`알 수 없는 행동 타입: ${action.type}`);
    }
  }

  /**
   * 입력 필드 채우기 (이벤트 발생 포함)
   */
  private async fillInput(selector: string, value: string): Promise<void> {
    const input = this.page.locator(selector).first();

    // 입력 필드가 보일 때까지 대기
    await input.waitFor({ state: 'visible', timeout: 5000 });

    // 클릭하여 포커스
    await input.click();

    // 기존 값 지우기
    await input.clear();

    // 타이핑 (이벤트 발생)
    await input.type(value, { delay: this.config.typeDelay });

    // blur 이벤트 발생을 위해 Tab
    await this.page.keyboard.press('Tab');

    this.log(`   입력: "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`);
  }

  /**
   * 요소 클릭
   */
  private async clickElement(selector: string): Promise<void> {
    // 다양한 셀렉터 형식 지원
    let locator;

    if (selector.startsWith('text=') || selector.includes(':has-text(')) {
      // 텍스트 기반 셀렉터
      locator = this.page.locator(selector).first();
    } else if (selector.includes('getByRole')) {
      // Playwright 메서드 형식 (문자열로 전달된 경우)
      // 이 경우는 직접 실행 불가, 셀렉터로 변환 필요
      locator = this.page.locator(selector).first();
    } else {
      locator = this.page.locator(selector).first();
    }

    await locator.waitFor({ state: 'visible', timeout: 5000 });
    await locator.click();

    this.log(`   클릭: ${selector.slice(0, 50)}`);
  }

  /**
   * 스크린샷 저장
   */
  private async takeScreenshot(name: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');

    const dir = this.config.screenshotDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filepath = path.join(dir, `${name}-${Date.now()}.png`);
    await this.page.screenshot({ path: filepath, fullPage: true });

    return filepath;
  }

  /**
   * 로그 출력
   */
  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[AutoPilot] ${message}`);
    }
  }

  /**
   * 현재 페이지 상태 조회
   */
  async getState(): Promise<PageState> {
    return this.decider.getCurrentState();
  }

  /**
   * 읽기 쉬운 상태 텍스트
   */
  async getReadableState(): Promise<string> {
    return this.decider.getReadableState();
  }

  /**
   * 버튼 비활성화 원인 분석
   */
  async analyzeButton(buttonText: string): Promise<string[]> {
    return this.decider.analyzeDisabledButton(buttonText);
  }

  /**
   * 단일 단계 실행 (디버깅용)
   */
  async stepOnce(goal: Goal): Promise<ExecutionStep> {
    const action = await this.decider.decideNextAction(goal);

    const step: ExecutionStep = {
      step: 1,
      timestamp: new Date().toISOString(),
      action,
      success: false
    };

    if (action.type !== 'done' && action.type !== 'blocked' && action.type !== 'explore') {
      try {
        await this.executeAction(action);
        step.success = true;
      } catch (error) {
        step.error = error instanceof Error ? error.message : String(error);
      }
    } else {
      step.success = action.type === 'done';
    }

    this.decider.recordAction(action);
    return step;
  }
}
