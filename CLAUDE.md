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
3. 안내 (아래 내용 전달):
   ```
   브라우저가 열리면 로그인해주세요.

   [Google 로그인 시 참고]
   - "패스키" 팝업이 뜨면 → "다른 방법 시도" 클릭
   - "비밀번호" 선택하여 로그인

   로그인 완료 후 Inspector 창을 닫아주세요.
   ```
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
     - `네, 앱 설정 필요` → 대시보드 표기 이름 추가 질문
   - "네" 선택 시: "어떤 앱에서 테스트하나요? (반드시 **대시보드에 표기된 앱 이름**을 입력해주세요. 앱 목록에서 해당 이름으로 찾아 진입합니다.)"
   - 입력받은 앱 이름은 테스트 코드 beforeEach에 반영
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
> **목적**: 본 테스트 실행 전에 올바른 앱에 접근하는지 사용자가 직접 확인

8. **앱 접근 테스트 작성 및 실행** (`--headed` 모드):
   ```bash
   npx playwright test "Tests/{테스트명}/앱접근테스트.spec.ts" --headed
   ```

   ```typescript
   // Tests/{테스트명}/앱접근테스트.spec.ts
   const APP_NAME = '{대시보드표기이름}';

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
   ```

9. **결과에 따른 처리**:
   - **앱이 없는 경우** (테스트 실패):
     - 사용자에게 알림: "'{앱이름}' 앱을 앱 목록에서 찾을 수 없습니다."
     - 대시보드 표기 이름 다시 요청 → 8번부터 재시도

   - **앱이 있는 경우** (브라우저 창 열린 상태):
     - AskUserQuestion으로 확인:
       - 질문: "현재 화면이 '{앱이름}' 앱이 맞나요?"
       - 선택지:
         - `네, 맞습니다` → 안내: "확인되었습니다. **Inspector 창을 닫아주세요.** 창을 닫으면 본 테스트가 진행됩니다."
         - `아니요, 다른 앱입니다` → 대시보드 표기 이름 다시 요청 → 8번부터 재시도

10. **사용자가 창을 닫으면** → Phase 4 (본 테스트) 진행

#### Phase 4: 실행 (Headless 모드)
> **중요**: 본 테스트는 headless 모드(브라우저 창 없이)로 실행됨

11. **페이지 구조 파악** - codegen으로 실제 selector 확인 (필요시)
    ```bash
    npx playwright codegen "{URL}" --load-storage=auth.json --timeout=30000
    ```
12. **테스트 코드 작성** - `Tests/{테스트명}/{테스트명}_test_code.spec.ts`
    - 앱 환경 설정한 경우: beforeEach에 앱 진입 로직 포함
    - 에러 확인은 정확한 텍스트 대신 **에러 컴포넌트 존재 여부**로 체크
      ```typescript
      // 좋은 예: 에러 컴포넌트 존재 여부 확인
      const errorMessage = page.locator('[role="alert"], [class*="error"]');
      await expect(errorMessage.first()).toBeVisible();

      // 피해야 할 예: 정확한 텍스트 매칭
      await expect(page.getByText('정확한 에러 메시지')).toBeVisible();
      ```
13. **테스트 실행** (headless 모드 - 브라우저 창 표시 안 함):
    ```bash
    npx playwright test "Tests/{테스트명}" --reporter=html
    ```
    - `--headed` 옵션 **없이** 실행 → 백그라운드에서 빠르게 테스트 진행

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
3. **안내** - 아래 내용을 사용자에게 전달:
   ```
   브라우저가 열리면 로그인해주세요.

   [Google 로그인 시 참고]
   - "패스키" 팝업이 뜨면 → "다른 방법 시도" 클릭
   - "비밀번호" 선택하여 로그인

   로그인 완료 후 Inspector 창을 닫아주세요.
   ```
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

## 웹 구조 문서 활용 (WEB-STRUCTURE.md)

> **모드: 보수적 (Mode 1)**
> - 자동 업데이트: OFF
> - 차이 리포트: ON (항상 생성)
> - 적용: 사용자가 리포트 확인 후 수동 반영

### 1. 웹 구조 문서란?

`WEB-STRUCTURE.md` 파일은 웹 애플리케이션의 구조를 문서화한 것으로, 다음 정보를 포함:
- 메뉴 계층 구조
- 페이지별 주요 요소 (버튼, 입력필드, 테이블)
- 모달/팝업 패턴
- 셀렉터 힌트

### 2. 문서 존재 여부 확인

