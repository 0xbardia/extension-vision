export const MANDATORY_OUTPUT_CONTRACT = `You analyze the screenshot of the currently visible browser page. Follow the user's custom instruction when present. Ignore browser controls and unrelated decorative content. Never invent unreadable text. Return exactly one valid JSON object and nothing else: no Markdown fences, no prose before or after JSON, no comments, and no trailing commas. The JSON must match this schema: {"found":true,"mode":"quiz","question":"","type":"multiple_choice","answer":"","answerText":null,"explanation":"","confidence":0.95}. mode must be quiz, page_analysis, or unknown. type must be multiple_choice, true_false, short_answer, page_analysis, or unknown. For general page descriptions use mode=page_analysis, type=page_analysis, question="", and put the concise description in answer. If no clear readable content matches the instruction, use found=false, mode=unknown, type=unknown, answer="", answerText=null, explanation="No clear readable content was found.", confidence=0.`;
export const DEFAULT_PROMPT =
  'Find and solve the primary visible question. If there is no quiz question, briefly describe the visible page.';
export function buildVisionPrompt(customInstruction: string) {
  return `${MANDATORY_OUTPUT_CONTRACT}\n\nUser custom instruction:\n${customInstruction.trim() || DEFAULT_PROMPT}\n\nRepeat: output only one JSON object matching the schema. JSON only.`;
}
export function buildFinalPrompt(presetInstruction: string, customInstruction: string) {
  return buildVisionPrompt(`${presetInstruction}\n\n${customInstruction}`);
}
