import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface TestDataRecord {
  id: string;
  type: string;
  name: string;
  createdAt: string;
  metadata: Record<string, any>;
}

export interface DataManagerConfig {
  storageFile: string;
  autoCleanup: boolean;
}

/**
 * 테스트 데이터 관리자 - 테스트 전 데이터 생성, 테스트 후 정리
 */
export class TestDataManager {
  private page: Page;
  private config: DataManagerConfig;
  private records: TestDataRecord[] = [];

  constructor(page: Page, config?: Partial<DataManagerConfig>) {
    this.page = page;
    this.config = {
      storageFile: './test-data-records.json',
      autoCleanup: true,
      ...config
    };
    this.loadRecords();
  }

  /**
   * 저장된 레코드 로드
   */
  private loadRecords() {
    try {
      if (fs.existsSync(this.config.storageFile)) {
        const data = fs.readFileSync(this.config.storageFile, 'utf-8');
        this.records = JSON.parse(data);
      }
    } catch {
      this.records = [];
    }
  }

  /**
   * 레코드 저장
   */
  private saveRecords() {
    fs.writeFileSync(this.config.storageFile, JSON.stringify(this.records, null, 2));
  }

  /**
   * 데이터 레코드 등록
   */
  registerData(record: Omit<TestDataRecord, 'createdAt'>): TestDataRecord {
    const fullRecord: TestDataRecord = {
      ...record,
      createdAt: new Date().toISOString()
    };
    this.records.push(fullRecord);
    this.saveRecords();
    console.log(`[DataManager] 등록됨: ${record.type} - ${record.name}`);
    return fullRecord;
  }

  /**
   * 특정 타입의 데이터 조회
   */
  getDataByType(type: string): TestDataRecord[] {
    return this.records.filter(r => r.type === type);
  }

  /**
   * 특정 데이터 존재 여부 확인
   */
  hasData(type: string, name?: string): boolean {
    return this.records.some(r =>
      r.type === type && (name ? r.name === name : true)
    );
  }

  /**
   * 데이터 레코드 제거
   */
  removeData(id: string) {
    this.records = this.records.filter(r => r.id !== id);
    this.saveRecords();
    console.log(`[DataManager] 제거됨: ${id}`);
  }

  /**
   * 특정 타입의 모든 데이터 제거
   */
  removeAllByType(type: string) {
    const count = this.records.filter(r => r.type === type).length;
    this.records = this.records.filter(r => r.type !== type);
    this.saveRecords();
    console.log(`[DataManager] ${type} 타입 ${count}개 제거됨`);
  }

  /**
   * 모든 레코드 초기화
   */
  clearAll() {
    this.records = [];
    this.saveRecords();
    console.log('[DataManager] 모든 레코드 초기화됨');
  }

  /**
   * 테스트 시작 전 데이터 확인 및 조건부 스킵
   */
  async ensureTestData(
    type: string,
    createFn: () => Promise<TestDataRecord | null>
  ): Promise<TestDataRecord | null> {
    const existing = this.getDataByType(type);

    if (existing.length > 0) {
      console.log(`[DataManager] 기존 ${type} 데이터 사용: ${existing[0].name}`);
      return existing[0];
    }

    console.log(`[DataManager] ${type} 데이터 없음, 생성 시도...`);
    const newData = await createFn();

    if (newData) {
      this.registerData(newData);
      return newData;
    }

    console.log(`[DataManager] ${type} 데이터 생성 실패`);
    return null;
  }

  /**
   * 트래킹 링크 생성 헬퍼
   */
  async createTrackingLink(options: {
    appName: string;
    linkName: string;
    channel?: string;
  }): Promise<TestDataRecord | null> {
    try {
      const { appName, linkName, channel = 'Custom' } = options;

      // 트래킹 링크 생성 페이지로 이동
      await this.page.getByText('트래킹 링크', { exact: true }).click();
      await this.page.waitForTimeout(500);
      await this.page.getByText('트래킹 링크 생성').click();
      await this.page.waitForTimeout(2000);

      // 링크 이름 입력
      const nameInput = this.page.locator('input[placeholder*="링크"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill(linkName);
      }

      // 채널 선택 (Custom)
      const channelSelect = this.page.getByText(channel, { exact: true });
      if (await channelSelect.isVisible()) {
        await channelSelect.click();
      }

      // 생성 버튼 클릭
      await this.page.getByRole('button', { name: /생성|만들기|create/i }).click();
      await this.page.waitForTimeout(3000);

      return {
        id: `tracking-${Date.now()}`,
        type: 'tracking-link',
        name: linkName,
        metadata: { appName, channel },
        createdAt: new Date().toISOString()
      };

    } catch (error) {
      console.log('[DataManager] 트래킹 링크 생성 실패:', error);
      return null;
    }
  }

  /**
   * 테스트 종료 시 정리
   */
  async cleanup(types?: string[]) {
    if (!this.config.autoCleanup) return;

    const toClean = types
      ? this.records.filter(r => types.includes(r.type))
      : this.records;

    console.log(`[DataManager] 정리 대상: ${toClean.length}개`);

    for (const record of toClean) {
      // 실제 삭제 로직은 타입별로 구현 필요
      this.removeData(record.id);
    }
  }

  /**
   * 현재 등록된 모든 데이터 출력
   */
  printStatus() {
    console.log('\n=== Test Data Status ===');
    if (this.records.length === 0) {
      console.log('(등록된 데이터 없음)');
    } else {
      const grouped = this.records.reduce((acc, r) => {
        acc[r.type] = acc[r.type] || [];
        acc[r.type].push(r);
        return acc;
      }, {} as Record<string, TestDataRecord[]>);

      for (const [type, records] of Object.entries(grouped)) {
        console.log(`\n[${type}] (${records.length}개)`);
        records.forEach(r => console.log(`  - ${r.name} (${r.id})`));
      }
    }
    console.log('========================\n');
  }
}
