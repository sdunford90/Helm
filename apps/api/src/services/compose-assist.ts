// Plan 33 — Email/message draft rewriter.
//
// One-shot call per request: caller passes a draft + tone preset + optional
// context. We pass them to Claude with a tone-tuned instruction and return
// the rewrite. No streaming, no conversation memory.
//
// Note on caching: Haiku 4.5 has a 4096-token minimum cacheable prefix; our
// system prompt is well below that, so cache_control would be a no-op even
// if the installed SDK typed it. If the preamble ever grows past the floor,
// add `cache_control: {type: "ephemeral"}` on the system text block — the
// API accepts it at runtime even though older SDK types omit it.

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ComposeTone = "friendly" | "firm" | "formal" | "concise";

export interface ComposeAssistArgs {
  draft: string;
  tone: ComposeTone;
  /** Optional one-paragraph hint about who this is going to and why. */
  context?: string;
}

export interface ComposeAssistResult {
  rewritten: string;
  tone: ComposeTone;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

const TONE_GUIDE: Record<ComposeTone, string> = {
  friendly:
    "Warm and approachable. Use first names if present, contractions, and a conversational rhythm. Acknowledge the recipient's situation before stating yours.",
  firm:
    "Direct and unambiguous. Lead with the outcome you need or the position you're holding. No hedging, no apologies for setting limits. Stay professional — firm is not rude.",
  formal:
    "Polished, business-formal register. Full sentences, no contractions, no slang. Greet and sign off properly. Avoid emoji.",
  concise:
    "Cut every word that isn't load-bearing. Aim for one short paragraph or a bulleted list. Preserve every concrete fact, name, date, and dollar amount from the draft.",
};

const SYSTEM_PROMPT = `You rewrite staff-authored emails, SMS, and short customer messages for a marina-management product.

Rules every rewrite must follow:
- Never invent facts. Names, dates, dollar amounts, slip numbers, and contact details in the draft are authoritative — copy them through verbatim.
- Never add a signature line or sign-off unless the draft contained one.
- Never add or remove the greeting line; if the draft has no greeting, the rewrite has none either.
- If the draft contains a question, the rewrite must contain a question.
- If the draft asks for action, the rewrite must ask for the same action.
- Output the rewritten message only. No preamble like "Here is the rewrite:". No quotation marks around the result.
- If the draft is empty or unintelligible, output exactly: NO_DRAFT.

You will receive a tone preset and an optional context paragraph. Apply the tone faithfully, but never let it override the rules above.`;

export async function composeAssist(args: ComposeAssistArgs): Promise<ComposeAssistResult> {
  const { draft, tone, context } = args;
  const trimmed = draft.trim();
  if (!trimmed) {
    return {
      rewritten: "NO_DRAFT",
      tone,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
  }

  const userMessage = [
    `Tone: ${tone}`,
    `Tone guidance: ${TONE_GUIDE[tone]}`,
    context ? `Context: ${context.trim()}` : null,
    "",
    "Draft to rewrite:",
    trimmed,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return {
    rewritten: text || "NO_DRAFT",
    tone,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedTokens: (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
  };
}
