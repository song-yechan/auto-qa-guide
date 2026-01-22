import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface FlowStep {
  order: number;
  action: 'click' | 'fill' | 'navigate' | 'wait' | 'assert' | 'custom';
  target?: string;
  selector?: string;
  value?: string;
  description: string;
  screenshot?: string;
  timestamp: string;
}

export interface FlowRecord {
  name: string;
  description: string;
  startUrl: string;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 플로우 기록기 - UI 플로우를 자동으로 기록하고 문서화
 */
export class FlowRecorder {
  private page: Page;
  private outputDir: string;
  private currentFlow: FlowRecord | null = null;
  private stepCount: number = 0;

  constructor(page: Page, outputDir: string = './flow-records') {
    this.page = page;
    this.outputDir = outputDir;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * 새 플로우 기록 시작
   */
  startFlow(name: string, description: string = '') {
    this.currentFlow = {
      name,
      description,
      startUrl: this.page.url(),
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.stepCount = 0;
    console.log(`[FlowRecorder] 기록 시작: ${name}`);
  }

  /**
   * 스텝 추가
   */
  async addStep(step: Omit<FlowStep, 'order' | 'timestamp' | 'screenshot'>, captureScreenshot: boolean = true): Promise<FlowStep> {
    if (!this.currentFlow) {
      throw new Error('플로우가 시작되지 않았습니다. startFlow()를 먼저 호출하세요.');
    }

    this.stepCount++;
    let screenshotPath: string | undefined;

    if (captureScreenshot) {
      const screenshotDir = path.join(this.outputDir, 'screenshots', this.currentFlow.name);
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      screenshotPath = path.join(screenshotDir, `step-${this.stepCount}.png`);
      await this.page.screenshot({ path: screenshotPath });
    }

    const fullStep: FlowStep = {
      ...step,
      order: this.stepCount,
      timestamp: new Date().toISOString(),
      screenshot: screenshotPath
    };

    this.currentFlow.steps.push(fullStep);
    this.currentFlow.updatedAt = new Date().toISOString();

    console.log(`[FlowRecorder] Step ${this.stepCount}: ${step.description}`);
    return fullStep;
  }

  /**
   * 클릭 액션 기록
   */
  async recordClick(selector: string, description: string) {
    await this.addStep({
      action: 'click',
      selector,
      description
    });
  }

  /**
   * 입력 액션 기록
   */
  async recordFill(selector: string, value: string, description: string) {
    await this.addStep({
      action: 'fill',
      selector,
      value,
      description
    });
  }

  /**
   * 네비게이션 기록
   */
  async recordNavigate(url: string, description: string) {
    await this.addStep({
      action: 'navigate',
      target: url,
      description
    });
  }

  /**
   * 대기 기록
   */
  async recordWait(description: string) {
    await this.addStep({
      action: 'wait',
      description
    });
  }

  /**
   * 검증 기록
   */
  async recordAssert(selector: string, description: string) {
    await this.addStep({
      action: 'assert',
      selector,
      description
    });
  }

  /**
   * 플로우 기록 종료 및 저장
   */
  endFlow(): FlowRecord | null {
    if (!this.currentFlow) {
      console.log('[FlowRecorder] 기록 중인 플로우가 없습니다.');
      return null;
    }

    const flow = this.currentFlow;
    this.saveFlow(flow);
    this.currentFlow = null;

    console.log(`[FlowRecorder] 기록 완료: ${flow.name} (${flow.steps.length} 스텝)`);
    return flow;
  }

  /**
   * 플로우를 파일로 저장
   */
  private saveFlow(flow: FlowRecord) {
    const flowDir = path.join(this.outputDir, 'flows');
    if (!fs.existsSync(flowDir)) {
      fs.mkdirSync(flowDir, { recursive: true });
    }

    // JSON 저장
    const jsonPath = path.join(flowDir, `${flow.name}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(flow, null, 2));

    // Markdown 문서 생성
    const mdPath = path.join(flowDir, `${flow.name}.md`);
    const markdown = this.generateMarkdown(flow);
    fs.writeFileSync(mdPath, markdown);

    console.log(`[FlowRecorder] 저장됨: ${jsonPath}`);
    console.log(`[FlowRecorder] 문서: ${mdPath}`);
  }

  /**
   * Playwright 테스트 코드 생성
   */
  generateTestCode(flow: FlowRecord): string {
    const lines: string[] = [
      `import { test, expect } from '@playwright/test';`,
      ``,
      `// 플로우: ${flow.name}`,
      `// ${flow.description}`,
      `// 생성일: ${flow.createdAt}`,
      ``,
      `test('${flow.name}', async ({ page }) => {`,
    ];

    for (const step of flow.steps) {
      lines.push(`  // Step ${step.order}: ${step.description}`);

      switch (step.action) {
        case 'navigate':
          lines.push(`  await page.goto('${step.target}');`);
          break;
        case 'click':
          lines.push(`  await page.locator('${step.selector}').click();`);
          break;
        case 'fill':
          lines.push(`  await page.locator('${step.selector}').fill('${step.value}');`);
          break;
        case 'wait':
          lines.push(`  await page.waitForTimeout(1000);`);
          break;
        case 'assert':
          lines.push(`  await expect(page.locator('${step.selector}')).toBeVisible();`);
          break;
      }
      lines.push('');
    }

    lines.push(`});`);
    return lines.join('\n');
  }

  /**
   * Markdown 문서 생성
   */
  private generateMarkdown(flow: FlowRecord): string {
    const lines: string[] = [
      `# ${flow.name}`,
      ``,
      flow.description ? `> ${flow.description}` : '',
      ``,
      `- **시작 URL**: ${flow.startUrl}`,
      `- **총 스텝**: ${flow.steps.length}개`,
      `- **생성일**: ${flow.createdAt}`,
      ``,
      `## 플로우 단계`,
      ``
    ];

    for (const step of flow.steps) {
      lines.push(`### Step ${step.order}: ${step.description}`);
      lines.push(``);
      lines.push(`- **액션**: ${step.action}`);
      if (step.selector) lines.push(`- **셀렉터**: \`${step.selector}\``);
      if (step.value) lines.push(`- **값**: ${step.value}`);
      if (step.target) lines.push(`- **대상**: ${step.target}`);
      if (step.screenshot) {
        const relativePath = path.relative(path.dirname(path.join(this.outputDir, 'flows', `${flow.name}.md`)), step.screenshot);
        lines.push(`- **스크린샷**: ![Step ${step.order}](${relativePath})`);
      }
      lines.push(``);
    }

    return lines.join('\n');
  }

  /**
   * 저장된 플로우 로드
   */
  loadFlow(name: string): FlowRecord | null {
    const jsonPath = path.join(this.outputDir, 'flows', `${name}.json`);
    try {
      const data = fs.readFileSync(jsonPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * 저장된 모든 플로우 목록
   */
  listFlows(): string[] {
    const flowDir = path.join(this.outputDir, 'flows');
    if (!fs.existsSync(flowDir)) return [];

    return fs.readdirSync(flowDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}
