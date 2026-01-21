# QA 자동화 시스템 지침

이 폴더는 Playwright 기반 QA 자동화 프로젝트입니다.

## 핵심 동작 규칙

### 0. 환경 자동 점검 (모든 작업 전 필수)

**QA 테스트 요청 시 자동으로 환경과 로그인 세션을 점검하고, 필요하면 알아서 해결한다.**

사용자에게 기술적인 내용을 묻지 않는다.

#### 점검 1: 패키지/브라우저 (자동 설치)

```bash
# 1. node_modules 존재 확인
ls node_modules/@playwright 2>/dev/null || echo "NEED_INSTALL"

# 2. Playwright 설치 확인
npx playwright --version 2>/dev/null || echo "NEED_INSTALL"

# 3. Chromium 브라우저 확인
npx playwright install --dry-run chromium 2>&1 | grep -q "already installed" || echo "NEED_BROWSER"
```

| 문제 | 자동 조치 | 사용자 안내 |
|------|----------|------------|
| node_modules 없음 | `npm install` 실행 | "환경을 준비하고 있습니다..." |
| Playwright 없음 | `npm install @playwright/test` 실행 | (위와 동일) |
| Chromium 없음 | `npx playwright install chromium` 실행 | "브라우저를 설치하고 있습니다..." |
| playwright.config.ts 없음 | 기본 설정 파일 생성 | (조용히 처리) |
| Tests/ 폴더 없음 | `mkdir -p Tests` 실행 | (조용히 처리) |

#### 점검 2: 로그인 세션 (사용자 액션 필요)

```bash
# auth.json 존재 및 유효성 확인
ls auth.json 2>/dev/null || echo "NO_SESSION"
```

**세션이 없거나 만료된 경우:**

1. 사용자에게 안내: "로그인이 필요합니다. Vercel URL을 입력해주세요."
2. URL 입력받으면 codegen 실행:
   ```bash
   npx playwright codegen --save-storage=auth.json "{URL}"
   ```
3. 안내: "브라우저가 열리면 로그인 후 Inspector 창을 닫아주세요."
4. 완료 후: "로그인이 저장되었습니다. 테스트를 진행합니다."
5. **이후 원래 QA 테스트 플로우 계속 진행**

#### 점검 결과 요약

| 상태 | 동작 |
|------|------|
| 모든 환경 정상 + 세션 있음 | 아무 말 없이 QA 플로우 진행 |
| 패키지 없음 | 자동 설치 후 진행 |
| 세션 없음 | 로그인 먼저 → 완료 후 QA 플로우 계속 |

---

### 1. QA 테스트 요청 시 자동 처리

사용자가 "QA 테스트 요청", "테스트해줘", "QA 해줘" 등의 키워드로 요청하면:

