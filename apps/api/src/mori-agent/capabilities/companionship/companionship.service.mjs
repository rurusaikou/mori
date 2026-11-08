/** 将 Companionship 专属 Prompt、Schema 和校验器组装为独立执行服务。 */
import { createCapabilityExecutor } from '../../shared/executor.mjs'
import { COMPANIONSHIP_PROMPT, COMPANIONSHIP_PROMPT_VERSION } from './companionship.prompt.mjs'
import { COMPANIONSHIP_SCHEMA, validateCompanionshipInput, validateCompanionshipOutput } from './companionship.types.mjs'
export function createCompanionshipCapability(llm) { return createCapabilityExecutor({ capability: 'companionship', promptVersion: COMPANIONSHIP_PROMPT_VERSION, prompt: COMPANIONSHIP_PROMPT, schema: COMPANIONSHIP_SCHEMA, validateInput: validateCompanionshipInput, validateOutput: validateCompanionshipOutput, llm }) }
