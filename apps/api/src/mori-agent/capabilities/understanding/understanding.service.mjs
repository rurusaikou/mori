/** 将 Understanding 专属 Prompt、Schema 和校验器组装为独立执行服务。 */
import { createCapabilityExecutor } from '../../shared/executor.mjs'
import { UNDERSTANDING_PROMPT, UNDERSTANDING_PROMPT_VERSION } from './understanding.prompt.mjs'
import { UNDERSTANDING_SCHEMA, validateUnderstandingInput, validateUnderstandingOutput } from './understanding.types.mjs'
export function createUnderstandingCapability(llm) { return createCapabilityExecutor({ capability: 'understanding', promptVersion: UNDERSTANDING_PROMPT_VERSION, prompt: UNDERSTANDING_PROMPT, schema: UNDERSTANDING_SCHEMA, validateInput: validateUnderstandingInput, validateOutput: validateUnderstandingOutput, llm }) }
