import { Page, Locator } from '@playwright/test';
import { WaitStrategy } from './wait-strategy';
import { SelectorGenerator, GeneratedSelector } from './selector-generator';

/**
 * 에러 타입
 */
export type ErrorType =
  | 'element-not-found'       // 요소를 찾을 수 없음
  | 'element-not-visible'     // 요소가 보이지 않음
  | 'element-not-interactable' // 요소와 상호작용 불가
  | 'element-detached'        // DOM에서 분리됨
  | 'value-not-persisted'     // 값이 저장되지 않음
  | 'timeout'                 // 시간 초과
  | 'navigation-error'        // 페이지 이동 에러
  | 'network-error'           // 네트워크 에러
  | 'selector-ambiguous'      // 여러 요소 매칭
  | 'unknown';                // 알 수 없는 에러

/**
 * 복구 전략
 */
export type RecoveryStrategyType =
  | 'retry-with-wait'         // 대기 후 재시도
  | 'scroll-into-view'        // 뷰포트로 스크롤
  | 'alternative-selector'    // 대체 셀렉터 사용
  | 'refresh-page'            // 페이지 새로고침
  | 'clear-and-retry'         // 초기화 후 재시도
  | 'extend-timeout'          // 타임아웃 연장
  | 'different-blur-method'   // 다른 blur 방법 시도
  | 'wait-for-network'        // 네트워크 안정화 대기
  | 'click-overlay-dismiss'   // 오버레이 제거
  | 'none';                   // 복구 불가

/**
 * 복구 시도 결과
 */
export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategyType;
  attempts: number;
  duration: number;
  errorType: ErrorType;
  newSelector?: string;       // 대체 셀렉터 사용 시
  message: string;
}

/**
 * 복구 옵션
 */
export interface RecoveryOptions {
  maxRetries?: number;
  timeout?: number;
  allowPageRefresh?: boolean;
  preserveState?: boolean;
}

/**
 * 에러 컨텍스트 (복구에 필요한 정보)
 */
interface ErrorContext {
  error: Error;
  errorType: ErrorType;
  selector?: string;
  value?: string;
  locator?: Locator;
  operation: 'click' | 'fill' | 'select' | 'wait' | 'navigate' | 'other';
}

/**
 * 복구 전략 정의
 */
interface RecoveryStrategy {
  errorTypes: ErrorType[];
  strategyType: RecoveryStrategyType;
  priority: number;           // 낮을수록 우선
  execute: (ctx: ErrorContext, page: Page) => Promise<boolean>;
}

/**
 * ErrorRecovery - 에러 유형별 복구 전략 관리
 *
 * 복구 전략:
 * | 에러 | 전략 |
 * |------|------|
 * | element-not-found | 대체 셀렉터 시도 |
 * | element-not-interactable | scrollIntoView + 대기 |
 * | value-not-persisted | 다른 blur 방법 시도 |
 * | timeout | timeout 연장 후 재시도 |
 */
export class ErrorRecovery {
  private page: Page;
  private waitStrategy: WaitStrategy;
  private selectorGenerator: SelectorGenerator;
  private strategies: RecoveryStrategy[];
  private defaultOptions: Required<RecoveryOptions>;

  constructor(page: Page, options: RecoveryOptions = {}) {
    this.page = page;
    this.waitStrategy = new WaitStrategy(page);
    this.selectorGenerator = new SelectorGenerator(page);
    this.defaultOptions = {
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeout ?? 10000,
      allowPageRefresh: options.allowPageRefresh ?? false,
      preserveState: options.preserveState ?? true
    };

    this.strategies = this.initializeStrategies();
  }

