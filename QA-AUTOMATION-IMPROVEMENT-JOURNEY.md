# QA 자동화 시스템 개선 여정

## 문서 개요

이 문서는 Claude Code와 Playwright를 활용한 QA 자동화 시스템을 구축하고 개선해온 전체 과정을 기록합니다. 기술적인 발견사항, 시행착오, 그리고 각 문제에 대한 해결책을 상세히 다룹니다.

**작성 목적**: 향후 유사한 시스템 구축 시 참고 자료로 활용하고, 발생했던 문제들의 재발을 방지하기 위함

**대상 독자**: QA 자동화 시스템을 운영하거나 구축하려는 팀원

---

## 1. 프로젝트 배경 및 목표

### 1.1 초기 상황

- **환경**: AB180 CS팀에서 Vercel Preview 환경에 배포된 웹 애플리케이션 QA 필요
- **문제점**:
  - 수동 테스트에 많은 시간 소요
  - 테스트 재현성 부족
  - 비개발자 팀원이 테스트 코드를 작성하기 어려움

### 1.2 목표

1. **단순화된 진입점**: "QA 테스트 요청" 한 마디로 전체 플로우 시작
2. **자동 환경 설정**: 패키지, 브라우저, 세션을 자동으로 확인하고 설치
3. **앱 환경 분리**: 특정 앱 내에서만 테스트가 진행되도록 격리
4. **사용자 친화적**: 비개발자도 쉽게 사용 가능한 프로세스

---

## 2. 개선 여정 타임라인

### Phase 1: 초기 가이드 구축

**문제**: 사용자가 매번 명령어를 기억해야 함

**해결**:
- `CLAUDE.md`에 QA 테스트 요청 시 자동 처리 프로세스 정의
- 단계별 Phase 구분 (Phase 1~6)
- `QA-AUTOMATION-GUIDE.md`에 사용자 가이드 작성

**교훈**: 단일 진입점("QA 테스트 요청")이 사용자 경험의 핵심

---

### Phase 2: 환경 자동 점검 시스템

**사용자 피드백**:
> "이런 케이스가 없도록 네가 CLAUDE.md에 환경 파악하고 진행하게끔 해줄 순 없어?"

**문제**: 사용자가 패키지 설치 여부, 브라우저 설치 여부를 매번 확인해야 함

**해결**:
```bash
# Phase 0: 환경 자동 점검 로직 추가

# 1. node_modules 존재 확인
ls node_modules/@playwright 2>/dev/null || echo "NEED_INSTALL"

# 2. Playwright 설치 확인
npx playwright --version 2>/dev/null || echo "NEED_INSTALL"

# 3. Chromium 브라우저 확인
npx playwright install --dry-run chromium 2>&1 | grep -q "already installed" || echo "NEED_BROWSER"
```

**자동 조치 매핑**:
| 문제 | 자동 조치 | 사용자 안내 |
|------|----------|------------|
| node_modules 없음 | `npm install` 실행 | "환경을 준비하고 있습니다..." |
| Playwright 없음 | `npm install @playwright/test` 실행 | (위와 동일) |
| Chromium 없음 | `npx playwright install chromium` 실행 | "브라우저를 설치하고 있습니다..." |

**교훈**: 기술적인 질문은 사용자에게 하지 않고, 시스템이 자동으로 해결

---

### Phase 3: 세션 관리 개선

**사용자 피드백**:
> "세션 저장하라는 말을 기억하기 어려우니까. 차라리 QA 진행 등의 유사 언어를 입력했을 때 세션 저장 여부에 대한 걸 판단하고..."

**문제**: 사용자가 세션 저장 명령어를 별도로 기억해야 함

**해결**:
- "QA 테스트 요청" 시 `auth.json` 존재 여부 자동 확인
- 없으면 로그인 프로세스 자동 시작
- 로그인 완료 후 원래 QA 플로우 계속 진행

**변경된 플로우**:
```
"QA 테스트 요청"
    ↓
Phase 0: 환경 점검
    ↓
세션(auth.json) 있음? ─Yes→ Phase 1: 정보 수집
    ↓ No
로그인 먼저 진행
    ↓
로그인 완료
    ↓
Phase 1: 정보 수집 (계속)
```

---

