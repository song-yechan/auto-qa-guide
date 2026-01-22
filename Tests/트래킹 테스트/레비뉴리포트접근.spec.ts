import { test, expect } from '@playwright/test';

const APP_NAME = 'bookscribe';

test('레비뉴 리포트 접근', async ({ page }) => {
  // 1. 앱 목록 페이지 이동
  await page.goto('/app');

  // 2. 앱 목록에서 bookscribe 클릭
  await expect(page.getByRole('heading', { name: '앱 목록' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('link', { name: APP_NAME }).click();

  // 3. 앱 진입 확인
  await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
    .toBeVisible({ timeout: 10000 });

  // 4. 모달이 있으면 닫기 (무료 체험 종료 등)
  await page.waitForTimeout(1000);
  const modalVisible = await page.getByText('무료 체험이 종료됐습니다').isVisible().catch(() => false);
  if (modalVisible) {
    // Escape 키로 모달 닫기
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // 5. Ask Airbridge 팝업 닫기 (있으면)
  const askAirbridgeClose = page.locator('button:has-text("닫기")');
  if (await askAirbridgeClose.isVisible().catch(() => false)) {
    await askAirbridgeClose.click();
    await page.waitForTimeout(500);
  }

  // 6. 리포트 메뉴 클릭 (하위 메뉴 펼치기)
  await page.getByText('리포트', { exact: true }).click();
  await page.waitForTimeout(500);

  // 7. 레비뉴 리포트 클릭
  await page.getByText('레비뉴 리포트').click();

  // 8. 레비뉴 리포트 페이지 로딩 확인
  await page.waitForTimeout(2000);

  console.log('✅ 레비뉴 리포트 접근 완료!');

  // 사용자 확인을 위해 일시정지
  await page.pause();
});
