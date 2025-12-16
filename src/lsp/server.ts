// Unsound Language Server - using extension system with //usc directive support
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
  SemanticTokensBuilder,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createLanguage,
  getSearchPaths,
  loadExtension,
  parseUscDirective,
} from "../extension.ts";
import { type Span } from "../ast.ts";
import type {
  AnalysisResult,
  Definition as AnalysisDef
} from "../analyze.ts";
import { Language } from "../types.ts";
import { posToLineCol } from "../util.ts";
import { dirname } from "path";

// Create connection
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache languages by their configuration (noCore + extensions list)
const languageCache = new Map<string, Language>();

// Cache analysis results per document
const documentCache = new Map<
  string,
  { analysis: AnalysisResult | null; source: string }
>();

// Semantic tokens legend
const tokenTypes = [
  "keyword",
  "variable",
  "parameter",
  "function",
  "number",
  "string",
  "operator",
  "property",
  "type",
];
const tokenModifiers = ["declaration", "definition", "readonly"];

// Get or create a language for the given source's //usc directive
async function getLanguageForSource(uri: string, source: string): Promise<Language> {
  const fileScheme = "file://";
  const filename = uri.startsWith(fileScheme) ? uri.slice(fileScheme.length) : uri;
  const directory = filename ? dirname(filename) : ".";
  const directive = parseUscDirective(source);

  // Cache based on loaded extensions *and* directory, in case the search path means
  // that e.g. "foo" is a different extension for different files.
  const cacheKey = `${directory}:${directive.extensions.join(",")}`;

  // Check the cache and built the language if we don't find a composed language.
  if (!languageCache.has(cacheKey)) {
    connection.console.log(`Creating language for: ${cacheKey}`);
    const language = await createLanguage(directive.extensions, getSearchPaths(filename));
    languageCache.set(cacheKey, language);
  }

  return languageCache.get(cacheKey)!;
}

// Convert a Span to LSP range
function spanToRange(
  source: string,
  span: Span
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  const start = posToLineCol(source, span.start);
  const end = posToLineCol(source, span.end);
  return {
    start: { line: start.line - 1, character: start.col - 1 },
    end: { line: end.line - 1, character: end.col - 1 },
  };
}

// Convert a position (byte offset) to LSP position
function posToLspPosition(
  source: string,
  pos: number
): { line: number; character: number } {
  const { line, col } = posToLineCol(source, pos);
  return { line: line - 1, character: col - 1 };
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ["."],
      },
      hoverProvider: true,
      definitionProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes,
          tokenModifiers,
        },
        full: true,
      },
    },
  };
});

// Validate document and send diagnostics
async function validateDocument(textDocument: TextDocument): Promise<void> {
  const source = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  try {
    const lang = await getLanguageForSource(textDocument.uri, source);

    // Parse
    const parseResult = lang.$parse.program()(source, 0);

    if (!parseResult.ok) {
      // Parse error - convert position to line/col
      const pos = posToLspPosition(source, parseResult.pos);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: pos,
          end: { line: pos.line, character: pos.character + 1 },
        },
        message: `Expected ${parseResult.expected}`,
        source: "unsound",
      });
      documentCache.set(textDocument.uri, { analysis: null, source });
    } else {
      // Parse succeeded - run analysis if $analyze exists
      let analysis: AnalysisResult | null = null;

      if (lang.$analyze?.analyzeProgram) {
        try {
          analysis = lang.$analyze.analyzeProgram(parseResult.value);

          // Convert analysis diagnostics to LSP diagnostics
          for (const diag of analysis?.diagnostics ?? []) {
            if (diag.loc) {
              const range = spanToRange(source, diag.loc);
              diagnostics.push({
                severity:
                  diag.severity === "error"
                    ? DiagnosticSeverity.Error
                    : diag.severity === "warning"
                      ? DiagnosticSeverity.Warning
                      : DiagnosticSeverity.Information,
                range,
                message: diag.message,
                source: "unsound",
              });
            }
          }
        } catch (e: any) {
          connection.console.log(`Analysis error: ${e.message}`);
        }
      }

      documentCache.set(textDocument.uri, { analysis, source });
    }
  } catch (e: any) {
    connection.console.log(`Validation error: ${e.message}`);
    documentCache.set(textDocument.uri, { analysis: null, source });
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// Document change handler
documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

// Completion
connection.onCompletion((params): CompletionItem[] => {
  const cached = documentCache.get(params.textDocument.uri);
  if (!cached?.analysis) return [];

  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  for (const def of cached.analysis.definitions) {
    if (!seen.has(def.name)) {
      seen.add(def.name);
      items.push({
        label: def.name,
        kind:
          def.kind === "param"
            ? CompletionItemKind.Variable
            : def.kind === "const"
              ? CompletionItemKind.Constant
              : CompletionItemKind.Variable,
      });
    }
  }

  // Add keywords
  const keywords = [
    "let",
    "if",
    "then",
    "else",
    "return",
    "true",
    "false",
    "null",
    "undefined",
    "this",
    "do",
    "import",
    "from",
  ];
  for (const kw of keywords) {
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
    });
  }

  return items;
});