### Phase 4: Google 패스키 문제 해결

**문제**: Google 로그인 시 패스키 팝업이 나타나 자동화 불가

**시행착오**:
1. 패스키를 자동으로 처리하려 했으나 보안 정책상 불가능
2. 기존 Chrome 프로필을 Playwright에서 사용하려 했으나 실패

**사용자 피드백**:
> "아니 동시 사용이 아니라 프로필 내에서 탭 하나 여는 방식으로 하는 건 불가능해? 실제 업무하면서 크롬을 다 끄는게 불가능해"

**기술적 한계**:
```
Chrome 프로필 공유 시도 → 실패
이유: Playwright는 기존 Chrome 세션에 연결 불가
     (--remote-debugging-port 설정 복잡, 세션 충돌 발생)
```

**최종 해결**:
> 사용자 의견: "그래 그럼 2번으로 하자 그냥"

- Chromium + auth.json 방식 유지
- 패스키 우회 가이드 문서화:
  ```
  [Google 로그인 시 참고]
  - "패스키" 팝업이 뜨면 → "다른 방법 시도" 클릭
  - "비밀번호" 선택하여 로그인
  ```

**교훈**:
- 기술적 한계가 있을 때는 우회 방법을 문서화하는 것이 효율적
- 사용자에게 선택지를 제시하고 결정을 맡기는 것이 좋음

---

### Phase 5: 앱 접근 검증 시스템

**사용자 피드백**:
> "앱을 설정할 수 있도록 하는 프로세스를 vercel 받고 나서 물어보는 프로세스를 추가해줘"
> "만약 앱 목록에서 특정 앱에 접근할 때 앱이 없으면 앱이 없다고 노티를 줘야하고, 있는 경우에 앱 접근까지 완료하고 창을 띄운 뒤에 이 앱 맞는지 확인 요청하고..."

**문제**:
1. 테스트가 잘못된 앱에서 실행될 수 있음
2. 사용자가 앱에 접근했는지 시각적으로 확인할 수 없음

**시행착오 1 - 앱 이름 입력**:
```
사용자: "앱 이름이 아닌 대시보드 표기 이름을 기입해달라고 변경해줘"
```
- 내부 앱 ID가 아닌 **대시보드에 표시되는 이름**을 사용해야 함

**시행착오 2 - 앱 검증 셀렉터**:
```typescript
// 시도 1: 링크로 확인
await page.getByRole('link', { name: APP_NAME }).click();

// 문제: 앱에 진입했는지 확인 불가

// 최종 해결: 앱 진입 후 앱 버튼으로 확인
await expect(page.getByRole('button', { name: `${APP_NAME} ${APP_NAME}` }))
  .toBeVisible({ timeout: 10000 });
```

**사용자 피드백 반영**:
> "bookscribe인지 아닌지는 어떻게 확인하려고 하는거야?"
> → codegen으로 확인
> "getByRole('button', { name: 'bookscribe bookscribe' })"

**Phase 3.5 추가**:
```
Phase 3: 계획 승인
    ↓
Phase 3.5: 앱 접근 확인 [headed 모드]
├── 앱 진입 테스트 실행 (브라우저 창 표시)
├── 사용자가 화면 확인
├── AskUserQuestion: "이 앱이 맞나요?"
│   ├── 네 → Inspector 닫기 안내
│   └── 아니요 → 앱 이름 재입력
└── Inspector 창 닫으면 다음 단계
    ↓
Phase 4: 본 테스트 [headless 모드]
```

**교훈**:
- headed/headless 모드를 분리하여 "확인"과 "실행"을 구분
- 시각적 확인이 필요한 단계는 반드시 브라우저를 표시

---

### Phase 6: 트래킹 링크 삭제 테스트 구현

**문제**: 복잡한 UI 플로우 (중첩 메뉴, 모달, 확인 입력)를 자동화해야 함

#### 6.1 셀렉터 찾기 문제

**사용자 피드백**:
> "이런 작업을 네가 할 수 없어? 이러면 자동화 하는 이유가 아무것도 없는데"

