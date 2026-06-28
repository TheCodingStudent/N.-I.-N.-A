import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const languageExtensions = {
  html: html(),
  css: css(),
  js: javascript()
};

const accentByLanguage = {
  html: "rgba(255, 139, 61, 0.82)",
  css: "rgba(173, 112, 255, 0.82)",
  js: "rgba(255, 220, 80, 0.82)"
};

const ninaHighlightStyle = HighlightStyle.define([
  {
    tag: [t.standard(t.variableName), t.variableName, t.self, t.content],
    color: "#f8f8f2"
  },
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword],
    color: "#ff2f7d"
  },
  {
    tag: [t.definitionKeyword, t.modifier],
    color: "#00e5ff",
    fontStyle: "italic"
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)],
    color: "#c6ff00"
  },
  {
    tag: [t.propertyName, t.definition(t.propertyName), t.attributeName],
    color: "#a6ff4d"
  },
  {
    tag: [t.string, t.special(t.string), t.attributeValue],
    color: "#fff23d"
  },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: "#bd7cff"
  },
  {
    tag: [t.regexp, t.escape],
    color: "#ff6aa9"
  },
  {
    tag: [t.tagName, t.angleBracket, t.processingInstruction],
    color: "#ff2f7d"
  },
  {
    tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator, t.derefOperator],
    color: "#ff2f7d"
  },
  {
    tag: [t.bracket, t.squareBracket, t.paren, t.brace],
    color: "#ffd866"
  },
  {
    tag: [t.punctuation, t.separator],
    color: "#f8f8f2"
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "#7f8f72",
    fontStyle: "italic"
  },
  {
    tag: [t.className, t.typeName, t.labelName],
    color: "#00e5ff"
  },
  {
    tag: [t.invalid],
    color: "#ffffff",
    backgroundColor: "#ff2f7d"
  }
]);

const ninaTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      minHeight: "0",
      border: "1px solid var(--holo-30)",
      borderRadius: "0",
      color: "var(--theme-foreground)",
      background: "var(--vscode-bg)",
      fontSize: "0.78rem"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      height: "100%",
      minHeight: "0",
      overflow: "auto",
      fontFamily: 'Consolas, "Cascadia Code", monospace',
      lineHeight: "1.45"
    },
    ".cm-content": {
      padding: "10px",
      caretColor: "var(--theme-foreground)"
    },
    ".cm-gutters": {
      borderRight: "1px solid var(--holo-18)",
      color: "var(--theme-muted-foreground)",
      background: "oklch(0.18 0.025 246 / 0.9)"
    },
    ".cm-activeLine": {
      background: "var(--holo-10)"
    },
    ".cm-activeLineGutter": {
      color: "var(--theme-foreground)",
      background: "var(--holo-18)"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      background: "var(--holo-30)"
    },
    ".cm-cursor": {
      borderLeftColor: "var(--theme-foreground)"
    }
  },
  { dark: true }
);

function createFromTextarea(textarea, language) {
  const host = document.createElement("div");
  host.className = `nina-codemirror nina-codemirror-${language}`;
  host.dataset.editorLanguage = language;
  host.hidden = !textarea.classList.contains("active");

  textarea.insertAdjacentElement("afterend", host);
  textarea.classList.add("cm-replaced");
  textarea.hidden = true;

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: textarea.value,
      extensions: [
        basicSetup,
        languageExtensions[language] || [],
        syntaxHighlighting(ninaHighlightStyle),
        ninaTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            textarea.value = update.state.doc.toString();
          }
        })
      ]
    })
  });

  host.style.setProperty("--active-code-border", accentByLanguage[language] || "var(--holo-30)");

  return {
    host,
    view,
    getValue() {
      return view.state.doc.toString();
    },
    setValue(value) {
      const nextValue = String(value ?? "");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: nextValue
        }
      });
      textarea.value = nextValue;
    },
    insertText(text) {
      const insert = String(text ?? "");
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
        scrollIntoView: true
      });
      view.focus();
    },
    focus() {
      view.focus();
    },
    setActive(active) {
      host.hidden = !active;
    }
  };
}

window.NinaCodeMirror = {
  createFromTextarea
};
