import { DataCheckService } from '../datacheck/datacheck.service';

describe('DataCheckService', () => {
  it('should return empty issues for valid unique data', async () => {
    const data = [
      { id: 1, name: 'Alice', score: 90 },
      { id: 2, name: 'Bob', score: 85 },
    ];
    const result = await DataCheckService.runCheck(data);
    expect(result.total).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(Object.keys(result.missingFields)).toHaveLength(0);
    expect(result.numericStats.id).toBeDefined();
    expect(result.numericStats.score.avg).toBe(87.5);
  });

  it('should detect duplicates', async () => {
    const data = [
      { id: 1, val: 10 },
      { id: 1, val: 10 },
      { id: 2, val: 20 },
    ];
    const result = await DataCheckService.runCheck(data);
    expect(result.duplicates).toBe(1);
    expect(result.issues).toContain('1 duplicate record(s) found');
  });

  it('should detect missing fields', async () => {
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2 },
    ];
    const result = await DataCheckService.runCheck(data);
    expect(result.missingFields.name).toBe(1);
  });

  it('should handle empty dataset', async () => {
    const result = await DataCheckService.runCheck([]);
    expect(result.total).toBe(0);
    expect(result.duplicates).toBe(0);
  });

  it('should compute numeric stats correctly', async () => {
    const data = [
      { value: 10 },
      { value: 20 },
      { value: 30 },
    ];
    const result = await DataCheckService.runCheck(data);
    expect(result.numericStats.value.min).toBe(10);
    expect(result.numericStats.value.max).toBe(30);
    expect(result.numericStats.value.avg).toBe(20);
  });
});
