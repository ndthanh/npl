import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { sql, SQLDialect, StandardSQL, PostgreSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Webviews expose UI colors, not the editor's TextMate token colors. Symbol
// icon colors may all equal the foreground, so they cannot color SQL tokens.
export const SQL_TOKEN_CSS = `
.cm-editor .np-sql-keyword{color:var(--np-sql-keyword,#c586c0)}
.cm-editor .np-sql-string{color:var(--np-sql-string,#ce9178)}
.cm-editor .np-sql-number{color:var(--np-sql-number,#b5cea8)}
.cm-editor .np-sql-comment{color:var(--np-sql-comment,#6a9955);font-style:italic}
.cm-editor .np-sql-type{color:var(--np-sql-type,#4ec9b0)}
body.vscode-light,body.vscode-high-contrast-light{
--np-sql-keyword:#0000ff;--np-sql-string:#a31515;--np-sql-number:#098658;--np-sql-comment:#008000;--np-sql-type:#267f99}
`;

const dialect = SQLDialect.define({
  ...StandardSQL.spec,
  identifierQuotes: '`"',
  types:
    PostgreSQL.spec.types + " string bigint tinyint double decimal struct map",
  keywords:
    PostgreSQL.spec.keywords +
    " use show catalog schema database catalogs schemas databases tables views tblproperties",
});
export class SqlEditor {
  readonly view: EditorView;
  private readonly readOnlySlot = new Compartment();
  private readonly language = new Compartment();
  private syncing = false;
  private columns = "";
  constructor(
    parent: HTMLElement,
    doc: string,
    nonce: string,
    onChange: (doc: string) => void,
    onRun: () => void,
    onSelection: () => void,
  ) {
    this.view = new EditorView({
      parent,
      doc,
      extensions: [
        basicSetup,
        EditorView.cspNonce.of(nonce),
        EditorView.contentAttributes.of({
          "aria-label": "SQL query",
          spellcheck: "false",
        }),
        this.readOnlySlot.of(EditorState.readOnly.of(false)),
        this.language.of(sql({ dialect, upperCaseKeywords: true })),
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onRun();
                return true;
              },
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.syncing)
            onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) onSelection();
        }),
        syntaxHighlighting(
          HighlightStyle.define([
            {
              tag: tags.keyword,
              class: "np-sql-keyword",
            },
            {
              tag: tags.string,
              class: "np-sql-string",
            },
            {
              tag: [tags.number, tags.bool, tags.null],
              class: "np-sql-number",
            },
            {
              tag: tags.comment,
              class: "np-sql-comment",
            },
            {
              tag: tags.typeName,
              class: "np-sql-type",
            },
          ]),
        ),
        EditorView.theme({
          "&": {
            fontSize: "13px",
            backgroundColor: "var(--vscode-editor-background)",
            color: "var(--vscode-editor-foreground,var(--vscode-foreground))",
          },
          ".cm-scroller": {
            fontFamily: "var(--vscode-editor-font-family,Consolas,monospace)",
            maxHeight: "340px",
            minHeight: "150px",
          },
          ".cm-content": { padding: "12px 0" },
          ".cm-gutters": {
            backgroundColor:
              "var(--vscode-editorGutter-background,var(--vscode-editor-background))",
            color: "var(--vscode-editorLineNumber-foreground,#858585)",
            borderRight: "1px solid var(--vscode-panel-border)",
          },
          ".cm-activeLine,.cm-activeLineGutter": {
            backgroundColor:
              "var(--vscode-editor-lineHighlightBackground,transparent)",
          },
          ".cm-cursor": {
            borderLeftColor:
              "var(--vscode-editorCursor-foreground,var(--vscode-foreground))",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
            {
              backgroundColor:
                "var(--vscode-editor-selectionBackground,#264f78)",
            },
          ".cm-tooltip": {
            backgroundColor:
              "var(--vscode-editorSuggestWidget-background,var(--vscode-editor-background))",
            color:
              "var(--vscode-editorSuggestWidget-foreground,var(--vscode-foreground))",
            border:
              "1px solid var(--vscode-editorSuggestWidget-border,var(--vscode-panel-border))",
          },
          ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
            backgroundColor:
              "var(--vscode-editorSuggestWidget-selectedBackground,#04395e)",
            color: "var(--vscode-editorSuggestWidget-selectedForeground,#fff)",
          },
        }),
      ],
    });
  }
  get document() {
    return this.view.state.doc.toString();
  }
  get selectedSql() {
    const ranges = this.view.state.selection.ranges.filter(
      (range) => !range.empty,
    );
    return ranges.length
      ? ranges
          .map((range) => this.view.state.sliceDoc(range.from, range.to))
          .join("\n")
      : this.document;
  }
  get hasSelection() {
    return this.view.state.selection.ranges.some((range) => !range.empty);
  }
  sync(doc: string, busy: boolean, columns: string[]) {
    this.syncing = true;
    try {
      if (this.document !== doc)
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: doc },
        });
      const effects = [
        this.readOnlySlot.reconfigure(EditorState.readOnly.of(busy)),
      ];
      const key = JSON.stringify(columns);
      if (key !== this.columns) {
        this.columns = key;
        effects.push(
          this.language.reconfigure(
            sql({
              dialect,
              upperCaseKeywords: true,
              schema: { result: columns },
              defaultTable: "result",
            }),
          ),
        );
      }
      this.view.dispatch({ effects });
    } finally {
      this.syncing = false;
    }
  }
}
