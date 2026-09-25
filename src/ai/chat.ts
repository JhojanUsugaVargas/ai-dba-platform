import { GoogleGenerativeAI } from '@google/generative-ai';

export async function askSqlAssistant(question: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key') {
    return "💡 [Mock] Recomendación de Gemini: Parece que estás preguntando sobre un error SQL. Sugiero revisar la sintaxis cerca del INNER JOIN o validar que las columnas existan.";
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Eres un experto DBA. Responde esta pregunta o error SQL en español de forma concisa y clara:\n\n${question}`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error("Gemini Error:", err);
    return "❌ Error interno al contactar al asistente AI.";
  }
}
