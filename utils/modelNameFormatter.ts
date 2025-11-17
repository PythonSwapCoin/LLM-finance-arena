/**
 * Formats model names for display in the frontend
 * Removes size indicators, version details, and direction suffixes
 */
export const formatModelName = (modelName: string | undefined | null): string => {
  if (!modelName) return '';
  
  // Hardcoded mappings for Wall Street Arena models only
  const modelMappings: { [key: string]: string } = {
    'anthropic/claude-haiku-4.5': 'Claude 4.5',
    'openai/gpt-5-nano': 'GPT 5',
    'x-ai/grok-4-fast': 'Grok 4',
    'qwen/qwen3-32b': 'QWEN 3',
    'google/gemini-2.5-flash': 'Gemini 2.5',
    // Handle variations with direction suffixes
    'anthropic/claude-haiku-4.5-instruct': 'Claude 4.5',
    'openai/gpt-5-nano-instruct': 'GPT 5',
    'x-ai/grok-4-fast-instruct': 'Grok 4',
    'qwen/qwen3-32b-instruct': 'QWEN 3',
    'google/gemini-2.5-flash-instruct': 'Gemini 2.5',
    // Handle old model names that might still be in use
    'qwen/qwen-2.5-72b-instruct': 'QWEN 3',
    'qwen/qwen-2.5-72b': 'QWEN 3',
    // Handle gpt-5-chat variations
    'openai/gpt-5-chat': 'GPT 5',
    'openai/gpt-5-chat-instruct': 'GPT 5',
    // Handle claude-3-haiku (old name)
    'anthropic/claude-3-haiku': 'Claude 4.5',
    'anthropic/claude-3-haiku-instruct': 'Claude 4.5',
  };
  
  // Check for exact match first
  if (modelMappings[modelName]) {
    return modelMappings[modelName];
  }
  
  // Fallback: return original if no mapping found
  return modelName;
};

/**
 * Gets the display name for an agent
 * For Wall Street Arena: returns formatted model name if available, otherwise agent name
 * For other arenas: returns agent name
 */
export const getAgentDisplayName = (
  agent: { name: string; model?: string },
  simulationTypeName?: string
): string => {
  // Only use formatted model names for Wall Street Arena
  if (simulationTypeName === 'Wall Street Arena' && agent.model) {
    const formatted = formatModelName(agent.model);
    // Only use formatted name if it's one of our mapped models (not the fallback)
    if (formatted !== agent.model) {
      return formatted;
    }
  }
  // Otherwise use agent name
  return agent.name;
};

