import { Page, Locator } from '@playwright/test';

/**
 * 셀렉터 안정성 레벨
 */
export type SelectorStability = 'high' | 'medium' | 'low';

/**
 * 생성된 셀렉터 정보
 */
export interface GeneratedSelector {
  selector: string;
  stability: SelectorStability;
  type: SelectorType;
  description: string;
}

/**
 * 셀렉터 타입
 */
export type SelectorType =
  | 'data-testid'
  | 'id'
  | 'aria-label'
  | 'role'
  | 'placeholder'
  | 'name'
  | 'text'
  | 'nth-index';

/**
 * 셀렉터 생성 옵션
 */
export interface SelectorOptions {
  preferredTypes?: SelectorType[];
  excludeTypes?: SelectorType[];
  maxAlternatives?: number;
  includeNthIndex?: boolean;
}

/**
 * 요소 속성 정보
 */
interface ElementAttributes {
  tagName: string;
  id?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  role?: string;
  dataTestId?: string;
  text?: string;
  nthIndex?: number;
  className?: string;
}

/**
 * SelectorGenerator - 안정성 기반 셀렉터 생성기
 *
 * 우선순위:
 * 1. data-testid (High) - 테스트 전용, 가장 안정적
 * 2. #id (High) - 고유 식별자
 * 3. aria-label (High) - 접근성 속성
 * 4. role + name (High) - Playwright 권장
 * 5. placeholder (Medium) - 입력 필드 전용
 * 6. :has-text() (Medium) - 텍스트 기반
 * 7. nth-index (Low) - 최후 수단
 */
export class SelectorGenerator {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 요소에 대한 최적의 셀렉터 생성
   */
  async generateSelector(
    locator: Locator,
    options: SelectorOptions = {}
  ): Promise<GeneratedSelector> {
    const {
      preferredTypes,
      excludeTypes = [],
      includeNthIndex = true
    } = options;

    const attrs = await this.extractAttributes(locator);
    const selectors = this.generateAllSelectors(attrs, excludeTypes, includeNthIndex);

    // 선호하는 타입이 있으면 해당 타입 우선
    if (preferredTypes && preferredTypes.length > 0) {
      for (const type of preferredTypes) {
        const found = selectors.find(s => s.type === type);
        if (found) return found;
      }
    }

    // 우선순위에 따라 첫 번째 반환
    return selectors[0] ?? {
      selector: locator.toString(),
      stability: 'low',
      type: 'nth-index',
      description: 'Fallback to locator string'
    };
  }

  /**
   * 요소에 대한 모든 가능한 셀렉터 생성
   */
  async generateAlternatives(
    locator: Locator,
    options: SelectorOptions = {}
  ): Promise<GeneratedSelector[]> {
    const {
      excludeTypes = [],
      maxAlternatives = 5,
      includeNthIndex = true
    } = options;

    const attrs = await this.extractAttributes(locator);
    const selectors = this.generateAllSelectors(attrs, excludeTypes, includeNthIndex);

    return selectors.slice(0, maxAlternatives);
  }

  /**
   * 셀렉터 유효성 검증
   */
  async validateSelector(selector: string): Promise<boolean> {
    try {
      const count = await this.page.locator(selector).count();
      return count === 1; // 정확히 하나의 요소만 매칭
    } catch {
      return false;
    }
  }

  /**
   * 셀렉터 고유성 확인 (여러 요소가 매칭되면 false)
   */
  async isUnique(selector: string): Promise<boolean> {
    try {
      const count = await this.page.locator(selector).count();
      return count === 1;
    } catch {
      return false;
    }
  }

