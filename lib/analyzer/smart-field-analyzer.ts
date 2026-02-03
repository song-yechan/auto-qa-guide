import { Page, Locator } from '@playwright/test';

/**
 * 필드 타입 - UI 상호작용 방식 결정
 */
export type FieldType =
  | 'text'           // 일반 텍스트 입력
  | 'dropdown'       // 드롭다운 선택 (select 또는 custom)
  | 'combobox'       // 입력 + 드롭다운 (자동완성, 태그 입력)
  | 'radio'          // 라디오 버튼
  | 'checkbox'       // 체크박스
  | 'datepicker'     // 날짜 선택
  | 'file'           // 파일 업로드
  | 'textarea'       // 여러 줄 텍스트
  | 'number'         // 숫자 입력
  | 'password'       // 비밀번호
  | 'unknown';       // 알 수 없음

/**
 * 필드 목적 - 어떤 데이터를 입력해야 하는지
 */
export type FieldPurpose =
  | 'name'           // 이름/명칭
  | 'email'          // 이메일
  | 'phone'          // 전화번호
  | 'url'            // URL/링크
  | 'channel'        // 채널 선택
  | 'campaign'       // 캠페인
  | 'adgroup'        // 광고 그룹
  | 'creative'       // 광고 소재
  | 'date'           // 날짜
  | 'amount'         // 금액/수량
  | 'description'    // 설명
  | 'search'         // 검색
  | 'password'       // 비밀번호
  | 'custom'         // 사용자 정의
  | 'unknown';       // 알 수 없음

/**
 * 필드 컨텍스트 정보
 */
export interface FieldContext {
  // 기본 정보
  selector: string;
  tagName: string;

  // 라벨/힌트
  label?: string;           // 연결된 label 텍스트
  placeholder?: string;     // placeholder 속성
  ariaLabel?: string;       // aria-label
  helperText?: string;      // 힌트/도움말 텍스트

  // 부모/섹션 정보
  sectionTitle?: string;    // 상위 섹션 제목
  formTitle?: string;       // 폼 제목
  groupLabel?: string;      // 필드 그룹 라벨

  // 속성
  name?: string;            // name 속성
  id?: string;              // id 속성
  type?: string;            // type 속성
  role?: string;            // role 속성
  required: boolean;        // 필수 여부
  disabled: boolean;        // 비활성화 여부
  value?: string;           // 현재 값

  // 상태
  hasDropdownIndicator: boolean;  // 드롭다운 화살표 있음
  hasAutocomplete: boolean;       // 자동완성 설정됨
  hasListbox: boolean;            // 연결된 listbox 있음
}

/**
 * 분석된 필드 정보
 */
export interface AnalyzedField {
  context: FieldContext;
  fieldType: FieldType;
  purpose: FieldPurpose;
  confidence: number;       // 분석 신뢰도 0-1
  suggestedValue?: string;  // 추천 값
  interactionHint: string;  // 상호작용 힌트
}

/**
 * SmartFieldAnalyzer - 필드 타입과 목적을 자동 분석
 */
export class SmartFieldAnalyzer {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 단일 필드 분석
   */
  async analyzeField(locator: Locator): Promise<AnalyzedField> {
    const context = await this.extractFieldContext(locator);
    const fieldType = this.detectFieldType(context);
    const purpose = this.detectFieldPurpose(context);
    const confidence = this.calculateConfidence(context, fieldType, purpose);
    const suggestedValue = this.generateSuggestedValue(purpose, context);
    const interactionHint = this.generateInteractionHint(fieldType, context);

    return {
      context,
      fieldType,
      purpose,
      confidence,
      suggestedValue,
      interactionHint
    };
  }

  /**
   * 페이지의 모든 입력 필드 분석
   */
  async analyzeAllFields(): Promise<AnalyzedField[]> {
    const fields: AnalyzedField[] = [];

    // 모든 입력 요소 찾기
    const inputLocators = this.page.locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
      'textarea, ' +
      'select, ' +
      '[role="textbox"], ' +
      '[role="combobox"], ' +
      '[role="listbox"], ' +
      '[contenteditable="true"]'
    );

    const count = await inputLocators.count();

    for (let i = 0; i < count; i++) {
      const locator = inputLocators.nth(i);

      // visible 요소만 분석
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) continue;

