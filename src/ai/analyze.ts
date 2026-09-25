import { Anthropic } from '@anthropic-ai/sdk';

/**
 * Call Anthropic Claude model to generate analysis/recommendations based on
 * collected performance metrics and optional data‑quality report.
 */
export async function analyzeReport(payload: any): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key') {
    console.warn('ANTHROPIC_API_KEY not set. Returning mock AI analysis.');
    return "💡 Recomendaciones de IA (Mock):\n\n1. PostgreSQL tiene algunas consultas lentas (promedio 0.85s). Sugerimos revisar los índices en las tablas más utilizadas.\n2. MSSQL muestra un uso de CPU de 68.5%, lo cual es normal pero debe ser monitoreado durante picos de carga.\n3. Asegúrate de verificar los 12 campos nulos encontrados en tu último reporte de DataCheck.\n4. Escala tus instancias si las sesiones activas superan los límites configurados en los poolers.";
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `You are an AI DBA assistant. Based on the following information, provide concise, actionable recommendations for database performance and data quality improvements. Return the answer in plain text (no markdown).

  Metrics:
  ${JSON.stringify(payload.metrics, null, 2)}

  Data-Quality Report:
  ${JSON.stringify(payload.dataCheck, null, 2)}
  `;

    // Note: Completions API requires Human/Assistant format
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    });
    return (response.content[0] as any).text || 'No response';
  } catch (err) {
    console.error('AI Analysis error (fallback to mock):', err);
    return "⚠️ El análisis de IA falló (posible error de API KEY). Por favor revisa la consola.";
  }
}
