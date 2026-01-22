import { Page, expect } from '@playwright/test';
import { DOMExplorer } from '../explorer/dom-explorer';
import { ModalHandler } from '../modal/modal-handler';
import { TestDataManager } from '../data/test-data-manager';
import { FlowRecorder } from '../flow/flow-recorder';

export interface AppConfig {
  name: string;
  baseUrl: string;
  verifySelector?: string;
}

/**
 * 통합 테스트 헬퍼 - 모든 모듈을 조합해서 사용
 */
export class TestHelper {
  page: Page;
  explorer: DOMExplorer;
  modalHandler: ModalHandler;
  dataManager: TestDataManager;
  flowRecorder: FlowRecorder;

  private appConfig: AppConfig;

  constructor(page: Page, appConfig: AppConfig) {
    this.page = page;
    this.appConfig = appConfig;

    this.explorer = new DOMExplorer(page);
    this.modalHandler = new ModalHandler(page);
    this.dataManager = new TestDataManager(page);
    this.flowRecorder = new FlowRecorder(page);

    // AB180 확인 모달 패턴 추가
    this.modalHandler.addAB180ConfirmPattern(appConfig.name);
  }

  /**
   * 앱 접근 및 검증
   */
  async accessApp(): Promise<boolean> {
    try {
      // 1. 앱 목록 페이지로 이동
      await this.page.goto('/app', { timeout: 60000 });

      // 2. 앱 목록 확인
      await expect(this.page.getByRole('heading', { name: '앱 목록' }))
        .toBeVisible({ timeout: 10000 });

      // 3. 모달 처리
      await this.modalHandler.waitAndHandle(1000);

      // 4. 앱 클릭
      await this.page.getByRole('link', { name: this.appConfig.name }).click();
      await this.page.waitForTimeout(2000);

      // 5. 앱 진입 확인
      const verifySelector = this.appConfig.verifySelector
        || `button:has-text("${this.appConfig.name}")`;
      await expect(this.page.locator(verifySelector).first())
        .toBeVisible({ timeout: 10000 });

      // 6. 추가 모달 처리
      await this.modalHandler.waitAndHandle(1000);

      console.log(`[TestHelper] 앱 접근 성공: ${this.appConfig.name}`);
      return true;

    } catch (error) {
      console.log(`[TestHelper] 앱 접근 실패:`, error);
      return false;
    }
  }

  /**
   * 현재 앱 위치 확인
   */
  async verifyAppLocation(): Promise<boolean> {
    const verifySelector = this.appConfig.verifySelector
      || `button:has-text("${this.appConfig.name}")`;

    try {
      await expect(this.page.locator(verifySelector).first())
        .toBeVisible({ timeout: 5000 });
      return true;
    } catch {
      console.log(`[TestHelper] 앱 위치 확인 실패: ${this.appConfig.name}`);
      return false;
    }
  }

  /**
   * 사이드바 메뉴 네비게이션
   */
  async navigateToMenu(menuPath: string[]): Promise<boolean> {
    try {
      // 모달 먼저 처리
      await this.modalHandler.handleAllModals();

      for (let i = 0; i < menuPath.length; i++) {
        const menu = menuPath[i];
        const isLast = i === menuPath.length - 1;

        // exact: true로 정확한 매칭
        const menuItem = this.page.getByText(menu, { exact: true });
        await menuItem.click();
        await this.page.waitForTimeout(isLast ? 2000 : 500);

        // 모달 처리
        await this.modalHandler.handleAllModals();
      }

      // 앱 위치 재확인
      await this.verifyAppLocation();

      console.log(`[TestHelper] 메뉴 이동 완료: ${menuPath.join(' > ')}`);
      return true;

    } catch (error) {
      console.log(`[TestHelper] 메뉴 이동 실패:`, error);
      return false;
    }
  }

  /**
   * 요소 탐색 및 셀렉터 제안
   */
  async findElement(description: string): Promise<string[]> {
    console.log(`[TestHelper] 요소 탐색: "${description}"`);

    // 텍스트로 검색
    const byText = await this.explorer.findByText(description);
    if (byText.length > 0) {
      console.log(`[TestHelper] ${byText.length}개 요소 발견 (텍스트)`);
      return byText.flatMap(el => el.suggestedSelectors);
    }

    // 전체 페이지 탐색
    const result = await this.explorer.exploreAndSave(`search-${Date.now()}`);

    // 관련 요소 필터링
    const keywords = description.toLowerCase().split(' ');
    const matches = result.elements.filter(el => {
      const text = `${el.text} ${el.ariaLabel || ''} ${el.role || ''}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });

    if (matches.length > 0) {
      console.log(`[TestHelper] ${matches.length}개 관련 요소 발견`);
      return matches.flatMap(el => el.suggestedSelectors);
    }

    console.log('[TestHelper] 요소를 찾을 수 없습니다.');
    return [];
  }

  /**
   * 안전한 클릭 (모달 처리 포함)
   */
  async safeClick(selector: string, options?: { timeout?: number }): Promise<boolean> {
    try {
      await this.modalHandler.handleAllModals();
      await this.page.locator(selector).first().click({ timeout: options?.timeout || 10000 });
      await this.page.waitForTimeout(500);
      await this.modalHandler.handleAllModals();
      return true;
    } catch (error) {
      console.log(`[TestHelper] 클릭 실패: ${selector}`, error);
      return false;
    }
  }

  /**
   * 안전한 입력 (이벤트 발생 포함)
   */
  async safeFill(selector: string, value: string): Promise<boolean> {
    try {
      const input = this.page.locator(selector).first();
      await input.click();
      await input.clear();
      await input.type(value, { delay: 30 });

      // blur 이벤트 발생
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(300);

      return true;
    } catch (error) {
      console.log(`[TestHelper] 입력 실패: ${selector}`, error);
      return false;
    }
  }

  /**
   * 요소가 나타날 때까지 시도
   */
  async waitForElement(
    selectorCandidates: string[],
    timeout: number = 10000
  ): Promise<string | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      for (const selector of selectorCandidates) {
        try {
          const isVisible = await this.page.locator(selector)
            .isVisible({ timeout: 500 });
          if (isVisible) {
            console.log(`[TestHelper] 요소 발견: ${selector}`);
            return selector;
          }
        } catch {
          continue;
        }
      }
      await this.page.waitForTimeout(500);
    }

    console.log('[TestHelper] 요소를 찾을 수 없습니다:', selectorCandidates);
    return null;
  }

  /**
   * 플로우 기록 시작
   */
  startRecording(flowName: string, description?: string) {
    this.flowRecorder.startFlow(flowName, description);
  }

  /**
   * 플로우 기록 종료
   */
  endRecording() {
    return this.flowRecorder.endFlow();
  }

  /**
   * 현재 상태 스냅샷
   */
  async snapshot(name: string) {
    return this.explorer.exploreAndSave(name);
  }
}

/**
 * 재시도 유틸리티
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delay?: number; onError?: (error: any, attempt: number) => void } = {}
): Promise<T> {
  const { maxAttempts = 3, delay = 1000, onError } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      onError?.(error, attempt);

      if (attempt < maxAttempts) {
        console.log(`[Retry] 시도 ${attempt}/${maxAttempts} 실패, ${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * 조건부 테스트 스킵
 */
export function skipIf(condition: boolean, reason: string) {
  if (condition) {
    console.log(`[Skip] ${reason}`);
    return true;
  }
  return false;
}