// Check if position is within a span
function isInSpan(
  source: string,
  span: Span,
  line: number,
  col: number
): boolean {
  const start = posToLineCol(source, span.start);
  const end = posToLineCol(source, span.end);

  if (line < start.line || line > end.line) return false;
  if (line === start.line && col < start.col) return false;
  if (line === end.line && col > end.col) return false;
  return true;
}

// Find definition at position
function findDefinitionAt(
  source: string,
  analysis: AnalysisResult,
  line: number,
  col: number
): AnalysisDef | null {
  // Check references first
  for (const ref of analysis.references) {
    if (ref.loc && isInSpan(source, ref.loc, line, col)) {
      return ref.definition || null;
    }
  }
  // Check definitions
  for (const def of analysis.definitions) {
    if (def.loc && isInSpan(source, def.loc, line, col)) {
      return def;
    }
  }
  return null;
}

// Hover
connection.onHover((params): Hover | null => {
  const cached = documentCache.get(params.textDocument.uri);
  if (!cached?.analysis) return null;

  const line = params.position.line + 1;
  const col = params.position.character + 1;

  const def = findDefinitionAt(cached.source, cached.analysis, line, col);
  if (def) {
    return {
      contents: {
        kind: "markdown",
        value: `**${def.name}** (${def.kind})`,
      },
    };
  }

  return null;
});

// Go to definition
connection.onDefinition((params): Definition | null => {
  const cached = documentCache.get(params.textDocument.uri);
  if (!cached?.analysis) return null;

  const line = params.position.line + 1;
  const col = params.position.character + 1;

  const def = findDefinitionAt(cached.source, cached.analysis, line, col);
  if (def?.loc) {
    const range = spanToRange(cached.source, def.loc);
    return Location.create(params.textDocument.uri, range);
  }

  return null;
});

// Semantic tokens
connection.languages.semanticTokens.on((params) => {
  const cached = documentCache.get(params.textDocument.uri);
  if (!cached?.analysis) return { data: [] };

  const builder = new SemanticTokensBuilder();

  // Sort tokens by position (required by LSP protocol)
  const sortedTokens = [...cached.analysis.tokens].sort(
    (a, b) => a.loc.start - b.loc.start
  );

  for (const token of sortedTokens) {
    const start = posToLineCol(cached.source, token.loc.start);
    const length = token.loc.end - token.loc.start;
    const typeIndex = tokenTypes.indexOf(token.type);
    if (typeIndex === -1) continue; // Skip unknown token types

    const modifierBits = (token.modifiers || []).reduce(
      (acc, mod) => acc | (1 << tokenModifiers.indexOf(mod)),
      0
    );

    builder.push(
      start.line - 1,
      start.col - 1,
      length,
      typeIndex,
      modifierBits
    );
  }

  return builder.build();
});

// Start listening
documents.listen(connection);
connection.listen();
