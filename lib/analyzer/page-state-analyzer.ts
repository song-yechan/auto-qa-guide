import { Page } from '@playwright/test';

/**
 * 버튼 상태 정보
 */
export interface ButtonState {
  text: string;
  disabled: boolean;
  visible: boolean;
  selector: string;
  ariaLabel?: string;
  type?: string;
}

/**
 * 입력 필드 상태 정보
 */
export interface InputState {
  name: string;
  type: string;
  value: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  visible: boolean;
  selector: string;
  ariaLabel?: string;
  validationMessage?: string;
}

/**
 * 폼 상태 정보
 */
export interface FormState {
  inputs: InputState[];
  buttons: ButtonState[];
  submitButton?: ButtonState;
  isValid: boolean;
  emptyRequiredFields: string[];
}

/**
 * 에러/알림 정보
 */
export interface AlertState {
  type: 'error' | 'warning' | 'info' | 'success';
  message: string;
  visible: boolean;
}

/**
 * 전체 페이지 상태
 */
export interface PageState {
  url: string;
  title: string;
  forms: FormState[];
  buttons: ButtonState[];
  inputs: InputState[];
  alerts: AlertState[];
  modals: ModalState[];
  activeTab?: string;
  timestamp: string;
}

/**
 * 모달 상태 정보
 */
export interface ModalState {
  visible: boolean;
  title?: string;
  content?: string;
  buttons: ButtonState[];
  inputs: InputState[];
}

/**
 * 페이지 상태 분석기 - 현재 페이지의 전체 상태를 구조화된 형태로 추출
 */
export class PageStateAnalyzer {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 전체 페이지 상태 추출
   */
  async analyze(): Promise<PageState> {
    const [buttons, inputs, alerts, modals, activeTab] = await Promise.all([
      this.extractButtons(),
      this.extractInputs(),
      this.extractAlerts(),
      this.extractModals(),
      this.extractActiveTab()
    ]);

    const forms = this.groupIntoForms(inputs, buttons);

    return {
      url: this.page.url(),
      title: await this.page.title(),
      forms,
      buttons,
      inputs,
      alerts,
      modals,
      activeTab,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 모든 버튼 상태 추출
   */
  async extractButtons(): Promise<ButtonState[]> {
    return this.page.evaluate(() => {
      const buttons: any[] = [];
      const seen = new Set<string>();

      document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el, index) => {
        const htmlEl = el as HTMLButtonElement;
        const rect = htmlEl.getBoundingClientRect();

        // 보이지 않는 요소 제외
        if (rect.width === 0 || rect.height === 0) return;

        const text = (htmlEl.textContent || htmlEl.value || '').trim();
        const ariaLabel = htmlEl.getAttribute('aria-label');

        // 중복 제거
        const key = `${text}-${ariaLabel}`;
        if (seen.has(key)) return;
        seen.add(key);

        // 셀렉터 생성
        let selector = '';
        if (htmlEl.id) {
          selector = `#${htmlEl.id}`;
        } else if (ariaLabel) {
          selector = `[aria-label="${ariaLabel}"]`;
        } else if (text) {
          selector = `button:has-text("${text.slice(0, 30)}")`;
        } else {
          selector = `button >> nth=${index}`;
        }

        buttons.push({
          text,
          disabled: htmlEl.disabled || htmlEl.getAttribute('aria-disabled') === 'true',
          visible: rect.width > 0 && rect.height > 0,
          selector,
          ariaLabel: ariaLabel || undefined,
          type: htmlEl.type || 'button'
        });
      });

      return buttons;
    });
  }

  /**
   * 모든 입력 필드 상태 추출
   */
  async extractInputs(): Promise<InputState[]> {
    return this.page.evaluate(() => {
      const inputs: any[] = [];

      document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]').forEach((el, index) => {
        const htmlEl = el as HTMLInputElement;
        const rect = htmlEl.getBoundingClientRect();

        // hidden 타입 제외
        if (htmlEl.type === 'hidden') return;

        const name = htmlEl.name || htmlEl.id || '';
        const ariaLabel = htmlEl.getAttribute('aria-label');
        const placeholder = htmlEl.placeholder || '';
        const label = document.querySelector(`label[for="${htmlEl.id}"]`)?.textContent?.trim() || '';

        // 셀렉터 생성
        let selector = '';
        if (htmlEl.id) {
          selector = `#${htmlEl.id}`;
        } else if (ariaLabel) {
          selector = `[aria-label="${ariaLabel}"]`;
        } else if (name) {
          selector = `[name="${name}"]`;
        } else if (placeholder) {
          selector = `[placeholder="${placeholder}"]`;
        } else {
          selector = `input >> nth=${index}`;
        }

        // 필수 여부 판단 (여러 방법으로)
        const required = htmlEl.required ||
          htmlEl.getAttribute('aria-required') === 'true' ||
          !!document.querySelector(`label[for="${htmlEl.id}"] .required, label[for="${htmlEl.id}"] *:has-text("*")`);

        inputs.push({
          name: label || ariaLabel || placeholder || name || `input-${index}`,
          type: htmlEl.type || htmlEl.tagName.toLowerCase(),
          value: htmlEl.value || '',
          placeholder,
          required,
          disabled: htmlEl.disabled || htmlEl.getAttribute('aria-disabled') === 'true',
          visible: rect.width > 0 && rect.height > 0,
          selector,
          ariaLabel: ariaLabel || undefined,
          validationMessage: htmlEl.validationMessage || undefined
        });
      });

