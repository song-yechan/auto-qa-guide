import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // 테스트 폴더
  testDir: './Tests',

  // 병렬 실행 비활성화 (순차 실행)
  fullyParallel: false,
  workers: 1,

  // 재시도 설정
  retries: 1,

  // 리포터 설정
  reporter: 'html',

  // 기본 설정
  use: {
    // baseURL - QA 테스트 시 자동 업데이트됨
    baseURL: 'https://abrge-app-git-feature-abrfe-2100-ab180.vercel.app',

    // 저장된 로그인 세션 사용
    storageState: 'auth.json',

    // 트레이스 설정 (실패 시 첫 재시도에서 기록)
    trace: 'on-first-retry',

    // 비디오 설정 (실패 시에만 저장)
    video: 'retain-on-failure',

    // 스크린샷 설정 (실패 시에만 저장)
    screenshot: 'only-on-failure',

    // 타임아웃 설정
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // 테스트 타임아웃 (1분)
  timeout: 60000,

  // 브라우저 설정 (Chromium 사용)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 산출물 저장 경로
  outputDir: 'test-results/',
});