  /**
   * 요소 속성 추출
   */
  private async extractAttributes(locator: Locator): Promise<ElementAttributes> {
    return locator.evaluate((el) => {
      const htmlEl = el as HTMLElement;

      // nth-index 계산
      let nthIndex = 0;
      const siblings = el.parentElement?.children;
      if (siblings) {
        for (let i = 0; i < siblings.length; i++) {
          if (siblings[i].tagName === el.tagName) {
            if (siblings[i] === el) {
              nthIndex = Array.from(siblings)
                .filter(s => s.tagName === el.tagName)
                .indexOf(el);
              break;
            }
          }
        }
      }

      return {
        tagName: el.tagName.toLowerCase(),
        id: htmlEl.id || undefined,
        name: (htmlEl as HTMLInputElement).name || undefined,
        type: (htmlEl as HTMLInputElement).type || undefined,
        placeholder: (htmlEl as HTMLInputElement).placeholder || undefined,
        ariaLabel: htmlEl.getAttribute('aria-label') || undefined,
        role: htmlEl.getAttribute('role') || undefined,
        dataTestId: htmlEl.getAttribute('data-testid') ||
                    htmlEl.getAttribute('data-test-id') ||
                    htmlEl.getAttribute('data-cy') ||
                    undefined,
        text: htmlEl.textContent?.trim().slice(0, 50) || undefined,
        nthIndex,
        className: htmlEl.className || undefined
      };
    });
  }

  /**
   * 모든 가능한 셀렉터 생성 (우선순위 순)
   */
  private generateAllSelectors(
    attrs: ElementAttributes,
    excludeTypes: SelectorType[],
    includeNthIndex: boolean
  ): GeneratedSelector[] {
    const selectors: GeneratedSelector[] = [];

    // 1. data-testid (High)
    if (attrs.dataTestId && !excludeTypes.includes('data-testid')) {
      selectors.push({
        selector: `[data-testid="${attrs.dataTestId}"]`,
        stability: 'high',
        type: 'data-testid',
        description: `Test ID: ${attrs.dataTestId}`
      });
    }

    // 2. #id (High)
    if (attrs.id && !excludeTypes.includes('id')) {
      selectors.push({
        selector: `#${this.escapeSelector(attrs.id)}`,
        stability: 'high',
        type: 'id',
        description: `ID: ${attrs.id}`
      });
    }

    // 3. aria-label (High)
    if (attrs.ariaLabel && !excludeTypes.includes('aria-label')) {
      selectors.push({
        selector: `[aria-label="${this.escapeAttribute(attrs.ariaLabel)}"]`,
        stability: 'high',
        type: 'aria-label',
        description: `ARIA Label: ${attrs.ariaLabel}`
      });
    }

    // 4. role + text (High) - Playwright getByRole 스타일
    if (attrs.role && attrs.text && !excludeTypes.includes('role')) {
      selectors.push({
        selector: `[role="${attrs.role}"]:has-text("${this.escapeText(attrs.text)}")`,
        stability: 'high',
        type: 'role',
        description: `Role: ${attrs.role} with text "${attrs.text.slice(0, 20)}"`
      });
    } else if (attrs.role && !excludeTypes.includes('role')) {
      // role만 있는 경우 (안정성 낮음)
      selectors.push({
        selector: `[role="${attrs.role}"]`,
        stability: 'medium',
        type: 'role',
        description: `Role: ${attrs.role}`
      });
    }

    // 5. name 속성 (Medium-High)
    if (attrs.name && !excludeTypes.includes('name')) {
      selectors.push({
        selector: `[name="${this.escapeAttribute(attrs.name)}"]`,
        stability: 'medium',
        type: 'name',
        description: `Name: ${attrs.name}`
      });
    }

    // 6. placeholder (Medium)
    if (attrs.placeholder && !excludeTypes.includes('placeholder')) {
      selectors.push({
        selector: `[placeholder="${this.escapeAttribute(attrs.placeholder)}"]`,
        stability: 'medium',
        type: 'placeholder',
        description: `Placeholder: ${attrs.placeholder}`
      });
    }

    // 7. :has-text() (Medium)
    if (attrs.text && !excludeTypes.includes('text')) {
      selectors.push({
        selector: `${attrs.tagName}:has-text("${this.escapeText(attrs.text)}")`,
        stability: 'medium',
        type: 'text',
        description: `Text: "${attrs.text.slice(0, 20)}..."`
      });
    }

    // 8. nth-index (Low) - 최후 수단
    if (includeNthIndex && !excludeTypes.includes('nth-index')) {
      selectors.push({
        selector: `${attrs.tagName} >> nth=${attrs.nthIndex}`,
        stability: 'low',
        type: 'nth-index',
        description: `${attrs.tagName}[${attrs.nthIndex}] (unstable)`
      });
    }

    return selectors;
  }

