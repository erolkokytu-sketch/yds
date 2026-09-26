export interface ValidationError {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ValidationError[] };

export function validateExamPack(examPack: unknown): ValidationResult;
export function validateExamSession(session: unknown): ValidationResult;
