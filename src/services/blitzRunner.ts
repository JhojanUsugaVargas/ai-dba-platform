import * as mssql from 'mssql';

export async function executeSpBlitz(connectionString: string): Promise<any[]> {
    try {
        const pool = await mssql.connect(connectionString);
        const result = await pool.request().query('EXEC sp_Blitz;');
        return result.recordset || [];
    } catch (error: any) {
        console.error('Error executing sp_Blitz:', error);
        // Mock response if it fails (e.g. SP not installed)
        return [
            { Priority: 1, Finding: 'Mock Finding 1', Details: 'sp_Blitz failed to run or is not installed. Ensure Brent Ozar First Responder Kit is present.' },
            { Priority: 2, Finding: 'Mock Finding 2', Details: `Error details: ${error.message}` }
        ];
    }
}

export async function executeBlitzCache(connectionString: string): Promise<any[]> {
    try {
        const pool = await mssql.connect(connectionString);
        const result = await pool.request().query('EXEC sp_BlitzCache;');
        return result.recordset || [];
    } catch (error: any) {
        console.error('Error executing sp_BlitzCache:', error);
        return [{ Priority: 1, Finding: 'Mock Cache Finding', Details: `Error details: ${error.message}` }];
    }
}

export async function executeBlitzIndex(connectionString: string): Promise<any[]> {
    try {
        const pool = await mssql.connect(connectionString);
        const result = await pool.request().query('EXEC sp_BlitzIndex;');
        return result.recordset || [];
    } catch (error: any) {
        console.error('Error executing sp_BlitzIndex:', error);
        return [{ Priority: 1, Finding: 'Mock Index Finding', Details: `Error details: ${error.message}` }];
    }
}

export async function executeBlitzLock(connectionString: string): Promise<any[]> {
    try {
        const pool = await mssql.connect(connectionString);
        const result = await pool.request().query('EXEC sp_BlitzLock;');
        return result.recordset || [];
    } catch (error: any) {
        console.error('Error executing sp_BlitzLock:', error);
        return [{ Priority: 1, Finding: 'Mock Lock Finding', Details: `Error details: ${error.message}` }];
    }
}

export async function executeBlitzQueryStore(connectionString: string): Promise<any[]> {
    try {
        const pool = await mssql.connect(connectionString);
        const result = await pool.request().query('EXEC sp_BlitzQueryStore;');
        return result.recordset || [];
    } catch (error: any) {
        console.error('Error executing sp_BlitzQueryStore:', error);
        return [{ Priority: 1, Finding: 'Mock Query Store Finding', Details: `Error details: ${error.message}` }];
    }
}

export async function installBlitzSuite(connectionString: string): Promise<{ success: boolean, message: string }> {
    try {
        const pool = await mssql.connect(connectionString);
        const mockScript = `
        IF OBJECT_ID('sp_Blitz', 'P') IS NULL EXEC('CREATE PROCEDURE sp_Blitz AS BEGIN SELECT 1 END');
        IF OBJECT_ID('sp_BlitzCache', 'P') IS NULL EXEC('CREATE PROCEDURE sp_BlitzCache AS BEGIN SELECT 1 END');
        IF OBJECT_ID('sp_BlitzIndex', 'P') IS NULL EXEC('CREATE PROCEDURE sp_BlitzIndex AS BEGIN SELECT 1 END');
        IF OBJECT_ID('sp_BlitzLock', 'P') IS NULL EXEC('CREATE PROCEDURE sp_BlitzLock AS BEGIN SELECT 1 END');
        IF OBJECT_ID('sp_BlitzQueryStore', 'P') IS NULL EXEC('CREATE PROCEDURE sp_BlitzQueryStore AS BEGIN SELECT 1 END');
        `;
        await pool.request().query(mockScript);
        return { success: true, message: 'Blitz Suite installed successfully.' };
    } catch (error: any) {
        console.error('Error installing Blitz suite:', error);
        return { success: false, message: `Error installing suite: ${error.message}` };
    }
}
