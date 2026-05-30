"""Check tool schemas for Groq incompatibilities."""
import json, sys
from app.tools.db_tools import get_tools_for_llm
from app.providers.base import normalize_tools_to_openai_schema

tools = get_tools_for_llm()
schemas = normalize_tools_to_openai_schema(tools)

print(f"Total tools: {len(schemas)}")
issues = []
for s in schemas:
    fname = s.get("function", {}).get("name", "?")
    params = s.get("function", {}).get("parameters", {}).get("properties", {})
    for pname, pval in params.items():
        if "default" in pval:
            issues.append(f"  {fname}.{pname} has 'default'={pval['default']!r}")
        if "anyOf" in pval:
            issues.append(f"  {fname}.{pname} uses 'anyOf' (not supported)")

if issues:
    print("ISSUES FOUND (Groq rejects these):")
    for i in issues:
        print(i)
else:
    print("No schema issues found.")

# Print first bad schema fully
print("\n--- Schema dump (first 3 tools) ---")
for s in schemas[:3]:
    print(json.dumps(s, indent=2))
