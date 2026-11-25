export interface WorkspaceConnectRequest {
  type: 'connect';
  id: string;
  reason?: string;
}

export interface WorkspaceReadRequest {
  type: 'read';
  id: string;
  paths: string[];
  reason?: string;
}

export interface WorkspaceWriteRequest {
  type: 'write';
  id: string;
  path: string;
  reason?: string;
  content: string;
}

export type WorkspaceActionSegment =
  | { type: 'markdown'; content: string }
  | WorkspaceConnectRequest
  | WorkspaceReadRequest
  | WorkspaceWriteRequest;

function parseConnectBlock(raw: string, id: string): WorkspaceConnectRequest {
  const trimmed = raw.trim();
  if (!trimmed) return { type: 'connect', id };

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { reason?: string };
      return {
        type: 'connect',
        id,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    } catch {
      // Fall through
    }
  }

  let reason: string | undefined;
  for (const line of trimmed.split(/\r?\n/)) {
    const reasonMatch = line.trim().match(/^REASON\s*:\s*(.+)$/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
      break;
    }
  }
  return { type: 'connect', id, reason: reason || trimmed };
}

function parseReadBlock(raw: string, id: string): WorkspaceReadRequest | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // JSON fallback if model emitted JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        paths?: string[];
        path?: string;
        reason?: string;
      };
      const paths = Array.isArray(parsed.paths)
        ? parsed.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : typeof parsed.path === 'string' && parsed.path.trim()
          ? [parsed.path.trim()]
          : [];
      if (paths.length > 0) {
        return {
          type: 'read',
          id,
          paths,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        };
      }
    } catch {
      // Fall through to line parser
    }
  }

  let reason: string | undefined;
  const paths: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const reasonMatch = l.match(/^REASON\s*:\s*(.+)$/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
      continue;
    }
    const pathMatch = l.match(/^PATH\s*:\s*(.+)$/i);
    if (pathMatch) {
      const p = pathMatch[1].trim().replace(/^["'`]|["'`]$/g, '');
      if (p) paths.push(p);
    }
  }

  if (paths.length === 0) return null;
  return { type: 'read', id, paths, reason };
}

function parseWriteBlock(raw: string, id: string): WorkspaceWriteRequest | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // JSON fallback if model emitted JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        path?: string;
        reason?: string;
        content?: string;
      };
      if (typeof parsed.path === 'string' && parsed.path.trim() && typeof parsed.content === 'string') {
        return {
          type: 'write',
          id,
          path: parsed.path.trim(),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
          content: parsed.content,
        };
      }
    } catch {
      // Fall through to header/separator parser
    }
  }

  const markerMatch = raw.match(/\r?\n---CONTENT---\r?\n/);
  if (!markerMatch || markerMatch.index === undefined) {
    return null;
  }

  const headerPart = raw.slice(0, markerMatch.index);
  const contentPart = raw.slice(markerMatch.index + markerMatch[0].length);

  let targetPath = '';
  let reason: string | undefined;
  for (const line of headerPart.split(/\r?\n/)) {
    const l = line.trim();
    const pathMatch = l.match(/^PATH\s*:\s*(.+)$/i);
    if (pathMatch) {
      targetPath = pathMatch[1].trim().replace(/^["'`]|["'`]$/g, '');
      continue;
    }
    const reasonMatch = l.match(/^REASON\s*:\s*(.+)$/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
    }
  }

  if (!targetPath) return null;
  return {
    type: 'write',
    id,
    path: targetPath,
    reason,
    content: contentPart,
  };
}

export function parseWorkspaceActions(
  messageId: string,
  markdownText: string,
): WorkspaceActionSegment[] {
  if (
    !markdownText.includes('aihub-read') &&
    !markdownText.includes('aihub-write') &&
    !markdownText.includes('aihub-connect')
  ) {
    return [{ type: 'markdown', content: markdownText }];
  }

  const regex =
    /(`{3,4})(aihub-connect|aihub-read|aihub-write)[ \t]*\r?\n([\s\S]*?)\r?\n\1(?=[ \t]*(?:\r?\n|$))/g;
  const segments: WorkspaceActionSegment[] = [];
  let lastIndex = 0;
  let blockIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdownText)) !== null) {
    const [fullMatch, , kind, body] = match;
    if (match.index > lastIndex) {
      const before = markdownText.slice(lastIndex, match.index);
      if (before.trim()) {
        segments.push({ type: 'markdown', content: before });
      }
    }

    const actionId = `${messageId}:${blockIndex++}`;
    const parsed =
      kind === 'aihub-connect'
        ? parseConnectBlock(body, actionId)
        : kind === 'aihub-read'
          ? parseReadBlock(body, actionId)
          : parseWriteBlock(body, actionId);

    if (parsed) {
      segments.push(parsed);
    } else {
      segments.push({ type: 'markdown', content: fullMatch });
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < markdownText.length) {
    const tail = markdownText.slice(lastIndex);
    if (tail.trim()) {
      segments.push({ type: 'markdown', content: tail });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content: markdownText }];
}