**시행착오**:
```typescript
// 시도 1: 일반적인 셀렉터 추측
await page.getByRole('button', { name: '삭제' }).click();
// 결과: 삭제 버튼을 찾지 못함

// 시도 2: aria-label 추측
await page.locator('[aria-label*="삭제"]').click();
// 결과: 실패

// 사용자가 codegen으로 확인한 정확한 셀렉터:
// "getByRole('button', { name: 'delete 트래킹 링크 삭제' })"
```

**최종 해결**:
```typescript
// 정확한 셀렉터들 (codegen으로 확인)
await page.locator('button').filter({ hasText: 'keyboard_arrow_right' }).first().click();
await page.getByRole('button', { name: /edit.*수정/ }).click();
await page.getByRole('button', { name: /delete.*삭제/ }).click();
```

**교훈**:
- 셀렉터를 **추측하지 말고 codegen을 먼저 사용**
- Material Icon이 텍스트로 포함될 수 있음 (예: 'delete 트래킹 링크 삭제')

---

#### 6.2 입력 필드 검증 문제

**문제**: 확인 문구를 입력해도 삭제 버튼이 활성화되지 않음

**시행착오**:
```typescript
// 시도 1: fill() 사용
await input.fill('bookscribe');
// 결과: 버튼이 여전히 비활성화

// 시도 2: 더 정확한 텍스트 입력
const exactText = 'bookscribe';
await input.fill(exactText);
// 결과: 여전히 비활성화
```

**원인 발견**:
- `fill()`은 값을 직접 설정하므로 **input/change 이벤트가 발생하지 않음**
- React/Vue 등 프레임워크는 이벤트 기반으로 유효성 검사 수행

**해결**:
```typescript
// type()을 사용하여 실제 타이핑 시뮬레이션
await input.type(confirmText.trim(), { delay: 50 });

// blur 이벤트 발생을 위해 다른 요소 클릭
await modal.locator('text=확인 문구').click();
```

**최종 코드**:
```typescript
// 13. 확인 입력란에 추출한 텍스트 입력 (타이핑 + blur 이벤트)
const confirmInput = modal.locator('input[type="text"], input:not([type])').first();
await confirmInput.click();
await confirmInput.clear();
await confirmInput.type(confirmText.trim(), { delay: 50 });  // ← type() 사용
// blur 이벤트 발생을 위해 다른 곳 클릭
await modal.locator('text=확인 문구').click();  // ← blur 트리거
await page.waitForTimeout(1000);

// 14. 삭제 버튼이 활성화될 때까지 대기
const deleteButton = modal.getByRole('button', { name: /삭제/ }).last();
await expect(deleteButton).toBeEnabled({ timeout: 10000 });
```

**핵심 교훈**:
| 메서드 | 이벤트 발생 | 사용 시점 |
|--------|------------|----------|
| `fill()` | 최소한 | 단순 입력, 이벤트 불필요 시 |
| `type()` | input, keydown, keyup | 유효성 검사가 있는 입력 필드 |

---

#### 6.3 동적 확인 텍스트 추출

**문제**: 삭제 모달의 확인 문구가 앱마다 다름

**시행착오**:
```typescript
// 시도 1: 앱 이름 하드코딩
await input.type('bookscribe');
// 문제: 다른 앱에서는 동작하지 않음

// 시도 2: 앱 이름 변수 사용
await input.type(APP_NAME);
// 문제: 모달에 표시된 텍스트와 다를 수 있음
```

**해결**:
```typescript
// 모달 내 링크 태그에서 동적으로 텍스트 추출
const linkInModal = modal.locator('a, strong, b').first();
if (await linkInModal.isVisible().catch(() => false)) {
  confirmText = await linkInModal.textContent() || '';
}

// 못 찾으면 앱 이름 사용 (fallback)
if (!confirmText) {
  confirmText = APP_NAME;
}
```

**교훈**: UI에 표시된 텍스트를 동적으로 추출하면 다양한 환경에서 재사용 가능

---

#### 6.4 2단계 확인 모달 처리

**문제**: AB180 확인 모달 후 추가 확인 모달이 나타남

**시행착오**:
```typescript
// 시도: AB180 모달만 처리
await deleteButton.click();
// 결과: "트래킹 링크를 삭제하겠습니까?" 모달이 나타남 → 처리 안 됨
```

