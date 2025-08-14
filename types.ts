
export interface McqInput {
  question_text: string;
  options: string[];
  numeric_tolerance: number;
}

export interface McqOutput {
  answer_index: number;
  answer_text: string;
  normalized_expression: string;
  value: string;
  confidence: number;
  explanation: string;
  fail_reason?: string;
}

export interface EssayInput {
    question_text: string;
}

export interface EssayOutput {
    answer: string;
    explanation: string;
    fail_reason?: string;
}
