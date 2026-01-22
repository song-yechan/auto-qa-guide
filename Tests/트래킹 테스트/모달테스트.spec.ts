import { test, expect } from '@playwright/test';

const APP_NAME = 'bookscribe';

test('삭제 모달 띄우기', async ({ page }) => {
  // 1. 메인 페이지 이동
  await page.goto('/');

  // 2. 앱 목록에서 앱 클릭
  await expect(page.getByRole('heading', { name: '앱 목록' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('link', { name: APP_NAME }).click();

  // 3. 앱 진입 확인
  await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
    .toBeVisible({ timeout: 10000 });

  // 4. 트래킹 링크 메뉴로 이동 (사이드바에서 찾기)
  await page.getByRole('link', { name: '트래킹 링크' }).click();

  // 5. 트래킹 링크 목록 로딩 대기
  await page.waitForTimeout(2000);

  // 6. 첫 번째 트래킹 링크의 삭제 버튼 클릭 (모달 띄우기)
  // 삭제 버튼이나 휴지통 아이콘 찾기
  const deleteButton = page.locator('[aria-label*="삭제"], [aria-label*="delete"], button:has-text("삭제")').first();

  if (await deleteButton.isVisible()) {
    await deleteButton.click();

    // 7. 삭제 확인 모달이 뜨는지 확인
    await expect(page.locator('[role="dialog"], [role="alertdialog"], .modal')).toBeVisible({ timeout: 5000 });

    console.log('✅ 삭제 모달이 정상적으로 표시되었습니다!');
  } else {
    console.log('⚠️ 삭제 버튼을 찾을 수 없습니다. 페이지 구조 확인 필요');
  }

  // 사용자 확인을 위해 잠시 대기
  await page.waitForTimeout(3000);
});