**해결**:
```typescript
// 15. 첫 번째 삭제 버튼 클릭 (AB180 확인 모달)
await deleteButton.click();
await page.waitForTimeout(1000);

// 16. 두 번째 확인 모달 처리 ("트래킹 링크를 삭제하겠습니까?")
await expect(page.getByText('트래킹 링크를 삭제하겠습니까?')).toBeVisible({ timeout: 5000 });
await page.getByRole('button', { name: '삭제' }).last().click();
```

**교훈**: 실제 UI 플로우를 완전히 파악해야 함 (숨겨진 확인 단계가 있을 수 있음)

---

### Phase 7: 오케스트레이션 시스템 구축

**사용자 피드백**:
> "오케스트레이션 활용해서 구축해봐"

**문제**: 여러 가지 반복적인 작업들을 체계화할 필요

**해결**: lib/ 폴더에 모듈화된 헬퍼 시스템 구축

#### 7.1 시스템 아키텍처

```
lib/
├── index.ts              # 통합 export
├── explorer/
│   └── dom-explorer.ts   # DOM 탐색 및 셀렉터 제안
├── modal/
│   └── modal-handler.ts  # 모달 자동 감지/처리
├── data/
│   └── test-data-manager.ts  # 테스트 데이터 CRUD
├── flow/
│   └── flow-recorder.ts  # 플로우 기록 및 문서화
└── utils/
    └── test-helpers.ts   # 통합 헬퍼 클래스
```

#### 7.2 각 모듈의 역할

**DOMExplorer** - 셀렉터 탐색 자동화:
```typescript
// 페이지의 클릭 가능한 요소들을 자동 탐색
const explorer = new DOMExplorer(page);
const clickables = await explorer.exploreClickables();

// 각 요소에 대해 가능한 셀렉터 제안
// [data-test-id], getByRole(), getByText(), #id 등
```

**ModalHandler** - 모달 자동 처리:
```typescript
const modalHandler = new ModalHandler(page);

// 알려진 모달 패턴 자동 등록
// - trial-ended (무료 체험 종료)
// - ask-airbridge (Ask Airbridge 팝업)
// - ab180-confirm (AB180 확인 모달)

// 자동 감지 및 처리
await modalHandler.handleAllModals();
```

**TestDataManager** - 테스트 데이터 관리:
```typescript
const dataManager = new TestDataManager(page);

// 테스트 전 데이터 확인/생성
const trackingLink = await dataManager.ensureTestData(
  'tracking-link',
  async () => await dataManager.createTrackingLink({
    appName: 'bookscribe',
    linkName: '테스트용 링크'
  })
);
```

**FlowRecorder** - 플로우 기록:
```typescript
const recorder = new FlowRecorder(page);

recorder.startFlow('트래킹 링크 삭제', '삭제 플로우 테스트');
await recorder.recordClick('button.delete', '삭제 버튼 클릭');
const flow = recorder.endFlow();
// → JSON + Markdown 문서 자동 생성
```

**TestHelper** - 통합 헬퍼:
```typescript
const helper = new TestHelper(page, {
  name: 'bookscribe',
  baseUrl: '/app'
});

// 앱 접근
await helper.accessApp();

// 메뉴 이동 (모달 자동 처리 포함)
await helper.navigateToMenu(['트래킹 링크', '트래킹 링크 관리']);

// 안전한 클릭 (모달 처리 + 재시도)
await helper.safeClick('button.delete');

// 안전한 입력 (type + blur)
await helper.safeFill('input.confirm', 'bookscribe');
```

---

### Phase 8: QA 테스트 요청 템플릿

**사용자 피드백**:
> "이 방식을 그대로 사용해서 테스트를 한다고 했을 때 적합한 테스트 형태로 요청사항을 뽑아낼 수 있는 프롬프트를 구체적으로 구성해서 알려줘"

**결과**: QA 테스트 요청 템플릿 (별첨 A)

```markdown
## QA 테스트 요청서

### 기본 정보
- **테스트명**: [예: 트래킹 링크 CRUD 테스트]
- **앱 환경**: [대시보드 표기 이름, 예: bookscribe]
- **Vercel URL**: [제공된 URL]

### 테스트 케이스

#### TC-001: [케이스명]
- **페이지**: [시작 페이지]
- **사전조건**: [필요한 데이터나 상태]
- **동작**:
  1. [1단계 액션]
  2. [2단계 액션]
- **기대결과**: [예상되는 결과]

#### TC-002: [케이스명]
...
```

