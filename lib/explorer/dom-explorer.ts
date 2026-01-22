import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface ElementInfo {
  tag: string;
  text: string;
  role: string | null;
  ariaLabel: string | null;
  testId: string | null;
  className: string;
  id: string | null;
  suggestedSelectors: string[];
}

export interface ExplorationResult {
  timestamp: string;
  url: string;
  elements: ElementInfo[];
  screenshot?: string;
}

/**
 * DOM 탐색기 - 페이지 요소를 자동으로 분석하고 셀렉터를 제안
 */
export class DOMExplorer {
  private page: Page;
  private outputDir: string;

  constructor(page: Page, outputDir: string = './exploration-results') {
    this.page = page;
    this.outputDir = outputDir;
  }

  /**
   * 특정 영역의 클릭 가능한 요소들을 탐색
   */
  async exploreClickables(containerSelector?: string): Promise<ElementInfo[]> {
    const container = containerSelector
      ? this.page.locator(containerSelector)
      : this.page;

    const clickables = await this.page.evaluate((containerSel) => {
      const root = containerSel
        ? document.querySelector(containerSel)
        : document.body;

      if (!root) return [];

      const elements: any[] = [];
      const selectors = 'button, a, [role="button"], [onclick], input[type="submit"], [tabindex="0"]';

      root.querySelectorAll(selectors).forEach((el: Element) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return; // 보이지 않는 요소 제외

        const htmlEl = el as HTMLElement;
        elements.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 100),
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          testId: el.getAttribute('data-test-id') || el.getAttribute('data-testid'),
          className: el.className.toString().slice(0, 200),
          id: el.id || null,
        });
      });

      return elements;
    }, containerSelector);

    return clickables.map(el => ({
      ...el,
      suggestedSelectors: this.generateSelectors(el)
    }));
  }

  /**
   * 테이블 행 요소들을 탐색
   */
  async exploreTableRows(): Promise<ElementInfo[]> {
    return this.page.evaluate(() => {
      const rows: any[] = [];

      // 일반 테이블 행
      document.querySelectorAll('tr, [role="row"]').forEach((row, index) => {
        const text = (row.textContent || '').trim().slice(0, 200);
        if (text) {
          rows.push({
            tag: row.tagName.toLowerCase(),
            text,
            role: row.getAttribute('role'),
            ariaLabel: row.getAttribute('aria-label'),
            testId: row.getAttribute('data-test-id'),
            className: row.className.toString(),
            id: row.id || null,
            index
          });
        }
      });

      return rows;
    });
  }

  /**
   * 모달/다이얼로그 탐색
   */
  async exploreModals(): Promise<ElementInfo[]> {
    return this.page.evaluate(() => {
      const modals: any[] = [];
      const selectors = '[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"]';

      document.querySelectorAll(selectors).forEach((modal) => {
        const rect = (modal as HTMLElement).getBoundingClientRect();
        if (rect.width === 0) return;

        modals.push({
          tag: modal.tagName.toLowerCase(),
          text: (modal.textContent || '').trim().slice(0, 500),
          role: modal.getAttribute('role'),
          ariaLabel: modal.getAttribute('aria-label'),
          testId: modal.getAttribute('data-test-id'),
          className: modal.className.toString(),
          id: modal.id || null,
        });
      });

      return modals;
    });
  }

  /**
   * 입력 필드 탐색
   */
  async exploreInputs(): Promise<ElementInfo[]> {
    return this.page.evaluate(() => {
      const inputs: any[] = [];

      document.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach((input) => {
        const el = input as HTMLInputElement;
        inputs.push({
          tag: input.tagName.toLowerCase(),
          text: el.placeholder || el.value || '',
          role: input.getAttribute('role'),
          ariaLabel: input.getAttribute('aria-label'),
          testId: input.getAttribute('data-test-id'),
          className: input.className.toString(),
          id: input.id || null,
          type: el.type || null,
          name: el.name || null,
        });
      });

      return inputs;
    });
  }

  /**
   * 전체 페이지 탐색 및 결과 저장
   */
  async exploreAndSave(name: string): Promise<ExplorationResult> {
    const timestamp = new Date().toISOString();
    const url = this.page.url();

    // 스크린샷 저장
    const screenshotDir = path.join(this.outputDir, 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(screenshotDir, `${name}-${Date.now()}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });

    // 요소 탐색
    const clickables = await this.exploreClickables();
    const inputs = await this.exploreInputs();
    const modals = await this.exploreModals();
    const tableRows = await this.exploreTableRows();

    const result: ExplorationResult = {
      timestamp,
      url,
      elements: [...clickables, ...inputs, ...modals, ...tableRows],
      screenshot: screenshotPath
    };

    // JSON 저장
    const jsonDir = path.join(this.outputDir, 'json');
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }
    const jsonPath = path.join(jsonDir, `${name}-${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

    console.log(`[Explorer] 탐색 완료: ${result.elements.length}개 요소 발견`);
    console.log(`[Explorer] 스크린샷: ${screenshotPath}`);
    console.log(`[Explorer] JSON: ${jsonPath}`);

    return result;
  }

  /**
   * 요소 정보로부터 가능한 셀렉터들을 생성
   */
  private generateSelectors(el: Partial<ElementInfo>): string[] {
    const selectors: string[] = [];

    // data-test-id (최우선)
    if (el.testId) {
      selectors.push(`[data-test-id="${el.testId}"]`);
      selectors.push(`page.locator('[data-test-id="${el.testId}"]')`);
    }

    // role + name
    if (el.role && el.ariaLabel) {
      selectors.push(`page.getByRole('${el.role}', { name: '${el.ariaLabel}' })`);
    } else if (el.role && el.text) {
      const shortText = el.text.slice(0, 30);
      selectors.push(`page.getByRole('${el.role}', { name: /${shortText}/ })`);
    }

    // text
    if (el.text && el.text.length < 50) {
      selectors.push(`page.getByText('${el.text}', { exact: true })`);
    }

    // id
    if (el.id) {
      selectors.push(`#${el.id}`);
      selectors.push(`page.locator('#${el.id}')`);
    }

    return selectors;
  }

  /**
   * 특정 텍스트를 포함한 요소 찾기
   */
  async findByText(text: string): Promise<ElementInfo[]> {
    const all = await this.exploreClickables();
    return all.filter(el =>
      el.text.toLowerCase().includes(text.toLowerCase()) ||
      el.ariaLabel?.toLowerCase().includes(text.toLowerCase())
    );
  }

  /**
   * 특정 역할의 요소 찾기
   */
  async findByRole(role: string): Promise<ElementInfo[]> {
    const all = await this.exploreClickables();
    return all.filter(el => el.role === role);
  }
}
