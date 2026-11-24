import type { Design } from '../sgm';

export interface ParseError {
  line: number;
  message: string;
  severity?: 'error' | 'warning';
}

export interface ParseResult {
  design: Design;
  errors: ParseError[];
}

export type Dialect = 'mermaid' | 'eraser';
