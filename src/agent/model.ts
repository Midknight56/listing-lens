export interface TextReply { content: string; prompt_tokens: number; completion_tokens: number; neurons?: number }
export interface TextWriter { write(prompt: string, facts: unknown, maxTokens: number): Promise<TextReply> }
export interface AiBinding { run(model: string, input: unknown): Promise<unknown> }
export const NEURONS_PER_INPUT_TOKEN = 4625 / 1e6
export const NEURONS_PER_OUTPUT_TOKEN = 30475 / 1e6
export function neuronsFor(prompt: number, completion: number): number { return prompt * NEURONS_PER_INPUT_TOKEN + completion * NEURONS_PER_OUTPUT_TOKEN }
export class BoundTextWriter implements TextWriter {
  constructor(private binding: AiBinding, private name: string) {}
  async write(prompt: string, facts: unknown, maxTokens: number): Promise<TextReply> {
    const raw = await this.binding.run(this.name, { messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(facts) }], max_tokens: maxTokens, temperature: 0.3 }) as { choices?: { message?: { content?: string | null } }[]; response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number } }
    const content = raw.choices?.[0]?.message?.content ?? raw.response ?? ''
    return { content, prompt_tokens: raw.usage?.prompt_tokens ?? 0, completion_tokens: raw.usage?.completion_tokens ?? 0, ...(typeof raw.usage?.neurons === 'number' ? { neurons: raw.usage.neurons } : {}) }
  }
}
