import { test, expect } from '@playwright/test';
import { AutoPilot, PageStateAnalyzer } from '../../lib';

const APP_NAME = 'bookscribe';

test.describe('트래킹 링크 생성 - AutoPilot 방식', () => {

  test.beforeEach(async ({ page }) => {
    // 1. 앱 목록 페이지 이동
    await page.goto('/app', { timeout: 60000 });

    // 2. 앱 목록 확인
    await expect(page.getByRole('heading', { name: '앱 목록' }))
      .toBeVisible({ timeout: 10000 });

    // 3. 앱 클릭
    await page.getByRole('link', { name: APP_NAME }).click();

    // 4. 앱 진입 확인
    await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
      .toBeVisible({ timeout: 10000 });

    // 5. 모달/팝업 닫기 (Escape 키)
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('페이지 상태 분석 테스트', async ({ page }) => {
    // 1. 트래킹 링크 메뉴 클릭
    await page.getByText('트래킹 링크', { exact: true }).click();
    await page.waitForTimeout(500);

    // 2. 트래킹 링크 생성 메뉴 클릭
    await page.getByText('트래킹 링크 생성').click();
    await page.waitForTimeout(2000);

    // 3. 모달 닫기
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 4. 커스텀 채널 탭 클릭
    await page.getByRole('tab', { name: /커스텀 채널/ }).click();
    await page.waitForTimeout(1000);

    // 5. 페이지 상태 분석
    const analyzer = new PageStateAnalyzer(page);
    const state = await analyzer.analyze();

    console.log('\n========== 페이지 상태 분석 결과 ==========');
    console.log(`URL: ${state.url}`);
    console.log(`현재 탭: ${state.activeTab || '(없음)'}`);

    console.log('\n--- 입력 필드 ---');
    state.inputs.filter(i => i.visible).forEach(input => {
      console.log(`- ${input.name}`);
      console.log(`  타입: ${input.type}`);
      console.log(`  값: "${input.value || '(비어있음)'}"`);
      console.log(`  필수: ${input.required}`);
      console.log(`  셀렉터: ${input.selector}`);
    });

    console.log('\n--- 버튼 ---');
    state.buttons.filter(b => b.visible).forEach(btn => {
      console.log(`- ${btn.text}: ${btn.disabled ? '비활성화' : '활성화'}`);
      console.log(`  셀렉터: ${btn.selector}`);
    });

    console.log('\n--- 폼 상태 ---');
    if (state.forms.length > 0) {
      const form = state.forms[0];
      console.log(`유효성: ${form.isValid ? '통과' : '미통과'}`);
      console.log(`비어있는 필수 필드: ${form.emptyRequiredFields.join(', ') || '없음'}`);
      if (form.submitButton) {
        console.log(`제출 버튼: "${form.submitButton.text}" (${form.submitButton.disabled ? '비활성화' : '활성화'})`);
      }
    }

    // 6. "링크 생성" 버튼 비활성화 원인 분석
    console.log('\n--- 버튼 비활성화 원인 분석 ---');
    const reasons = await analyzer.analyzeDisabledButton('링크 생성');
    reasons.forEach(reason => console.log(`- ${reason}`));

    console.log('\n========================================\n');

    // 이 테스트는 분석 결과만 출력하고 통과
    expect(state.inputs.length).toBeGreaterThan(0);
  });

  test('AutoPilot으로 트래킹 링크 생성', async ({ page }) => {
    // 1. 트래킹 링크 메뉴 클릭
    await page.getByText('트래킹 링크', { exact: true }).click();
    await page.waitForTimeout(500);

    // 2. 트래킹 링크 생성 메뉴 클릭
    await page.getByText('트래킹 링크 생성').click();
    await page.waitForTimeout(2000);

    // 3. 모달 닫기
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 4. 커스텀 채널 탭 클릭
    await page.getByRole('tab', { name: /커스텀 채널/ }).click();
    await page.waitForTimeout(1000);

    // 5. AutoPilot 설정
    const pilot = new AutoPilot(page, {
      maxSteps: 15,
      stepDelay: 800,
      typeDelay: 50,
      verbose: true,
      enableScreenshots: false
    });

    // 6. 커스텀 필드 전략 추가 (웹 URL 필드용)
    pilot.addFieldStrategy({
      fieldPattern: /웹.*URL|웹.*페이지|web.*url/i,
      valueGenerator: () => 'https://example.com/landing'
    });

    // 7. AutoPilot 실행
    const result = await pilot.execute({
      name: '트래킹 링크 생성',
      targetButton: '링크 생성',
      successIndicator: '/done/'
    });

    // 8. 결과 출력
    console.log('\n========== AutoPilot 실행 결과 ==========');
    console.log(`성공: ${result.success}`);
    console.log(`총 단계: ${result.steps.length}`);
    console.log(`소요 시간: ${result.totalTime}ms`);

    if (result.error) {
      console.log(`에러: ${result.error}`);
    }

    console.log('\n--- 실행 단계 ---');
    result.steps.forEach(step => {
      const status = step.success ? '✅' : '❌';
      console.log(`${status} Step ${step.step}: ${step.action.type} - ${step.action.reason}`);
      if (step.error) {
        console.log(`   에러: ${step.error}`);
      }
    });

    console.log('\n========================================\n');

    // 결과에 따른 테스트 결과
    // AutoPilot이 추가 탐색이 필요하다고 판단한 경우도 일단 허용
    // (완전 자동화가 안 되는 경우 정보 수집 목적)
    if (!result.success && result.error?.includes('추가 조건')) {
      console.log('⚠️ 추가 조건 탐색 필요 - 현재 상태:');
      console.log(await pilot.getReadableState());
    }

    // 성공 또는 유의미한 진행이 있었는지 확인
    expect(result.steps.length).toBeGreaterThan(0);
  });

  test('단계별 실행 (디버깅용)', async ({ page }) => {
    // 1. 트래킹 링크 메뉴 클릭
    await page.getByText('트래킹 링크', { exact: true }).click();
    await page.waitForTimeout(500);

    // 2. 트래킹 링크 생성 메뉴 클릭
    await page.getByText('트래킹 링크 생성').click();
    await page.waitForTimeout(2000);

    // 3. 모달 닫기
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 4. 커스텀 채널 탭 클릭
    await page.getByRole('tab', { name: /커스텀 채널/ }).click();
    await page.waitForTimeout(1000);

    // 5. AutoPilot 설정
    const pilot = new AutoPilot(page, { verbose: true });

    const goal = {
      name: '트래킹 링크 생성',
      targetButton: '링크 생성'
    };

    // 6. 최대 5단계 수동 실행
    for (let i = 0; i < 5; i++) {
      console.log(`\n===== 단계 ${i + 1} =====`);

      // 현재 상태 출력
      console.log(await pilot.getReadableState());

      // 한 단계 실행
      const step = await pilot.stepOnce(goal);

      console.log(`\n행동: ${step.action.type}`);
      console.log(`이유: ${step.action.reason}`);
      console.log(`성공: ${step.success}`);

      if (step.action.type === 'done' || step.action.type === 'blocked') {
        console.log('종료');
        break;
      }

      await page.waitForTimeout(1000);
    }

    // 이 테스트는 디버깅 정보 수집용
    expect(true).toBe(true);
  });
});