1. **[### 0. 환경 자동 점검] 수행** (패키지 + 세션)
2. **세션 없으면 → 로그인 먼저 진행 → 완료 후 아래 계속**
3. **세션 있으면 → 바로 아래 Phase 1 진행**

#### Phase 1: 정보 수집 (순차적으로 질문)
1. **테스트명 질문** - "테스트명을 입력해주세요 (해당 명칭에 맞게 폴더가 생성됩니다)"
2. **URL 질문** - "테스트할 Vercel URL을 입력해주세요"
3. **앱 환경 설정 질문** - AskUserQuestion 도구로 객관식 선택지 제시:
   - 질문: "특정 앱 환경에서 테스트해야 하나요?"
   - 선택지:
     - `아니요, 바로 진행` → 4번으로
     - `네, 앱 설정 필요` → 앱 이름/설정 방법 추가 질문
   - "네" 선택 시: "어떤 앱에서 테스트하나요? (앱 이름 또는 접근 방법을 알려주세요)"
   - 입력받은 앱 설정은 테스트 코드 beforeEach에 반영
   - **앱 접근 검증 필수**: 테스트 코드에서 해당 앱에 정확히 접근했는지 자동 검증
     ```typescript
     // beforeEach에서 앱 접근 후 검증 로직 추가
     test.beforeEach(async ({ page }) => {
       await page.goto('/');

       // 1. 앱 목록에서 해당 앱 클릭
       await page.getByRole('link', { name: '{앱이름}' }).click();

       // 2. 앱 접근 검증 - 현재 앱이 맞는지 확인
       // (앱 진입 후 앱 이름이 표시되는 버튼/헤더 등 확인)
       await expect(page.getByRole('button', { name: '{앱이름} {앱이름}' })
         .or(page.getByRole('heading', { name: '{앱이름}' }))
       ).toBeVisible({ timeout: 10000 });

       // 3. 검증 실패 시 테스트 자동 실패 → 다른 앱 데이터 보호
     });
     ```
   - **검증 selector 확인 방법**: codegen으로 앱 진입 후 앱 이름이 표시되는 요소의 selector 확인
4. **테스트 케이스 질문** - 아래 형식으로 안내:
   ```
   테스트 케이스를 입력해주세요. 형식은 아래가 가장 적합합니다:

   테스트 케이스:
   1. 페이지: {페이지명}
      동작: {수행할 액션}
      확인: {기대 결과}

   * 만약 테스트 케이스가 모호하다면 [QA-AUTOMATION-GUIDE] 파일의 [## 별첨: QA 케이스 작성 프롬프트] 내용을 확인해주세요
   ```

#### Phase 2: 준비
4. **폴더 생성** - `Tests/{테스트명}/` 폴더 생성
5. **baseURL 업데이트** - URL이 다르면 `playwright.config.ts` 자동 수정

#### Phase 3: 계획
6. **테스트 계획 제시** - 구체화된 테스트 케이스 표로 보여주기
7. **승인 요청** - "이 계획대로 진행할까요?" 묻기

#### Phase 3.5: 앱 접근 확인 (앱 환경 설정한 경우만)
> 특정 앱 환경에서 테스트하는 경우에만 실행

8. **앱 접근 스크린샷 촬영**:
   ```bash
   # 브라우저 열어서 앱까지 이동 후 스크린샷
   npx playwright test --headed --debug
   # 또는 codegen으로 직접 확인
   npx playwright codegen "{URL}" --timeout=60000
   ```
9. **사용자 확인 요청** - 스크린샷 또는 브라우저 화면을 보여주고:
   - "현재 {앱이름} 앱에 접근한 화면입니다. 맞는지 확인해주세요."
   - AskUserQuestion으로 확인:
     - `네, 맞습니다` → Phase 4로 진행
     - `아니요, 다른 앱입니다` → 앱 접근 방법 재확인
10. **확인 완료 후** 테스트 진행

#### Phase 4: 실행
11. **페이지 구조 파악** - codegen으로 실제 selector 확인 (필요시)
    ```bash
    npx playwright codegen "{URL}" --timeout=30000
    ```
12. **테스트 코드 작성** - `Tests/{테스트명}/{테스트명}_test_code.spec.ts`
    - 사용자가 "동작"만 설명해도 이해하고 적절한 테스트 작성
    - 에러 확인은 정확한 텍스트 대신 **에러 컴포넌트 존재 여부**로 체크
      ```typescript
      // 좋은 예: 에러 컴포넌트 존재 여부 확인
      const errorMessage = page.locator('[role="alert"], [class*="error"]');
      await expect(errorMessage.first()).toBeVisible();

      // 피해야 할 예: 정확한 텍스트 매칭
      await expect(page.getByText('정확한 에러 메시지')).toBeVisible();
      ```
13. **테스트 실행** - `npx playwright test "Tests/{테스트명}" --reporter=html`

#### Phase 5: 산출물 저장
14. **리포트 이동** - 실행 후 아래 명령어로 산출물 정리:
    ```bash
    mv playwright-report "Tests/{테스트명}/report"
    mv test-results "Tests/{테스트명}/results"
    ```
15. **결과 리포트 작성** - `Tests/{테스트명}/{테스트명}_test_result.md`

#### Phase 6: 검증
16. **HTML 리포트 오픈** - `open "Tests/{테스트명}/report/index.html"`
17. **확인 완료 질문** - AskUserQuestion 도구로 객관식 선택지 제시:
    - 질문: "확인을 완료하셨으면 다음 동작을 요청해주세요"
    - 선택지:
      - `테스트 완료` → 종료
      - `UI 모드로 추가 확인` → 18번으로
18. **UI 모드 실행 (선택)** - 사용자가 "UI 모드로 추가 확인" 선택 시:
    - 해당 테스트의 UI 모드 직접 실행: `npx playwright test "Tests/{테스트명}" --ui`

---

### 2. 테스트 완료 후 생성되는 파일 구조

```
Tests/{테스트명}/
├── {테스트명}_test_code.spec.ts   ← 테스트 코드
├── {테스트명}_test_result.md      ← 결과 리포트 (마크다운)
├── report/                        ← HTML 리포트
│   ├── index.html                 ← 메인 리포트
│   ├── data/                      ← 테스트 데이터
│   └── trace/                     ← 실행 트레이스
├── results/                       ← 테스트 실행 산출물
│   └── {테스트별 폴더}/
│       ├── test-failed-1.png      ← 실패 스크린샷
│       └── video.webm             ← 실패 비디오
└── screenshots/                   ← 수동 저장 스크린샷
```

---

### 3. 세션 재저장 요청 시 (세션 만료된 경우)

> 참고: QA 테스트 요청 시 세션이 없으면 자동으로 로그인을 안내합니다.
> 이 섹션은 세션이 만료되어 "다시 로그인해줘", "세션 다시 저장" 등을 요청할 때 사용됩니다.

사용자가 "세션 저장", "다시 로그인", "로그인 다시" 등 요청하면:

1. **URL 질문** - "Vercel URL을 입력해주세요"
2. **codegen 실행**:
   ```bash
   npx playwright codegen --save-storage=auth.json "{URL}"
   ```
3. **안내** - "브라우저가 열리면 로그인 후 Inspector 창을 닫아주세요."
4. **완료 후** - "로그인이 저장되었습니다."

---

### 4. 결과 리포트 형식 (마크다운)

```markdown
# 테스트 결과: {테스트명}

## 테스트 환경
- URL: {테스트 URL}
- 실행 시간: {시간}
- 브라우저: Chromium

## 요약
- 자동화 실행: N개
- 통과: N개 ✅
- 실패: N개 ❌
- 자동화 제외: N개 ⚠️

## 자동화 테스트 결과

| # | 테스트명 | 결과 | 비고 |
|---|----------|------|------|
| 1 | xxx | ✅ Pass | - |
| 2 | xxx | ❌ Fail | 에러 내용 |

## 자동화 제외 항목

| # | 테스트명 | 제외 사유 | 상세 설명 |
|---|----------|----------|----------|
| N | Google SSO 로그인 성공 | ❌ 외부 인증 | Google OAuth는 외부 서비스로, 보안 정책상 자동화된 로그인이 불가합니다. 수동으로 테스트해주세요. |
| N | 이메일 로그인 성공 | ⚠️ 실제 계정 필요 | 실제 계정 정보(이메일/비밀번호)가 필요하며, 보안상 테스트 코드에 포함하지 않습니다. 수동으로 테스트해주세요. |

> **참고**: 자동화 제외 항목은 수동으로 검증이 필요합니다.

## 실패 상세 (있는 경우)
- [테스트명]: 예상 vs 실제
- 스크린샷: results/{테스트폴더}/test-failed-1.png

## 발견 사항
- {테스트 중 발견한 이슈나 특이사항}

## 검증 방법
- HTML 리포트: 테스트 완료 후 자동 오픈
- UI 모드: "UI 모드로 추가 확인" 선택 시 Claude가 실행
```

---

### 5. 검증 방법

#### HTML 리포트 (기본)
```bash
open "Tests/{테스트명}/report/index.html"
```
- 테스트 완료 후 자동 실행
- 각 테스트의 통과/실패 상태, 소요 시간 확인

#### UI 모드 (추가 확인)
```bash
npx playwright test "Tests/{테스트명}" --ui
```
- 사용자가 "UI 모드로 추가 확인" 선택 시 Claude가 실행
- 해당 테스트만 로드하여 실시간 확인
- 각 단계별 스크린샷, DOM 상태, 타임라인 확인

---

## 프로젝트 폴더 구조

```
~/auto-QA/
├── Tests/                         ← 테스트 산출물 (테스트명별 폴더)
│   └── {테스트명}/
│       ├── {테스트명}_test_code.spec.ts
│       ├── {테스트명}_test_result.md
│       ├── report/                ← HTML 리포트
│       └── results/               ← 실행 산출물
├── auth.json                      ← 로그인 세션
├── playwright.config.ts           ← Playwright 설정
├── CLAUDE.md                      ← 이 파일 (시스템 지침)
└── QA-AUTOMATION-GUIDE.md         ← 사용자 가이드
```

---

## 주의사항

1. **운영계 영향 금지** - 저장/수정 동작 절대 금지 (명시적 요청 없으면)
2. **auth.json 보안** - 커밋하지 않음
3. **테스트 전 확인** - 항상 테스트 계획을 먼저 보여주고 승인 받기
