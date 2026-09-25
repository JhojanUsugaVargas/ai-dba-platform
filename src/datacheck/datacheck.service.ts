/**
 * DataCheck service – placeholder for data validation / quality checks.
 * In the full implementation, this would import the logic from the
 * `DataCheck-web` project (e.g., schema validation, duplicate detection,
 * statistical profiling). For now it provides a simple stub that returns
 * a static report.
 */
export class DataCheckService {
  /**
   * Perform a basic data quality check on an array of objects.
   * Returns total records, duplicate count, missing field counts, and simple numeric stats.
   */
  static async runCheck(data: any[], regexRules?: Record<string, string>): Promise<{
    total: number;
    duplicates: number;
    missingFields: Record<string, number>;
    numericStats: Record<string, { min: number; max: number; avg: number }>; 
    regexIssues?: Record<string, number>;
    issues: string[];
  }> {
    const total = data.length;
    const issues: string[] = [];

    // Detect duplicate records (deep equality via JSON stringification)
    const seen = new Set<string>();
    let duplicateCount = 0;
    for (const row of data) {
      const key = JSON.stringify(row);
      if (seen.has(key)) duplicateCount++;
      else seen.add(key);
    }
    if (duplicateCount > 0) issues.push(`${duplicateCount} duplicate record(s) found`);

    // Missing field analysis
    const missingFields: Record<string, number> = {};
    const allKeys = new Set<string>();
    data.forEach((row) => Object.keys(row).forEach((k) => allKeys.add(k)));
    for (const key of allKeys) {
      let missing = 0;
      for (const row of data) {
        if (row[key] === undefined || row[key] === null) missing++;
      }
      if (missing > 0) missingFields[key] = missing;
    }
    if (Object.keys(missingFields).length > 0) {
      const msgs = Object.entries(missingFields)
        .map(([k, v]) => `${v} record(s) missing "${k}"`)
        .join(', ');
      issues.push(`Missing fields: ${msgs}`);
    }

    // Regex rule validation
    const regexIssues: Record<string, number> = {};
    if (regexRules) {
      for (const [key, pattern] of Object.entries(regexRules)) {
        try {
          const regex = new RegExp(pattern);
          let invalidCount = 0;
          for (const row of data) {
            if (row[key] !== undefined && row[key] !== null) {
              if (!regex.test(String(row[key]))) {
                invalidCount++;
              }
            }
          }
          if (invalidCount > 0) regexIssues[key] = invalidCount;
        } catch (e) {
          issues.push(`Invalid regex pattern for "${key}"`);
        }
      }
      
      if (Object.keys(regexIssues).length > 0) {
        const msgs = Object.entries(regexIssues)
          .map(([k, v]) => `${v} record(s) failed regex for "${k}"`)
          .join(', ');
        issues.push(`Regex validation failures: ${msgs}`);
      }
    }

    // Simple numeric stats (min, max, average) for numeric columns
    const numericStats: Record<string, { min: number; max: number; avg: number }> = {};
    for (const key of allKeys) {
      const values = data.map((r) => r[key]).filter((v) => typeof v === 'number');
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = sum / values.length;
        numericStats[key] = { min, max, avg };
      }
    }
    if (Object.keys(numericStats).length > 0) {
      issues.push('Numeric statistics computed for numeric fields');
    }

    return { total, duplicates: duplicateCount, missingFields, numericStats, regexIssues, issues };
  }
}
