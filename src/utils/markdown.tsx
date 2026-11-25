import { Check, Copy } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-400">
        <span className="font-mono">{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiato' : 'Copia'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[13px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((token, idx) => {
    if (!token) return null;
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded bg-zinc-200/70 dark:bg-zinc-800 px-1.5 py-0.5 text-[0.85em] font-mono text-zinc-900 dark:text-zinc-100"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-zinc-950 dark:text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      if (isSafeUrl(href)) {
        return (
          <a
            key={idx}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:opacity-80"
          >
            {label}
          </a>
        );
      }
      return <span key={idx}>{label}</span>;
    }
    return <Fragment key={idx}>{token}</Fragment>;
  });
}

export function MarkdownContent({ content }: { content: string }) {
  const segments = content.split(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g);
  const elements: ReactNode[] = [];

  for (let i = 0; i < segments.length; i += 3) {
    const plain = segments[i];
    if (plain) {
      const lines = plain.split('\n');
      let listItems: string[] = [];
      const flushList = (keyPrefix: string) => {
        if (listItems.length > 0) {
          elements.push(
            <ul key={`${keyPrefix}-ul`} className="my-2 ml-5 list-disc space-y-1">
              {listItems.map((item, liIdx) => (
                <li key={liIdx}>{renderInline(item)}</li>
              ))}
            </ul>,
          );
          listItems = [];
        }
      };

      lines.forEach((line, lineIdx) => {
        const trimmed = line.trim();
        const key = `${i}-${lineIdx}`;
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          listItems.push(trimmed.slice(2));
          return;
        }
        flushList(key);
        if (!trimmed) {
          return;
        }
        if (trimmed.startsWith('### ')) {
          elements.push(
            <h4 key={key} className="mt-3 mb-1 text-sm font-semibold text-zinc-950 dark:text-white">
              {renderInline(trimmed.slice(4))}
            </h4>,
          );
        } else if (trimmed.startsWith('## ')) {
          elements.push(
            <h3 key={key} className="mt-3.5 mb-1.5 text-base font-semibold text-zinc-950 dark:text-white">
              {renderInline(trimmed.slice(3))}
            </h3>,
          );
        } else if (trimmed.startsWith('# ')) {
          elements.push(
            <h2 key={key} className="mt-4 mb-2 text-lg font-semibold text-zinc-950 dark:text-white">
              {renderInline(trimmed.slice(2))}
            </h2>,
          );
        } else {
          elements.push(
            <p key={key} className="my-1.5 leading-relaxed">
              {renderInline(line)}
            </p>,
          );
        }
      });
      flushList(`${i}-end`);
    }

    const lang = segments[i + 1];
    const code = segments[i + 2];
    if (code !== undefined) {
      elements.push(<CodeBlock key={`code-${i}`} language={lang || ''} code={code.replace(/\n$/, '')} />);
    }
  }

  return <div className="text-sm leading-relaxed break-words">{elements}</div>;
}
