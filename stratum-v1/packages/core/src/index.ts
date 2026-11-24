export * from './sgm';
export * from './dsl/types';
export { parseMermaid, emitMermaid } from './dsl/mermaid';
export { parseEraser, emitEraser } from './dsl/eraser';
export * from './sim/analytical';
export * from './critique/types';
export { runCritique, buildContext } from './critique/orchestrator';
export { applyPatch } from './critique/patch';
export { autoLayout, preservePositions } from './layout';
export { TEMPLATES, loadTemplate } from './templates';
export { generateFromPrompt } from './generate';
export { buildCritiquePrompt, parseLlmFindings } from './llm';

import { parseMermaid, emitMermaid } from './dsl/mermaid';
import { parseEraser, emitEraser } from './dsl/eraser';
import type { Dialect, ParseResult } from './dsl/types';
import type { Design } from './sgm';

export function parse(code: string, dialect: Dialect): ParseResult {
  return dialect === 'mermaid' ? parseMermaid(code) : parseEraser(code);
}

export function emit(design: Design, dialect: Dialect): string {
  return dialect === 'mermaid' ? emitMermaid(design) : emitEraser(design);
}