---

## 3. 주요 기술적 발견사항

### 3.1 Playwright 관련

| 발견 | 상세 | 적용 |
|------|------|------|
| `fill()` vs `type()` | fill()은 이벤트 미발생 | 유효성 검사 있으면 type() 사용 |
| Storage State | 로그인 세션만 저장, 앱 위치 X | beforeEach에서 앱 진입 필수 |
| Escape 키 | 대부분 모달이 닫힘 | 모달 처리 기본 전략 |
| codegen | 셀렉터 탐색에 가장 효율적 | 추측하지 말고 codegen 먼저 |
| headed vs headless | 사용자 확인 vs 빠른 실행 | Phase별 분리 |

### 3.2 셀렉터 우선순위

```
1. data-test-id (가장 안정적)
2. getByRole() + name (접근성 기반)
3. getByText() exact: true (텍스트 기반)
4. CSS selector (마지막 수단)
```

### 3.3 Material Icon 셀렉터 패턴

Material Icon이 포함된 버튼의 셀렉터:
```typescript
// 아이콘 이름이 텍스트에 포함됨
page.getByRole('button', { name: 'delete 트래킹 링크 삭제' })
page.getByRole('button', { name: 'edit 상세보기*수정' })
page.locator('button').filter({ hasText: 'keyboard_arrow_right' })
```

### 3.4 이벤트 트리거 패턴

```typescript
// 입력 후 검증 트리거
await input.type(value, { delay: 50 });  // 타이핑 이벤트
await otherElement.click();              // blur 이벤트
await page.keyboard.press('Tab');        // 또 다른 blur 방법
```

---

## 4. 시스템 한계 및 보완 계획

### 4.1 현재 한계

| 한계 | 상세 | 영향도 | 보완 방향 |
|------|------|--------|----------|
| Chrome 프로필 미지원 | Playwright는 기존 Chrome 세션 사용 불가 | 중 | Chromium + auth.json 유지 |
| 패스키 자동화 불가 | Google 패스키는 수동 처리 필요 | 저 | 비밀번호 로그인 가이드 |
| 동적 셀렉터 | 페이지 구조 변경 시 셀렉터 깨짐 | 고 | Page Object Model 도입 예정 |
| 셀렉터 자동 탐색 | AI가 직접 셀렉터를 찾는 데 한계 | 고 | DOMExplorer 개선 |

### 4.2 향후 개선 로드맵

#### 단기 (1-2주)
- [ ] Page Object Model 도입하여 셀렉터 중앙 관리
- [ ] 에러 재시도 로직 고도화 (원인별 대응)
- [ ] 테스트 결과 Slack 알림 연동

#### 중기 (1개월)
- [ ] 사이트맵 기반 네비게이션 자동화
- [ ] 셀렉터 자동 힐링 (변경 감지 시 자동 수정 제안)
- [ ] 테스트 커버리지 리포트 자동 생성

#### 장기 (3개월)
- [ ] Visual Regression 테스트 추가
- [ ] 성능 테스트 (Lighthouse 연동)
- [ ] 크로스 브라우저 테스트 확장

---

## 5. 사이트맵 활용 가능성 분석

**사용자 질문**:
> "만약 사이트맵이 제공되면 조금 더 개선이 될 수 있는지 궁금해"

### 5.1 사이트맵 활용 시 개선 가능 영역

| 영역 | 현재 | 사이트맵 활용 시 |
|------|------|-----------------|
| 메뉴 네비게이션 | 텍스트 클릭 체인 | URL 직접 이동 가능 |
| 경로 검증 | 수동 확인 | 자동 경로 유효성 검사 |
| 테스트 커버리지 | 수동 계획 | 전체 페이지 커버리지 계산 |
| 페이지 탐색 | codegen 필요 | 구조 기반 자동 탐색 |

### 5.2 Vercel Preview와의 불일치 문제

**사용자 질문**:
> "vercel에서 업데이트 사항이 있으면 내가 근본적으로 제공하는 사이트맵이랑 100% 동일하지 않을 수 있는데"

