# Claude Code + Playwright QA 자동화 시스템 문서

## 1. 개요

### 1.1 시스템 목적
Vercel Preview 환경에서 배포된 웹 애플리케이션을 Claude Code와 Playwright를 활용하여 자동으로 QA 테스트하는 시스템

### 1.2 핵심 특징
- **단일 프롬프트 진입점**: "QA 테스트 요청" 한 마디로 전체 플로우 시작
- **자동 환경 점검**: 패키지, 브라우저, 세션 자동 확인 및 설치
- **앱 환경 분리**: 특정 앱 내에서만 테스트 진행 가능 (다른 앱 영향 방지)
- **2단계 실행 모드**: 앱 확인(headed) → 본 테스트(headless)

---

## 2. 기술 스택

### 2.1 핵심 기술
| 기술 | 용도 | 버전 |
|------|------|------|
| **Playwright** | E2E 테스트 프레임워크 | Latest |
| **Claude Code** | AI 기반 테스트 작성/실행 자동화 | - |
| **TypeScript** | 테스트 코드 작성 | - |
| **Chromium** | 테스트 브라우저 | Playwright 내장 |

### 2.2 Playwright 주요 기능 활용
```typescript
// 1. Storage State - 로그인 세션 유지
test.use({ storageState: 'auth.json' });

// 2. Codegen - 셀렉터 탐색
npx playwright codegen "{URL}" --load-storage=auth.json

// 3. Headed/Headless 모드
npx playwright test --headed  // 브라우저 표시
npx playwright test           // 백그라운드 실행

// 4. Page Pause - 사용자 확인용 일시정지
await page.pause();

// 5. HTML Reporter
npx playwright test --reporter=html
```

### 2.3 디렉토리 구조
```
auto-QA/
├── CLAUDE.md                 # Claude Code 지침서
├── QA-AUTOMATION-GUIDE.md    # 사용자 가이드
├── playwright.config.ts      # Playwright 설정
├── auth.json                 # 로그인 세션 (gitignore)
└── Tests/
    └── {테스트명}/
        ├── 앱접근테스트.spec.ts     # 앱 진입 확인용
        ├── {테스트명}.spec.ts       # 본 테스트 코드
        ├── {테스트명}_result.md     # 결과 리포트
        ├── report/                  # HTML 리포트
        └── results/                 # 스크린샷, 비디오
```

---

## 3. 워크플로우

### 3.1 전체 플로우
```
사용자: "QA 테스트 요청"
         ↓
Phase 0: 환경 자동 점검
├── 패키지 확인 (node_modules/@playwright)
├── 브라우저 확인 (npx playwright --version)
└── 세션 확인 (auth.json 존재 여부)
         ↓
Phase 1: 정보 수집
├── 테스트명 입력
├── Vercel URL 입력
├── 앱 환경 설정 (선택)
└── 테스트 케이스 입력
         ↓
Phase 2: 준비
├── 폴더 생성 (Tests/{테스트명}/)
└── baseURL 업데이트
         ↓
Phase 3: 계획
├── 테스트 케이스 표로 정리
└── 자동화 가능/불가 분류
         ↓
Phase 3.5: 앱 접근 확인 [--headed]
├── 앱 진입 테스트 실행
├── 브라우저 창에서 사용자 확인
└── Inspector 창 닫으면 다음 단계
         ↓
Phase 4: 실행 [headless]
├── 테스트 코드 작성
└── 전체 테스트 백그라운드 실행
         ↓
Phase 5: 산출물 저장
├── report/, results/ 폴더 정리
└── 결과 리포트 작성
         ↓
Phase 6: 검증
├── HTML 리포트 브라우저 오픈
└── 추가 확인 옵션 제공
```

### 3.2 세션 관리
```bash
# 세션 저장 (Google SSO 로그인)
npx playwright codegen "{URL}" --save-storage=auth.json

# 세션 로드
npx playwright codegen "{URL}" --load-storage=auth.json
```

**Google 패스키 팝업 처리:**
1. "패스키" 팝업 표시됨
2. "다른 방법 시도" 클릭
3. "비밀번호" 선택하여 로그인

### 3.3 앱 환경 분리 (핵심 기능)
특정 앱 내에서만 테스트할 때:

```typescript
const APP_NAME = 'bookscribe'; // 대시보드 표기 이름

// beforeEach에서 앱 진입 + 검증
test.beforeEach(async ({ page }) => {
  await page.goto('/app');

  // 앱 목록 확인
  await expect(page.getByRole('heading', { name: '앱 목록' }))
    .toBeVisible({ timeout: 10000 });

  // 앱 클릭
  await page.getByRole('link', { name: APP_NAME }).click();

  // 앱 진입 검증
  await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
    .toBeVisible({ timeout: 10000 });
});
```

