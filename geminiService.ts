import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import type { McqInput, McqOutput, EssayInput, EssayOutput } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const buildMcqPrompt = (input: McqInput, language: string, hasImage: boolean): string => {
    const imageInstruction = hasImage
        ? `\n- **Image Input**: The user has provided an image. The primary question is in the image. The 'question_text' field below may be empty or provide additional context. Your main task is to analyze the image.\n`
        : '';

    return `
دورك: محلّل حسابي لاختيار الإجابة الصحيحة في أسئلة اختيار من متعدد (MCQ).

١) القيود العامة:
- أجب بصيغة JSON "فقط" حسب المخطط المحدد أدناه، بدون أي نص إضافي أو شرح خارج بنية JSON.
- يجب أن تكون إجابتك بالكامل، بما في ذلك الشرح، باللغة التالية: ${language}.${imageInstruction}

٢) التطبيع الموحّد قبل التحليل:
- الأرقام العربية: ٠١٢٣٤٥٦٧٨٩ → 0123456789
- الفاصلة العشرية العربية (٫) → "."، وفاصل الآلاف (٬) يزال.
- الضرب: × ✕ ∗ · x (إذا وقعت بين رقمين) → "*"
- القسمة: ÷ ／ ⁄ ∕ → "/"
- الطرح: − – — ‐ → "-"
- الجذر: √a → sqrt(a)
- النسبة المئوية: n% → n/100
- حافظ على الأقواس، وادعم الأسس: ^
- أزل الفراغات غير اللازمة.

٣) التقييم والحساب:
- قيّم التعبير العددي بعد التطبيع. استخدم "numeric_tolerance" للمقارنة.

٤) مخطط الإخراج (ملزم):
{
  "answer_index": <int 0-based or -1 on failure>,
  "answer_text": "<string from options>",
  "normalized_expression": "<string after normalization>",
  "value": "<computed result as string>",
  "confidence": <float 0..1>,
  "explanation": "<شرح تفصيلي خطوة بخطوة لكيفية الوصول إلى الحل باللغة المطلوبة>",
  "fail_reason": "<string optional; present only if answer_index = -1>"
}

---
Current Task Input:
${JSON.stringify(input, null, 2)}
Current Task Output:
`;
};

const buildEssayPrompt = (input: EssayInput, language: string, hasImage: boolean): string => {
    const imageInstruction = hasImage
        ? `\n**IMPORTANT**: The user has provided an image. The primary question is in the image. The 'question_text' field below may be empty or provide additional context. Your main task is to analyze the image.\n`
        : '';
    
    return `
You are an expert AI assistant. Your task is to solve the following user question and provide a clear, step-by-step explanation.

**Constraints:**
1.  You MUST respond ONLY with a single JSON object. Do not include any text, markdown, or formatting outside of the JSON structure.
2.  Your entire response, including the answer and the explanation, MUST be in the following language: **${language}**.
${imageInstruction}
**Output Schema (Strict):**
{
  "answer": "<The final, complete answer to the user's question>",
  "explanation": "<A detailed, step-by-step explanation of the reasoning and calculations used to arrive at the answer>",
  "fail_reason": "<Optional string, only present if the question cannot be answered>"
}

---
**User Question:**
"${input.question_text}"

**JSON Output:**
`;
};


const parseGeminiResponse = <T>(textResponse: string): T | { fail_reason: string } => {
    try {
        const cleanedJsonString = textResponse.replace(/^```json\s*|```\s*$/g, '').trim();
        return JSON.parse(cleanedJsonString) as T;
    } catch (error) {
        console.error("Failed to parse JSON response:", textResponse);
        return { fail_reason: "AI returned a response in an invalid format." };
    }
};

export const solveMcq = async (input: McqInput, language: string, image?: { base64: string, mimeType: string }): Promise<McqOutput> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");

    try {
        const promptText = buildMcqPrompt(input, language, !!image);
        const contents = image 
            ? { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: promptText }] }
            : promptText;

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
        });

        const result = parseGeminiResponse<McqOutput>(response.text);
        if ('fail_reason' in result && !('answer_index' in result)) {
             return {
                answer_index: -1, answer_text: "", normalized_expression: "", value: "", confidence: 0, explanation: "",
                ...result
            };
        }
        return result as McqOutput;
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        const fail_reason = error instanceof Error ? error.message : "An unknown error occurred.";
        return { answer_index: -1, answer_text: "", normalized_expression: "", value: "", confidence: 0, explanation: "", fail_reason };
    }
};

export const solveEssay = async (input: EssayInput, language: string, image?: { base64: string, mimeType: string }): Promise<EssayOutput> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");

    try {
        const promptText = buildEssayPrompt(input, language, !!image);
        const contents = image 
            ? { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: promptText }] }
            : promptText;
        
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
        });

        const result = parseGeminiResponse<EssayOutput>(response.text);
         if ('fail_reason' in result && !('answer' in result)) {
             return { answer: "", explanation: "", ...result };
        }
        return result as EssayOutput;

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        const fail_reason = error instanceof Error ? error.message : "An unknown error occurred.";
        return { answer: "", explanation: "", fail_reason };
    }
};