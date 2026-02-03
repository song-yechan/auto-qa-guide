import { Page, Locator } from '@playwright/test';

/**
 * Wait 결과 타입
 */
export interface WaitResult {
  success: boolean;
  duration: number;
  reason?: string;
}

/**
 * Exponential Backoff 옵션
 */
export interface BackoffOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  multiplier?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * DOM Stability 옵션
 */
export interface DomStabilityOptions {
  timeout?: number;
  checkInterval?: number;
  stabilityThreshold?: number; // ms - DOM이 변경 없이 유지되어야 하는 시간
}

/**
 * WaitStrategy - 적응형 대기 시스템
 *
 * 고정 타임아웃 대신 DOM 상태, 네트워크, 값 persist를 기반으로 대기
 */
export class WaitStrategy {
  private page: Page;
  private defaultTimeout: number;

  constructor(page: Page, defaultTimeout: number = 10000) {
    this.page = page;
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * DOM 안정화 대기
   * MutationObserver를 사용하여 DOM 변경이 멈출 때까지 대기
   */
  async waitForDomStable(options: DomStabilityOptions = {}): Promise<WaitResult> {
    const {
      timeout = this.defaultTimeout,
      checkInterval = 100,
      stabilityThreshold = 500
    } = options;

    const startTime = Date.now();

    try {
      await this.page.evaluate(
        ({ stabilityThreshold, timeout }) => {
          return new Promise<void>((resolve, reject) => {
            let lastMutationTime = Date.now();
            let resolved = false;

            const observer = new MutationObserver(() => {
              lastMutationTime = Date.now();
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });

            const checkStability = () => {
              if (resolved) return;

              const timeSinceLastMutation = Date.now() - lastMutationTime;
              const elapsed = Date.now() - (Date.now() - timeout);

              if (timeSinceLastMutation >= stabilityThreshold) {
                resolved = true;
                observer.disconnect();
                resolve();
              } else if (Date.now() - lastMutationTime + stabilityThreshold > timeout) {
                resolved = true;
                observer.disconnect();
                resolve(); // 타임아웃 시에도 resolve (최선의 노력)
              } else {
                setTimeout(checkStability, 50);
              }
            };

            // 초기 대기 후 체크 시작
            setTimeout(checkStability, stabilityThreshold);

            // 전체 타임아웃
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                observer.disconnect();
                resolve();
              }
            }, timeout);
          });
        },
        { stabilityThreshold, timeout }
      );

      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 네트워크 Idle 대기
   * 진행 중인 네트워크 요청이 없을 때까지 대기
   */
  async waitForNetworkIdle(timeout?: number): Promise<WaitResult> {
    const startTime = Date.now();
    const waitTimeout = timeout ?? this.defaultTimeout;

    try {
      await this.page.waitForLoadState('networkidle', { timeout: waitTimeout });

      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      // networkidle 실패는 치명적이지 않음
      return {
        success: false,
        duration: Date.now() - startTime,
        reason: 'Network not idle within timeout'
      };
    }
  }

  /**
   * 값 Persist 확인
   * 입력한 값이 실제로 저장되었는지 확인
   */
  async waitForValuePersistence(
    locator: Locator,
    expectedValue: string,
    options: { timeout?: number; checkInterval?: number } = {}
  ): Promise<WaitResult> {
    const { timeout = this.defaultTimeout, checkInterval = 100 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const currentValue = await locator.inputValue();

        if (currentValue === expectedValue) {
          return {
            success: true,
            duration: Date.now() - startTime
          };
        }

        // attribute 기반 값도 확인 (contenteditable 등)
        const attrValue = await locator.getAttribute('value');
        if (attrValue === expectedValue) {
          return {
            success: true,
            duration: Date.now() - startTime
          };
        }

        // textContent 확인 (contenteditable)
        const textContent = await locator.textContent();
        if (textContent?.trim() === expectedValue) {
          return {
            success: true,
            duration: Date.now() - startTime
          };
        }
      } catch {
        // 요소 상태 변경 중일 수 있음
      }

      await this.page.waitForTimeout(checkInterval);
    }

    // 최종 값 확인
    let finalValue: string = '';
    try {
      finalValue = await locator.inputValue();
    } catch {
      try {
        finalValue = (await locator.textContent()) ?? '';
      } catch {
        finalValue = 'unknown';
      }
    }

