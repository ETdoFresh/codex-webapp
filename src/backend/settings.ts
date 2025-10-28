export type CodexReasoningEffort = 'low' | 'medium' | 'high';
export type CodexProvider = 'CodexSDK' | 'ClaudeCodeSDK' | 'DroidCLI' | 'GeminiSDK';

type CodexMeta = {
  provider: CodexProvider;
  availableProviders: CodexProvider[];
  model: string;
  reasoningEffort: CodexReasoningEffort;
  availableModels: string[];
  availableReasoningEfforts: CodexReasoningEffort[];
  modelsByProvider: Record<CodexProvider, string[]>;
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
const droidDefaultModel = (process.env.DROID_MODEL ?? 'glm-4.6').trim();
const droidFallbackModels = ['glm-4.6', 'gpt-5-2025-08-07', 'claude-sonnet-4-5-20250929'];
const droidModels = Array.from(
  new Set([...(parseList(process.env.DROID_MODEL_OPTIONS)), droidDefaultModel, ...droidFallbackModels])
);

const availableModels = Array.from(new Set([...codexModels, ...claudeModels, ...droidModels]));
const modelsByProvider: Record<CodexProvider, string[]> = {
  CodexSDK: codexModels,
  ClaudeCodeSDK: claudeModels,
  DroidCLI: droidModels,
  GeminiSDK: codexModels
};

const allowedProviders: CodexProvider[] = ['CodexSDK', 'ClaudeCodeSDK', 'DroidCLI', 'GeminiSDK'];
const fallbackProviders: CodexProvider[] = ['CodexSDK', 'ClaudeCodeSDK'];
const isProviderAvailable = (provider: CodexProvider): boolean => {
  switch (provider) {
    case 'DroidCLI':
      return Boolean(process.env.DROID_PATH && process.env.DROID_PATH.trim().length > 0);
    case 'ClaudeCodeSDK':
      return true;
    case 'CodexSDK':
      return true;
    case 'GeminiSDK':
      return false;
    default:
      return false;
  }
};

const availableProviders = (() => {
  const configured = parseList(process.env.CODEX_PROVIDER_OPTIONS)
    .map((value) => value as CodexProvider)
    .filter((value): value is CodexProvider => allowedProviders.includes(value));

  const combined = new Set<CodexProvider>([...fallbackProviders, ...configured]);
  if (isProviderAvailable('DroidCLI')) {
    combined.add('DroidCLI');
  }
  return Array.from(combined).filter((provider) => isProviderAvailable(provider));
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
    case 'DroidCLI':
      return droidModels.includes(droidDefaultModel) ? droidDefaultModel : droidModels[0];
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
  availableReasoningEfforts,
  modelsByProvider
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

  const resolveProviderModels = (provider: CodexProvider): string[] => {
    const list = modelsByProvider[provider];
    return list && list.length > 0 ? list : availableModels;
  };

  const previousModel = currentModel;
  const previousProvider = currentProvider;
  const previousReasoningEffort = currentReasoningEffort;

  let nextProvider = previousProvider;
  let nextModel = previousModel;
  let nextReasoningEffort = previousReasoningEffort;

  if (typeof updates.provider === 'string') {
    const proposedProvider = updates.provider as CodexProvider;
    if (!availableProviders.includes(proposedProvider)) {
      throw new Error(`Unsupported provider: ${updates.provider}`);
    }

    nextProvider = proposedProvider;
    providerChanged = proposedProvider !== previousProvider;
  }

  if (typeof updates.model === 'string') {
    const candidateModel = updates.model.trim();
    const providerModels = resolveProviderModels(nextProvider);
    if (!providerModels.includes(candidateModel)) {
      throw new Error(`Unsupported model: ${updates.model}`);
    }

    nextModel = candidateModel;
    modelChanged = candidateModel !== previousModel;
  }

  if (typeof updates.reasoningEffort === 'string') {
    const proposedEffort = updates.reasoningEffort;
    if (!availableReasoningEfforts.includes(proposedEffort)) {
      throw new Error(`Unsupported reasoning effort: ${updates.reasoningEffort}`);
    }

    nextReasoningEffort = proposedEffort;
    reasoningChanged = proposedEffort !== previousReasoningEffort;
  }

  const providerModels = resolveProviderModels(nextProvider);
  if (!providerModels.includes(nextModel)) {
    const defaultForProvider = getDefaultModelForProvider(nextProvider);
    if (defaultForProvider !== nextModel) {
      nextModel = defaultForProvider;
      modelChanged = defaultForProvider !== previousModel;
    }
  }

  if (modelChanged) {
    currentModel = nextModel;
    process.env.CODEX_MODEL = nextModel;
  }

  if (reasoningChanged) {
    currentReasoningEffort = nextReasoningEffort;
    process.env.CODEX_REASONING_EFFORT = nextReasoningEffort;
  }

  if (providerChanged) {
    currentProvider = nextProvider;
    process.env.CODEX_PROVIDER = nextProvider;
  }

  return {
    meta: getCodexMeta(),
    modelChanged,
    reasoningChanged,
    providerChanged
  };
};
