export interface TextReply {
  content: string;
  prompt_tokens: number;
  completion_tokens: number;
  neurons?: number;
}
export interface TextWriter {
  write(prompt: string, facts: unknown, maxTokens: number): Promise<TextReply>;
}
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}
export const NEURONS_PER_INPUT_TOKEN = 4625 / 1e6;
export const NEURONS_PER_OUTPUT_TOKEN = 30475 / 1e6;
export function neuronsFor(prompt: number, completion: number): number {
  return (
    prompt * NEURONS_PER_INPUT_TOKEN + completion * NEURONS_PER_OUTPUT_TOKEN
  );
}
export const MODEL_NAME = "@cf/qwen/qwen3-30b-a3b-fp8";

export class BoundTextWriter implements TextWriter {
  constructor(private binding: AiBinding) {}
  async write(
    prompt: string,
    facts: unknown,
    maxTokens: number,
  ): Promise<TextReply> {
    const raw = (await this.binding.run(MODEL_NAME, {
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(facts) },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      chat_template_kwargs: { enable_thinking: false },
    })) as ModelReply;
    const content = readContent(raw);
    return {
      content,
      prompt_tokens: raw.usage?.prompt_tokens ?? 0,
      completion_tokens: raw.usage?.completion_tokens ?? 0,
      ...(typeof raw.usage?.neurons === "number"
        ? { neurons: raw.usage.neurons }
        : {}),
    };
  }
}

interface ModelReply {
  choices?: {
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }[];
  response?: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    neurons?: number;
  };
}

function readContent(reply: ModelReply): string {
  if (!reply || typeof reply !== "object")
    throw new Error("Invalid text reply");
  if (
    reply.choices !== undefined &&
    (!Array.isArray(reply.choices) ||
      !reply.choices[0]?.message ||
      typeof reply.choices[0].message !== "object")
  )
    throw new Error("Invalid text reply");
  if (
    reply.response !== undefined &&
    reply.response !== null &&
    typeof reply.response !== "string"
  )
    throw new Error("Invalid text reply");
  const message = reply.choices?.[0]?.message;
  const choice = message?.content;
  if (choice !== undefined && choice !== null && typeof choice !== "string") {
    throw new Error("Invalid text reply");
  }
  let content = choice ?? reply.response ?? "";
  if (!content.trim()) {
    content = message?.reasoning ?? message?.reasoning_content ?? "";
  }
  content = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^[\s\S]*<\/think>/, "")
    .trim();
  if (!content) throw new Error("Empty text reply");
  return content;
}