**해결 방안**:
1. **런타임 검증**: 사이트맵의 각 경로를 실제로 요청하여 유효성 확인
2. **차이점 리포트**: 예상 vs 실제 경로 차이를 리포트로 생성
3. **Fallback 전략**: 경로 불일치 시 텍스트 기반 네비게이션으로 전환

```typescript
// 사이트맵 경로 검증 예시
async function validateSitemapPath(path: string): Promise<boolean> {
  const response = await page.request.head(path);
  if (response.ok()) {
    return true;
  }
  console.warn(`[Sitemap] 경로 불일치: ${path}`);
  return false;
}
```

---

## 6. 핵심 교훈 요약

### 6.1 사용자 경험 측면

1. **단일 진입점**: 복잡한 명령어보다 "QA 테스트 요청" 하나가 효과적
2. **자동 환경 설정**: 기술적 질문은 시스템이 해결
3. **시각적 확인**: 중요한 단계는 반드시 브라우저 표시 (headed 모드)
4. **명확한 다음 단계 안내**: 사용자가 다음에 무엇을 해야 할지 항상 안내

### 6.2 기술적 측면

1. **codegen 먼저**: 셀렉터를 추측하지 말 것
2. **이벤트 고려**: `fill()` vs `type()` 차이 이해
3. **blur 트리거**: 입력 후 다른 요소 클릭으로 검증 트리거
4. **2단계 확인**: 모달이 연속으로 나타날 수 있음

### 6.3 프로세스 측면

1. **사용자 피드백 반영**: 빠른 반복 개선
2. **문서화**: 시행착오를 기록하여 재발 방지
3. **모듈화**: 반복 작업을 헬퍼로 추출

---

## 7. 참조

### 7.1 관련 파일

| 파일 | 용도 |
|------|------|
| `/auto-QA/CLAUDE.md` | Claude Code 지침서 |
| `/auto-QA/QA-AUTOMATION-GUIDE.md` | 사용자 가이드 |
| `/auto-QA/QA-AUTOMATION-SYSTEM-DOCUMENTATION.md` | 시스템 문서 |
| `/auto-QA/lib/` | 오케스트레이션 모듈 |
| `/auto-QA/Tests/트래킹 테스트/삭제테스트.spec.ts` | 삭제 테스트 코드 |

### 7.2 GitHub 저장소

- **URL**: https://github.com/song-yechan/auto-qa-guide
- **포함 파일**: CLAUDE.md, QA-AUTOMATION-GUIDE.md

---

## 8. 버전 히스토리

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 1.0 | 2026-01-21 | 초기 시스템 구축 |
| 1.1 | 2026-01-21 | 환경 자동 점검 추가 |
| 1.2 | 2026-01-21 | 세션 관리 개선 |
| 1.3 | 2026-01-21 | 앱 접근 검증 시스템 |
| 1.4 | 2026-01-21 | Phase 3.5 (headed 확인) 추가 |
| 1.5 | 2026-01-21 | 트래킹 링크 삭제 테스트 완성 |
| 1.6 | 2026-01-22 | 오케스트레이션 시스템 구축 |
| 1.7 | 2026-01-22 | QA 테스트 요청 템플릿 추가 |
| 1.8 | 2026-01-22 | 개선 여정 문서화 |
| 1.9 | 2026-01-22 | 웹 구조 문서 활용 시스템 추가 |
| 2.0 | 2026-01-22 | 트래킹 링크 생성 테스트 시도 및 근본적 한계 분석 |

---

## 9. 트래킹 링크 생성 테스트 시도 (2026-01-22)

### 9.1 테스트 목표

커스텀 채널을 사용하여 트래킹 링크를 생성하는 테스트 케이스 구현

### 9.2 발생한 문제들

#### 문제 1: 세션 만료
```
codegen으로 재로그인 필요
→ 해결: Google 비밀번호 로그인으로 auth.json 갱신
```

#### 문제 2: `expect().or()` 문법 오류
```typescript
// 잘못된 코드
await expect(page.getByText('A').or(page.getByText('B'))).toBeVisible();

// 올바른 코드
const element = page.getByText('A').or(page.getByText('B'));
await expect(element).toBeVisible();
```

**교훈**: `or()`는 locator 메서드이며, expect 체인에서는 사용 불가

#### 문제 3: 채널 입력 필드 셀렉터 찾기 실패

