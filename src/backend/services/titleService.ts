import { DEFAULT_SESSION_TITLE } from "../config/sessions";

const MAX_TITLE_LENGTH = 80;
const MAX_TITLE_WORDS = 12;

const sanitizeLine = (line: string): string => {
  const withoutMarkdown = line
    .replace(/^\s*[-*+#>\d.\)\(]+\s*/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
  const withoutCodeFences = withoutMarkdown.replace(/```.*$/g, "");
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

const titleCase = (value: string): string => {
  if (!value) {
    return value;
  }
  return value
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) {
        return word;
      }
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
};

export function generateTitleFromContent(
  contents: string,
  options?: {
    fallback?: string;
  },
): string {
  const fallbackTitle = options?.fallback?.trim();
  if (typeof contents !== "string" || contents.trim().length === 0) {
    return fallbackTitle && fallbackTitle.length > 0
      ? fallbackTitle
      : DEFAULT_SESSION_TITLE;
  }

  const lines = contents
    .split(/\r?\n/)
    .map((line) => sanitizeLine(line))
    .filter((line) => line.length > 0);

  const userLines = lines
    .filter((line) => /^user:\s*/i.test(line))
    .map((line) => line.replace(/^user:\s*/i, ""))
    .filter((line) => line.length > 0);

  let candidate = userLines[userLines.length - 1];
  if (!candidate) {
    candidate = lines[0];
  }

  if (!candidate) {
    return fallbackTitle && fallbackTitle.length > 0
      ? fallbackTitle
      : DEFAULT_SESSION_TITLE;
  }

  const wordsClamped = clampWords(candidate);
  const lengthClamped = clampLength(wordsClamped);
  const normalized = lengthClamped.replace(/\s+/g, " ").trim();

  if (!normalized || normalized.length === 0) {
    return fallbackTitle && fallbackTitle.length > 0
      ? fallbackTitle
      : DEFAULT_SESSION_TITLE;
  }

  const titled = titleCase(normalized);
  return titled || DEFAULT_SESSION_TITLE;
}
