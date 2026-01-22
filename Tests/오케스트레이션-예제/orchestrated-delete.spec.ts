import { test, expect } from '@playwright/test';
import { TestHelper, retry, skipIf } from '../../lib';

// 앱 설정
const APP_CONFIG = {
  name: 'bookscribe',
  baseUrl: 'https://abrge-app-git-feature-abrfe-2100-ab180.vercel.app',
  verifySelector: 'button:has-text("bookscribe")'
};

test.describe('오케스트레이션 시스템 - 트래킹 링크 삭제', () => {
  let helper: TestHelper;

  test.beforeEach(async ({ page }) => {
    helper = new TestHelper(page, APP_CONFIG);
  });

  test('자동 탐색 및 삭제 플로우', async ({ page }) => {
    // 1. 플로우 기록 시작
    helper.startRecording('tracking-link-delete', '트래킹 링크 삭제 자동화 플로우');

    // 2. 앱 접근 (모달 자동 처리 포함)
    const appAccess = await helper.accessApp();
    expect(appAccess).toBe(true);

    await helper.flowRecorder.recordNavigate(page.url(), '앱 접근 완료');

    // 3. 트래킹 링크 관리 메뉴로 이동
    const menuNav = await helper.navigateToMenu(['트래킹 링크', '트래킹 링크 관리']);
    expect(menuNav).toBe(true);

    await helper.flowRecorder.recordClick(
      "getByText('트래킹 링크 관리')",
      '트래킹 링크 관리 메뉴 클릭'
    );

    // 4. 페이지 탐색 - 삭제할 트래킹 링크 찾기
    console.log('\n=== DOM 탐색 시작 ===');
    const exploration = await helper.snapshot('tracking-link-page');
    console.log(`발견된 요소: ${exploration.elements.length}개`);

    // 5. 테이블에서 첫 번째 확장 버튼 찾기
    const expandSelectors = [
      "button:has-text('keyboard_arrow_right')",
      "[aria-expanded='false']",
      "tr button:first-child"
    ];

    const expandButton = await helper.waitForElement(expandSelectors, 5000);

    if (!expandButton) {
      // 트래킹 링크가 없는 경우 - 테스트 데이터 생성 필요
      console.log('[테스트] 트래킹 링크 없음 - 생성 필요');

      // 데이터 상태 출력
      helper.dataManager.printStatus();

      // 조건부 스킵
      test.skip(true, '삭제할 트래킹 링크가 없습니다. 먼저 트래킹 링크를 생성하세요.');
      return;
    }

    // 6. 트래킹 링크 선택 (확장)
    await helper.safeClick(expandButton);
    await helper.flowRecorder.recordClick(expandButton, '트래킹 링크 선택 (펼침)');

    // 7. 수정 버튼 찾기 및 클릭
    const editSelectors = [
      "button:has-text('edit')",
      "button:has-text('수정')",
      "[aria-label*='수정']",
      "[aria-label*='edit']"
    ];

    const editButton = await helper.waitForElement(editSelectors, 5000);
    if (!editButton) {
      // DOM 탐색으로 후보 찾기
      const candidates = await helper.findElement('수정 edit');
      console.log('수정 버튼 후보:', candidates);
      test.fail(true, '수정 버튼을 찾을 수 없습니다.');
      return;
    }

    await helper.safeClick(editButton);
    await helper.flowRecorder.recordClick(editButton, '수정 버튼 클릭');

    // 8. 삭제 버튼 찾기 및 클릭
    const deleteSelectors = [
      "button:has-text('delete')",
      "button:has-text('삭제')",
      "[aria-label*='삭제']"
    ];

    const deleteButton = await helper.waitForElement(deleteSelectors, 5000);
    if (!deleteButton) {
      const candidates = await helper.findElement('삭제 delete');
      console.log('삭제 버튼 후보:', candidates);
      test.fail(true, '삭제 버튼을 찾을 수 없습니다.');
      return;
    }

    await helper.safeClick(deleteButton);
    await helper.flowRecorder.recordClick(deleteButton, '삭제 버튼 클릭');

    // 9. 모달 자동 처리 (AB180 확인 + 최종 확인)
    await page.waitForTimeout(1000);

    // 첫 번째 모달 (AB180 확인) - ModalHandler가 자동 처리
    await helper.modalHandler.handleAllModals();

    // 두 번째 모달 (최종 확인)
    const finalConfirm = page.getByText('트래킹 링크를 삭제하겠습니까?');
    if (await finalConfirm.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: '삭제' }).last().click();
      await helper.flowRecorder.recordClick(
        "getByRole('button', { name: '삭제' })",
        '최종 삭제 확인'
      );
    }

    // 10. 삭제 완료 확인
    await page.waitForTimeout(2000);

    const successIndicators = [
      page.locator('[data-test-id="snackbar-success"]'),
      page.getByText('삭제됐습니다'),
      page.getByText('삭제되었습니다')
    ];

    let deleteSuccess = false;
    for (const indicator of successIndicators) {
      if (await indicator.isVisible().catch(() => false)) {
        deleteSuccess = true;
        break;
      }
    }

    expect(deleteSuccess).toBe(true);

    // 11. 플로우 기록 종료
    const flow = helper.endRecording();
    console.log(`\n플로우 기록 완료: ${flow?.steps.length}개 스텝`);

    // 12. 테스트 코드 생성
    if (flow) {
      const generatedCode = helper.flowRecorder.generateTestCode(flow);
      console.log('\n=== 생성된 테스트 코드 ===');
      console.log(generatedCode);
    }
  });

  test('DOM 탐색 전용 테스트', async ({ page }) => {
    // 앱 접근
    await helper.accessApp();
    await helper.navigateToMenu(['트래킹 링크', '트래킹 링크 관리']);

    // 전체 페이지 탐색 및 저장
    const result = await helper.snapshot('full-page-exploration');

    console.log('\n=== 탐색 결과 ===');
    console.log(`URL: ${result.url}`);
    console.log(`총 요소: ${result.elements.length}개`);
    console.log(`스크린샷: ${result.screenshot}`);

    // 클릭 가능한 버튼들
    const buttons = result.elements.filter(el => el.tag === 'button' || el.role === 'button');
    console.log(`\n버튼 (${buttons.length}개):`);
    buttons.slice(0, 10).forEach(btn => {
      console.log(`  - ${btn.text.slice(0, 30)} | ${btn.suggestedSelectors[0] || 'N/A'}`);
    });

    // 테이블 관련 요소
    const tableElements = await helper.explorer.exploreTableRows();
    console.log(`\n테이블 행 (${tableElements.length}개):`);
    tableElements.slice(0, 5).forEach(row => {
      console.log(`  - ${row.text.slice(0, 50)}`);
    });
  });
});
