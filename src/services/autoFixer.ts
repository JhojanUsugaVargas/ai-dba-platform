import { Pool } from 'pg';
import * as mssql from 'mssql';

// Assume a generic config store or environment variables for connection strings
// In a real application, you would fetch these from a database or config file
const getServerConfig = (serverId: string) => {
  // Mock config retrieval
  // You would replace this with actual logic to retrieve server configuration
  if (serverId.includes('pg') || serverId.includes('postgres')) {
    return { type: 'postgres', url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres' };
  } else {
    return { type: 'mssql', config: {
      user: process.env.MSSQL_USER || 'sa',
      password: process.env.MSSQL_PASSWORD || 'Password123',
      server: process.env.MSSQL_SERVER || 'localhost',
      database: process.env.MSSQL_DB || 'master',
      options: { encrypt: true, trustServerCertificate: true }
    }};
  }
};

export const executeAutoFix = async (serverId: string, sqlScript: string): Promise<{ success: boolean; message: string }> => {
  try {
    const config = getServerConfig(serverId);

    if (config.type === 'postgres') {
      const pool = new Pool({ connectionString: config.url });
      await pool.query(sqlScript);
      await pool.end();
      return { success: true, message: 'Script executed successfully on PostgreSQL.' };
    } else if (config.type === 'mssql') {
      await mssql.connect(config.config as any);
      await mssql.query(sqlScript);
      await mssql.close();
      return { success: true, message: 'Script executed successfully on MSSQL.' };
    } else {
      return { success: false, message: 'Unsupported server type.' };
    }
  } catch (error: any) {
    return { success: false, message: `Error executing script: ${error.message}` };
  }
};
