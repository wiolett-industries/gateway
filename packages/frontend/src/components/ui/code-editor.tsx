import { useEffect, useRef } from "react";
import { EditorView, lineNumbers, highlightActiveLine, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
  StreamLanguage,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";

// ---------------------------------------------------------------------------
// Nginx + Handlebars stream parser
// ---------------------------------------------------------------------------

const NGINX_KEYWORDS = new Set([
  "server",
  "location",
  "upstream",
  "listen",
  "server_name",
  "proxy_pass",
  "proxy_set_header",
  "proxy_cache",
  "proxy_cache_path",
  "proxy_cache_valid",
  "proxy_cache_use_stale",
  "proxy_cache_background_update",
  "proxy_http_version",
  "proxy_connect_timeout",
  "proxy_send_timeout",
  "proxy_read_timeout",
  "ssl_certificate",
  "ssl_certificate_key",
  "ssl_trusted_certificate",
  "ssl_protocols",
  "ssl_ciphers",
  "ssl_prefer_server_ciphers",
  "ssl_session_cache",
  "ssl_session_timeout",
  "ssl_session_tickets",
  "access_log",
  "error_log",
  "return",
  "rewrite",
  "alias",
  "root",
  "add_header",
  "auth_basic",
  "auth_basic_user_file",
  "limit_req",
  "limit_req_zone",
  "deny",
  "allow",
  "if",
  "set",
  "map",
  "include",
  "worker_processes",
  "events",
  "http",
  "types",
  "default_type",
  "sendfile",
  "keepalive_timeout",
  "gzip",
  "gzip_types",
]);

const NGINX_VALUES = new Set([
  "on",
  "off",
  "true",
  "false",
  "yes",
  "no",
  "http",
  "https",
  "ssl",
  "http2",
  "permanent",
  "redirect",
  "nodelay",
  "error",
  "timeout",
  "updating",
  "warn",
]);

interface ParserState {
  inHandlebars: boolean;
  inString: string | null; // quote char or null
  inComment: boolean;
}

const nginxHandlebarsLang = StreamLanguage.define<ParserState>({
  startState: () => ({ inHandlebars: false, inString: null, inComment: false }),
  token(stream, state) {
    // Inside Handlebars expression
    if (state.inHandlebars) {
      if (stream.match("}}") || stream.match("}}}")) {
        state.inHandlebars = false;
        return "meta";
      }
      if (
        stream.match("#if") ||
        stream.match("#unless") ||
        stream.match("#each") ||
        stream.match("/if") ||
        stream.match("/unless") ||
        stream.match("/each") ||
        stream.match("else")
      ) {
        return "meta";
      }
      if (stream.match("sanitize") || stream.match("eq")) {
        return "meta";
      }
      if (stream.match(/this\.\w+/)) return "meta";
      if (stream.match(/\w+/)) return "meta";
      stream.next();
      return "meta";
    }

    // Start of Handlebars
    if (stream.match("{{{") || stream.match("{{")) {
      state.inHandlebars = true;
      return "meta";
    }

    // Comment
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }

    // String (double quote)
    if (state.inString === '"' || (!state.inString && stream.peek() === '"')) {
      if (!state.inString) {
        stream.next();
        state.inString = '"';
        return "string";
      }
      if (stream.match(/[^"]*"/)) {
        state.inString = null;
        return "string";
      }
      stream.skipToEnd();
      return "string";
    }

    // String (single quote)
    if (state.inString === "'" || (!state.inString && stream.peek() === "'")) {
      if (!state.inString) {
        stream.next();
        state.inString = "'";
        return "string";
      }
      if (stream.match(/[^']*'/)) {
        state.inString = null;
        return "string";
      }
      stream.skipToEnd();
      return "string";
    }

    // Nginx variable ($...)
    if (stream.match(/\$\w+/)) return "variableName";

    // Number
    if (stream.match(/\d+[smhd]?\b/)) return "number";

    // Braces / semicolons
    if (stream.match("{") || stream.match("}")) return "brace";
    if (stream.match(";")) return "operator";

    // Word
    if (stream.match(/[\w._\-/]+/)) {
      const word = stream.current();
      if (NGINX_KEYWORDS.has(word)) return "keyword";
      if (NGINX_VALUES.has(word)) return "atom";
      return null;
    }

    stream.next();
    return null;
  },
});

// ---------------------------------------------------------------------------
// Theme + highlighting
// ---------------------------------------------------------------------------

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    fontSize: "13px",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  },
  ".cm-content": {
    caretColor: "hsl(var(--foreground))",
    padding: "8px 0",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--muted))",
    color: "hsl(var(--muted-foreground))",
    border: "none",
    borderRight: "1px solid hsl(var(--border))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.3)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent) / 0.3)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "hsl(var(--accent) / 0.5)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "hsl(var(--accent) / 0.4)",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--foreground))",
  },
});

const highlightStyles = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "#c678dd" },
    { tag: tags.string, color: "#98c379" },
    { tag: tags.number, color: "#d19a66" },
    { tag: tags.comment, color: "#5c6370", fontStyle: "italic" },
    { tag: tags.variableName, color: "#e06c75" },
    { tag: tags.atom, color: "#d19a66" },
    { tag: tags.propertyName, color: "#61afef" },
    { tag: tags.operator, color: "#56b6c2" },
    { tag: tags.brace, color: "#e5c07b" },
    {
      tag: tags.meta,
      color: "#e5c07b",
      backgroundColor: "rgba(229, 192, 123, 0.06)",
      borderRadius: "2px",
    },
  ]),
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
}

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  className = "",
  minHeight = "300px",
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        nginxHandlebarsLang,
        editorTheme,
        highlightStyles,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`border border-border overflow-auto ${className}`}
      style={{ minHeight }}
    />
  );
}
