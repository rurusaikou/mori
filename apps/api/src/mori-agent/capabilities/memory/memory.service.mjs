/** 将 Memory 专属 Prompt、Schema 和校验器组装为可独立调用的 execute(input)。 */
import { createCapabilityExecutor } from '../../shared/executor.mjs'
import { MEMORY_PROMPT, MEMORY_PROMPT_VERSION } from './memory.prompt.mjs'
import { MEMORY_SCHEMA, validateMemoryInput, validateMemoryOutput } from './memory.types.mjs'
export function createMemoryCapability(llm) { return createCapabilityExecutor({ capability: 'memory', promptVersion: MEMORY_PROMPT_VERSION, prompt: MEMORY_PROMPT, schema: MEMORY_SCHEMA, validateInput: validateMemoryInput, validateOutput: validateMemoryOutput, llm }) }