    return {
      success: false,
      duration: Date.now() - startTime,
      reason: `Value not persisted. Expected: "${expectedValue}", Got: "${finalValue}"`
    };
  }

  /**
   * 요소 상호작용 가능 대기
   * 요소가 보이고, 활성화되고, 클릭 가능할 때까지 대기
   */
  async waitForInteractable(
    locator: Locator,
    timeout?: number
  ): Promise<WaitResult> {
    const startTime = Date.now();
    const waitTimeout = timeout ?? this.defaultTimeout;

    try {
      // 요소가 보일 때까지 대기
      await locator.waitFor({ state: 'visible', timeout: waitTimeout });

      // 추가로 actionability 체크
      const isEnabled = await locator.isEnabled();
      const isVisible = await locator.isVisible();

      if (!isEnabled) {
        return {
          success: false,
          duration: Date.now() - startTime,
          reason: 'Element is disabled'
        };
      }

      if (!isVisible) {
        return {
          success: false,
          duration: Date.now() - startTime,
          reason: 'Element is not visible'
        };
      }

      // 뷰포트 내에 있는지 확인
      const boundingBox = await locator.boundingBox();
      if (!boundingBox) {
        return {
          success: false,
          duration: Date.now() - startTime,
          reason: 'Element has no bounding box'
        };
      }

      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Exponential Backoff 재시도
   * 실패 시 지수적으로 증가하는 대기 시간으로 재시도
   */
  async withExponentialBackoff<T>(
    fn: () => Promise<T>,
    options: BackoffOptions = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      initialDelay = 100,
      maxDelay = 5000,
      multiplier = 2,
      shouldRetry = () => true
    } = options;

    let lastError: Error | null = null;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt >= maxRetries || !shouldRetry(lastError, attempt)) {
          throw lastError;
        }

        // 대기 후 재시도
        await this.page.waitForTimeout(delay);
        delay = Math.min(delay * multiplier, maxDelay);
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * 복합 대기 - DOM 안정화 + 네트워크 idle
   * 두 조건이 모두 만족될 때까지 대기
   */
  async waitForStableState(timeout?: number): Promise<WaitResult> {
    const startTime = Date.now();
    const waitTimeout = timeout ?? this.defaultTimeout;

    try {
      // 병렬로 실행하고 둘 다 완료될 때까지 대기
      const [domResult, networkResult] = await Promise.all([
        this.waitForDomStable({ timeout: waitTimeout }),
        this.waitForNetworkIdle(waitTimeout)
      ]);

      const success = domResult.success && networkResult.success;

      return {
        success,
        duration: Date.now() - startTime,
        reason: success
          ? undefined
          : `DOM: ${domResult.reason ?? 'ok'}, Network: ${networkResult.reason ?? 'ok'}`
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 조건부 대기 - 특정 조건이 true가 될 때까지 대기
   */
  async waitForCondition(
    condition: () => Promise<boolean>,
    options: { timeout?: number; interval?: number; description?: string } = {}
  ): Promise<WaitResult> {
    const {
      timeout = this.defaultTimeout,
      interval = 100,
      description = 'condition'
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        if (await condition()) {
          return {
            success: true,
            duration: Date.now() - startTime
          };
        }
      } catch {
        // 조건 체크 중 에러는 무시하고 재시도
      }

      await this.page.waitForTimeout(interval);
    }

    return {
      success: false,
      duration: Date.now() - startTime,
      reason: `${description} not met within ${timeout}ms`
    };
  }

  /**
   * 애니메이션 완료 대기
   * CSS 애니메이션/트랜지션이 완료될 때까지 대기
   */
  async waitForAnimationEnd(
    locator: Locator,
    timeout?: number
  ): Promise<WaitResult> {
    const startTime = Date.now();
    const waitTimeout = timeout ?? 2000; // 애니메이션은 보통 짧음

    try {
      await locator.evaluate((el) => {
        return new Promise<void>((resolve) => {
          const animations = el.getAnimations();

          if (animations.length === 0) {
            resolve();
            return;
          }

          Promise.all(animations.map((anim) => anim.finished))
            .then(() => resolve())
            .catch(() => resolve());
        });
      });

      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
