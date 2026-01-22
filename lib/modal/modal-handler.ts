import { Page } from '@playwright/test';

export interface ModalPattern {
  name: string;
  detectText?: string;
  detectSelector?: string;
  closeAction: 'escape' | 'click' | 'fill-and-click';
  closeSelector?: string;
  fillSelector?: string;
  fillValue?: string | ((page: Page) => Promise<string>);
  priority: number; // 낮을수록 먼저 처리
}

/**
 * 모달 자동 처리기 - 예상치 못한 모달을 자동으로 감지하고 닫음
 */
export class ModalHandler {
  private page: Page;
  private patterns: ModalPattern[] = [];
  private handledModals: string[] = [];

  constructor(page: Page) {
    this.page = page;
    this.initDefaultPatterns();
  }

  /**
   * 기본 모달 패턴 등록
   */
  private initDefaultPatterns() {
    // 무료 체험 종료 모달
    this.addPattern({
      name: 'trial-ended',
      detectText: '무료 체험이 종료됐습니다',
      closeAction: 'escape',
      priority: 1
    });

    // Ask Airbridge 팝업
    this.addPattern({
      name: 'ask-airbridge',
      detectText: 'Ask Airbridge',
      closeAction: 'escape',
      priority: 2
    });

    // 일반 닫기 버튼이 있는 모달
    this.addPattern({
      name: 'generic-close-button',
      detectSelector: '[role="dialog"] button:has-text("닫기")',
      closeAction: 'click',
      closeSelector: '[role="dialog"] button:has-text("닫기")',
      priority: 10
    });

    // 일반 X 버튼
    this.addPattern({
      name: 'generic-x-button',
      detectSelector: '[role="dialog"] button[aria-label="close"], [role="dialog"] button:has-text("×")',
      closeAction: 'click',
      closeSelector: '[role="dialog"] button[aria-label="close"], [role="dialog"] button:has-text("×")',
      priority: 11
    });
  }

  /**
   * 커스텀 모달 패턴 추가
   */
  addPattern(pattern: ModalPattern) {
    this.patterns.push(pattern);
    this.patterns.sort((a, b) => a.priority - b.priority);
  }

  /**
   * AB180 확인 모달 패턴 추가 (앱 이름 자동 입력)
   */
  addAB180ConfirmPattern(appName: string) {
    this.addPattern({
      name: 'ab180-confirm',
      detectText: 'AB180 내부 확인',
      closeAction: 'fill-and-click',
      fillSelector: 'input',
      fillValue: async (page) => {
        // 모달에서 링크 태그의 텍스트 추출 (동적 앱 이름)
        const linkText = await page.locator('[role="dialog"] a, [role="alertdialog"] a').first()
          .textContent().catch(() => null);
        return linkText?.trim() || appName;
      },
      closeSelector: 'button:has-text("삭제")',
      priority: 5
    });
  }

  /**
   * 현재 보이는 모달 감지
   */
  async detectModal(): Promise<ModalPattern | null> {
    for (const pattern of this.patterns) {
      try {
        let isVisible = false;

        if (pattern.detectText) {
          isVisible = await this.page.getByText(pattern.detectText)
            .isVisible({ timeout: 500 }).catch(() => false);
        }

        if (!isVisible && pattern.detectSelector) {
          isVisible = await this.page.locator(pattern.detectSelector)
            .isVisible({ timeout: 500 }).catch(() => false);
        }

        if (isVisible) {
          console.log(`[ModalHandler] 감지됨: ${pattern.name}`);
          return pattern;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * 감지된 모달 처리
   */
  async handleModal(pattern: ModalPattern): Promise<boolean> {
    try {
      console.log(`[ModalHandler] 처리 중: ${pattern.name}`);

      switch (pattern.closeAction) {
        case 'escape':
          await this.page.keyboard.press('Escape');
          break;

        case 'click':
          if (pattern.closeSelector) {
            await this.page.locator(pattern.closeSelector).first().click();
          }
          break;

        case 'fill-and-click':
          if (pattern.fillSelector && pattern.fillValue) {
            const value = typeof pattern.fillValue === 'function'
              ? await pattern.fillValue(this.page)
              : pattern.fillValue;

            // 모달 내 입력 필드 찾기
            const modal = this.page.locator('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="Modal"]').first();
            const input = modal.locator('input').first();

            await input.waitFor({ state: 'visible', timeout: 5000 });
            await input.click();
            await input.clear();
            await input.type(value, { delay: 50 });

            // blur 이벤트 발생
            await modal.locator('text=확인 문구').click().catch(() => {});
            await this.page.waitForTimeout(500);
          }

          if (pattern.closeSelector) {
            const closeBtn = this.page.locator(pattern.closeSelector).last();
            await closeBtn.waitFor({ state: 'visible', timeout: 5000 });

            // 버튼이 활성화될 때까지 대기
            let attempts = 0;
            while (attempts < 10) {
              const isDisabled = await closeBtn.isDisabled().catch(() => true);
              if (!isDisabled) break;
              await this.page.waitForTimeout(300);
              attempts++;
            }

            await closeBtn.click();
          }
          break;
      }

      this.handledModals.push(pattern.name);
      await this.page.waitForTimeout(500);
      console.log(`[ModalHandler] 완료: ${pattern.name}`);
      return true;

    } catch (error) {
      console.log(`[ModalHandler] 실패: ${pattern.name}`, error);
      return false;
    }
  }

  /**
   * 모든 보이는 모달 자동 처리 (반복)
   */
  async handleAllModals(maxIterations: number = 5): Promise<string[]> {
    const handled: string[] = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      const modal = await this.detectModal();
      if (!modal) break;

      const success = await this.handleModal(modal);
      if (success) {
        handled.push(modal.name);
      } else {
        break; // 실패하면 중단
      }

      iterations++;
    }

    if (handled.length > 0) {
      console.log(`[ModalHandler] 총 ${handled.length}개 모달 처리됨:`, handled);
    }

    return handled;
  }

  /**
   * 페이지 이동 후 자동으로 모달 처리
   */
  async waitAndHandle(timeout: number = 2000): Promise<string[]> {
    await this.page.waitForTimeout(timeout);
    return this.handleAllModals();
  }

  /**
   * 처리된 모달 목록 반환
   */
  getHandledModals(): string[] {
    return [...this.handledModals];
  }

  /**
   * 처리 기록 초기화
   */
  resetHistory() {
    this.handledModals = [];
  }
}
