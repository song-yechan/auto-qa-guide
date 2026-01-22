import { test, expect } from '@playwright/test';

const APP_NAME = 'bookscribe';

test('트래킹 링크 삭제', async ({ page }) => {
  // 1. 앱 목록 페이지 이동 (타임아웃 60초)
  await page.goto('/app', { timeout: 60000 });

  // 2. 앱 목록 확인
  await expect(page.getByRole('heading', { name: '앱 목록' })).toBeVisible({ timeout: 10000 });

  // 3. 앱 클릭
  await page.getByRole('link', { name: APP_NAME }).click();

  // 4. 앱 진입 확인
  await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
    .toBeVisible({ timeout: 10000 });

  // 5. 모달/팝업 닫기 (Escape 키로 모두 닫기)
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 6. 트래킹 링크 > 트래킹 링크 관리 메뉴 클릭
  await page.getByText('트래킹 링크', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByText('트래킹 링크 관리').click();
  await page.waitForTimeout(2000);

  // 7. Ask Airbridge 팝업 닫기 (Escape 키)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 8. 테이블 행의 화살표 버튼 클릭 (첫 번째 트래킹 링크 펼침)
  const expandButton = page.locator('button').filter({ hasText: 'keyboard_arrow_right' }).first();
  await expandButton.click();
  await page.waitForTimeout(1000);

  // 9. 수정 버튼 클릭
  await page.getByRole('button', { name: /edit.*수정/ }).click();
  await page.waitForTimeout(1000);

  // 10. 삭제 버튼 클릭
  await page.getByRole('button', { name: /delete.*삭제/ }).click();
  await page.waitForTimeout(1000);

  // 11. 삭제 모달 확인
  const modal = page.locator('[role="dialog"], [role="alertdialog"]');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // 12. 모달 안내 문구에서 필요한 확인 텍스트 자동 추출
  // "앱 이름 {name}을(를) 입력해주세요" 패턴에서 {name} 추출
  const instructionText = await modal.locator('text=/입력해주세요/').first().textContent() || '';

  // 링크 태그 안의 텍스트 또는 굵은 텍스트 찾기 (확인 문구)
  let confirmText = '';
  const linkInModal = modal.locator('a, strong, b').first();
  if (await linkInModal.isVisible().catch(() => false)) {
    confirmText = await linkInModal.textContent() || '';
  }

  // 못 찾으면 앱 이름 사용
  if (!confirmText) {
    confirmText = APP_NAME;
  }

  console.log(`확인 문구 추출: "${confirmText}"`);

  // 13. 확인 입력란에 추출한 텍스트 입력 (타이핑 + blur 이벤트)
  const confirmInput = modal.locator('input[type="text"], input:not([type])').first();
  await confirmInput.click();
  await confirmInput.clear();
  await confirmInput.type(confirmText.trim(), { delay: 50 });
  // blur 이벤트 발생을 위해 다른 곳 클릭
  await modal.locator('text=확인 문구').click();
  await page.waitForTimeout(1000);

  // 14. 삭제 버튼이 활성화될 때까지 대기
  const deleteButton = modal.getByRole('button', { name: /삭제/ }).last();
  await expect(deleteButton).toBeEnabled({ timeout: 10000 });

  // 15. 첫 번째 삭제 버튼 클릭 (AB180 확인 모달)
  await deleteButton.click();
  await page.waitForTimeout(1000);

  // 16. 두 번째 확인 모달 처리 ("트래킹 링크를 삭제하겠습니까?")
  // 모달 텍스트가 보일 때까지 대기
  await expect(page.getByText('트래킹 링크를 삭제하겠습니까?')).toBeVisible({ timeout: 5000 });
  // 빨간색 삭제 버튼 클릭 (마지막 삭제 버튼)
  await page.getByRole('button', { name: '삭제' }).last().click();
  await page.waitForTimeout(2000);

  // 17. 삭제 완료 확인 (Snackbar)
  const snackbar = page.locator('[data-test-id="snackbar-success"]');
  await expect(snackbar).toBeVisible({ timeout: 10000 });

  // 삭제 메시지 확인
  await expect(page.getByText('트래킹 링크가 삭제됐습니다')).toBeVisible({ timeout: 5000 });

  console.log('✅ 트래킹 링크 삭제 완료');
});
