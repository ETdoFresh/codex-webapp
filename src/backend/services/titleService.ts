import { DEFAULT_SESSION_TITLE } from "../config/sessions";
import { codexManager } from "../codexManager";
import { claudeManager } from "../claudeManager";
import { getCodexMeta } from "../settings";
import type { SessionRecord } from "../types/database";
import { droidCliManager } from "../droidCliManager";

const MAX_TITLE_LENGTH = 80;
const MAX_TITLE_WORDS = 12;

type AutoTitleMessage = {
  role?: unknown;
  content?: unknown;
  attachments?: unknown;
  items?: unknown;
};

const sanitizeLine = (line: string): string => {
  const withoutMarkdown = line
    .replace(/^[\s>*#\-\d.()]+/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
  const withoutCodeFences = withoutMarkdown.replace(/```[\s\S]*?```/g, " ");
  const condensedWhitespace = withoutCodeFences.replace(/\s+/g, " ");
  return condensedWhitespace.trim();
};

const clampLength = (value: string): string => {
  if (value.length <= MAX_TITLE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`;
};

const clampWords = (value: string): string => {
  const words = value.split(/\s+/);
  if (words.length <= MAX_TITLE_WORDS) {
    return value;
  }
  return `${words.slice(0, MAX_TITLE_WORDS).join(" ")}…`;
};

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .map((word) =>
      word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word,
    )
    .join(" ");

const clampTitle = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return clampLength(trimmed);
};

const extractLinesFromMessages = (messages: AutoTitleMessage[]): string[] => {
  const lines: string[] = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const role =
      typeof record.role === "string" && record.role.length > 0
        ? record.role
        : "user";
    const content =
      typeof record.content === "string" ? record.content.trim() : "";
    if (content.length > 0) {
      lines.push(`${role}: ${content}`);
    }

    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const itemRecord = item as Record<string, unknown>;
        const type =
          typeof itemRecord.type === "string" ? itemRecord.type : "item";
        const textCandidate =
          typeof itemRecord.text === "string"
            ? itemRecord.text
            : typeof itemRecord.summary === "string"
              ? itemRecord.summary
              : null;
        if (textCandidate && textCandidate.trim().length > 0) {
          lines.push(`${role} ${type}: ${textCandidate.trim()}`);
        }
      }
    }

    if (Array.isArray(record.attachments) && record.attachments.length > 0) {
      const attachmentNames = record.attachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== "object") {
            return null;
          }
          const attachmentRecord = attachment as Record<string, unknown>;
          if (
            typeof attachmentRecord.filename === "string" &&
            attachmentRecord.filename.length > 0
          ) {
            return attachmentRecord.filename;
          }
          return null;
        })
        .filter((name): name is string => Boolean(name));

      if (attachmentNames.length > 0) {
        lines.push(`${role} attachments: ${attachmentNames.join(", ")}`);
      }
    }
  }

  return lines;
};

const heuristicTitleFromMessages = (
  messages: AutoTitleMessage[],
  fallback: string,
): string => {
  const lines = extractLinesFromMessages(messages)
    .map((line) => sanitizeLine(line))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return fallback;
  }

  const userLines = lines.filter((line) => /^user:\s*/i.test(line));
  let candidate = userLines.length > 0
    ? userLines[userLines.length - 1].replace(/^user:\s*/i, "")
    : lines[lines.length - 1] ?? lines[0];

  if (!candidate || candidate.trim().length === 0) {
    return fallback;
  }

  const wordsClamped = clampWords(candidate);
  const lengthClamped = clampLength(wordsClamped);
  const normalized = lengthClamped.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return fallback;
  }

  return titleCase(normalized);
};

export async function generateSessionTitle(
  session: SessionRecord,
  messages: unknown[],
  options?: { fallback?: string },
): Promise<string> {
  const fallbackTitle =
    options?.fallback?.trim() ?? session.title ?? DEFAULT_SESSION_TITLE;

  const safeMessages = Array.isArray(messages)
    ? (messages as AutoTitleMessage[])
    : [];
  const serialized = safeMessages.length > 0
    ? JSON.stringify(safeMessages, null, 2)
    : "";

  if (serialized.length > 0) {
    try {
      const meta = getCodexMeta();
      const manager = (() => {
        switch (meta.provider) {
          case 'ClaudeCodeSDK':
            return claudeManager;
          case 'DroidCLI':
            return droidCliManager;
          case 'CodexSDK':
          default:
            return codexManager;
        }
      })();
      const suggestion = await manager.generateTitleSuggestion(
        session,
        serialized,
      );
      if (suggestion && suggestion.trim().length > 0) {
        return clampTitle(suggestion, fallbackTitle);
      }
    } catch (error) {
      console.warn(
        `[codex-webapp] Title suggestion failed for session ${session.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const heuristic = heuristicTitleFromMessages(safeMessages, fallbackTitle);
  return clampTitle(heuristic, fallbackTitle);
}
