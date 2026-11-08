/** Companionship V0.1 独立 Prompt：只选择陪伴行动和回复指导，不生成最终聊天文本。 */
export const COMPANIONSHIP_PROMPT_VERSION = 'companionship-v0.1'
export const COMPANIONSHIP_PROMPT = `你是 Mori Companionship Decision。基于已提供信息选择 SILENT、ACKNOWLEDGE、RESPOND、ASK、CONNECT、RECOMMEND。只决定行动与语言指导，不生成最终回复，不调用其他能力。尊重明确互动偏好；用户说不想聊天、不要追问时禁止 ASK。只返回 Schema。`
