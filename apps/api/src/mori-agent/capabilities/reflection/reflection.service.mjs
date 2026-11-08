/** 将 Reflection 专属 Prompt、Schema 和校验器组装为独立执行服务。 */
import { createCapabilityExecutor } from '../../shared/executor.mjs'
import { REFLECTION_PROMPT, REFLECTION_PROMPT_VERSION } from './reflection.prompt.mjs'
import { REFLECTION_SCHEMA, validateReflectionInput, validateReflectionOutput } from './reflection.types.mjs'
export function createReflectionCapability(llm) { return createCapabilityExecutor({ capability: 'reflection', promptVersion: REFLECTION_PROMPT_VERSION, prompt: REFLECTION_PROMPT, schema: REFLECTION_SCHEMA, validateInput: validateReflectionInput, validateOutput: validateReflectionOutput, llm }) }