  /**
   * CSS 셀렉터 이스케이프
   */
  private escapeSelector(str: string): string {
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  /**
   * 속성값 이스케이프
   */
  private escapeAttribute(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * 텍스트 이스케이프 (:has-text 용)
   */
  private escapeText(str: string): string {
    return str
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ')
      .slice(0, 50); // 너무 긴 텍스트 자르기
  }

  /**
   * 입력 필드용 최적 셀렉터 생성
   */
  async generateInputSelector(locator: Locator): Promise<GeneratedSelector> {
    return this.generateSelector(locator, {
      preferredTypes: ['data-testid', 'id', 'name', 'aria-label', 'placeholder']
    });
  }

  /**
   * 버튼용 최적 셀렉터 생성
   */
  async generateButtonSelector(locator: Locator): Promise<GeneratedSelector> {
    return this.generateSelector(locator, {
      preferredTypes: ['data-testid', 'id', 'aria-label', 'role', 'text']
    });
  }

  /**
   * 드롭다운 옵션용 셀렉터 생성
   */
  async generateOptionSelector(
    text: string,
    container?: Locator
  ): Promise<GeneratedSelector[]> {
    const selectors: GeneratedSelector[] = [];
    const escapedText = this.escapeText(text);

    // role="option" 기반 (권장)
    selectors.push({
      selector: `[role="option"]:has-text("${escapedText}")`,
      stability: 'high',
      type: 'role',
      description: `Option with text: "${text}"`
    });

    // role="listitem" 기반
    selectors.push({
      selector: `[role="listitem"]:has-text("${escapedText}")`,
      stability: 'high',
      type: 'role',
      description: `List item with text: "${text}"`
    });

    // li 태그 기반
    selectors.push({
      selector: `li:has-text("${escapedText}")`,
      stability: 'medium',
      type: 'text',
      description: `<li> with text: "${text}"`
    });

    // div 기반 (커스텀 드롭다운)
    selectors.push({
      selector: `[role="listbox"] >> text="${escapedText}"`,
      stability: 'medium',
      type: 'role',
      description: `Listbox item: "${text}"`
    });

    return selectors;
  }

  /**
   * 에러 메시지 셀렉터 생성
   */
  generateErrorSelectors(): GeneratedSelector[] {
    return [
      {
        selector: '[role="alert"]',
        stability: 'high',
        type: 'role',
        description: 'ARIA alert role'
      },
      {
        selector: '[class*="error"]',
        stability: 'medium',
        type: 'text',
        description: 'Class containing "error"'
      },
      {
        selector: '[class*="Error"]',
        stability: 'medium',
        type: 'text',
        description: 'Class containing "Error"'
      },
      {
        selector: '[aria-invalid="true"]',
        stability: 'high',
        type: 'aria-label',
        description: 'Invalid input indicator'
      }
    ];
  }
}

/**
 * 셀렉터 문자열에서 특수문자 이스케이프
 * 외부에서 사용할 수 있도록 export
 */
export function escapeForSelector(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Playwright :has-text() 용 텍스트 이스케이프
 */
export function escapeForHasText(text: string): string {
  return text
    .replace(/"/g, '\\"')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .slice(0, 100); // 너무 긴 텍스트는 자르기
}
