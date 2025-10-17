export type CodexReasoningEffort = 'low' | 'medium' | 'high';

type CodexMeta = {
  model: string;
  reasoningEffort: CodexReasoningEffort;
  availableModels: string[];
  availableReasoningEfforts: CodexReasoningEffort[];
};

const defaultModel = (process.env.CODEX_MODEL ?? 'gpt-5-codex').trim();

const parseList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const fallbackModels = ['gpt-5-codex', 'gpt-5'];
const availableModels = Array.from(
  new Set([...(parseList(process.env.CODEX_MODEL_OPTIONS)), defaultModel, ...fallbackModels])
);

const allowedReasoningEfforts: CodexReasoningEffort[] = ['low', 'medium', 'high'];
const availableReasoningEfforts = (() => {
  const configured = parseList(process.env.CODEX_REASONING_EFFORT_OPTIONS);
  const normalized = configured
    .map((value) => value.toLowerCase())
    .filter((value): value is CodexReasoningEffort =>
      allowedReasoningEfforts.includes(value as CodexReasoningEffort)
    );

  if (normalized.length > 0) {
    return Array.from(new Set(normalized));
  }

  return allowedReasoningEfforts;
})();

const defaultReasoningEffort = (() => {
  const value = process.env.CODEX_REASONING_EFFORT?.toLowerCase() as
    | CodexReasoningEffort
    | undefined;
  return value && availableReasoningEfforts.includes(value) ? value : 'medium';
})();

let currentModel = availableModels.includes(defaultModel) ? defaultModel : availableModels[0];
let currentReasoningEffort = defaultReasoningEffort;

export const getCodexMeta = (): CodexMeta => ({
  model: currentModel,
  reasoningEffort: currentReasoningEffort,
  availableModels,
  availableReasoningEfforts
});

export const updateCodexMeta = (updates: {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
}): {
  meta: CodexMeta;
  modelChanged: boolean;
  reasoningChanged: boolean;
} => {
  let modelChanged = false;
  let reasoningChanged = false;

  if (typeof updates.model === 'string') {
    const nextModel = updates.model.trim();
    if (!availableModels.includes(nextModel)) {
      throw new Error(`Unsupported model: ${updates.model}`);
    }

    if (nextModel !== currentModel) {
      currentModel = nextModel;
      process.env.CODEX_MODEL = nextModel;
      modelChanged = true;
    }
  }

  if (typeof updates.reasoningEffort === 'string') {
    const nextEffort = updates.reasoningEffort;
    if (!availableReasoningEfforts.includes(nextEffort)) {
      throw new Error(`Unsupported reasoning effort: ${updates.reasoningEffort}`);
    }

    if (nextEffort !== currentReasoningEffort) {
      currentReasoningEffort = nextEffort;
      process.env.CODEX_REASONING_EFFORT = nextEffort;
      reasoningChanged = true;
    }
  }

  return {
    meta: getCodexMeta(),
    modelChanged,
    reasoningChanged
  };
};
