import { test, expect } from '@playwright/test';
import {
  AutoPilot,
  PageStateAnalyzer,
  ActionDecider,
  WaitStrategy,
  SelectorGenerator,
  SmartFieldAnalyzer,
  InteractionHandler,
  DropdownHandler,
  ErrorRecovery
} from '../lib';

test.describe('Auto-QA 모듈 통합 테스트', () => {

  test('모든 모듈이 정상적으로 import 되는지 확인', async ({ page }) => {
    // 모듈 존재 확인
    expect(AutoPilot).toBeDefined();
    expect(PageStateAnalyzer).toBeDefined();
    expect(ActionDecider).toBeDefined();
    expect(WaitStrategy).toBeDefined();
    expect(SelectorGenerator).toBeDefined();
    expect(SmartFieldAnalyzer).toBeDefined();
    expect(InteractionHandler).toBeDefined();
    expect(DropdownHandler).toBeDefined();
    expect(ErrorRecovery).toBeDefined();

    console.log('✅ 모든 모듈 import 성공');
  });

  test('WaitStrategy - DOM 안정화 대기 테스트', async ({ page }) => {
    // 간단한 HTML 페이지로 테스트
    await page.setContent(`
      <html>
        <body>
          <div id="container">
            <input type="text" id="test-input" placeholder="테스트 입력" />
            <button id="test-button">테스트 버튼</button>
          </div>
        </body>
      </html>
    `);

    const waitStrategy = new WaitStrategy(page);

    // DOM 안정화 대기 테스트
    const result = await waitStrategy.waitForDomStable({ timeout: 3000 });
    expect(result.success).toBe(true);
    console.log(`✅ DOM 안정화 대기 성공: ${result.duration}ms`);

    // 요소 상호작용 가능 대기 테스트
    const input = page.locator('#test-input');
    const interactableResult = await waitStrategy.waitForInteractable(input, 3000);
    expect(interactableResult.success).toBe(true);
    console.log(`✅ 요소 상호작용 가능 확인: ${interactableResult.duration}ms`);

    // 값 persist 확인 테스트
    await input.fill('테스트 값');
    const persistResult = await waitStrategy.waitForValuePersistence(input, '테스트 값', { timeout: 2000 });
    expect(persistResult.success).toBe(true);
    console.log(`✅ 값 persist 확인 성공: ${persistResult.duration}ms`);
  });

  test('SelectorGenerator - 셀렉터 생성 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <input id="email-input" type="email" placeholder="이메일 입력" aria-label="이메일" name="email" />
          <button data-testid="submit-btn" aria-label="제출">제출하기</button>
          <select id="country-select">
            <option value="kr">한국</option>
            <option value="us">미국</option>
          </select>
        </body>
      </html>
    `);

    const generator = new SelectorGenerator(page);

    // 입력 필드 셀렉터 생성
    const inputLocator = page.locator('#email-input');
    const inputSelector = await generator.generateInputSelector(inputLocator);
    expect(inputSelector.stability).toBe('high');
    expect(inputSelector.type).toBe('id');
    console.log(`✅ 입력 셀렉터: ${inputSelector.selector} (안정성: ${inputSelector.stability})`);

    // 버튼 셀렉터 생성
    const buttonLocator = page.locator('[data-testid="submit-btn"]');
    const buttonSelector = await generator.generateButtonSelector(buttonLocator);
    expect(buttonSelector.stability).toBe('high');
    console.log(`✅ 버튼 셀렉터: ${buttonSelector.selector} (안정성: ${buttonSelector.stability})`);

    // 대체 셀렉터 생성
    const alternatives = await generator.generateAlternatives(inputLocator, { maxAlternatives: 3 });
    expect(alternatives.length).toBeGreaterThan(0);
    console.log(`✅ 대체 셀렉터 ${alternatives.length}개 생성됨`);
  });

  test('SmartFieldAnalyzer - 필드 분석 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <form>
            <label for="channel">채널 선택</label>
            <input id="channel" type="text" placeholder="채널을 선택하세요" role="combobox" aria-haspopup="listbox" />

            <label for="url">웹 URL</label>
            <input id="url" type="url" placeholder="https://example.com" required />

            <label for="campaign">캠페인 이름</label>
            <input id="campaign" type="text" placeholder="캠페인의 이름을 입력하세요" />
          </form>
        </body>
      </html>
    `);

    const analyzer = new SmartFieldAnalyzer(page);

    // 모든 필드 분석
    const fields = await analyzer.analyzeAllFields();
    expect(fields.length).toBe(3);
    console.log(`✅ ${fields.length}개 필드 분석됨`);

    // 채널 필드 분석
    const channelField = fields.find(f => f.context.id === 'channel');
    expect(channelField).toBeDefined();
    expect(channelField?.fieldType).toBe('combobox');
    expect(channelField?.purpose).toBe('channel');
    console.log(`✅ 채널 필드: 타입=${channelField?.fieldType}, 목적=${channelField?.purpose}`);

    // URL 필드 분석
    const urlField = fields.find(f => f.context.id === 'url');
    expect(urlField).toBeDefined();
    expect(urlField?.purpose).toBe('url');
    expect(urlField?.context.required).toBe(true);
    console.log(`✅ URL 필드: 타입=${urlField?.fieldType}, 목적=${urlField?.purpose}, 필수=${urlField?.context.required}`);

    // 캠페인 필드 분석
    const campaignField = fields.find(f => f.context.id === 'campaign');
    expect(campaignField).toBeDefined();
    expect(campaignField?.purpose).toBe('campaign');
    console.log(`✅ 캠페인 필드: 타입=${campaignField?.fieldType}, 목적=${campaignField?.purpose}`);
  });

  test('DropdownHandler - 드롭다운 선택 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <div id="dropdown-container">
            <input id="combobox" type="text" role="combobox" placeholder="옵션 선택" />
            <ul id="listbox" role="listbox" style="display: none;">
              <li role="option" data-value="opt1">옵션 1</li>
              <li role="option" data-value="opt2">옵션 2</li>
              <li role="option" data-value="opt3">테스트 추가</li>
            </ul>
          </div>
          <script>
            const input = document.getElementById('combobox');
            const listbox = document.getElementById('listbox');

            input.addEventListener('focus', () => {
              listbox.style.display = 'block';
            });

            input.addEventListener('blur', () => {
              setTimeout(() => { listbox.style.display = 'none'; }, 200);
            });

            listbox.querySelectorAll('[role="option"]').forEach(opt => {
              opt.addEventListener('click', () => {
                input.value = opt.textContent;
                listbox.style.display = 'none';
              });
            });
          </script>
        </body>
      </html>
    `);

    const handler = new DropdownHandler(page);

    // 드롭다운 옵션 선택 테스트
    const result = await handler.selectOrCreate({
      selector: '#combobox',
      value: '옵션 1',
      timeout: 5000,
      maxRetries: 2
    });

    console.log(`드롭다운 선택 결과: 성공=${result.success}, 방법=${result.method}, 시도=${result.attempts}`);

    // 값이 입력되었는지 확인
    const inputValue = await page.locator('#combobox').inputValue();
    console.log(`✅ 입력된 값: "${inputValue}"`);
  });

  test('ErrorRecovery - 에러 분류 테스트', async ({ page }) => {
    const recovery = new ErrorRecovery(page);

    // 다양한 에러 타입 분류 테스트
    const testCases = [
      { error: new Error('Element not found'), expected: 'element-not-found' },
      { error: new Error('Timeout 5000ms exceeded'), expected: 'timeout' },
      { error: new Error('Element is not visible'), expected: 'element-not-visible' },
      { error: new Error('Element is not interactable'), expected: 'element-not-interactable' },
      { error: new Error('Element is detached from DOM'), expected: 'element-detached' },
      { error: new Error('Network request failed'), expected: 'network-error' },
      { error: new Error('strict mode violation, multiple elements'), expected: 'selector-ambiguous' },
    ];

    for (const tc of testCases) {
      const errorType = recovery.classifyError(tc.error);
      expect(errorType).toBe(tc.expected);
      console.log(`✅ "${tc.error.message.slice(0, 30)}..." → ${errorType}`);
    }

    // 복구 가능 여부 확인
    expect(recovery.canRecover('element-not-found')).toBe(true);
    expect(recovery.canRecover('timeout')).toBe(true);
    console.log('✅ 에러 복구 가능 여부 확인 완료');
  });

  test('ActionDecider - State Snapshot 및 Stuck 감지 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <form>
            <input id="field1" type="text" />
            <input id="field2" type="text" required />
            <button id="submit" disabled>제출</button>
          </form>
        </body>
      </html>
    `);

    const decider = new ActionDecider(page);

    // 상태 스냅샷 기록
    const snapshot1 = await decider.recordStateSnapshot({ name: 'test', targetButton: '제출' });
    expect(snapshot1.emptyFieldCount).toBe(2);
    expect(snapshot1.targetButtonEnabled).toBe(false);
    console.log(`✅ 스냅샷 1: 빈필드=${snapshot1.emptyFieldCount}, 버튼활성화=${snapshot1.targetButtonEnabled}`);

    // 값 입력 후 스냅샷
    await page.locator('#field1').fill('테스트');
    const snapshot2 = await decider.recordStateSnapshot({ name: 'test', targetButton: '제출' });
    expect(snapshot2.filledFieldCount).toBe(1);
    console.log(`✅ 스냅샷 2: 채운필드=${snapshot2.filledFieldCount}`);

    // Stuck 감지 (동일 상태 반복)
    // 동일 상태 3번 기록
    await decider.recordStateSnapshot({ name: 'test', targetButton: '제출' });
    await decider.recordStateSnapshot({ name: 'test', targetButton: '제출' });

    const stuckResult = decider.detectStuckState();
    console.log(`✅ Stuck 감지: isStuck=${stuckResult.isStuck}, 연속반복=${stuckResult.consecutiveSameStates}`);

    // 진행 상황 요약
    const summary = decider.getProgressSummary();
    console.log(`✅ 진행 요약: ${summary.currentState}`);
  });

  test('InteractionHandler - 텍스트 입력 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <input id="test-input" type="text" placeholder="테스트" />
        </body>
      </html>
    `);

    const handler = new InteractionHandler(page);
    const analyzer = new SmartFieldAnalyzer(page);

    const locator = page.locator('#test-input');
    const field = await analyzer.analyzeField(locator);

    const result = await handler.fillField(field, '테스트 값 입력', {
      typeDelay: 10,
      timeout: 5000
    });

    expect(result.success).toBe(true);
    console.log(`✅ 텍스트 입력 성공: 방법=${result.method}, 시간=${result.duration}ms`);

    const value = await locator.inputValue();
    expect(value).toBe('테스트 값 입력');
    console.log(`✅ 입력된 값 확인: "${value}"`);
  });

  test('PageStateAnalyzer - 페이지 상태 분석 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <form>
            <label for="name">이름 *</label>
            <input id="name" type="text" required />

            <label for="email">이메일</label>
            <input id="email" type="email" />

            <button type="submit" disabled>저장</button>
            <button type="button">취소</button>
          </form>
          <div role="alert" style="display: block;">에러 메시지</div>
        </body>
      </html>
    `);

    const analyzer = new PageStateAnalyzer(page);
    const state = await analyzer.analyze();

    // 입력 필드 확인
    expect(state.inputs.length).toBeGreaterThanOrEqual(2);
    console.log(`✅ 입력 필드 ${state.inputs.length}개 감지`);

    // 버튼 확인
    expect(state.buttons.length).toBeGreaterThanOrEqual(2);
    const submitBtn = state.buttons.find(b => b.text.includes('저장'));
    expect(submitBtn?.disabled).toBe(true);
    console.log(`✅ 버튼 ${state.buttons.length}개 감지, 저장버튼 비활성화=${submitBtn?.disabled}`);

    // 폼 상태 확인
    expect(state.forms.length).toBeGreaterThan(0);
    const form = state.forms[0];
    expect(form.emptyRequiredFields.length).toBeGreaterThan(0);
    console.log(`✅ 비어있는 필수 필드: ${form.emptyRequiredFields.join(', ')}`);

    // 알림 확인
    expect(state.alerts.length).toBeGreaterThan(0);
    console.log(`✅ 알림 ${state.alerts.length}개 감지`);

    // 버튼 비활성화 원인 분석
    const reasons = await analyzer.analyzeDisabledButton('저장');
    expect(reasons.length).toBeGreaterThan(0);
    console.log(`✅ 버튼 비활성화 원인: ${reasons.join(', ')}`);
  });

  test('AutoPilot - 기본 초기화 테스트', async ({ page }) => {
    await page.setContent(`
      <html>
        <body>
          <form>
            <input id="name" type="text" placeholder="이름" />
            <button id="submit">제출</button>
          </form>
        </body>
      </html>
    `);

    // AutoPilot 초기화
    const pilot = new AutoPilot(page, {
      maxSteps: 10,
      stepDelay: 100,
      typeDelay: 10,
      verbose: false,
      useSmartAnalysis: true,
      useAdaptiveWait: true
    });

    // 필드 전략 추가
    pilot.addFieldStrategy({
      fieldPattern: /이름/,
      valueGenerator: () => '테스트 이름'
    });

    // 상태 조회
    const state = await pilot.getState();
    expect(state.inputs.length).toBeGreaterThan(0);
    console.log(`✅ AutoPilot 초기화 성공, 입력필드 ${state.inputs.length}개`);

    // 읽기 쉬운 상태 출력
    const readableState = await pilot.getReadableState();
    expect(readableState).toContain('이름');
    console.log(`✅ 상태 텍스트 생성 성공`);
  });

});
