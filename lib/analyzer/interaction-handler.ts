import { Page, Locator } from '@playwright/test';
import { WaitStrategy } from './wait-strategy';
import { FieldType, AnalyzedField } from './smart-field-analyzer';
import { escapeForHasText } from './selector-generator';

/**
 * 상호작용 결과
 */
export interface InteractionResult {
  success: boolean;
  method?: string;           // 성공한 방법
  attempts: number;          // 시도 횟수
  duration: number;          // 소요 시간
  error?: string;            // 실패 원인
  finalValue?: string;       // 최종 값 (입력의 경우)
}

/**
 * 상호작용 옵션
 */
export interface InteractionOptions {
  timeout?: number;
  retries?: number;
  typeDelay?: number;
  waitAfter?: number;
}

/**
 * InteractionHandler - 필드 타입별 전문화된 상호작용 처리
 */
export class InteractionHandler {
  private page: Page;
  private waitStrategy: WaitStrategy;
  private defaultTimeout: number;
  private defaultRetries: number;

  constructor(page: Page, options: { timeout?: number; retries?: number } = {}) {
    this.page = page;
    this.waitStrategy = new WaitStrategy(page);
    this.defaultTimeout = options.timeout ?? 10000;
    this.defaultRetries = options.retries ?? 3;
  }

  /**
   * 분석된 필드에 값 입력 (자동으로 타입에 맞는 방법 선택)
   */
  async fillField(
    field: AnalyzedField,
    value: string,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const { fieldType, context } = field;

    switch (fieldType) {
      case 'dropdown':
        return this.handleDropdown(context.selector, value, options);

      case 'combobox':
        return this.handleCombobox(context.selector, value, options);

      case 'radio':
        return this.handleRadio(context.selector, value, options);

      case 'checkbox':
        return this.handleCheckbox(context.selector, value === 'true', options);

      case 'datepicker':
        return this.handleDatepicker(context.selector, value, options);

      case 'file':
        return this.handleFileUpload(context.selector, value, options);

      case 'textarea':
      case 'text':
      case 'number':
      default:
        return this.handleTextInput(context.selector, value, options);
    }
  }

  /**
   * 일반 텍스트 입력
   */
  async handleTextInput(
    selector: string,
    value: string,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout, typeDelay = 30, waitAfter = 300 } = options;

    const locator = this.page.locator(selector).first();