QA 테스트 시작 전:
```bash
ls WEB-STRUCTURE.md 2>/dev/null || echo "NO_STRUCTURE_DOC"
```

| 상태 | 동작 |
|------|------|
| 문서 있음 | 문서 참조하여 테스트 작성 |
| 문서 없음 | 기존 방식대로 codegen 활용 |

### 3. 테스트 작성 시 문서 활용

**문서가 있는 경우 다음 순서로 셀렉터 탐색:**

1. **문서의 셀렉터 힌트 먼저 시도**
   ```typescript
   // WEB-STRUCTURE.md에 "삭제 버튼: getByRole('button', { name: /delete.*삭제/ })" 라고 되어 있으면
   await page.getByRole('button', { name: /delete.*삭제/ }).click();
   ```

2. **실패 시 문서의 대안 패턴 시도**
   ```typescript
   // 문서에 "버튼 공통 패턴: 아이콘명 + 텍스트" 라고 되어 있으면
   await page.locator('button').filter({ hasText: '삭제' }).click();
   ```

3. **모두 실패 시 codegen으로 실제 셀렉터 확인**

**메뉴 네비게이션:**
```typescript
// 문서에 "트래킹 링크 관리: 트래킹 링크 > 트래킹 링크 관리" 라고 되어 있으면
await page.getByText('트래킹 링크', { exact: true }).click();
await page.getByText('트래킹 링크 관리').click();
```

**모달 처리:**
```typescript
// 문서에 "AB180 확인 모달: 삭제 시 앱 이름 입력 필요" 라고 되어 있으면
// 미리 모달 처리 로직 준비
```

### 4. 문서 vs 실제 UI 차이 감지

테스트 실행 중 문서와 다른 점이 발견되면 **STRUCTURE-DIFF.md** 파일에 기록:

#### 감지 대상
| 유형 | 감지 방법 |
|------|----------|
| 셀렉터 불일치 | 문서의 셀렉터로 요소를 찾지 못함 |
| 새 요소 발견 | 문서에 없는 버튼/메뉴 발견 |
| 요소 사라짐 | 문서에 있는 요소가 실제로 없음 |
| 텍스트 변경 | 버튼 텍스트 등이 변경됨 |
| 플로우 변경 | 예상과 다른 단계/모달 등장 |

#### 차이 기록 형식
테스트 종료 후 차이가 있으면 다음 형식으로 기록:

```markdown
# 웹 구조 변경 감지 리포트

**생성일**: {날짜}
**테스트 환경**: {Vercel URL}
**기준 문서**: WEB-STRUCTURE.md

## 변경 요약
| 유형 | 건수 |
|------|------|
| 셀렉터 변경 | N건 |
| 새 요소 발견 | N건 |
| 요소 사라짐 | N건 |

## 상세 내역

### 셀렉터 변경
- **페이지**: {페이지명}
- **요소**: {요소명}
- **문서**: `{기존 셀렉터}`
- **실제**: `{동작한 셀렉터}`
- **권장 조치**: 문서 업데이트

### 새 요소 발견
- **페이지**: {페이지명}
- **요소**: {발견된 요소}
- **셀렉터**: `{탐색된 셀렉터}`
- **권장 조치**: 문서에 추가
```

### 5. 차이 리포트 처리 (수동)

**자동 업데이트 하지 않음**. 사용자가 리포트를 확인하고 판단:

1. **테스트 완료 후** STRUCTURE-DIFF.md 존재 여부 안내
2. **차이가 있으면** 사용자에게 알림:
   ```
   ⚠️ 웹 구조 문서와 실제 UI 간 차이가 발견되었습니다.

   - 셀렉터 변경: N건
   - 새 요소 발견: N건

   상세 내용은 STRUCTURE-DIFF.md를 확인해주세요.
   문서 업데이트가 필요하면 "구조 문서 업데이트해줘"라고 요청해주세요.
   ```

3. **사용자가 "구조 문서 업데이트해줘" 요청 시**:
   - STRUCTURE-DIFF.md 내용을 WEB-STRUCTURE.md에 반영
   - 업데이트 이력 기록
   - STRUCTURE-DIFF.md 삭제

### 6. 구조 문서 업데이트 시

사용자가 업데이트를 요청하면:

1. **변경 내역 확인** - STRUCTURE-DIFF.md 읽기
2. **적용 범위 질문** - AskUserQuestion으로 확인:
   - 질문: "다음 변경사항을 문서에 반영할까요?"
   - 선택지:
     - `모두 반영` → 전체 적용
     - `선택적 반영` → 항목별 확인
     - `반영 안 함` → 취소
