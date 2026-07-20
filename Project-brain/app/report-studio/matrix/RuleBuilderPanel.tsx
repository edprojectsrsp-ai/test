"use client";

/**
 * Visual rule builder (react-querybuilder) themed to the Furnace tokens.
 * Adds two Matrix-specific affordances on top of stock RQB:
 *   · rule references — the pseudo-field "Reuse rule…" whose value editor is
 *     a select over the published rule library (encoded __ruleref__/ref)
 *   · period tokens  — date/number values may be '@fy_start' etc.; a per-rule
 *     "FY" toggle swaps the input for a token select
 * Conversion to/from the engine's condition JSON lives in ruleConvert.ts
 * (unit-tested round-trip incl. NOT groups, between, tokens, refs).
 */

import { useMemo } from "react";
import { QueryBuilder, RuleGroupType, RuleType } from "react-querybuilder";
import { RULEREF_FIELD, TOKENS } from "./ruleConvert";

type Field = { key: string; label: string; type: string };
type LibRule = { rule_key: string; rule_name: string };

const OPS: Record<string, { name: string; label: string }[]> = {
  text: [
    ["=", "is"], ["!=", "is not"], ["contains", "contains"],
    ["not_contains", "doesn't contain"], ["starts_with", "starts with"],
    ["ends_with", "ends with"], ["in", "in list"], ["not_in", "not in list"],
    ["is_null", "is blank"], ["not_null", "is not blank"],
  ].map(([name, label]) => ({ name, label })),
  number: [
    ["=", "="], ["!=", "≠"], [">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"],
    ["between", "between"], ["in", "in list"],
    ["is_null", "is blank"], ["not_null", "is not blank"],
  ].map(([name, label]) => ({ name, label })),
  date: [
    ["=", "on"], ["!=", "not on"], [">", "after"], [">=", "on or after"],
    ["<", "before"], ["<=", "on or before"], ["between", "between"],
    ["is_null", "is blank"], ["not_null", "is not blank"],
  ].map(([name, label]) => ({ name, label })),
};

export default function RuleBuilderPanel({ query, onChange, fields, libRules, excludeRuleKey }: {
  query: RuleGroupType;
  onChange: (q: RuleGroupType) => void;
  fields: Field[];
  libRules: LibRule[];
  excludeRuleKey?: string;
}) {
  const rqbFields = useMemo(() => [
    { name: RULEREF_FIELD, label: "↪ Reuse rule…" },
    ...fields.map((f) => ({ name: f.key, label: f.label })),
  ], [fields]);
  const typeOf = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.type])), [fields]);

  return (
    <div className="mx-rqb">
      <style>{`
        .mx-rqb .ruleGroup { background: var(--panel-2); border: 1px solid var(--line);
          border-radius: 9px; padding: 8px; }
        .mx-rqb .ruleGroup .ruleGroup { background: var(--panel); }
        .mx-rqb .ruleGroup-header, .mx-rqb .rule { display: flex; gap: 6px;
          align-items: center; margin: 4px 0; flex-wrap: wrap; }
        .mx-rqb select, .mx-rqb input { background: var(--panel); border: 1px solid var(--line);
          border-radius: 7px; color: var(--ink); font-size: 12px; padding: 5px 8px; outline: none; }
        .mx-rqb input:focus, .mx-rqb select:focus { border-color: var(--steel); }
        .mx-rqb button { background: transparent; border: 1px solid var(--line);
          border-radius: 7px; color: var(--ink-2); font-size: 11.5px; font-weight: 700;
          padding: 4px 9px; cursor: pointer; }
        .mx-rqb button:hover { border-color: var(--steel); color: var(--steel); }
        .mx-rqb .rule-remove, .mx-rqb .ruleGroup-remove { color: var(--ink-4);
          border: none; font-size: 14px; padding: 2px 6px; }
        .mx-rqb .ruleGroup-notToggle { font-size: 11.5px; color: var(--ink-3);
          display: inline-flex; gap: 4px; align-items: center; }
      `}</style>
      <QueryBuilder
        query={query}
        onQueryChange={onChange}
        fields={rqbFields}
        showNotToggle
        getOperators={(field) => {
          if (field === RULEREF_FIELD) return [{ name: "ref", label: "matches" }];
          return OPS[typeOf[field] || "text"] || OPS.text;
        }}
        getValueEditorType={(field) => (field === RULEREF_FIELD ? "select" : "text")}
        getValues={(field) => field === RULEREF_FIELD
          ? libRules.filter((r) => r.rule_key !== excludeRuleKey)
              .map((r) => ({ name: r.rule_key, label: r.rule_name }))
          : []}
        controlElements={{
          valueEditor: (props) => {
            const { field, operator, value, handleOnChange } = props;
            if (operator === "is_null" || operator === "not_null") return null;
            if (field === RULEREF_FIELD) {
              return (
                <select value={String(value ?? "")} onChange={(e) => handleOnChange(e.target.value)}>
                  <option value="">rule…</option>
                  {libRules.filter((r) => r.rule_key !== excludeRuleKey).map((r) => (
                    <option key={r.rule_key} value={r.rule_key}>{r.rule_name}</option>
                  ))}
                </select>
              );
            }
            const isToken = typeof value === "string" && value.startsWith("@");
            const ftype = typeOf[field];
            return (
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {isToken ? (
                  <select value={value} onChange={(e) => handleOnChange(e.target.value)}>
                    {TOKENS.map((t) => <option key={t} value={`@${t}`}>{t}</option>)}
                  </select>
                ) : (
                  <input
                    value={value ?? ""}
                    placeholder={operator === "between" || operator === "in"
                      ? "a, b" : ftype === "date" ? "YYYY-MM-DD" : "value"}
                    onChange={(e) => handleOnChange(e.target.value)}
                    style={{ width: 150 }}
                  />
                )}
                {(ftype === "date" || ftype === "number") && (
                  <button type="button" title="Toggle period token (fy_start, report_date…)"
                          onClick={() => handleOnChange(isToken ? "" : "@fy_start")}>
                    FY
                  </button>
                )}
              </span>
            );
          },
        }}
        translations={{
          addRule: { label: "+ Condition", title: "Add condition" },
          addGroup: { label: "+ Group", title: "Add nested group" },
          removeRule: { label: "×", title: "Remove" },
          removeGroup: { label: "×", title: "Remove group" },
          notToggle: { label: "NOT", title: "Invert this group" },
        }}
      />
    </div>
  );
}