      try {
        const analyzed = await this.analyzeField(locator);
        fields.push(analyzed);
      } catch (error) {
        // 분석 실패한 필드는 건너뛰기
        console.warn(`필드 분석 실패: ${error}`);
      }
    }

    return fields;
  }

  /**
   * 특정 목적의 필드 찾기
   */
  async findFieldByPurpose(purpose: FieldPurpose): Promise<AnalyzedField | null> {
    const allFields = await this.analyzeAllFields();
    const matching = allFields
      .filter(f => f.purpose === purpose && !f.context.disabled)
      .sort((a, b) => b.confidence - a.confidence);

    return matching[0] || null;
  }

  /**
   * 특정 패턴으로 필드 찾기 (라벨, placeholder 등)
   */
  async findFieldByPattern(pattern: RegExp): Promise<AnalyzedField | null> {
    const allFields = await this.analyzeAllFields();

    for (const field of allFields) {
      const { context } = field;
      const searchText = [
        context.label,
        context.placeholder,
        context.ariaLabel,
        context.helperText,
        context.sectionTitle,
        context.name
      ].filter(Boolean).join(' ');

      if (pattern.test(searchText)) {
        return field;
      }
    }

    return null;
  }

  /**
   * 비어있는 필수 필드 찾기
   */
  async findEmptyRequiredFields(): Promise<AnalyzedField[]> {
    const allFields = await this.analyzeAllFields();
    return allFields.filter(f =>
      f.context.required &&
      !f.context.value &&
      !f.context.disabled
    );
  }

  /**
   * 필드 컨텍스트 추출
   */
  private async extractFieldContext(locator: Locator): Promise<FieldContext> {
    return locator.evaluate((el) => {
      const htmlEl = el as HTMLElement;
      const inputEl = el as HTMLInputElement;

      // 기본 셀렉터 생성
      let selector = '';
      if (htmlEl.id) {
        selector = `#${htmlEl.id}`;
      } else if (inputEl.name) {
        selector = `[name="${inputEl.name}"]`;
      } else if (htmlEl.getAttribute('aria-label')) {
        selector = `[aria-label="${htmlEl.getAttribute('aria-label')}"]`;
      } else if (inputEl.placeholder) {
        selector = `[placeholder="${inputEl.placeholder}"]`;
      } else {
        // fallback: 태그 + 인덱스
        const siblings = el.parentElement?.querySelectorAll(el.tagName) || [];
        const index = Array.from(siblings).indexOf(el);
        selector = `${el.tagName.toLowerCase()} >> nth=${index}`;
      }

      // label 찾기 (for 속성 또는 부모)
      let label: string | undefined;
      if (htmlEl.id) {
        const labelEl = document.querySelector(`label[for="${htmlEl.id}"]`);
        label = labelEl?.textContent?.trim();
      }
      if (!label) {
        // 부모 label 확인
        const parentLabel = htmlEl.closest('label');
        if (parentLabel) {
          label = parentLabel.textContent?.trim();
        }
      }

      // 힌트/도움말 찾기
      let helperText: string | undefined;
      const describedBy = htmlEl.getAttribute('aria-describedby');
      if (describedBy) {
        const helperEl = document.getElementById(describedBy);
        helperText = helperEl?.textContent?.trim();
      }
      // 인접한 힌트 요소 찾기
      if (!helperText) {
        const nextEl = htmlEl.nextElementSibling;
        if (nextEl?.classList.toString().match(/hint|helper|description|help/i)) {
          helperText = nextEl.textContent?.trim();
        }
      }

      // 섹션 제목 찾기 (상위 heading)
      let sectionTitle: string | undefined;
      let parent = htmlEl.parentElement;
      for (let i = 0; i < 10 && parent; i++) {
        const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
        if (heading) {
          sectionTitle = heading.textContent?.trim();
          break;
        }
        parent = parent.parentElement;
      }

      // 폼 제목
      let formTitle: string | undefined;
      const form = htmlEl.closest('form');
      if (form) {
        const formHeading = form.querySelector('h1, h2, h3, [class*="title"], [class*="header"]');
        formTitle = formHeading?.textContent?.trim();
      }

      // 필드 그룹 라벨
      let groupLabel: string | undefined;
      const fieldset = htmlEl.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        groupLabel = legend?.textContent?.trim();
      }

      // 드롭다운 인디케이터 확인
      const hasDropdownIndicator = !!(
        htmlEl.querySelector('[class*="arrow"], [class*="caret"], [class*="chevron"]') ||
        htmlEl.parentElement?.querySelector('[class*="arrow"], [class*="caret"], [class*="chevron"]') ||
        htmlEl.getAttribute('aria-haspopup') === 'listbox' ||
        htmlEl.getAttribute('aria-haspopup') === 'true'
      );

      // listbox 연결 확인
      const listboxId = htmlEl.getAttribute('aria-controls') || htmlEl.getAttribute('aria-owns');
      const hasListbox = !!(listboxId && document.getElementById(listboxId));

      // autocomplete 확인
      const hasAutocomplete = !!(
        inputEl.autocomplete && inputEl.autocomplete !== 'off' ||
        htmlEl.getAttribute('aria-autocomplete')
      );

      // required 확인
      const required = !!(
        inputEl.required ||
        htmlEl.getAttribute('aria-required') === 'true' ||
        label?.includes('*') ||
        htmlEl.closest('[class*="required"]')
      );

      return {
        selector,
        tagName: el.tagName.toLowerCase(),
        label,
        placeholder: inputEl.placeholder || undefined,
        ariaLabel: htmlEl.getAttribute('aria-label') || undefined,
        helperText,
        sectionTitle,
        formTitle,
        groupLabel,
        name: inputEl.name || undefined,
        id: htmlEl.id || undefined,
        type: inputEl.type || undefined,
        role: htmlEl.getAttribute('role') || undefined,
        required,
        disabled: inputEl.disabled || htmlEl.getAttribute('aria-disabled') === 'true',
        value: inputEl.value || htmlEl.textContent?.trim() || undefined,
        hasDropdownIndicator,
        hasAutocomplete,
        hasListbox
      };
    });
  }

  /**
   * 필드 타입 감지
   */
  private detectFieldType(context: FieldContext): FieldType {
    const { tagName, type, role, hasDropdownIndicator, hasAutocomplete, hasListbox } = context;

    // select 태그
    if (tagName === 'select') {
      return 'dropdown';
    }

    // role 기반
    if (role === 'combobox' || (hasDropdownIndicator && hasAutocomplete)) {
      return 'combobox';
    }
    if (role === 'listbox') {
      return 'dropdown';
    }

    // input type 기반
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'file') return 'file';
    if (type === 'date' || type === 'datetime-local') return 'datepicker';
    if (type === 'number') return 'number';
    if (type === 'password') return 'password';
    if (type === 'email') return 'text'; // email도 text처럼 처리
    if (type === 'tel') return 'text';
    if (type === 'url') return 'text';

    // textarea
    if (tagName === 'textarea') {
      return 'textarea';
    }

    // 드롭다운 인디케이터가 있으면 combobox로 추정
    if (hasDropdownIndicator || hasListbox) {
      return 'combobox';
    }

    // 기본값
    if (tagName === 'input' || role === 'textbox') {
      return 'text';
    }

    return 'unknown';
  }

  /**
   * 필드 목적 감지
   */
  private detectFieldPurpose(context: FieldContext): FieldPurpose {
    // 분석할 텍스트 모음
    const searchText = [
      context.label,
      context.placeholder,
      context.ariaLabel,
      context.helperText,
      context.name,
      context.sectionTitle
    ].filter(Boolean).join(' ').toLowerCase();

    // 패턴 매칭 (우선순위 순)
    const patterns: [RegExp, FieldPurpose][] = [
      // 구체적인 패턴 먼저
      [/채널.*선택|채널의?\s*이름|channel/i, 'channel'],
      [/캠페인의?\s*이름|campaign/i, 'campaign'],
      [/광고.*그룹|ad.*group|adgroup/i, 'adgroup'],
      [/광고.*소재|creative/i, 'creative'],

      // 일반적인 패턴
      [/이메일|email|e-mail/i, 'email'],
      [/전화|phone|tel|mobile|휴대폰/i, 'phone'],
      [/url|링크|link|주소|address.*web|웹.*주소|http/i, 'url'],
      [/날짜|date|일자/i, 'date'],
      [/금액|amount|price|가격|비용/i, 'amount'],
      [/비밀번호|password|pwd/i, 'password'],
      [/검색|search|찾기/i, 'search'],
      [/설명|description|내용|메모|note/i, 'description'],
      [/이름|name|명칭|제목|title/i, 'name'],
    ];

    for (const [pattern, purpose] of patterns) {
      if (pattern.test(searchText)) {
        return purpose;
      }
    }

    return 'unknown';
  }

  /**
   * 분석 신뢰도 계산
   */
  private calculateConfidence(
    context: FieldContext,
    fieldType: FieldType,
    purpose: FieldPurpose
  ): number {
    let confidence = 0.5; // 기본값

    // 라벨이 있으면 +0.2
    if (context.label) confidence += 0.2;

    // placeholder가 있으면 +0.1
    if (context.placeholder) confidence += 0.1;

    // aria-label이 있으면 +0.1
    if (context.ariaLabel) confidence += 0.1;

    // 타입이 명확하면 +0.1
    if (fieldType !== 'unknown') confidence += 0.1;

    // 목적이 명확하면 +0.1
    if (purpose !== 'unknown') confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * 추천 값 생성
   */
  private generateSuggestedValue(purpose: FieldPurpose, context: FieldContext): string | undefined {
    const timestamp = Date.now();

    switch (purpose) {
      case 'name':
        return `test_${timestamp}`;
      case 'email':
        return `test_${timestamp}@example.com`;
      case 'phone':
        return '010-1234-5678';
      case 'url':
        return 'https://example.com/test';
      case 'channel':
        return `ch_${Math.random().toString(36).slice(2, 8)}`;
      case 'campaign':
        return `campaign_${timestamp}`;
      case 'adgroup':
        return `adgroup_${timestamp}`;
      case 'creative':
        return `creative_${timestamp}`;
      case 'description':
        return 'Test description';
      case 'amount':
        return '1000';
      case 'search':
        return undefined; // 검색은 값 제안 안 함
      case 'password':
        return undefined; // 비밀번호도 제안 안 함
      default:
        return `test_value_${timestamp}`;
    }
  }

  /**
   * 상호작용 힌트 생성
   */
  private generateInteractionHint(fieldType: FieldType, context: FieldContext): string {
    switch (fieldType) {
      case 'dropdown':
        return 'click → select option';
      case 'combobox':
        if (context.hasListbox) {
          return 'type → wait for options → click option or press Enter';
        }
        return 'type → Tab or click "추가" button';
      case 'radio':
        return 'click the target option';
      case 'checkbox':
        return 'click to toggle';
      case 'datepicker':
        return 'click → select date from picker';
      case 'file':
        return 'setInputFiles()';
      case 'textarea':
        return 'fill or type';
      case 'number':
        return 'fill with numeric value';
      case 'text':
      default:
        return 'type → Tab to blur';
    }
  }

  /**
   * 필드가 드롭다운/콤보박스인지 확인
   */
  async isDropdownField(locator: Locator): Promise<boolean> {
    const context = await this.extractFieldContext(locator);
    const fieldType = this.detectFieldType(context);
    return fieldType === 'dropdown' || fieldType === 'combobox';
  }

  /**
   * 필드의 연결된 옵션 목록 가져오기
   */
  async getFieldOptions(locator: Locator): Promise<string[]> {
    return locator.evaluate((el) => {
      const options: string[] = [];

      // select 태그
      if (el.tagName === 'SELECT') {
        const selectEl = el as HTMLSelectElement;
        Array.from(selectEl.options).forEach(opt => {
          if (opt.value) options.push(opt.textContent?.trim() || opt.value);
        });
        return options;
      }

      // aria-controls로 연결된 listbox
      const listboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      if (listboxId) {
        const listbox = document.getElementById(listboxId);
        if (listbox) {
          listbox.querySelectorAll('[role="option"], li').forEach(opt => {
            const text = opt.textContent?.trim();
            if (text) options.push(text);
          });
        }
      }

      // 인접한 dropdown 메뉴 찾기
      const parent = el.closest('[class*="dropdown"], [class*="select"], [class*="combobox"]');
      if (parent) {
        parent.querySelectorAll('[role="option"], [role="menuitem"], li').forEach(opt => {
          const text = opt.textContent?.trim();
          if (text) options.push(text);
        });
      }

      return options;
    });
  }
}