      return inputs;
    });
  }

  /**
   * 에러/알림 메시지 추출
   */
  async extractAlerts(): Promise<AlertState[]> {
    return this.page.evaluate(() => {
      const alerts: any[] = [];

      // role="alert" 요소
      document.querySelectorAll('[role="alert"], [role="alertdialog"], [class*="error"], [class*="Error"], [class*="warning"], [class*="Warning"], [class*="success"], [class*="Success"]').forEach(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0) return;

        const text = (el.textContent || '').trim();
        if (!text) return;

        let type: 'error' | 'warning' | 'info' | 'success' = 'info';
        const className = el.className.toString().toLowerCase();

        if (className.includes('error') || el.getAttribute('role') === 'alert') {
          type = 'error';
        } else if (className.includes('warning')) {
          type = 'warning';
        } else if (className.includes('success')) {
          type = 'success';
        }

        alerts.push({
          type,
          message: text.slice(0, 200),
          visible: true
        });
      });

      return alerts;
    });
  }

  /**
   * 모달 상태 추출
   */
  async extractModals(): Promise<ModalState[]> {
    const modals = await this.page.evaluate(() => {
      const results: any[] = [];

      document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"]').forEach(modal => {
        const rect = (modal as HTMLElement).getBoundingClientRect();
        if (rect.width === 0) return;

        const title = modal.querySelector('[role="heading"], h1, h2, h3, [class*="title"], [class*="Title"]')?.textContent?.trim();
        const content = (modal.textContent || '').trim().slice(0, 300);

        // 모달 내 버튼
        const buttons: any[] = [];
        modal.querySelectorAll('button').forEach(btn => {
          const btnRect = btn.getBoundingClientRect();
          if (btnRect.width === 0) return;

          buttons.push({
            text: (btn.textContent || '').trim(),
            disabled: btn.disabled,
            visible: true,
            selector: `[role="dialog"] button:has-text("${(btn.textContent || '').trim().slice(0, 20)}")`
          });
        });

        // 모달 내 입력
        const inputs: any[] = [];
        modal.querySelectorAll('input, textarea').forEach(input => {
          const inputEl = input as HTMLInputElement;
          inputs.push({
            name: inputEl.placeholder || inputEl.name || 'input',
            type: inputEl.type,
            value: inputEl.value,
            placeholder: inputEl.placeholder,
            required: inputEl.required,
            disabled: inputEl.disabled,
            visible: true,
            selector: '[role="dialog"] input'
          });
        });

        results.push({
          visible: true,
          title,
          content,
          buttons,
          inputs
        });
      });

      return results;
    });

    return modals;
  }

  /**
   * 현재 활성화된 탭 추출
   */
  async extractActiveTab(): Promise<string | undefined> {
    return this.page.evaluate(() => {
      const activeTab = document.querySelector('[role="tab"][aria-selected="true"], [class*="tab"][class*="active"], [class*="Tab"][class*="Active"]');
      return activeTab?.textContent?.trim();
    });
  }

  /**
   * 입력 필드와 버튼을 폼 단위로 그룹화
   */
  private groupIntoForms(inputs: InputState[], buttons: ButtonState[]): FormState[] {
    // 단순화: 전체를 하나의 폼으로 처리
    const emptyRequiredFields = inputs
      .filter(i => i.required && !i.value && i.visible)
      .map(i => i.name);

    const submitButton = buttons.find(b =>
      b.type === 'submit' ||
      b.text.includes('저장') ||
      b.text.includes('생성') ||
      b.text.includes('확인') ||
      b.text.includes('완료')
    );

    return [{
      inputs: inputs.filter(i => i.visible),
      buttons: buttons.filter(b => b.visible),
      submitButton,
      isValid: emptyRequiredFields.length === 0,
      emptyRequiredFields
    }];
  }

  /**
   * 상태를 사람이 읽기 쉬운 텍스트로 변환
   */
  async getReadableState(): Promise<string> {
    const state = await this.analyze();
    const lines: string[] = [];

    lines.push(`## 페이지 상태: ${state.title}`);
    lines.push(`URL: ${state.url}`);
    lines.push(`시간: ${state.timestamp}`);
    lines.push('');

    // 활성 탭
    if (state.activeTab) {
      lines.push(`### 현재 탭: ${state.activeTab}`);
      lines.push('');
    }

    // 모달
    if (state.modals.length > 0) {
      lines.push('### 모달');
      state.modals.forEach(modal => {
        lines.push(`- 제목: ${modal.title || '(없음)'}`);
        lines.push(`  버튼: ${modal.buttons.map(b => `${b.text}${b.disabled ? '(비활성화)' : ''}`).join(', ')}`);
        if (modal.inputs.length > 0) {
          lines.push(`  입력필드: ${modal.inputs.map(i => i.name).join(', ')}`);
        }
      });
      lines.push('');
    }

    // 입력 필드
    if (state.inputs.length > 0) {
      lines.push('### 입력 필드');
      state.inputs.filter(i => i.visible).forEach(input => {
        const status = [];
        if (input.required) status.push('필수');
        if (input.disabled) status.push('비활성화');
        if (input.value) status.push(`값: "${input.value.slice(0, 20)}"`);
        else status.push('비어있음');

        lines.push(`- ${input.name} [${input.type}]: ${status.join(', ')}`);
        lines.push(`  셀렉터: ${input.selector}`);
      });
      lines.push('');
    }

    // 버튼
    if (state.buttons.length > 0) {
      lines.push('### 버튼');
      state.buttons.filter(b => b.visible).forEach(btn => {
        const status = btn.disabled ? '비활성화' : '활성화';
        lines.push(`- ${btn.text}: ${status}`);
        lines.push(`  셀렉터: ${btn.selector}`);
      });
      lines.push('');
    }

    // 알림
    if (state.alerts.length > 0) {
      lines.push('### 알림/에러');
      state.alerts.forEach(alert => {
        lines.push(`- [${alert.type}] ${alert.message}`);
      });
      lines.push('');
    }

    // 폼 상태 요약
    if (state.forms.length > 0) {
      const form = state.forms[0];
      lines.push('### 폼 상태 요약');
      lines.push(`- 유효성: ${form.isValid ? '통과' : '미통과'}`);
      if (form.emptyRequiredFields.length > 0) {
        lines.push(`- 비어있는 필수 필드: ${form.emptyRequiredFields.join(', ')}`);
      }
      if (form.submitButton) {
        lines.push(`- 제출 버튼: "${form.submitButton.text}" (${form.submitButton.disabled ? '비활성화' : '활성화'})`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 특정 버튼이 왜 비활성화되어 있는지 분석
   */
  async analyzeDisabledButton(buttonText: string): Promise<string[]> {
    const state = await this.analyze();
    const reasons: string[] = [];

    const button = state.buttons.find(b => b.text.includes(buttonText));
    if (!button) {
      reasons.push(`"${buttonText}" 버튼을 찾을 수 없습니다.`);
      return reasons;
    }

    if (!button.disabled) {
      reasons.push(`"${buttonText}" 버튼은 활성화 상태입니다.`);
      return reasons;
    }

    // 폼 분석
    const form = state.forms[0];
    if (form) {
      if (form.emptyRequiredFields.length > 0) {
        reasons.push(`비어있는 필수 필드: ${form.emptyRequiredFields.join(', ')}`);
      }

      // 값이 없는 입력 필드 찾기
      const emptyInputs = form.inputs.filter(i => !i.value && i.visible && !i.disabled);
      if (emptyInputs.length > 0) {
        reasons.push(`입력되지 않은 필드: ${emptyInputs.map(i => i.name).join(', ')}`);
      }
    }

    // 에러 메시지 확인
    if (state.alerts.length > 0) {
      const errors = state.alerts.filter(a => a.type === 'error');
      if (errors.length > 0) {
        reasons.push(`에러: ${errors.map(e => e.message).join(', ')}`);
      }
    }

    if (reasons.length === 0) {
      reasons.push('비활성화 원인을 파악할 수 없습니다. 추가 조건이 있을 수 있습니다.');
    }

    return reasons;
  }
}
