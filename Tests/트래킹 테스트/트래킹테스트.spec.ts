import { test, expect, Page } from '@playwright/test';

const APP_NAME = 'bookscribe';

// 현재 앱 위치 확인 헬퍼 함수
async function verifyAppLocation(page: Page) {
  const appButton = page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` });
  await expect(appButton).toBeVisible({ timeout: 5000 });
}

// 트래킹 링크 페이지로 이동하는 헬퍼 함수
async function navigateToTrackingLink(page: Page) {
  await page.getByText('트래킹 링크', { exact: true }).click();
  await page.waitForTimeout(1000);
  await verifyAppLocation(page);
}

// 삭제 모달 열기 헬퍼 함수
async function openDeleteModal(page: Page) {
  const deleteButton = page.getByRole('button', { name: 'delete 트래킹 링크 삭제' }).first();
  await deleteButton.click();
  await expect(page.locator('[role="dialog"], [role="alertdialog"]')).toBeVisible({ timeout: 5000 });
}

test.describe('트래킹 링크 삭제 테스트', () => {

  test.beforeEach(async ({ page }) => {
    // 앱 목록 페이지 이동
    await page.goto('/app');

    // 앱 목록 확인
    await expect(page.getByRole('heading', { name: '앱 목록' })).toBeVisible({ timeout: 10000 });

    // 앱 클릭
    await page.getByRole('link', { name: APP_NAME }).click();

    // 앱 진입 확인
    await verifyAppLocation(page);

    // 모달 닫기 (무료 체험 종료 등)
    await page.waitForTimeout(1000);
    const modalVisible = await page.getByText('무료 체험이 종료됐습니다').isVisible().catch(() => false);
    if (modalVisible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Ask Airbridge 팝업 닫기
    const askAirbridgeClose = page.locator('button:has-text("닫기")');
    if (await askAirbridgeClose.isVisible().catch(() => false)) {
      await askAirbridgeClose.click();
      await page.waitForTimeout(500);
    }
  });

  test('1. 운영 모드 앱에서 전체 삭제 버튼 미노출', async ({ page }) => {
    await navigateToTrackingLink(page);

    // 전체 삭제 버튼이 없는지 확인
    const deleteAllButton = page.locator('button:has-text("전체 삭제")');
    await expect(deleteAllButton).not.toBeVisible();
  });

  test('4. 삭제 버튼 클릭 시 삭제 확인 모달 노출', async ({ page }) => {
    await navigateToTrackingLink(page);
    await openDeleteModal(page);

    // 앱 위치 재확인
    await verifyAppLocation(page);
  });

  test('5. 삭제 모달 최초 로드 시 삭제 확인 버튼 비활성화', async ({ page }) => {
    await navigateToTrackingLink(page);
    await openDeleteModal(page);

    // 삭제 확인 버튼이 비활성화 상태인지 확인
    const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
    await expect(confirmButton).toBeDisabled();
  });

  test('6. 정규식에 맞지 않는 값 입력 시 삭제 버튼 비활성화 유지', async ({ page }) => {
    await navigateToTrackingLink(page);
    await openDeleteModal(page);

    // 잘못된 값 입력
    const input = page.locator('[role="dialog"] input, [role="alertdialog"] input');
    await input.fill('wrong value');

    // 삭제 확인 버튼이 여전히 비활성화 상태인지 확인
    const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
    await expect(confirmButton).toBeDisabled();
  });

  test('7. 정규식에 맞는 올바른 값 입력 시 삭제 버튼 활성화', async ({ page }) => {
    await navigateToTrackingLink(page);
    await openDeleteModal(page);

    // 올바른 값 입력 (일반적으로 "삭제" 입력 요구)
    const input = page.locator('[role="dialog"] input, [role="alertdialog"] input');
    await input.fill('삭제');

    // 삭제 확인 버튼이 활성화 상태인지 확인
    const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
    await expect(confirmButton).toBeEnabled();
  });

  test('8. 삭제 실행 시 완료 Snackbar 노출', async ({ page }) => {
    await navigateToTrackingLink(page);
    await openDeleteModal(page);

    // 올바른 값 입력
    const input = page.locator('[role="dialog"] input, [role="alertdialog"] input');
    await input.fill('삭제');

    // 삭제 확인 버튼 클릭
    const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
    await confirmButton.click();

    // Snackbar/Toast 노출 확인
    const snackbar = page.locator('[role="alert"], .snackbar, .toast, [class*="Snackbar"], [class*="Toast"]');
    await expect(snackbar.first()).toBeVisible({ timeout: 5000 });

    // 삭제 후 앱 위치 확인
    await verifyAppLocation(page);
  });

  test('9. 삭제 후 트래킹 링크 목록에서 미노출', async ({ page }) => {
    await navigateToTrackingLink(page);

    // 첫 번째 트래킹 링크 이름 저장
    const firstLinkName = await page.locator('table tbody tr:first-child td:first-child, [class*="list"] [class*="item"]:first-child').first().textContent();

    await openDeleteModal(page);

    // 올바른 값 입력 및 삭제 실행
    const input = page.locator('[role="dialog"] input, [role="alertdialog"] input');
    await input.fill('삭제');
    const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
    await confirmButton.click();

    // 삭제 완료 대기
    await page.waitForTimeout(2000);

    // 앱 위치 확인
    await verifyAppLocation(page);

    // 삭제된 링크가 목록에 없는지 확인
    if (firstLinkName) {
      await expect(page.getByText(firstLinkName.trim())).not.toBeVisible();
    }
  });

  test('10. 삭제 후 남아있는 트래킹 링크 확인', async ({ page }) => {
    await navigateToTrackingLink(page);

    // 삭제 전 링크 개수 확인
    const linkCountBefore = await page.locator('table tbody tr, [class*="list"] [class*="item"]').count();

    await openDeleteModal(page);

    // 올바른 값 입력 및 삭제 실행
    const input = page.locator('[role="dialog"] input, [role="alertdialog"] input');
    await input.fill('삭제');
    const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
    await confirmButton.click();

    // 삭제 완료 대기
    await page.waitForTimeout(2000);

    // 앱 위치 확인
    await verifyAppLocation(page);

    // 삭제 후 링크 개수 확인 (1개 줄어야 함)
    const linkCountAfter = await page.locator('table tbody tr, [class*="list"] [class*="item"]').count();
    expect(linkCountAfter).toBe(linkCountBefore - 1);
  });

  test('11. 삭제된 유저가 생성한 트래킹 링크도 삭제됨', async ({ page }) => {
    await navigateToTrackingLink(page);

    // 삭제된 유저의 링크가 목록에 없는지 확인
    // (삭제된 유저의 링크 표시 방식에 따라 셀렉터 조정 필요)
    const deletedUserLinks = page.locator('[class*="deleted"], :has-text("삭제된 사용자")');
    await expect(deletedUserLinks).not.toBeVisible();
  });

  test('12. Activity History에 삭제 기록 노출', async ({ page }) => {
    // 먼저 트래킹 링크 삭제 실행
    await navigateToTrackingLink(page);

    const deleteButton = page.getByRole('button', { name: 'delete 트래킹 링크 삭제' }).first();
    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();
      const input = page.locator('[role="dialog"] input, [role="alertdialog"] input');
      await input.fill('삭제');
      const confirmButton = page.locator('[role="dialog"] button:has-text("삭제"), [role="alertdialog"] button:has-text("삭제")');
      await confirmButton.click();
      await page.waitForTimeout(2000);
    }

    // Activity History 페이지로 이동
    await page.getByText('Activity History').click();
    await page.waitForTimeout(1000);

    // 앱 위치 확인
    await verifyAppLocation(page);

    // 삭제 관련 로그가 있는지 확인
    const deleteLog = page.locator(':has-text("삭제"), :has-text("delete"), :has-text("Delete")');
    await expect(deleteLog.first()).toBeVisible({ timeout: 5000 });
  });

  test('13. 삭제된 트래킹 링크 URL 접근 시 redirect url로 리다이렉션', async ({ page }) => {
    // 삭제된 트래킹 링크 URL (테스트 환경에 맞게 조정 필요)
    const deletedLinkUrl = 'https://abr.ge/deleted-test-link';

    // 해당 URL로 이동
    await page.goto(deletedLinkUrl);

    // 리다이렉션 발생 확인 (redirect url로 이동)
    expect(page.url()).not.toBe(deletedLinkUrl);
  });

  test('14. 삭제된 트래킹 링크 URL 접근 시 fallback path로 리다이렉션', async ({ page }) => {
    // redirect url 미설정 삭제된 링크 URL (테스트 환경에 맞게 조정 필요)
    const deletedLinkNoRedirect = 'https://abr.ge/deleted-no-redirect';

    // 해당 URL로 이동
    await page.goto(deletedLinkNoRedirect);

    // fallback path로 리다이렉션 확인
    expect(page.url()).toContain('fallback');
  });
});