  /**
   * 복구 전략 초기화
   */
  private initializeStrategies(): RecoveryStrategy[] {
    return [
      // 1. 요소 보이지 않음 - 스크롤
      {
        errorTypes: ['element-not-visible', 'element-not-interactable'],
        strategyType: 'scroll-into-view',
        priority: 1,
        execute: async (ctx, page) => {
          if (!ctx.selector) return false;
          try {
            const locator = page.locator(ctx.selector).first();
            await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
            await page.waitForTimeout(500);
            return await locator.isVisible();
          } catch {
            return false;
          }
        }
      },

      // 2. 오버레이/모달이 가리는 경우 - 제거 시도
      {
        errorTypes: ['element-not-interactable'],
        strategyType: 'click-overlay-dismiss',
        priority: 2,
        execute: async (ctx, page) => {
          try {
            // 오버레이 닫기 시도
            const overlaySelectors = [
              '[class*="overlay"]',
              '[class*="backdrop"]',
              '[class*="modal-backdrop"]',
              '[role="presentation"]'
            ];

            for (const selector of overlaySelectors) {
              const overlay = page.locator(selector).first();
              const isVisible = await overlay.isVisible({ timeout: 500 }).catch(() => false);
              if (isVisible) {
                // ESC로 닫기 시도
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);

                // 다시 확인
                const stillVisible = await overlay.isVisible({ timeout: 300 }).catch(() => false);
                if (!stillVisible) return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        }
      },

      // 3. 요소 찾을 수 없음 - 대체 셀렉터
      {
        errorTypes: ['element-not-found', 'selector-ambiguous'],
        strategyType: 'alternative-selector',
        priority: 3,
        execute: async (ctx, page) => {
          // 대체 셀렉터는 attemptRecovery에서 처리
          return false;
        }
      },

      // 4. 값 persist 안됨 - 다른 blur 방법
      {
        errorTypes: ['value-not-persisted'],
        strategyType: 'different-blur-method',
        priority: 4,
        execute: async (ctx, page) => {
          if (!ctx.selector || !ctx.value) return false;

          try {
            const locator = page.locator(ctx.selector).first();

            // 방법 1: Tab 키
            await page.keyboard.press('Tab');
            await page.waitForTimeout(300);
            let currentValue = await locator.inputValue().catch(() => '');
            if (currentValue === ctx.value) return true;

            // 방법 2: 외부 클릭
            await page.evaluate(() => document.body.click());
            await page.waitForTimeout(300);
            currentValue = await locator.inputValue().catch(() => '');
            if (currentValue === ctx.value) return true;

            // 방법 3: JavaScript blur 이벤트
            await locator.evaluate((el) => {
              (el as HTMLElement).blur();
              el.dispatchEvent(new Event('blur', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.waitForTimeout(300);
            currentValue = await locator.inputValue().catch(() => '');
            if (currentValue === ctx.value) return true;

            // 방법 4: 포커스 이동
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
            currentValue = await locator.inputValue().catch(() => '');
            return currentValue === ctx.value;

          } catch {
            return false;
          }
        }
      },

      // 5. 타임아웃 - 대기 후 재시도
      {
        errorTypes: ['timeout'],
        strategyType: 'extend-timeout',
        priority: 5,
        execute: async (ctx, page) => {
          // DOM 안정화 대기
          const waitStrategy = new WaitStrategy(page);
          await waitStrategy.waitForDomStable({ timeout: 3000 });
          return true; // 재시도하도록
        }
      },

      // 6. 네트워크 에러 - 네트워크 안정화 대기
      {
        errorTypes: ['network-error'],
        strategyType: 'wait-for-network',
        priority: 6,
        execute: async (ctx, page) => {
          const waitStrategy = new WaitStrategy(page);
          const result = await waitStrategy.waitForNetworkIdle(5000);
          return result.success;
        }
      },

      // 7. 요소 분리됨 - 대기 후 재시도
      {
        errorTypes: ['element-detached'],
        strategyType: 'retry-with-wait',
        priority: 7,
        execute: async (ctx, page) => {
          const waitStrategy = new WaitStrategy(page);
          await waitStrategy.waitForDomStable({ timeout: 2000 });
          return true;
        }
      },

      // 8. 초기화 후 재시도
      {
        errorTypes: ['element-not-found', 'element-not-interactable', 'unknown'],
        strategyType: 'clear-and-retry',
        priority: 8,
        execute: async (ctx, page) => {
          // ESC로 모달/드롭다운 닫기
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);

          // 포커스 초기화
          await page.evaluate(() => {
            (document.activeElement as HTMLElement)?.blur?.();
          });
          await page.waitForTimeout(300);

          return true;
        }
      },

      // 9. 페이지 새로고침 (최후 수단)
      {
        errorTypes: ['navigation-error', 'unknown'],
        strategyType: 'refresh-page',
        priority: 10,
        execute: async (ctx, page) => {
          // allowPageRefresh가 true일 때만 실행
          // 실제 실행은 attemptRecovery에서 옵션 확인 후
          return false;
        }
      }
    ];
  }

  /**
   * 에러 타입 추론
   */
  classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();

    if (message.includes('not found') || message.includes('no element') || message.includes('locator resolved to')) {
      return 'element-not-found';
    }

    if (message.includes('not visible') || message.includes('hidden')) {
      return 'element-not-visible';
    }

    if (message.includes('not interactable') || message.includes('intercept') || message.includes('clickable')) {
      return 'element-not-interactable';
    }

    if (message.includes('detached') || message.includes('stale')) {
      return 'element-detached';
    }

    if (message.includes('timeout') || message.includes('exceeded')) {
      return 'timeout';
    }

    if (message.includes('navigation') || message.includes('navigate')) {
      return 'navigation-error';
    }

    if (message.includes('network') || message.includes('fetch') || message.includes('net::')) {
      return 'network-error';
    }

    if (message.includes('multiple') || message.includes('strict mode')) {
      return 'selector-ambiguous';
    }

    if (message.includes('value') && (message.includes('persist') || message.includes('mismatch'))) {
      return 'value-not-persisted';
    }

    return 'unknown';
  }

  /**
   * 에러 복구 시도
   */
  async attemptRecovery(
    error: Error,
    context: {
      selector?: string;
      value?: string;
      operation: 'click' | 'fill' | 'select' | 'wait' | 'navigate' | 'other';
    },
    options: RecoveryOptions = {}
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };
    const errorType = this.classifyError(error);

    const errorContext: ErrorContext = {
      error,
      errorType,
      selector: context.selector,
      value: context.value,
      operation: context.operation
    };

    // 적용 가능한 전략 필터링 (우선순위 정렬)
    const applicableStrategies = this.strategies
      .filter(s => s.errorTypes.includes(errorType))
      .sort((a, b) => a.priority - b.priority);

    if (applicableStrategies.length === 0) {
      return {
        success: false,
        strategy: 'none',
        attempts: 0,
        duration: Date.now() - startTime,
        errorType,
        message: `No recovery strategy for error type: ${errorType}`
      };
    }

    // 각 전략 시도
    for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
      for (const strategy of applicableStrategies) {
        // 페이지 새로고침은 옵션 확인
        if (strategy.strategyType === 'refresh-page' && !opts.allowPageRefresh) {
          continue;
        }

        // 대체 셀렉터 전략은 별도 처리
        if (strategy.strategyType === 'alternative-selector') {
          const altResult = await this.tryAlternativeSelector(errorContext);
          if (altResult.success) {
            return {
              ...altResult,
              attempts: attempt,
              duration: Date.now() - startTime
            };
          }
          continue;
        }

        try {
          const success = await strategy.execute(errorContext, this.page);
          if (success) {
            return {
              success: true,
              strategy: strategy.strategyType,
              attempts: attempt,
              duration: Date.now() - startTime,
              errorType,
              message: `Recovered using ${strategy.strategyType}`
            };
          }
        } catch {
          // 전략 실행 실패, 다음 전략 시도
        }
      }

      // 재시도 전 대기
      if (attempt < opts.maxRetries) {
        await this.page.waitForTimeout(500 * attempt);
      }
    }

    // 최후 수단: 페이지 새로고침
    if (opts.allowPageRefresh && !opts.preserveState) {
      try {
        await this.page.reload({ waitUntil: 'networkidle', timeout: opts.timeout });
        return {
          success: true,
          strategy: 'refresh-page',
          attempts: opts.maxRetries + 1,
          duration: Date.now() - startTime,
          errorType,
          message: 'Recovered by page refresh'
        };
      } catch {
        // 새로고침도 실패
      }
    }

    return {
      success: false,
      strategy: 'none',
      attempts: opts.maxRetries,
      duration: Date.now() - startTime,
      errorType,
      message: `Failed to recover from ${errorType} after ${opts.maxRetries} attempts`
    };
  }

  /**
   * 대체 셀렉터로 복구 시도
   */
  private async tryAlternativeSelector(ctx: ErrorContext): Promise<RecoveryResult & { newSelector?: string }> {
    if (!ctx.selector) {
      return {
        success: false,
        strategy: 'alternative-selector',
        attempts: 0,
        duration: 0,
        errorType: ctx.errorType,
        message: 'No selector provided'
      };
    }

    try {
      // 기존 셀렉터로 요소 찾기 시도
      const locator = this.page.locator(ctx.selector).first();
      const count = await locator.count().catch(() => 0);

      if (count === 0) {
        // 대체 셀렉터 생성 시도 (텍스트 기반)
        // 셀렉터에서 텍스트 추출 시도
        const textMatch = ctx.selector.match(/:has-text\("([^"]+)"\)|text="([^"]+)"|text='([^']+)'/);
        if (textMatch) {
          const text = textMatch[1] || textMatch[2] || textMatch[3];
          const alternativeSelectors = [
            `button:has-text("${text}")`,
            `[role="button"]:has-text("${text}")`,
            `input[value="${text}"]`,
            `*:has-text("${text}")`
          ];

          for (const altSelector of alternativeSelectors) {
            const altLocator = this.page.locator(altSelector).first();
            const altCount = await altLocator.count().catch(() => 0);
            const isVisible = altCount > 0 && await altLocator.isVisible({ timeout: 1000 }).catch(() => false);

            if (isVisible) {
              return {
                success: true,
                strategy: 'alternative-selector',
                attempts: 1,
                duration: 0,
                errorType: ctx.errorType,
                newSelector: altSelector,
                message: `Found alternative selector: ${altSelector}`
              };
            }
          }
        }
      }

      return {
        success: false,
        strategy: 'alternative-selector',
        attempts: 1,
        duration: 0,
        errorType: ctx.errorType,
        message: 'No alternative selector found'
      };

    } catch {
      return {
        success: false,
        strategy: 'alternative-selector',
        attempts: 1,
        duration: 0,
        errorType: ctx.errorType,
        message: 'Failed to find alternative selector'
      };
    }
  }

  /**
   * 작업 실행 with 자동 복구
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    context: {
      selector?: string;
      value?: string;
      operationType: 'click' | 'fill' | 'select' | 'wait' | 'navigate' | 'other';
    },
    options: RecoveryOptions = {}
  ): Promise<{ result?: T; recovered: boolean; recoveryResult?: RecoveryResult }> {
    const opts = { ...this.defaultOptions, ...options };

    for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
      try {
        const result = await operation();
        return { result, recovered: attempt > 1 };
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        if (attempt === opts.maxRetries) {
          // 마지막 시도 - 복구 전략 실행
          const recoveryResult = await this.attemptRecovery(error, {
            selector: context.selector,
            value: context.value,
            operation: context.operationType
          }, options);

          if (recoveryResult.success) {
            // 복구 후 재시도
            try {
              const result = await operation();
              return { result, recovered: true, recoveryResult };
            } catch {
              // 복구 후에도 실패
              throw error;
            }
          }

          throw error;
        }

        // 재시도 전 대기
        await this.page.waitForTimeout(300 * attempt);
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * 특정 에러 타입에 대한 복구 가능 여부
   */
  canRecover(errorType: ErrorType): boolean {
    return this.strategies.some(s => s.errorTypes.includes(errorType));
  }

  /**
   * 에러에 대한 권장 복구 전략
   */
  getRecommendedStrategy(error: Error): RecoveryStrategyType {
    const errorType = this.classifyError(error);
    const strategy = this.strategies
      .filter(s => s.errorTypes.includes(errorType))
      .sort((a, b) => a.priority - b.priority)[0];

    return strategy?.strategyType ?? 'none';
  }
}
