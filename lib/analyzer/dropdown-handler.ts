import { Page, Locator } from '@playwright/test';
import { WaitStrategy } from './wait-strategy';
import { escapeForHasText } from './selector-generator';

/**
 * 드롭다운 선택 결과
 */
export interface DropdownResult {
  success: boolean;
  method: DropdownSelectionMethod;
  attempts: number;
  duration: number;
  selectedValue?: string;
  error?: string;
}

/**
 * 드롭다운 선택 방법
 */
export type DropdownSelectionMethod =
  | 'native-select'       // <select> 태그
  | 'role-option-click'   // [role="option"] 클릭
  | 'listitem-click'      // li 클릭
  | 'add-button-click'    // "추가" 버튼 클릭
  | 'enter-key'           // Enter 키
  | 'tab-blur'            // Tab으로 blur
  | 'keyboard-navigation' // 키보드 화살표 + Enter
  | 'failed';             // 실패

/**
 * 드롭다운 설정
 */
export interface DropdownConfig {
  selector: string;
  value: string;
  timeout?: number;
  maxRetries?: number;
  allowCreate?: boolean;    // "추가" 버튼으로 새 항목 생성 허용
  exactMatch?: boolean;     // 정확한 텍스트 매칭 필요
  typeDelay?: number;       // 타이핑 딜레이 (combobox용)
}

/**
 * 드롭다운 옵션 정보
 */
interface DropdownOption {
  text: string;
  selector: string;
  isCreateOption: boolean;  // "xxx 추가" 형태인지
}

/**
 * DropdownHandler - 우선순위 기반 드롭다운 선택 처리
 *
 * 선택 우선순위:
 * 1. [role="option"] 직접 클릭 (Playwright click 사용)
 * 2. Enter 키 입력
 * 3. "추가" 버튼 클릭
 * 4. Tab으로 blur + API 대기
 *
 * 핵심 개선:
 * - evaluate().click() 대신 Playwright click() 사용
 * - 특수문자 완벽한 이스케이프 처리
 * - 3회 재시도 로직
 */
export class DropdownHandler {
  private page: Page;
  private waitStrategy: WaitStrategy;
  private defaultTimeout: number;
  private defaultRetries: number;

  constructor(page: Page, options: { timeout?: number; maxRetries?: number } = {}) {
    this.page = page;
    this.waitStrategy = new WaitStrategy(page);
    this.defaultTimeout = options.timeout ?? 10000;
    this.defaultRetries = options.maxRetries ?? 3;
  }

  /**
   * 드롭다운에서 값 선택 또는 새로 생성
   * 우선순위 기반으로 여러 방법 시도
   */
  async selectOrCreate(config: DropdownConfig): Promise<DropdownResult> {
    const {
      selector,
      value,
      timeout = this.defaultTimeout,
      maxRetries = this.defaultRetries,
      allowCreate = true,
      exactMatch = false,
      typeDelay = 30
    } = config;

    const startTime = Date.now();
    const locator = this.page.locator(selector).first();

    // 1. Native select 태그인지 확인
    try {
      const tagName = await locator.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'select') {
        const result = await this.handleNativeSelect(locator, value, timeout);
        if (result.success) {
          return { ...result, duration: Date.now() - startTime };
        }
      }
    } catch {
      // native select 아님, 다음 방법으로
    }

    // 2. Combobox/Custom Dropdown 처리 (재시도 로직)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 2a. 입력 필드에 포커스 및 값 입력
        await locator.click();
        await this.page.waitForTimeout(200);

        // 기존 값 지우기
        await locator.clear();

        // 값 타이핑 (이벤트 트리거를 위해)
        await locator.type(value, { delay: typeDelay });

        // DOM 안정화 대기 (드롭다운 옵션 로드)
        await this.waitStrategy.waitForDomStable({ timeout: 2000 });

        // 2b. 드롭다운 옵션 선택 시도 (우선순위별)
        const selectResult = await this.trySelectOption(value, {
          allowCreate,
          exactMatch,
          timeout
        });

        if (selectResult.success) {
          return {
            ...selectResult,
            attempts: attempt,
            duration: Date.now() - startTime
          };
        }

