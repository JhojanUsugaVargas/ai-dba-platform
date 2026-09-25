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
