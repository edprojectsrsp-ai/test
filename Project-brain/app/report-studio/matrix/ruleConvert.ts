/**
 * Bidirectional converters: Matrix Engine condition JSON <-> react-querybuilder.
 *
 * Engine condition:  {op:'AND'|'OR'|'NOT', conditions:[ {field,op,value} | {rule:key} | group ]}
 * RQB query:         {combinator:'and'|'or', not?:boolean, rules:[ {field,operator,value} | group ]}
 *
 * Special encodings (round-trip safe):
 *   · rule reference  -> RQB rule  {field:'__ruleref__', operator:'ref', value:'<rule_key>'}
 *   · period token    -> value string '@<token>'   e.g. '@fy_start'
 *   · between/in      -> comma-joined string in RQB, array in engine JSON
 *   · NOT group       -> RQB group {combinator:'and', not:true}
 */

export type EngineCond = {
  op?: string;
  conditions?: EngineCond[];
  field?: string;
  value?: any;
  rule?: string;
};

export type RQBRule = { field: string; operator: string; value: any };
export type RQBGroup = { combinator: string; not?: boolean; rules: (RQBRule | RQBGroup)[] };

export const RULEREF_FIELD = "__ruleref__";
export const TOKENS = ["report_date", "fy_start", "fy_end", "prev_fy_start",
                       "prev_fy_end", "one_year_before_report"];

const ARRAY_OPS = new Set(["between", "not_between", "in", "not_in"]);

function encodeValue(v: any): any {
  if (v && typeof v === "object" && "token" in v) return `@${v.token}`;
  if (Array.isArray(v)) return v.map(encodeValue).join(",");
  return v;
}

function decodeScalar(s: any, wantNumber: boolean): any {
  if (typeof s === "string" && s.startsWith("@")) return { token: s.slice(1) };
  if (wantNumber && s !== "" && s !== null && !isNaN(Number(s))) return Number(s);
  return s;
}

export function engineToRQB(cond: EngineCond | null | undefined): RQBGroup {
  if (!cond) return { combinator: "and", rules: [] };
  const op = (cond.op || "AND").toUpperCase();
  const group: RQBGroup = {
    combinator: op === "OR" ? "or" : "and",
    not: op === "NOT" || undefined,
    rules: [],
  };
  for (const c of cond.conditions || []) {
    if (c.rule !== undefined) {
      group.rules.push({ field: RULEREF_FIELD, operator: "ref", value: c.rule });
    } else if (c.conditions !== undefined) {
      group.rules.push(engineToRQB(c));
    } else {
      group.rules.push({ field: c.field!, operator: c.op || "=",
                         value: encodeValue(c.value) });
    }
  }
  return group;
}

export function rqbToEngine(group: RQBGroup,
                            fieldTypes: Record<string, string>): EngineCond {
  const out: EngineCond = {
    op: group.not ? "NOT" : (group.combinator || "and").toUpperCase(),
    conditions: [],
  };
  for (const r of group.rules || []) {
    if ("rules" in r) {
      out.conditions!.push(rqbToEngine(r as RQBGroup, fieldTypes));
      continue;
    }
    const rule = r as RQBRule;
    if (rule.field === RULEREF_FIELD) {
      out.conditions!.push({ rule: String(rule.value) });
      continue;
    }
    const wantNumber = fieldTypes[rule.field] === "number";
    if (rule.operator === "is_null" || rule.operator === "not_null") {
      out.conditions!.push({ field: rule.field, op: rule.operator });
      continue;
    }
    let value: any;
    if (ARRAY_OPS.has(rule.operator)) {
      value = String(rule.value ?? "").split(",").map((s) => s.trim())
        .filter((s) => s !== "").map((s) => decodeScalar(s, wantNumber));
    } else {
      value = decodeScalar(rule.value, wantNumber);
    }
    out.conditions!.push({ field: rule.field, op: rule.operator, value });
  }
  return out;
}
