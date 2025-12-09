// Unsound Language Server - using self-hosted $analyze semantics

import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  Hover,
  Definition,
  Location,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { tryParse } from '../parser.ts';
import { compile } from '../compiler.ts';
import { $eval } from '../runtime.ts';

// Types for analysis results (matches SourceRange from ast.ts)
interface AnalysisLoc {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
}

interface AnalysisDefinition {
  name: string;
  loc: AnalysisLoc;
  kind: string;
}

interface AnalysisReference {
  name: string;
  loc: AnalysisLoc;
  definition: AnalysisDefinition | null;
}

interface AnalysisDiagnostic {
  message: string;
  loc: AnalysisLoc;
  severity: string;
}

interface AnalysisResult {
  definitions: AnalysisDefinition[];
  references: AnalysisReference[];
  diagnostics: AnalysisDiagnostic[];
}

// Load $analyze semantics
let $analyze: any = null;

async function loadAnalyzer() {
  try {
    connection.console.log('Loading $analyze semantics...');
    // @ts-ignore - dynamic import of compiled .us file
    const $analyzeModule = await import('../semantics/analyze.us.js');
    $analyze = await $analyzeModule.default($eval);
    connection.console.log('$analyze loaded successfully');
  } catch (e: any) {
    connection.console.log(`Failed to load $analyze: ${e.message || e}`);
  }
}

// Create connection
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache for analysis results
const documentCache = new Map<string, AnalysisResult | null>();

connection.onInitialize(async (_params: InitializeParams): Promise<InitializeResult> => {
  await loadAnalyzer();
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['.'],
      },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
});

// Run analysis using $analyze semantics
async function runAnalysis(source: string): Promise<AnalysisResult | null> {
  if (!$analyze) {
    connection.console.log('runAnalysis: $analyze not loaded');
    return null;
  }

  try {
    // Compile the source
    const compiled = compile(source);
    connection.console.log('runAnalysis: compiled successfully');

    // Reset analyzer state
    $analyze.reset();

    // Run compiled code with $analyze
    // Provide a fake import.meta since we're using new Function()
    const code = compiled.replace('export default async ($) =>', '');
    const fn = new Function('$', 'import_meta', `return (async () => {
      const import_meta_url = import_meta.url;
      ${code.replace(/import\.meta\.url/g, 'import_meta_url')}
    })()`);

    await fn($analyze, { url: 'file:///fake/module.js' });

    // Get results
    const results = $analyze.getResults();
    connection.console.log(`runAnalysis: got ${results.definitions.length} definitions, ${results.references.length} references`);
    for (const def of results.definitions) {
      connection.console.log(`  def: ${def.name} at ${JSON.stringify(def.loc)}`);
    }
    for (const ref of results.references) {
      connection.console.log(`  ref: ${ref.name} at ${JSON.stringify(ref.loc)} -> ${ref.definition?.name || 'null'}`);
    }
    return results;
  } catch (e: any) {
    connection.console.log(`runAnalysis error: ${e.message || e}`);
    return null;
  }
}

// Validate document and send diagnostics
async function validateDocument(textDocument: TextDocument): Promise<void> {
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  const parseResult = tryParse(text);

  if (!parseResult.success) {
    // Parse error
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: parseResult.error.loc.start.line - 1, character: parseResult.error.loc.start.column - 1 },
        end: { line: parseResult.error.loc.end.line - 1, character: parseResult.error.loc.end.column - 1 },
      },
      message: parseResult.error.shortMessage,
      source: 'unsound',
    });
    documentCache.set(textDocument.uri, null);
  } else {
    // Parse succeeded - run $analyze
    const analysis = await runAnalysis(text);
    documentCache.set(textDocument.uri, analysis);

    if (analysis) {
      // Add analysis diagnostics
      for (const diag of analysis.diagnostics) {
        diagnostics.push({
          severity: diag.severity === 'error' ? DiagnosticSeverity.Error
            : diag.severity === 'warning' ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Information,
          range: {
            start: { line: diag.loc.start.line - 1, character: diag.loc.start.column - 1 },
            end: { line: diag.loc.end.line - 1, character: diag.loc.end.column - 1 },
          },
          message: diag.message,
          source: 'unsound',
        });
      }
    }
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// Document change handler
documents.onDidChangeContent(change => {
  validateDocument(change.document);
});

// Completion
connection.onCompletion((params): CompletionItem[] => {
  const analysis = documentCache.get(params.textDocument.uri);
  if (!analysis) return [];

  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  for (const def of analysis.definitions) {
    if (!seen.has(def.name)) {
      seen.add(def.name);
      items.push({
        label: def.name,
        kind: CompletionItemKind.Variable,
      });
    }
  }

  // Add keywords
  const keywords = ['let', 'if', 'then', 'else', 'return', 'true', 'false', 'null', 'undefined', 'this', 'do', 'import', 'from'];
  for (const kw of keywords) {
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
    });
  }

  return items;
});

// Check if position is within a location
function isInRange(loc: AnalysisLoc, line: number, col: number): boolean {
  if (line < loc.start.line || line > loc.end.line) return false;
  if (line === loc.start.line && col < loc.start.column) return false;
  if (line === loc.end.line && col > loc.end.column) return false;
  return true;
}

// Find definition at position
function findDefinitionAt(analysis: AnalysisResult, line: number, col: number): AnalysisDefinition | null {
  // Check references first
  for (const ref of analysis.references) {
    if (isInRange(ref.loc, line, col)) {
      return ref.definition;
    }
  }
  // Check definitions
  for (const def of analysis.definitions) {
    if (isInRange(def.loc, line, col)) {
      return def;
    }
  }
  return null;
}

// Hover
connection.onHover((params): Hover | null => {
  const analysis = documentCache.get(params.textDocument.uri);
  if (!analysis) return null;

  const line = params.position.line + 1;
  const col = params.position.character + 1;

  const def = findDefinitionAt(analysis, line, col);
  if (def) {
    return {
      contents: {
        kind: 'markdown',
        value: `**${def.name}** (${def.kind})`,
      },
    };
  }

  return null;
});

// Go to definition
connection.onDefinition((params): Definition | null => {
  const analysis = documentCache.get(params.textDocument.uri);
  if (!analysis) return null;

  const line = params.position.line + 1;
  const col = params.position.character + 1;

  const def = findDefinitionAt(analysis, line, col);
  if (def?.loc) {
    return Location.create(params.textDocument.uri, {
      start: { line: def.loc.start.line - 1, character: def.loc.start.column - 1 },
      end: { line: def.loc.end.line - 1, character: def.loc.end.column - 1 },
    });
  }

  return null;
});

// Start listening
documents.listen(connection);
connection.listen();