    try {
      // 1. 요소 대기
      await locator.waitFor({ state: 'visible', timeout });

      // 2. 클릭하여 포커스
      await locator.click();

      // 3. 기존 값 지우기
      await locator.clear();

      // 4. 타이핑 (이벤트 발생)
      await locator.type(value, { delay: typeDelay });

      // 5. Blur 트리거 (여러 방법 시도)
      await this.triggerBlur(locator);

      // 6. 값 persist 확인
      await this.page.waitForTimeout(waitAfter);
      const persistResult = await this.waitStrategy.waitForValuePersistence(
        locator,
        value,
        { timeout: 3000 }
      );

      if (!persistResult.success) {
        // 재시도: Tab + 외부 클릭
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(200);
        await this.clickOutside();

        // 다시 확인
        const finalValue = await locator.inputValue().catch(() => '');
        if (finalValue !== value) {
          return {
            success: false,
            method: 'text-input',
            attempts: 1,
            duration: Date.now() - startTime,
            error: `Value not persisted. Expected: "${value}", Got: "${finalValue}"`,
            finalValue
          };
        }
      }

      return {
        success: true,
        method: 'text-input',
        attempts: 1,
        duration: Date.now() - startTime,
        finalValue: value
      };

    } catch (error) {
      return {
        success: false,
        method: 'text-input',
        attempts: 1,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 드롭다운 선택 (select 태그 또는 custom)
   */
  async handleDropdown(
    selector: string,
    value: string,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout, retries = this.defaultRetries } = options;

    const locator = this.page.locator(selector).first();

    // 방법 1: native select
    try {
      const tagName = await locator.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'select') {
        await locator.selectOption({ label: value });
        return {
          success: true,
          method: 'native-select',
          attempts: 1,
          duration: Date.now() - startTime,
          finalValue: value
        };
      }
    } catch {
      // native select 실패, 다음 방법 시도
    }

    // 방법 2: 클릭하여 드롭다운 열고 옵션 선택
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // 드롭다운 열기
        await locator.click();
        await this.waitStrategy.waitForDomStable({ timeout: 2000 });

        // 옵션 찾기 및 클릭
        const result = await this.selectDropdownOption(value, timeout);
        if (result.success) {
          return {
            ...result,
            attempts: attempt,
            duration: Date.now() - startTime
          };
        }

        // 실패 시 ESC로 닫고 재시도
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

      } catch (error) {
        if (attempt === retries) {
          return {
            success: false,
            method: 'dropdown-click',
            attempts: attempt,
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }

    return {
      success: false,
      method: 'dropdown-click',
      attempts: retries,
      duration: Date.now() - startTime,
      error: `Failed to select "${value}" after ${retries} attempts`
    };
  }

  /**
   * 콤보박스 처리 (입력 + 드롭다운)
   */
  async handleCombobox(
    selector: string,
    value: string,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const {
      timeout = this.defaultTimeout,
      retries = this.defaultRetries,
      typeDelay = 30
    } = options;

    const locator = this.page.locator(selector).first();

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // 1. 포커스 및 기존 값 지우기
        await locator.click();
        await locator.clear();

        // 2. 값 입력
        await locator.type(value, { delay: typeDelay });

        // 3. 드롭다운 옵션 대기
        await this.waitStrategy.waitForDomStable({ timeout: 2000 });

        // 4. 옵션 선택 시도 (여러 방법)
        const selectResult = await this.tryComboboxSelection(value, timeout);

        if (selectResult.success) {
          // 5. 값 확인
          await this.page.waitForTimeout(500);
          return {
            success: true,
            method: selectResult.method,
            attempts: attempt,
            duration: Date.now() - startTime,
            finalValue: value
          };
        }

        // 재시도 전 초기화
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

      } catch (error) {
        if (attempt === retries) {
          return {
            success: false,
            method: 'combobox',
            attempts: attempt,
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }

    return {
      success: false,
      method: 'combobox',
      attempts: retries,
      duration: Date.now() - startTime,
      error: `Failed to input "${value}" in combobox after ${retries} attempts`
    };
  }

  /**
   * 콤보박스 선택 시도 (여러 방법)
   */
  private async tryComboboxSelection(
    value: string,
    timeout: number
  ): Promise<{ success: boolean; method: string }> {
    const escapedValue = escapeForHasText(value);

    // 방법 1: role="option" 직접 클릭 (Playwright click 사용)
    try {
      const optionSelector = `[role="option"]:has-text("${escapedValue}")`;
      const option = this.page.locator(optionSelector).first();
      const isVisible = await option.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        await option.click({ timeout: 2000 });
        return { success: true, method: 'option-click' };
      }
    } catch {
      // 다음 방법 시도
    }

    // 방법 2: "xxx 추가" 버튼 클릭
    try {
      const addPatterns = [
        `[role="option"]:has-text("${escapedValue} 추가")`,
        `button:has-text("${escapedValue} 추가")`,
        `[role="option"]:has-text("추가")`,
        `li:has-text("${escapedValue} 추가")`
      ];

      for (const pattern of addPatterns) {
        const addBtn = this.page.locator(pattern).first();
        const exists = await addBtn.count() > 0;
        const isVisible = exists && await addBtn.isVisible({ timeout: 500 }).catch(() => false);

        if (isVisible) {
          await addBtn.click({ timeout: 2000 });
          return { success: true, method: 'add-button-click' };
        }
      }
    } catch {
      // 다음 방법 시도
    }

    // 방법 3: Enter 키
    try {
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(500);

      // Enter 후 드롭다운이 닫혔는지 확인
      const listbox = this.page.locator('[role="listbox"], [class*="dropdown-menu"]').first();
      const stillOpen = await listbox.isVisible({ timeout: 500 }).catch(() => false);

      if (!stillOpen) {
        return { success: true, method: 'enter-key' };
      }
    } catch {
      // 다음 방법 시도
    }

    // 방법 4: Tab + 외부 클릭 (blur로 확정)
    try {
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(200);
      await this.clickOutside();
      return { success: true, method: 'tab-blur' };
    } catch {
      // 모든 방법 실패
    }

    return { success: false, method: 'none' };
  }

  /**
   * 드롭다운 옵션 선택
   */
  private async selectDropdownOption(
    value: string,
    timeout: number
  ): Promise<InteractionResult> {
    const escapedValue = escapeForHasText(value);
    const startTime = Date.now();

    // 옵션 셀렉터 우선순위
    const optionSelectors = [
      `[role="option"]:has-text("${escapedValue}")`,
      `[role="menuitem"]:has-text("${escapedValue}")`,
      `[role="listitem"]:has-text("${escapedValue}")`,
      `li:has-text("${escapedValue}")`,
      `[data-value="${value}"]`,
      `option:has-text("${escapedValue}")`
    ];

    for (const selector of optionSelectors) {
      try {
        const option = this.page.locator(selector).first();
        const isVisible = await option.isVisible({ timeout: 1000 }).catch(() => false);

        if (isVisible) {
          await option.click();
          return {
            success: true,
            method: `dropdown-option: ${selector.split(':')[0]}`,
            attempts: 1,
            duration: Date.now() - startTime,
            finalValue: value
          };
        }
      } catch {
        continue;
      }
    }

    return {
      success: false,
      method: 'dropdown-option',
      attempts: optionSelectors.length,
      duration: Date.now() - startTime,
      error: `Option "${value}" not found`
    };
  }

  /**
   * 라디오 버튼 선택
   */
  async handleRadio(
    selector: string,
    value: string,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout } = options;

    try {
      // 라디오 그룹에서 해당 값 찾기
      const radioGroup = this.page.locator(selector).first();
      const name = await radioGroup.getAttribute('name');

      let targetRadio: Locator;

      if (name) {
        // name으로 그룹 내 찾기
        targetRadio = this.page.locator(`input[name="${name}"][value="${value}"]`).first();
      } else {
        // 라벨 텍스트로 찾기
        targetRadio = this.page.locator(`input[type="radio"]`).filter({
          has: this.page.locator(`xpath=..//*[contains(text(), "${value}")]`)
        }).first();
      }

      // 또는 label로 찾기
      if (await targetRadio.count() === 0) {
        targetRadio = this.page.getByLabel(value);
      }

      await targetRadio.waitFor({ state: 'visible', timeout });
      await targetRadio.click();

      return {
        success: true,
        method: 'radio-click',
        attempts: 1,
        duration: Date.now() - startTime,
        finalValue: value
      };

    } catch (error) {
      return {
        success: false,
        method: 'radio-click',
        attempts: 1,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 체크박스 토글
   */
  async handleCheckbox(
    selector: string,
    shouldCheck: boolean,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout } = options;

    try {
      const checkbox = this.page.locator(selector).first();
      await checkbox.waitFor({ state: 'visible', timeout });

      if (shouldCheck) {
        await checkbox.check();
      } else {
        await checkbox.uncheck();
      }

      return {
        success: true,
        method: 'checkbox-toggle',
        attempts: 1,
        duration: Date.now() - startTime,
        finalValue: String(shouldCheck)
      };

    } catch (error) {
      return {
        success: false,
        method: 'checkbox-toggle',
        attempts: 1,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 날짜 선택
   */
  async handleDatepicker(
    selector: string,
    value: string, // ISO 형식: "2024-01-15"
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout } = options;

    try {
      const input = this.page.locator(selector).first();
      await input.waitFor({ state: 'visible', timeout });

      // 방법 1: fill로 직접 입력
      await input.fill(value);

      // 방법 2: 실패 시 클릭 후 입력
      const currentValue = await input.inputValue();
      if (currentValue !== value) {
        await input.click();
        await input.clear();
        await input.type(value);
        await this.page.keyboard.press('Escape'); // 달력 닫기
      }

      return {
        success: true,
        method: 'datepicker-fill',
        attempts: 1,
        duration: Date.now() - startTime,
        finalValue: value
      };

    } catch (error) {
      return {
        success: false,
        method: 'datepicker-fill',
        attempts: 1,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 파일 업로드
   */
  async handleFileUpload(
    selector: string,
    filePath: string,
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout } = options;

    try {
      const input = this.page.locator(selector).first();
      await input.waitFor({ state: 'attached', timeout }); // file input은 hidden일 수 있음
      await input.setInputFiles(filePath);

      return {
        success: true,
        method: 'file-upload',
        attempts: 1,
        duration: Date.now() - startTime,
        finalValue: filePath
      };

    } catch (error) {
      return {
        success: false,
        method: 'file-upload',
        attempts: 1,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 버튼 클릭 (재시도 및 스크롤 포함)
   */
  async clickButton(
    target: string | { text?: string | RegExp; selector?: string; ariaLabel?: string | RegExp },
    options: InteractionOptions = {}
  ): Promise<InteractionResult> {
    const startTime = Date.now();
    const { timeout = this.defaultTimeout, retries = this.defaultRetries } = options;

    // 셀렉터 결정
    let locator: Locator;
    if (typeof target === 'string') {
      // 텍스트 기반
      locator = this.page.getByRole('button', { name: target }).or(
        this.page.locator(`button:has-text("${target}")`)
      ).first();
    } else if (target.selector) {
      locator = this.page.locator(target.selector).first();
    } else if (target.text) {
      if (typeof target.text === 'string') {
        locator = this.page.getByRole('button', { name: target.text }).first();
      } else {
        locator = this.page.getByRole('button', { name: target.text }).first();
      }
    } else if (target.ariaLabel) {
      if (typeof target.ariaLabel === 'string') {
        locator = this.page.locator(`[aria-label="${target.ariaLabel}"]`).first();
      } else {
        locator = this.page.locator(`button`).filter({
          has: this.page.locator(`[aria-label]`)
        }).first();
      }
    } else {
      return {
        success: false,
        method: 'button-click',
        attempts: 0,
        duration: Date.now() - startTime,
        error: 'Invalid button target'
      };
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // 1. 요소 대기
        await locator.waitFor({ state: 'visible', timeout });

        // 2. 활성화 대기
        const isEnabled = await locator.isEnabled();
        if (!isEnabled) {
          // 잠시 대기 후 다시 확인
          await this.page.waitForTimeout(1000);
          const stillDisabled = !(await locator.isEnabled());
          if (stillDisabled) {
            throw new Error('Button is disabled');
          }
        }

        // 3. 뷰포트로 스크롤
        await locator.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(200);

        // 4. 클릭
        await locator.click({ timeout: 5000 });

        // 5. DOM 안정화 대기
        await this.waitStrategy.waitForDomStable({ timeout: 2000 });

        return {
          success: true,
          method: 'button-click',
          attempts: attempt,
          duration: Date.now() - startTime
        };

      } catch (error) {
        if (attempt === retries) {
          return {
            success: false,
            method: 'button-click',
            attempts: attempt,
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
          };
        }

        // 재시도 전 대기
        await this.page.waitForTimeout(500);
      }
    }

    return {
      success: false,
      method: 'button-click',
      attempts: retries,
      duration: Date.now() - startTime,
      error: 'Max retries exceeded'
    };
  }

  /**
   * Blur 트리거 (여러 방법 시도)
   */
  private async triggerBlur(locator: Locator): Promise<void> {
    // 방법 1: Tab 키
    await this.page.keyboard.press('Tab');
    await this.page.waitForTimeout(100);

    // 방법 2: 외부 클릭
    await this.clickOutside();
    await this.page.waitForTimeout(100);

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
   * 외부 클릭 (blur 트리거용)
   */
  private async clickOutside(): Promise<void> {
    try {
      // body의 빈 영역 클릭
      await this.page.evaluate(() => {
        const body = document.body;
        body.click();
      });
    } catch {
      // 무시
    }
  }
}
