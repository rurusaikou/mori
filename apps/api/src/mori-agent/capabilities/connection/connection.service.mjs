/** 将 Connection 专属 Prompt、Schema 和校验器组装为独立执行服务。 */
import { createCapabilityExecutor } from '../../shared/executor.mjs'
import { CONNECTION_PROMPT, CONNECTION_PROMPT_VERSION } from './connection.prompt.mjs'
import { CONNECTION_SCHEMA, validateConnectionInput, validateConnectionOutput } from './connection.types.mjs'
export function createConnectionCapability(llm) { return createCapabilityExecutor({ capability: 'connection', promptVersion: CONNECTION_PROMPT_VERSION, prompt: CONNECTION_PROMPT, schema: CONNECTION_SCHEMA, validateInput: validateConnectionInput, validateOutput: validateConnectionOutput, llm }) }
