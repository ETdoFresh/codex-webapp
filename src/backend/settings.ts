export type CodexReasoningEffort = 'low' | 'medium' | 'high';
export type CodexProvider = 'CodexSDK' | 'ClaudeCodeSDK' | 'GeminiSDK';

type CodexMeta = {
  provider: CodexProvider;
  availableProviders: CodexProvider[];
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

// Codex models
const fallbackModels = ['gpt-5-codex', 'gpt-5'];
const codexModels = Array.from(
  new Set([...(parseList(process.env.CODEX_MODEL_OPTIONS)), defaultModel, ...fallbackModels])
);

// Claude models
const claudeDefaultModel = (process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5-20250929').trim();
const claudeFallbackModels = ['claude-sonnet-4-5-20250929', 'claude-opus-4-20250514', 'claude-haiku-4-5-20250929', 'claude-sonnet-3-5-20241022'];
const claudeModels = Array.from(
  new Set([...(parseList(process.env.CLAUDE_MODEL_OPTIONS)), claudeDefaultModel, ...claudeFallbackModels])
);

// Combined available models (will be filtered by provider in UI)
const availableModels = Array.from(new Set([...codexModels, ...claudeModels]));

const allowedProviders: CodexProvider[] = ['CodexSDK', 'ClaudeCodeSDK', 'GeminiSDK'];
const fallbackProviders: CodexProvider[] = ['CodexSDK', 'ClaudeCodeSDK'];
const availableProviders = (() => {
  const configured = parseList(process.env.CODEX_PROVIDER_OPTIONS)
    .map((value) => value as CodexProvider)
    .filter((value): value is CodexProvider => allowedProviders.includes(value));

  const combined = new Set<CodexProvider>([...fallbackProviders, ...configured]);
  return Array.from(combined);
})();

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

const defaultProvider = (() => {
  const value = process.env.CODEX_PROVIDER as CodexProvider | undefined;
  return value && availableProviders.includes(value) ? value : fallbackProviders[0];
})();

// Initialize current provider first
let currentProvider = availableProviders.includes(defaultProvider)
  ? defaultProvider
  : availableProviders[0];

// Initialize model based on provider
const getDefaultModelForProvider = (provider: CodexProvider): string => {
  switch (provider) {
    case 'CodexSDK':
      return codexModels.includes(defaultModel) ? defaultModel : codexModels[0];
    case 'ClaudeCodeSDK':
      return claudeModels.includes(claudeDefaultModel) ? claudeDefaultModel : claudeModels[0];
    case 'GeminiSDK':
      return codexModels[0]; // Fallback to Codex model for now
    default:
      return availableModels[0];
  }
};

let currentModel = getDefaultModelForProvider(currentProvider);
let currentReasoningEffort = defaultReasoningEffort;

export const getCodexMeta = (): CodexMeta => ({
  provider: currentProvider,
  availableProviders,
  model: currentModel,
  reasoningEffort: currentReasoningEffort,
  availableModels,
  availableReasoningEfforts
});

export const updateCodexMeta = (updates: {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  provider?: CodexProvider;
}): {
  meta: CodexMeta;
  modelChanged: boolean;
  reasoningChanged: boolean;
  providerChanged: boolean;
} => {
  let modelChanged = false;
  let reasoningChanged = false;
  let providerChanged = false;

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

  if (typeof updates.provider === 'string') {
    const nextProvider = updates.provider;
    if (!availableProviders.includes(nextProvider)) {
      throw new Error(`Unsupported provider: ${updates.provider}`);
    }

    if (nextProvider !== currentProvider) {
      currentProvider = nextProvider;
      process.env.CODEX_PROVIDER = nextProvider;
      providerChanged = true;

      // Auto-switch to appropriate model for the new provider if current model is incompatible
      const providerModels = nextProvider === 'ClaudeCodeSDK' ? claudeModels : codexModels;
      if (!providerModels.includes(currentModel)) {
        currentModel = getDefaultModelForProvider(nextProvider);
        modelChanged = true;
      }
    }
  }

  return {
    meta: getCodexMeta(),
    modelChanged,
    reasoningChanged,
    providerChanged
  };
};