        // 실패 시 ESC로 드롭다운 닫고 재시도
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

      } catch (error) {
        if (attempt === maxRetries) {
          return {
            success: false,
            method: 'failed',
            attempts: attempt,
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
          };
        }

        // 에러 후 정리
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }
    }

    return {
      success: false,
      method: 'failed',
      attempts: maxRetries,
      duration: Date.now() - startTime,
      error: `Failed to select "${value}" after ${maxRetries} attempts`
    };
  }

  /**
   * Native <select> 태그 처리
   */
  private async handleNativeSelect(
    locator: Locator,
    value: string,
    timeout: number
  ): Promise<DropdownResult> {
    const startTime = Date.now();

    try {
      // label로 선택 시도
      await locator.selectOption({ label: value }, { timeout });
      return {
        success: true,
        method: 'native-select',
        attempts: 1,
        duration: Date.now() - startTime,
        selectedValue: value
      };
    } catch {
      // value로 선택 시도
      try {
        await locator.selectOption({ value }, { timeout });
        return {
          success: true,
          method: 'native-select',
          attempts: 1,
          duration: Date.now() - startTime,
          selectedValue: value
        };
      } catch (error) {
        return {
          success: false,
          method: 'native-select',
          attempts: 1,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }

  /**
   * 드롭다운 옵션 선택 시도 (우선순위별)
   */
  private async trySelectOption(
    value: string,
    options: { allowCreate: boolean; exactMatch: boolean; timeout: number }
  ): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    const { allowCreate, exactMatch, timeout } = options;
    const escapedValue = this.escapeForSelector(value);

    // 방법 1: [role="option"] 직접 클릭 (가장 권장)
    const optionResult = await this.tryRoleOptionClick(escapedValue, exactMatch, timeout);
    if (optionResult.success) return optionResult;

    // 방법 2: [role="listitem"] 클릭
    const listitemResult = await this.tryListitemClick(escapedValue, timeout);
    if (listitemResult.success) return listitemResult;

    // 방법 3: Enter 키 (첫 번째 옵션 선택)
    const enterResult = await this.tryEnterKey();
    if (enterResult.success) return { ...enterResult, selectedValue: value };

    // 방법 4: "추가" 버튼 클릭 (allowCreate가 true일 때)
    if (allowCreate) {
      const addResult = await this.tryAddButton(value);
      if (addResult.success) return addResult;
    }

    // 방법 5: Tab으로 blur (입력값 확정)
    const tabResult = await this.tryTabBlur();
    if (tabResult.success) return { ...tabResult, selectedValue: value };

    // 방법 6: 키보드 네비게이션
    const keyboardResult = await this.tryKeyboardNavigation(value, timeout);
    if (keyboardResult.success) return keyboardResult;

    return {
      success: false,
      method: 'failed',
      error: `No option found for "${value}"`
    };
  }

  /**
   * 방법 1: [role="option"] 클릭
   */
  private async tryRoleOptionClick(
    escapedValue: string,
    exactMatch: boolean,
    timeout: number
  ): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    // 정확한 매칭과 부분 매칭 셀렉터
    const selectors = exactMatch
      ? [
          `[role="option"]:text-is("${escapedValue}")`,
          `[role="option"][data-value="${escapedValue}"]`
        ]
      : [
          `[role="option"]:has-text("${escapedValue}")`,
          `[role="option"]:text-is("${escapedValue}")`,
          `[role="option"][data-value="${escapedValue}"]`
        ];

    for (const selector of selectors) {
      try {
        const option = this.page.locator(selector).first();
        const isVisible = await option.isVisible({ timeout: 1000 }).catch(() => false);

        if (isVisible) {
          // Playwright click 사용 (evaluate().click() 대신)
          await option.click({ timeout: 2000 });

          // 선택 후 DOM 안정화 대기
          await this.waitStrategy.waitForDomStable({ timeout: 1000 });

          const selectedText = await option.textContent().catch(() => escapedValue);
          return {
            success: true,
            method: 'role-option-click',
            selectedValue: selectedText?.trim() || escapedValue
          };
        }
      } catch {
        continue;
      }
    }

    return { success: false, method: 'role-option-click' };
  }

  /**
   * 방법 2: [role="listitem"] 또는 li 클릭
   */
  private async tryListitemClick(
    escapedValue: string,
    timeout: number
  ): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    const selectors = [
      `[role="listitem"]:has-text("${escapedValue}")`,
      `[role="menuitem"]:has-text("${escapedValue}")`,
      `li:has-text("${escapedValue}")`,
      `[class*="option"]:has-text("${escapedValue}")`,
      `[class*="item"]:has-text("${escapedValue}")`
    ];

    for (const selector of selectors) {
      try {
        const option = this.page.locator(selector).first();
        const isVisible = await option.isVisible({ timeout: 500 }).catch(() => false);

        if (isVisible) {
          await option.click({ timeout: 2000 });
          await this.waitStrategy.waitForDomStable({ timeout: 1000 });

          return {
            success: true,
            method: 'listitem-click',
            selectedValue: escapedValue
          };
        }
      } catch {
        continue;
      }
    }

    return { success: false, method: 'listitem-click' };
  }

  /**
   * 방법 3: Enter 키로 선택
   */
  private async tryEnterKey(): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    try {
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(500);

      // Enter 후 드롭다운이 닫혔는지 확인
      const dropdownOpen = await this.isDropdownOpen();

      if (!dropdownOpen) {
        return {
          success: true,
          method: 'enter-key'
        };
      }
    } catch {
      // 무시
    }

    return { success: false, method: 'enter-key' };
  }

  /**
   * 방법 4: "추가" 버튼 클릭
   */
  private async tryAddButton(value: string): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    const escapedValue = this.escapeForSelector(value);

    // "xxx 추가" 패턴들
    const addPatterns = [
      `[role="option"]:has-text("${escapedValue} 추가")`,
      `[role="option"]:has-text("추가"):has-text("${escapedValue}")`,
      `button:has-text("${escapedValue} 추가")`,
      `li:has-text("${escapedValue} 추가")`,
      `[class*="create"]:has-text("${escapedValue}")`,
      `[class*="add"]:has-text("${escapedValue}")`
    ];

    for (const pattern of addPatterns) {
      try {
        const addBtn = this.page.locator(pattern).first();
        const isVisible = await addBtn.isVisible({ timeout: 500 }).catch(() => false);

        if (isVisible) {
          const btnText = await addBtn.textContent().catch(() => '');

          // "추가" 텍스트가 포함된 것만 클릭
          if (btnText?.includes('추가') || btnText?.includes('Add') || btnText?.includes('Create')) {
            await addBtn.click({ timeout: 2000 });
            await this.waitStrategy.waitForDomStable({ timeout: 1000 });

            return {
              success: true,
              method: 'add-button-click',
              selectedValue: value
            };
          }
        }
      } catch {
        continue;
      }
    }

    return { success: false, method: 'add-button-click' };
  }

  /**
   * 방법 5: Tab으로 blur (입력값 확정)
   */
  private async tryTabBlur(): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    try {
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(300);

      // blur 후 DOM 안정화
      await this.waitStrategy.waitForDomStable({ timeout: 1000 });

      // 드롭다운이 닫혔는지 확인
      const dropdownOpen = await this.isDropdownOpen();

      if (!dropdownOpen) {
        return {
          success: true,
          method: 'tab-blur'
        };
      }
    } catch {
      // 무시
    }

    return { success: false, method: 'tab-blur' };
  }

  /**
   * 방법 6: 키보드 네비게이션 (ArrowDown + Enter)
   */
  private async tryKeyboardNavigation(
    value: string,
    timeout: number
  ): Promise<Omit<DropdownResult, 'attempts' | 'duration'>> {
    try {
      // 최대 10개 옵션까지 탐색
      for (let i = 0; i < 10; i++) {
        await this.page.keyboard.press('ArrowDown');
        await this.page.waitForTimeout(100);

        // 현재 포커스된 옵션 확인
        const focusedOption = this.page.locator('[role="option"][aria-selected="true"], [role="option"]:focus, .focused, [class*="focused"]').first();
        const optionText = await focusedOption.textContent().catch(() => '');

        if (optionText?.includes(value)) {
          await this.page.keyboard.press('Enter');
          await this.waitStrategy.waitForDomStable({ timeout: 1000 });

          return {
            success: true,
            method: 'keyboard-navigation',
            selectedValue: optionText.trim()
          };
        }
      }
    } catch {
      // 무시
    }

    return { success: false, method: 'keyboard-navigation' };
  }

  /**
   * 드롭다운이 열려있는지 확인
   */
  private async isDropdownOpen(): Promise<boolean> {
    const dropdownSelectors = [
      '[role="listbox"]:visible',
      '[role="menu"]:visible',
      '[class*="dropdown-menu"]:visible',
      '[class*="dropdown"][class*="open"]',
      '[class*="select"][class*="open"]',
      '[data-state="open"]'
    ];

    for (const selector of dropdownSelectors) {
      try {
        const dropdown = this.page.locator(selector).first();
        const isVisible = await dropdown.isVisible({ timeout: 300 }).catch(() => false);
        if (isVisible) return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * 드롭다운 옵션 목록 가져오기
   */
  async getOptions(selector: string): Promise<DropdownOption[]> {
    const locator = this.page.locator(selector).first();

    // 드롭다운 열기
    await locator.click();
    await this.waitStrategy.waitForDomStable({ timeout: 2000 });

    const options = await this.page.evaluate(() => {
      const results: { text: string; selector: string; isCreateOption: boolean }[] = [];

      // role="option" 요소 수집
      document.querySelectorAll('[role="option"], [role="listitem"], [role="menuitem"], li').forEach((el, index) => {
        const text = el.textContent?.trim() || '';
        if (!text) return;

        const isCreateOption = text.includes('추가') || text.includes('Add') || text.includes('Create');

        let selector = '';
        if (el.id) {
          selector = `#${el.id}`;
        } else if (el.getAttribute('data-value')) {
          selector = `[data-value="${el.getAttribute('data-value')}"]`;
        } else {
          selector = `[role="option"] >> nth=${index}`;
        }

        results.push({ text, selector, isCreateOption });
      });

      return results;
    });

    // 드롭다운 닫기
    await this.page.keyboard.press('Escape');

    return options;
  }

  /**
   * 셀렉터용 문자열 이스케이프
   * 특수문자 처리 강화
   */
  private escapeForSelector(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\^/g, '\\^')
      .replace(/\$/g, '\\$')
      .replace(/\|/g, '\\|')
      .replace(/\?/g, '\\?')
      .replace(/\*/g, '\\*')
      .replace(/\+/g, '\\+')
      .slice(0, 100); // 너무 긴 텍스트 자르기
  }

  /**
   * 특정 옵션이 존재하는지 확인
   */
  async hasOption(selector: string, value: string): Promise<boolean> {
    const options = await this.getOptions(selector);
    const escapedValue = value.toLowerCase();
    return options.some(opt => opt.text.toLowerCase().includes(escapedValue));
  }

  /**
   * 첫 번째 옵션 선택 (값 상관없이)
   */
  async selectFirst(selector: string): Promise<DropdownResult> {
    const startTime = Date.now();
    const locator = this.page.locator(selector).first();

    try {
      await locator.click();
      await this.waitStrategy.waitForDomStable({ timeout: 2000 });

      // 첫 번째 옵션 클릭
      const firstOption = this.page.locator('[role="option"], [role="listitem"], li').first();
      const isVisible = await firstOption.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        const text = await firstOption.textContent();
        await firstOption.click();
        await this.waitStrategy.waitForDomStable({ timeout: 1000 });

        return {
          success: true,
          method: 'role-option-click',
          attempts: 1,
          duration: Date.now() - startTime,
          selectedValue: text?.trim()
        };
      }

      // ArrowDown + Enter
      await this.page.keyboard.press('ArrowDown');
      await this.page.keyboard.press('Enter');

      return {
        success: true,
        method: 'keyboard-navigation',
        attempts: 1,
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        method: 'failed',
        attempts: 1,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
