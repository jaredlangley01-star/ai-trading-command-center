export type AIResearchReport = {
  executiveSummary: string;
  supportingEvidence: string[];
  conflictingEvidence: string[];
  bullCase: string[];
  bearCase: string[];
  catalysts: string[];
  risks: string[];
  invalidation: string[];
  generatedAt: string;
};
export interface AIResearchProvider {
  synthesize(
    verifiedResearch: Record<string, unknown>,
  ): Promise<AIResearchReport | null>;
}
export class OpenAIResponsesResearchProvider implements AIResearchProvider {
  async synthesize(verifiedResearch: Record<string, unknown>) {
    if (!process.env.AI_API_KEY || !process.env.AI_MODEL) return null;
    const response = await fetch(
      `${process.env.AI_API_URL ?? "https://api.openai.com/v1"}/responses`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.AI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL,
          input: [
            {
              role: "system",
              content:
                "Synthesize only the verified JSON supplied. Separate source facts from interpretation. Do not invent facts, URLs, scores, orders, position sizes, approvals, or risk changes. Return JSON with executiveSummary, supportingEvidence, conflictingEvidence, bullCase, bearCase, catalysts, risks, invalidation.",
            },
            { role: "user", content: JSON.stringify(verifiedResearch) },
          ],
          text: { format: { type: "json_object" } },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text = payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text)
      .find(Boolean);
    if (!text) return null;
    try {
      return {
        ...(JSON.parse(text) as Omit<AIResearchReport, "generatedAt">),
        generatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
