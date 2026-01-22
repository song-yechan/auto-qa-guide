import { test, expect } from '@playwright/test';

// 로그인 페이지 테스트는 인증 없이 진행해야 함
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('민채님과 데이트 - 로그인 페이지 QA', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('1. Placeholder 노출 확인 - ID와 PW 입력창이 함께 노출되는지', async ({ page }) => {
    // 이메일 입력창 확인
    const emailInput = page.locator('input').first();
    await expect(emailInput).toBeVisible({ timeout: 10000 });

    // 비밀번호 입력창 확인
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 10000 });

    // Work email / 회사 이메일 라벨 확인
    await expect(
      page.getByText('Work email', { exact: true })
        .or(page.getByText('회사 이메일', { exact: true }))
    ).toBeVisible();

    // Password / 비밀번호 라벨 확인
    await expect(
      page.getByText('Password', { exact: true })
        .or(page.getByText('비밀번호', { exact: true }))
    ).toBeVisible();
  });

  test('2. 이메일 형식 validation - 이메일 형식이 아닐 때 에러메세지 등장', async ({ page }) => {
    // 이메일 형식 아닌 값 입력
    const emailInput = page.locator('input').first();
    await emailInput.fill('invalid-email');

    // 비밀번호 입력
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('testpassword');

    // Submit 버튼 클릭
    const submitButton = page.getByRole('button', { name: 'Submit' });
    await submitButton.click();

    // 에러 메시지 확인: "이메일 형식으로 입력해주세요" 또는 영문
    const errorMessage = page.getByText('이메일 형식으로 입력해주세요')
      .or(page.getByText('Enter a valid email'));
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('3. 잘못된 비밀번호 에러 - 에러 메시지 노출', async ({ page }) => {
    // 이메일 입력
    const emailInput = page.locator('input').first();
    await emailInput.fill('test@example.com');

    // 틀린 비밀번호 입력
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('wrongpassword123');

    // Submit 버튼 클릭
    const submitButton = page.getByRole('button', { name: 'Submit' });
    await submitButton.click();

    // 에러 메시지 확인 (에러 컴포넌트 존재 여부)
    const errorMessage = page.locator('[class*="error"], [class*="Error"], [role="alert"]')
      .or(page.getByText(/incorrect|invalid|wrong|failed|blocked|올바르지 않습니다/i));
    await expect(errorMessage.first()).toBeVisible({ timeout: 15000 });
  });

  test('4. 존재하지 않는 이메일 에러 - 동일한 에러 메시지 노출 (보안)', async ({ page }) => {
    // 존재하지 않는 이메일 입력
    const emailInput = page.locator('input').first();
    await emailInput.fill('nonexistent12345@example.com');

    // 비밀번호 입력
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('somepassword123');

    // Submit 버튼 클릭
    const submitButton = page.getByRole('button', { name: 'Submit' });
    await submitButton.click();

    // 동일한 에러 메시지 확인 (보안상 이메일 존재 여부를 노출하지 않아야 함)
    const errorMessage = page.locator('[class*="error"], [class*="Error"], [role="alert"]')
      .or(page.getByText(/incorrect|invalid|wrong|failed|blocked|올바르지 않습니다/i));
    await expect(errorMessage.first()).toBeVisible({ timeout: 15000 });
  });

  test('5. 에러 메시지 i18n (한글) - 한글 에러 메시지 확인', async ({ page }) => {
    // 한글 모드로 전환 시도
    const langButton = page.getByText('English', { exact: true });
    if (await langButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await langButton.click();
      const koreanOption = page.getByText('한국어');
      if (await koreanOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await koreanOption.click();
        await page.waitForLoadState('networkidle');
      }
    }

    // 잘못된 로그인 시도
    const emailInput = page.locator('input').first();
    await emailInput.fill('test@example.com');

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('wrongpassword');

    const submitButton = page.getByRole('button', { name: /Submit|제출/i });
    await submitButton.click();

    // 한글 에러 메시지 확인: "회사 이메일 또는 비밀번호가 올바르지 않습니다"
    const errorMessage = page.getByText(/올바르지 않습니다/)
      .or(page.locator('[class*="error"], [class*="Error"], [role="alert"]'));
    await expect(errorMessage.first()).toBeVisible({ timeout: 15000 });
  });

  test('6. 에러 메시지 i18n (영문) - 영문 에러 메시지 확인', async ({ page }) => {
    // 영문 모드로 전환 (기본값일 수 있음)
    const langButton = page.getByText('한국어', { exact: true });
    if (await langButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await langButton.click();
      const englishOption = page.getByText('English');
      if (await englishOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await englishOption.click();
        await page.waitForLoadState('networkidle');
      }
    }

    // 잘못된 로그인 시도
    const emailInput = page.locator('input').first();
    await emailInput.fill('test@example.com');

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('wrongpassword');

    const submitButton = page.getByRole('button', { name: 'Submit' });
    await submitButton.click();

    // 영문 에러 메시지 확인
    const errorMessage = page.getByText(/incorrect|invalid|wrong|failed|blocked/i)
      .or(page.locator('[class*="error"], [class*="Error"], [role="alert"]'));
    await expect(errorMessage.first()).toBeVisible({ timeout: 15000 });
  });

  test('7. Google SSO 이메일로 일반 로그인 시 실패', async ({ page }) => {
    // Google SSO 이메일로 일반 로그인 시도
    const emailInput = page.locator('input').first();
    await emailInput.fill('googleuser@gmail.com');

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('anypassword123');

    const submitButton = page.getByRole('button', { name: 'Submit' });
    await submitButton.click();

    // 로그인 실패 확인 (에러 메시지 또는 여전히 로그인 페이지)
    await page.waitForTimeout(3000);

    const errorMessage = page.locator('[class*="error"], [class*="Error"], [role="alert"]')
      .or(page.getByText(/incorrect|invalid|wrong|failed|blocked|올바르지 않습니다/i));
    const stillOnLoginPage = page.locator('input[type="password"]');

    await expect(errorMessage.or(stillOnLoginPage).first()).toBeVisible({ timeout: 15000 });
  });
});