3. **문서 수정** - WEB-STRUCTURE.md 업데이트
4. **이력 추가**:
   ```markdown
   ## 업데이트 이력
   | 날짜 | 변경 내용 | 출처 |
   |------|----------|------|
   | 2026-01-22 | 삭제 버튼 셀렉터 수정 | 테스트 실행 중 감지 |
   ```

### 7. 구조 문서 신규 생성 요청 시

사용자가 "웹 구조 문서 만들어줘" 요청하면:

1. **안내**:
   ```
   웹 구조 문서는 코드베이스를 분석해서 생성해야 합니다.

   Git에 연동된 Claude에게 다음 프롬프트로 요청해주세요:
   [프롬프트 내용 안내 또는 링크]

   생성된 WEB-STRUCTURE.md 파일을 이 폴더에 복사하면 활용할 수 있습니다.
   ```

2. **또는 현재 테스트 실행 결과 기반으로 초안 생성**:
   - 테스트 중 탐색한 셀렉터들을 모아서 기본 구조 문서 생성
   - 불완전하지만 시작점으로 활용 가능

---

## AutoPilot 시스템 (DOM 기반 자동화)

> 실시간 DOM 분석을 통해 Vercel 환경 변화에 자동 대응하는 시스템

### 1. AutoPilot이란?

정적 웹 구조 문서 대신 **실시간 DOM 분석**으로 페이지 상태를 파악하고 자동으로 다음 행동을 결정합니다.

```
기존: 웹 구조 문서 → 추론 → 실행 → 에러 → 수정
AutoPilot: DOM 분석 → 상태 파악 → 행동 결정 → 실행 → 반복
```

### 2. 언제 사용하나?

| 상황 | 권장 방식 |
|------|----------|
| 정적이고 안정적인 페이지 | 기존 방식 (웹 구조 문서 + codegen) |
| Vercel preview처럼 자주 바뀌는 환경 | **AutoPilot** |
| 버튼이 왜 비활성화인지 모를 때 | **AutoPilot** (상태 분석) |
| 복잡한 폼 (여러 필드, 조건부 활성화) | **AutoPilot** |

### 3. 사용 방법

#### 기본 사용

```typescript
import { AutoPilot } from '../../lib';

const pilot = new AutoPilot(page, {
  maxSteps: 15,
  verbose: true
});

const result = await pilot.execute({
  name: '트래킹 링크 생성',
  targetButton: '링크 생성',
  successIndicator: '/done/'
});
```

#### 상태 분석만 (디버깅)

```typescript
import { PageStateAnalyzer } from '../../lib';

const analyzer = new PageStateAnalyzer(page);
const state = await analyzer.analyze();

console.log('입력 필드:', state.inputs);
console.log('버튼:', state.buttons);
console.log('비어있는 필수 필드:', state.forms[0].emptyRequiredFields);
```

#### 버튼 비활성화 원인 분석

```typescript
const pilot = new AutoPilot(page);
const reasons = await pilot.analyzeButton('링크 생성');
// ["비어있는 필수 필드: 채널, 웹 URL"]
```

### 4. 모듈 구조

```
lib/analyzer/
├── page-state-analyzer.ts   # 페이지 상태 추출
├── action-decider.ts        # 행동 결정 로직
├── auto-pilot.ts            # 자동화 루프
└── index.ts
```

### 5. 기존 모듈과 통합

AutoPilot은 기존 오케스트레이션 모듈과 함께 사용할 수 있습니다:

```typescript
import {
  AutoPilot,          // DOM 기반 자동화
  TestHelper,         // 기존 헬퍼
  ModalHandler,       // 모달 처리
  DOMExplorer         // 셀렉터 탐색
} from '../../lib';
```

### 6. 주의사항

- AutoPilot은 **보조 도구**입니다. 완전 자동화를 보장하지 않습니다.
- 복잡한 조건부 로직은 여전히 수동 확인이 필요할 수 있습니다.
- 결과를 반드시 검증하세요.

---

## 주의사항

1. **운영계 영향 금지** - 저장/수정 동작 절대 금지 (명시적 요청 없으면)
2. **auth.json 보안** - 커밋하지 않음
3. **테스트 전 확인** - 항상 테스트 계획을 먼저 보여주고 승인 받기
4. **구조 문서 자동 수정 금지** - 차이 발견 시 리포트만 생성, 사용자 확인 후 수동 반영
