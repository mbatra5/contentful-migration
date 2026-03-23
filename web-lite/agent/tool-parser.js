import { TOOL_DEFS } from './tool-definitions.js';

/**
 * Fallback parser: extracts a tool call from LLM text output when the model
 * returns tool calls as plain text instead of structured tool_calls.
 */
export function tryParseToolCallFromText(text) {
  if (!text) return null;

  const patterns = [
    /\{"name"\s*:\s*"(\w+)"\s*,\s*"(?:parameters|arguments)"\s*:\s*(\{[^}]+\})\}/s,
    /\{"function"\s*:\s*\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\}\}/s,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      try { return { name: m[1], args: JSON.parse(m[2]) }; } catch { /* skip */ }
    }
  }

  const jsonBlocks = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g);
  if (jsonBlocks) {
    for (const block of jsonBlocks) {
      const inner = block.replace(/```(?:json)?\s*/, '').replace(/\s*```$/, '');
      try {
        const obj = JSON.parse(inner);
        if (obj.name && (obj.parameters || obj.arguments)) return { name: obj.name, args: obj.parameters || obj.arguments };
        if (obj.function?.name) return {
          name: obj.function.name,
          args: typeof obj.function.arguments === 'string' ? JSON.parse(obj.function.arguments) : obj.function.arguments,
        };
      } catch { /* skip */ }
    }
  }

  const toolNames = TOOL_DEFS.map(t => t.function.name);
  for (const tn of toolNames) {
    const re = new RegExp(`["']?${tn}["']?\\s*[:(]\\s*(\\{[\\s\\S]*?\\})`, 'i');
    const m2 = text.match(re);
    if (m2) { try { return { name: tn, args: JSON.parse(m2[1]) }; } catch { /* skip */ } }
  }

  return null;
}
