import { test, expect } from '@playwright/test';

// 테스트할 앱 이름 (사용자 입력값)
const APP_NAME = 'bookscribe';

test.describe(`${APP_NAME} 앱 접근 테스트`, () => {

  test('앱 목록에서 앱 진입 및 검증', async ({ page }) => {
    // 1. 페이지 접속 (로그인된 상태로 앱 목록 표시)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 2. 앱 목록 화면 확인
    await expect(page.getByRole('heading', { name: '앱 목록' })).toBeVisible({ timeout: 10000 });
    console.log('✅ 앱 목록 화면 확인');

    // 3. 해당 앱 클릭하여 진입
    await page.getByRole('link', { name: APP_NAME }).click();
    await page.waitForLoadState('networkidle');
    console.log(`✅ ${APP_NAME} 앱 클릭`);

    // 4. 앱 진입 검증 - 앱 이름이 표시되는 버튼 확인
    await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
      .toBeVisible({ timeout: 10000 });
    console.log(`✅ ${APP_NAME} 앱 진입 확인 완료`);

    // 5. 사용자 확인을 위해 대기 (Inspector에서 Resume 클릭 시 종료)
    await page.pause();
  });
});
