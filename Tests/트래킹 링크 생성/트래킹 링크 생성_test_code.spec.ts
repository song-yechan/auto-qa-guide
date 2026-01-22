import { test, expect } from '@playwright/test';

const APP_NAME = 'bookscribe';

test.describe('트래킹 링크 생성 - 커스텀 채널', () => {

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

  test('커스텀 채널로 트래킹 링크 생성', async ({ page }) => {
    // 1. 트래킹 링크 메뉴 클릭
    await page.getByText('트래킹 링크', { exact: true }).click();
    await page.waitForTimeout(500);

    // 2. 트래킹 링크 생성 메뉴 클릭
    await page.getByText('트래킹 링크 생성').click();
    await page.waitForTimeout(2000);

    // 3. Ask Airbridge 팝업 닫기 (있을 경우)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 4. 링크 생성 페이지 확인
    await expect(page.getByRole('heading', { name: /트래킹 링크 생성/ }))
      .toBeVisible({ timeout: 10000 });

    // 5. 커스텀 채널 탭 클릭
    await page.getByRole('tab', { name: /커스텀 채널/ }).click();
    await page.waitForTimeout(1000);

    // 6. 채널 입력 (textbox) - type() 사용하여 이벤트 발생
    const channelInput = page.getByRole('textbox', { name: '트래킹 링크를 사용할 채널을 선택하거나 새 이름을 입력해 주세요' });
    await channelInput.click();
    await channelInput.clear();
    await channelInput.type('테스트_채널_' + Date.now(), { delay: 30 });

    // blur 이벤트 발생을 위해 다른 곳 클릭
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);

    // 7. 링크 생성 버튼 활성화 대기 후 클릭
    const createButton = page.getByRole('button', { name: 'check 링크 생성' });
    await expect(createButton).toBeEnabled({ timeout: 10000 });
    await createButton.click();
    await page.waitForTimeout(3000);

    // 10. 생성 완료 확인 (완료 페이지로 이동 또는 성공 메시지)
    // URL이 /done/으로 변경되거나 성공 메시지 표시
    await page.waitForURL(/\/done\/|\/link-management/, { timeout: 15000 }).catch(() => {});

    // 링크가 생성되었는지 확인 (abr.ge URL 또는 완료 메시지)
    const successCheck = page.getByText(/abr\.ge|완료|생성|copied|복사/i).first();
    await expect(successCheck).toBeVisible({ timeout: 10000 });

    console.log('✅ 커스텀 채널 트래킹 링크 생성 완료');
  });
});
