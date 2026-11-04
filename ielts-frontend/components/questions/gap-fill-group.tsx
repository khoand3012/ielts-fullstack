import { parseGapContext } from "@/lib/content/gaps";
import { AnswerInput } from "./answer-input";
import type { GroupProps } from "./types";

/** Summary completion: `{n}` markers in the context become inline inputs. */
export function GapFillGroup({ group, answers, onChange }: GroupProps) {
  const tokens = parseGapContext(group.context ?? "");

  return (
    <p className="rounded-lg border p-4 text-sm leading-9">
      {tokens.map((token, i) => {
        if (token.kind === "text") return <span key={i}>{token.text}</span>;
        const value = answers[token.number];
        return (
          <span key={i} id={`q-${token.number}`} className="mx-1 inline-block scroll-mt-28">
            <AnswerInput
              question={token.number}
              value={typeof value === "string" ? value : ""}
              onValueChange={(text) => onChange(token.number, text, { debounce: true })}
              className="w-36"
            />
          </span>
        );
      })}
    </p>
  );
}