**앱 위치 확인 헬퍼 함수:**
```typescript
async function verifyAppLocation(page: Page) {
  const appButton = page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` });
  await expect(appButton).toBeVisible({ timeout: 5000 });
}
```

---

## 4. 인사이트 및 교훈

### 4.1 사용자 경험 관련
| 문제 | 해결책 | 인사이트 |
|------|--------|----------|
| "세션 저장해줘" 기억 어려움 | "QA 테스트 요청" 시 자동 감지 | **단일 진입점이 핵심** |
| 앱 확인 없이 테스트 시작 | Phase 3.5 추가 (headed 모드) | **시각적 확인이 안전** |
| Inspector 창 언제 닫아야? | 명시적 안내 추가 | **사용자에게 항상 다음 행동 안내** |

### 4.2 기술적 교훈
| 상황 | 발견 | 적용 |
|------|------|------|
| 세션 저장 | 로그인만 저장, 앱 위치는 저장 안 됨 | beforeEach에서 앱 진입 로직 필수 |
| 모달 처리 | Escape 키로 대부분 닫힘 | 모달 닫기 로직 공통화 |
| 셀렉터 탐색 | codegen이 가장 효율적 | 추측하지 말고 codegen 먼저 |
| Vercel URL | 세션은 URL 변경되어도 유효 | 24시간 후 만료 |

### 4.3 테스트 설계 원칙
1. **에러 메시지 검증**: 정확한 텍스트 대신 컴포넌트 존재 여부 확인
   ```typescript
   // Bad
   await expect(page.getByText('정확한 에러 메시지')).toBeVisible();

   // Good
   const error = page.locator('[role="alert"], [class*="error"]');
   await expect(error.first()).toBeVisible();
   ```

2. **앱 위치 주기적 확인**: 페이지 이동 후 항상 `verifyAppLocation()` 호출

3. **모달/팝업 사전 처리**: beforeEach에서 공통 모달 닫기

---

## 5. 시스템 한계 및 보완점

### 5.1 현재 한계
| 한계 | 상세 | 영향도 |
|------|------|--------|
| **Chrome 프로필 미지원** | Playwright는 기존 Chrome 세션 사용 불가 | 중 |
| **패스키 자동화 불가** | Google 패스키는 수동 처리 필요 | 저 |
| **동적 셀렉터** | 페이지 구조 변경 시 셀렉터 깨짐 | 고 |
| **네트워크 의존** | 오프라인/불안정 네트워크에서 실패 | 중 |

### 5.2 자동화 제외 항목
| 유형 | 예시 | 사유 |
|------|------|------|
| 계정 전환 | 오너/비오너 권한 테스트 | 세션 분리 필요 |
| 앱 모드 전환 | 운영/개발 모드 테스트 | 별도 앱 필요 |
| 실제 트래픽 | 유입 후 리포트 확인 | 외부 시스템 연동 |
| 실시간 데이터 | 특정 사용자 데이터 확인 | 데이터 의존성 |

### 5.3 개선 제안
| 영역 | 현재 | 개선안 |
|------|------|--------|
| 셀렉터 관리 | 코드에 하드코딩 | Page Object Model 도입 |
| 에러 복구 | 실패 시 재시도 1회 | 지능형 재시도 (원인별 대응) |
| 병렬 실행 | 순차 실행 (workers: 1) | 독립 테스트는 병렬화 |
| 리포트 | HTML 리포트만 | Slack/이메일 알림 연동 |

---

## 6. 명령어 레퍼런스

### 6.1 기본 명령어
```bash
# 테스트 실행
npx playwright test "Tests/{테스트명}"

# headed 모드 (브라우저 표시)
npx playwright test --headed

# 특정 테스트만 실행
npx playwright test -g "테스트 이름"

# HTML 리포트 열기
open "Tests/{테스트명}/report/index.html"

# UI 모드 (디버깅)
npx playwright test --ui
```

### 6.2 세션 관리
```bash
# 세션 저장
npx playwright codegen "{URL}" --save-storage=auth.json

# 세션으로 codegen
npx playwright codegen "{URL}" --load-storage=auth.json
```

### 6.3 디버깅
```bash
# Trace 확인
npx playwright show-trace "{trace.zip 경로}"

# 스크린샷 확인
open "test-results/{테스트명}/test-failed-1.png"
```

---

## 7. 관련 파일

| 파일 | 용도 | 위치 |
|------|------|------|
| CLAUDE.md | Claude Code 지침서 | /auto-QA/ |
| QA-AUTOMATION-GUIDE.md | 사용자 가이드 | /auto-QA/ |
| playwright.config.ts | Playwright 설정 | /auto-QA/ |
| auth.json | 로그인 세션 | /auto-QA/ (gitignore) |

---

## 8. GitHub 저장소

- **URL**: https://github.com/song-yechan/auto-qa-guide
- **파일**: CLAUDE.md, QA-AUTOMATION-GUIDE.md
- **최신 커밋**: `d4b282a` (앱 접근 확인 후 headless 테스트 실행 프로세스 정립)

---

## 9. 버전 히스토리

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 1.0 | 2026-01-21 | 초기 시스템 구축 |
| 1.1 | 2026-01-21 | 앱 환경 설정 기능 추가 |
| 1.2 | 2026-01-21 | 앱 접근 자동 검증 로직 추가 |
| 1.3 | 2026-01-21 | Phase 3.5 (사용자 확인 단계) 추가 |
| 1.4 | 2026-01-21 | Google 패스키 가이드 추가 |
| 1.5 | 2026-01-21 | headed/headless 분리 프로세스 정립 |

---

*문서 작성일: 2026-01-21*
*작성: Claude Opus 4.5*
