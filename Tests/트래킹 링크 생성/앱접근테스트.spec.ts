import { test, expect } from '@playwright/test';

const APP_NAME = 'bookscribe';

test('앱 접근 확인', async ({ page }) => {
  await page.goto('/');

  // 앱 목록 확인 (로그인 상태)
  await expect(page.getByRole('heading', { name: '앱 목록' }))
    .toBeVisible({ timeout: 10000 });

  // 앱 링크 존재 여부 확인
  const appLink = page.getByRole('link', { name: APP_NAME });
  const appExists = await appLink.isVisible().catch(() => false);

  if (!appExists) {
    throw new Error(`앱을 찾을 수 없습니다: "${APP_NAME}"`);
  }

  // 앱 클릭하여 진입
  await appLink.click();

  // 앱 진입 검증
  await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
    .toBeVisible({ timeout: 10000 });

  // 사용자 확인을 위해 일시정지 (창 유지)
  await page.pause();
});