웹 구조 문서가 있었지만 정확한 셀렉터를 찾지 못함:
```typescript
// 시도 1: 웹 구조 문서 기반 추론
await page.getByRole('textbox').first().fill('테스트채널');
// 실패: strict mode violation - 9개 요소 매칭

// 시도 2: 더 구체적인 셀렉터
await page.locator('input[placeholder*="채널"]').fill('테스트채널');
// 실패: 요소를 찾지 못함

// 실제 셀렉터 (codegen으로 확인)
await page.getByRole('textbox', {
  name: '트래킹 링크를 사용할 채널을 선택하거나 새 이름을 입력해 주세요'
}).fill('테스트채널');
```

**교훈**: placeholder가 아닌 aria-label 기반 name 속성 사용

#### 문제 4: 버튼 비활성화 상태 유지

입력 후에도 "링크 생성" 버튼이 disabled 상태로 유지됨:

```typescript
// 시도 1: fill() 사용
await channelInput.fill('테스트_채널_' + Date.now());
// 실패: 버튼이 활성화되지 않음

// 시도 2: type() + delay 사용
await channelInput.type('테스트_채널_' + Date.now(), { delay: 30 });
await page.keyboard.press('Tab');  // blur 이벤트 트리거
// 실패: 여전히 버튼이 활성화되지 않음
```

**원인 분석 (미해결)**:
- 단순 채널 이름 입력만으로는 버튼이 활성화되지 않을 수 있음
- 추가 필수 필드가 있을 가능성 (딥링크 설정, 웹 URL 등)
- 폼 유효성 검사 조건이 웹 구조 문서에 명시되지 않음

### 9.3 근본적 한계 발견

사용자 피드백:
> "원래 이렇게 내가 UI를 일일히 보여주지 않아도 네가 인지해서 작업을 진행하는 방식으로 하기로 한 거 아니었어?"

**핵심 문제: AI의 시각적 접근 불가**

현재 시스템에서 AI가 할 수 있는 것:
- 웹 구조 문서 읽기 (정적 정보)
- 테스트 실행 후 에러 메시지 확인
- codegen으로 사용자 행동 기록

AI가 할 수 없는 것:
- **브라우저 화면을 직접 보기**
- **실시간 폼 유효성 검증 규칙 파악**
- **동적 UI 상태 확인 (드롭다운 옵션, 조건부 렌더링)**
- **어떤 필드가 필수인지, 버튼 활성화 조건이 무엇인지 파악**

**웹 구조 문서의 한계**:

| 웹 구조 문서가 제공하는 것 | 웹 구조 문서가 제공하지 못하는 것 |
|------------------------|------------------------------|
| 라우트 패턴 | 폼 유효성 검증 규칙 |
| 메뉴 구조 | 버튼 활성화 조건 |
| 일반적인 UI 패턴 | 필수 필드 정보 |
| data-testid 패턴 | 동적 UI 상태 |

### 9.4 개선 방향 제안

#### 방안 1: 스크린샷 기반 피드백 루프

```
테스트 단계 실행 → 스크린샷 캡처 → AI 이미지 분석 → 다음 행동 결정
```

AI는 이미지 분석이 가능하므로, 각 단계마다 스크린샷을 찍으면 실제 UI 상태 파악 가능

#### 방안 2: 웹 구조 문서 보강

현재 문서에 추가해야 할 정보:
- 각 폼의 필수 필드 목록
- 버튼 활성화 조건
- 폼 유효성 검증 규칙

#### 방안 3: 탐색 모드 테스트

1단계: headed 모드로 실행하면서 스크린샷 캡처
2단계: 캡처된 정보를 바탕으로 테스트 정교화

### 9.5 현재 테스트 상태

```
Tests/트래킹 링크 생성/
├── 앱접근테스트.spec.ts      ← 통과
└── 트래킹 링크 생성_test_code.spec.ts  ← 실패 (버튼 활성화 안됨)
```

**다음 단계**:
- 스크린샷 기반 접근 방식 구현
- 웹 구조 문서에 폼 유효성 검증 규칙 추가
- 또는 codegen으로 전체 플로우 먼저 기록 후 테스트 작성

---

*문서 작성일: 2026-01-22*
*작성: Claude Opus 4.5*
