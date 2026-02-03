import { Page, expect } from '@playwright/test';
import { ActionDecider, Action, Goal, FieldStrategy } from './action-decider';
import { PageState } from './page-state-analyzer';
import { ModalHandler } from '../modal/modal-handler';
import { SmartFieldAnalyzer, AnalyzedField } from './smart-field-analyzer';
import { InteractionHandler, InteractionResult } from './interaction-handler';
import { WaitStrategy } from './wait-strategy';
import { DropdownHandler } from './dropdown-handler';
import { ErrorRecovery } from './error-recovery';
import {
  ExtendedGoal,
  FieldInstruction,
  matchesFieldIdentifier,
  resolveValue,
  normalizeGoal
} from './instruction-types';

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

  // 신규 옵션
  useSmartAnalysis?: boolean; // 스마트 필드 분석 사용 (기본: true)
  useAdaptiveWait?: boolean;  // 적응형 대기 사용 (기본: true)
  strictMode?: boolean;       // 명시적 지시만 처리 (기본: false)
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

  // 신규 모듈
  private smartAnalyzer: SmartFieldAnalyzer;
  private interactionHandler: InteractionHandler;
  private waitStrategy: WaitStrategy;
  private dropdownHandler: DropdownHandler;
  private errorRecovery: ErrorRecovery;

  // 명시적 지시 처리 상태
  private processedInstructions: Set<number> = new Set();

  constructor(page: Page, config: AutoPilotConfig = {}) {
    this.page = page;
    this.decider = new ActionDecider(page);
    this.modalHandler = new ModalHandler(page);

    // 신규 모듈 초기화
    this.smartAnalyzer = new SmartFieldAnalyzer(page);
    this.interactionHandler = new InteractionHandler(page);
    this.waitStrategy = new WaitStrategy(page);
    this.dropdownHandler = new DropdownHandler(page, { maxRetries: config.maxRetries ?? 3 });
    this.errorRecovery = new ErrorRecovery(page, { maxRetries: config.maxRetries ?? 3 });

    this.config = {
      maxSteps: config.maxSteps ?? 20,
      stepDelay: config.stepDelay ?? 500,
      typeDelay: config.typeDelay ?? 30,
      enableScreenshots: config.enableScreenshots ?? false,
      screenshotDir: config.screenshotDir ?? './autopilot-screenshots',
      verbose: config.verbose ?? true,
      retryOnError: config.retryOnError ?? true,
      maxRetries: config.maxRetries ?? 2,
      useSmartAnalysis: config.useSmartAnalysis ?? true,
      useAdaptiveWait: config.useAdaptiveWait ?? true,
      strictMode: config.strictMode ?? false
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
   * ExtendedGoal과 기존 Goal 모두 지원
   */
  async execute(goal: Goal | ExtendedGoal): Promise<ExecutionResult> {
    const startTime = Date.now();
    const steps: ExecutionStep[] = [];
    let currentStep = 0;
    let retryCount = 0;

    // Goal 정규화
    const extendedGoal = normalizeGoal(goal as ExtendedGoal);
    const targetButtonText = typeof extendedGoal.targetButton === 'string'
      ? extendedGoal.targetButton
      : extendedGoal.targetButton?.text?.toString();

    // 명시적 지시 처리 상태 초기화
    this.processedInstructions.clear();

    this.log(`🚀 AutoPilot 시작: ${extendedGoal.name}`);
    this.log(`   목표 버튼: ${targetButtonText || '(없음)'}`);
    this.log(`   성공 지표: ${extendedGoal.successIndicator || '(없음)'}`);

    if (extendedGoal.fieldInstructions?.length) {
      this.log(`   명시적 지시: ${extendedGoal.fieldInstructions.length}개 필드`);
    }

    try {
      // 적응형 대기로 초기 DOM 안정화
      if (this.config.useAdaptiveWait) {
        await this.waitStrategy.waitForDomStable({ timeout: 3000 });
      }

      while (currentStep < this.config.maxSteps) {
        currentStep++;

        // 1. 명시적 지시가 있으면 우선 처리
        if (extendedGoal.fieldInstructions?.length) {
          const instructionAction = await this.processNextInstruction(extendedGoal);
          if (instructionAction) {
            this.log(`\n[Step ${currentStep}] 명시적 지시: ${instructionAction.reason}`);

            const step: ExecutionStep = {
              step: currentStep,
              timestamp: new Date().toISOString(),
              action: instructionAction,
              success: false
            };

            try {
              await this.executeAction(instructionAction);
              step.success = true;
              retryCount = 0;
            } catch (error) {
              step.success = false;
              step.error = error instanceof Error ? error.message : String(error);
              this.log(`   ❌ 실패: ${step.error}`);
            }

            this.decider.recordAction(instructionAction);
            steps.push(step);
            await this.page.waitForTimeout(this.config.stepDelay);
            continue;
          }
        }

        // 2. 기존 로직: 다음 행동 결정
        const legacyGoal: Goal = {
          name: extendedGoal.name,
          targetButton: targetButtonText,
          successIndicator: typeof extendedGoal.successIndicator === 'string'
            ? extendedGoal.successIndicator
            : (extendedGoal.successIndicator as any)?.value,
          requiredFields: extendedGoal.requiredFields
        };

        const action = await this.decider.decideNextAction(legacyGoal);
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
          if (targetButtonText) {
            const reasons = await this.decider.analyzeDisabledButton(targetButtonText);
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
   * 입력 필드 채우기 (개선된 버전)
   * SmartFieldAnalyzer, InteractionHandler, DropdownHandler, ErrorRecovery 통합
   */
  private async fillInput(selector: string, value: string): Promise<void> {
    const locator = this.page.locator(selector).first();

    this.log(`   입력: "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`);

    // 스마트 분석 사용 시
    if (this.config.useSmartAnalysis) {
      try {
        const analyzed = await this.smartAnalyzer.analyzeField(locator);
        this.log(`   필드 타입: ${analyzed.fieldType}, 목적: ${analyzed.purpose}`);

        // 드롭다운/콤보박스인 경우 DropdownHandler 사용
        if (analyzed.fieldType === 'dropdown' || analyzed.fieldType === 'combobox') {
          const dropdownResult = await this.dropdownHandler.selectOrCreate({
            selector: analyzed.context.selector,
            value,
            timeout: 10000,
            maxRetries: this.config.maxRetries,
            allowCreate: true,
            typeDelay: this.config.typeDelay
          });

          if (dropdownResult.success) {
            this.log(`   ✓ 드롭다운 성공 (방법: ${dropdownResult.method})`);
            return;
          } else {
            this.log(`   ⚠️ 드롭다운 실패: ${dropdownResult.error}`);
            // ErrorRecovery로 복구 시도
            const recoveryResult = await this.errorRecovery.attemptRecovery(
              new Error(dropdownResult.error || 'Dropdown selection failed'),
              { selector, value, operation: 'select' }
            );
            if (recoveryResult.success) {
              this.log(`   ↻ 복구 성공 (전략: ${recoveryResult.strategy})`);
              // 복구 후 재시도
              const retryResult = await this.dropdownHandler.selectOrCreate({
                selector: recoveryResult.newSelector || selector,
                value,
                timeout: 10000,
                maxRetries: 1
              });
              if (retryResult.success) {
                this.log(`   ✓ 복구 후 드롭다운 성공`);
                return;
              }
            }
          }
        }

        // 일반 필드 처리
        const result = await this.interactionHandler.fillField(analyzed, value, {
          typeDelay: this.config.typeDelay,
          retries: this.config.maxRetries
        });

        if (!result.success) {
          this.log(`   ⚠️ InteractionHandler 실패: ${result.error}`);

          // ErrorRecovery로 복구 시도
          const recoveryResult = await this.errorRecovery.attemptRecovery(
            new Error(result.error || 'Fill failed'),
            { selector, value, operation: 'fill' }
          );

          if (recoveryResult.success) {
            this.log(`   ↻ 복구 성공 (전략: ${recoveryResult.strategy})`);
            // 복구 후 legacy 방식으로 재시도
            await this.fillInputLegacy(
              recoveryResult.newSelector || selector,
              value
            );
          } else {
            // Fallback to legacy method
            await this.fillInputLegacy(selector, value);
          }
        } else {
          this.log(`   ✓ 성공 (방법: ${result.method})`);

          // 값 persist 검증 (CRITICAL)
          const persistVerified = await this.verifyValuePersistence(locator, value);
          if (!persistVerified) {
            this.log(`   ⚠️ 값 persist 검증 실패, 재시도`);
            await this.fillInputLegacy(selector, value);
          }
        }
        return;
      } catch (error) {
        this.log(`   스마트 분석 실패, 기존 방식 사용: ${error}`);
      }
    }

    // 기존 방식 (fallback)
    await this.fillInputLegacy(selector, value);
  }

  /**
   * 값 persist 검증
   */
  private async verifyValuePersistence(
    locator: ReturnType<Page['locator']>,
    expectedValue: string
  ): Promise<boolean> {
    try {
      const result = await this.waitStrategy.waitForValuePersistence(
        locator,
        expectedValue,
        { timeout: 2000 }
      );
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * 기존 입력 방식 (fallback) - 개선된 버전
   */
  private async fillInputLegacy(selector: string, value: string): Promise<void> {
    const input = this.page.locator(selector).first();

    // 입력 필드가 보일 때까지 대기
    await input.waitFor({ state: 'visible', timeout: 5000 });

    // 상호작용 가능 대기
    const interactableResult = await this.waitStrategy.waitForInteractable(input, 3000);
    if (!interactableResult.success) {
      // 스크롤하여 보이게 시도
      await input.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(300);
    }

    // 클릭하여 포커스
    await input.click();

    // 기존 값 지우기
    await input.clear();

    // 타이핑 (이벤트 발생)
    await input.type(value, { delay: this.config.typeDelay });

    // 적응형 대기로 DOM 안정화
    if (this.config.useAdaptiveWait) {
      await this.waitStrategy.waitForDomStable({ timeout: 2000 });
    } else {
      await this.page.waitForTimeout(800);
    }

    // 드롭다운/자동완성 처리 (DropdownHandler 사용)
    const dropdownHandled = await this.handleDropdownAddButton(value);

    // 드롭다운이 아닌 경우 blur 트리거 및 값 검증
    if (!dropdownHandled) {
      await this.triggerBlurWithVerification(input, value);
    }

    // 최종 값 검증 (CRITICAL)
    const finalValue = await input.inputValue().catch(() => '');
    if (finalValue !== value) {
      this.log(`   ⚠️ 값 불일치: 예상="${value.slice(0, 20)}", 실제="${finalValue.slice(0, 20)}"`);

      // 1회 더 재시도
      await input.clear();
      await input.fill(value); // type 대신 fill 시도
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(300);

      const retryValue = await input.inputValue().catch(() => '');
      if (retryValue !== value) {
        throw new Error(`Value not persisted after retry. Expected: "${value}", Got: "${retryValue}"`);
      }
    }
  }

  /**
   * Blur 트리거 및 값 검증
   */
  private async triggerBlurWithVerification(
    locator: ReturnType<Page['locator']>,
    expectedValue: string
  ): Promise<void> {
    // 방법 1: Tab 키
    await this.page.keyboard.press('Tab');
    await this.page.waitForTimeout(200);

    // 값 확인
    let currentValue = await locator.inputValue().catch(() => '');
    if (currentValue === expectedValue) return;

    // 방법 2: 외부 클릭
    await this.page.evaluate(() => document.body.click());
    await this.page.waitForTimeout(200);

    currentValue = await locator.inputValue().catch(() => '');
    if (currentValue === expectedValue) return;

    // 방법 3: JavaScript blur 이벤트
    try {
      await locator.evaluate((el) => {
        (el as HTMLElement).blur();
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } catch {
      // 무시
    }
  }

  /**
   * 드롭다운/자동완성 "추가" 버튼 처리 (개선된 버전 - DropdownHandler 활용)
   */
  private async handleDropdownAddButton(typedValue: string): Promise<boolean> {
    // 적응형 대기로 드롭다운 옵션 로드 대기
    if (this.config.useAdaptiveWait) {
      await this.waitStrategy.waitForDomStable({ timeout: 2000 });
    } else {
      await this.page.waitForTimeout(800);
    }

    // 드롭다운이 열려있는지 확인
    const dropdownSelectors = [
      '[role="listbox"]',
      '[role="menu"]',
      '[class*="dropdown-menu"]',
      '[class*="autocomplete"]',
      '[class*="suggestions"]'
    ];

    let isDropdownOpen = false;
    for (const selector of dropdownSelectors) {
      const dropdown = this.page.locator(selector).first();
      const isVisible = await dropdown.isVisible({ timeout: 500 }).catch(() => false);
      if (isVisible) {
        isDropdownOpen = true;
        break;
      }
    }

    if (!isDropdownOpen) {
      this.log(`   드롭다운 없음`);
      return false;
    }

    // 특수문자 이스케이프 (완벽한 처리)
    const escapedValue = this.escapeForDropdownSelector(typedValue);

    // 우선순위 1: [role="option"] 직접 클릭 (Playwright click 사용)
    const optionPatterns = [
      `[role="option"]:has-text("${escapedValue}")`,
      `[role="option"]:text-is("${escapedValue}")`,
      `[role="listitem"]:has-text("${escapedValue}")`,
      `li:has-text("${escapedValue}")`
    ];

    for (const pattern of optionPatterns) {
      try {
        const option = this.page.locator(pattern).first();
        const exists = await option.count() > 0;
        if (!exists) continue;

        const isVisible = await option.isVisible({ timeout: 500 }).catch(() => false);
        if (!isVisible) continue;

        const text = await option.textContent().catch(() => '');
        this.log(`   드롭다운 옵션 발견: "${text?.trim().slice(0, 50)}"`);

        // Playwright click 사용 (evaluate().click() 대신 - CRITICAL FIX)
        await option.click({ timeout: 2000 });
        this.log(`   ✓ 드롭다운 선택 완료`);

        // 선택 후 DOM 안정화 대기
        if (this.config.useAdaptiveWait) {
          await this.waitStrategy.waitForDomStable({ timeout: 1000 });
        } else {
          await this.page.waitForTimeout(300);
        }

        return true;
      } catch {
        continue;
      }
    }

    // 우선순위 2: "추가" 버튼 클릭
    const addPatterns = [
      `[role="option"]:has-text("${escapedValue} 추가")`,
      `[role="option"]:has-text("추가"):has-text("${escapedValue}")`,
      `button:has-text("${escapedValue} 추가")`,
      `li:has-text("${escapedValue} 추가")`
    ];

    for (const pattern of addPatterns) {
      try {
        const addBtn = this.page.locator(pattern).first();
        const isVisible = await addBtn.isVisible({ timeout: 500 }).catch(() => false);
        if (!isVisible) continue;

        const btnText = await addBtn.textContent().catch(() => '');
        if (btnText?.includes('추가') || btnText?.includes('Add')) {
          this.log(`   "추가" 버튼 발견: "${btnText?.trim().slice(0, 50)}"`);
          await addBtn.click({ timeout: 2000 });
          this.log(`   ✓ "추가" 버튼 클릭 완료`);

          if (this.config.useAdaptiveWait) {
            await this.waitStrategy.waitForDomStable({ timeout: 1000 });
          } else {
            await this.page.waitForTimeout(300);
          }

          return true;
        }
      } catch {
        continue;
      }
    }

    // 우선순위 3: Enter 키로 선택
    try {
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(300);

      // Enter 후 드롭다운이 닫혔는지 확인
      let stillOpen = false;
      for (const selector of dropdownSelectors) {
        const dropdown = this.page.locator(selector).first();
        const isVisible = await dropdown.isVisible({ timeout: 300 }).catch(() => false);
        if (isVisible) {
          stillOpen = true;
          break;
        }
      }

      if (!stillOpen) {
        this.log(`   ✓ Enter로 선택 완료`);
        return true;
      }
    } catch {
      // 무시
    }

    // 우선순위 4: Tab으로 blur (값 확정)
    try {
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(300);

      // Tab 후 드롭다운이 닫혔는지 확인
      let stillOpen = false;
      for (const selector of dropdownSelectors) {
        const dropdown = this.page.locator(selector).first();
        const isVisible = await dropdown.isVisible({ timeout: 300 }).catch(() => false);
        if (isVisible) {
          stillOpen = true;
          break;
        }
      }

      if (!stillOpen) {
        this.log(`   ✓ Tab으로 값 확정`);
        return true;
      }
    } catch {
      // 무시
    }

    this.log(`   드롭다운 옵션 선택 실패`);
    return false;
  }

  /**
   * 드롭다운 셀렉터용 특수문자 이스케이프
   */
  private escapeForDropdownSelector(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')
      .slice(0, 100);
  }

  /**
   * 다음 명시적 지시 처리
   */
  private async processNextInstruction(goal: ExtendedGoal): Promise<Action | null> {
    if (!goal.fieldInstructions?.length) return null;

    // 모든 필드 분석
    const allFields = await this.smartAnalyzer.analyzeAllFields();

    for (let i = 0; i < goal.fieldInstructions.length; i++) {
      // 이미 처리된 지시 건너뛰기
      if (this.processedInstructions.has(i)) continue;

      const instruction = goal.fieldInstructions[i];
      const { field, value, skipIfFilled = true } = instruction;

      // 매칭되는 필드 찾기
      const matchedField = allFields.find((f, idx) =>
        matchesFieldIdentifier(field, {
          selector: f.context.selector,
          name: f.context.name,
          label: f.context.label,
          placeholder: f.context.placeholder,
          ariaLabel: f.context.ariaLabel,
          purpose: f.purpose
        }, idx)
      );

      if (!matchedField) {
        this.log(`   명시적 지시 ${i}: 필드를 찾을 수 없음`);
        continue;
      }

      // 이미 값이 있으면 건너뛰기
      if (skipIfFilled && matchedField.context.value) {
        this.processedInstructions.add(i);
        continue;
      }

      // 비활성화된 필드 건너뛰기
      if (matchedField.context.disabled) {
        continue;
      }

      // 값 해결
      const resolvedValue = resolveValue(value);

      // 지시 처리 완료로 표시
      this.processedInstructions.add(i);

      return {
        type: 'fill',
        selector: matchedField.context.selector,
        value: resolvedValue,
        reason: `명시적 지시: ${matchedField.context.label || matchedField.context.placeholder || '필드'}에 "${resolvedValue.slice(0, 20)}" 입력`,
        confidence: 1.0
      };
    }

    return null; // 모든 지시 처리 완료
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
