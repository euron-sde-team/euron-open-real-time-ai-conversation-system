"use client";

/** The code answer editor: CodeMirror with the question's language, light and dark aware. */
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { Extension } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { NativeSelect } from "@open-conversation/ui";
import { LANGUAGE_LABEL } from "@/components/interview/format";
import { resolveTheme, useTheme } from "@/lib/stores/theme";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false, loading: () => <div className="h-full animate-pulse rounded-card bg-muted" /> });

function languageExtension(lang: string): Extension[] {
  switch (lang) {
    case "python":
      return [python()];
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "java":
      return [java()];
    case "cpp":
      return [cpp()];
    case "sql":
      return [sql()];
    default:
      return [];
  }
}

export function CodeEditor({ value, onChange, language, onLanguage }: { value: string; onChange: (v: string) => void; language: string; onLanguage: (l: string) => void }) {
  const { pref } = useTheme();
  const resolved = resolveTheme(pref, typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const extensions = useMemo(() => languageExtension(language), [language]);
  return (
    <div className="flex h-full min-h-[280px] flex-col overflow-hidden rounded-card bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[13px] font-medium text-muted-foreground">Your solution</span>
        <NativeSelect aria-label="Language" value={language} onChange={(e) => onLanguage(e.target.value)} className="h-8 w-36 text-[13px]">
          {Object.entries(LANGUAGE_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="min-h-0 flex-1 overflow-auto text-[13.5px]">
        <CodeMirror value={value} onChange={onChange} extensions={extensions} theme={resolved === "dark" ? "dark" : "light"} height="100%" className="h-full" basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }} aria-label="Code editor" />
      </div>
    </div>
  );
}
