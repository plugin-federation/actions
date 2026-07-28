# Rule reference (`PFMTL-*`)

Normative product summary:
[plugin-federation monorepo component doc](https://github.com/plugin-federation/plugin-federation/blob/main/docs/components/mcp-tools-list-validate-action.md).

## Authority for each rule

| Source | What it covers |
|---|---|
| MCP JSON Schema **2025-06-18** `Tool` | Structural types: required `name`+`inputSchema`, `inputSchema.type` const `"object"`, optional `title`/`description`/`outputSchema`/`annotations`/`_meta` |
| **SEP-986** (Final) tool name format | Name charset + **1–64** length (`A–Z a–z 0–9 _ - . /`) |
| Plugin Federation composition | Catalog max tools, uniqueness, description length, envelope fields, Ajv usability |

> **Note:** The 2025-06-18 machine schema still types `name` as unconstrained `string`. SEP-986 is the Final standards-track format rule we enforce for names. Later prose (2025-11-25) uses max **128** and drops `/`; this Action keeps the **tighter SEP-986 (64 + `/`)** rule.

## Audit status

| ruleId | Valid? | Authority | Notes |
|---|---|---|---|
| `PFMTL-PAGE-001` | **Yes** | MCP pagination | Residual `nextCursor` ⇒ incomplete export |
| `PFMTL-CAT-001` | **Yes (PF)** | Composition max 5000 | Not an MCP limit; warning under `mcp` |
| `PFMTL-CAT-002` | **Yes** | MCP uniqueness SHOULD; composition MUST | Duplicate `name` in list |
| `PFMTL-TOOL-001` | **Yes** | MCP `Tool` type object | |
| `PFMTL-TOOL-002` | **Yes** | MCP required `name` string | Presence/type only |
| `PFMTL-TOOL-014` | **Yes** | SEP-986 min length 1 | Empty string invalid |
| `PFMTL-TOOL-003` | **Yes (fixed)** | **SEP-986** charset | Was wrong: used monorepo `toolName` allowing `:` and forbidding `/` |
| `PFMTL-TOOL-004` | **Yes (fixed)** | **SEP-986** max **64** | Was wrong: max **255** from monorepo composition |
| `PFMTL-TOOL-005` | **Yes (PF)** | Composition ≤4000 | Not MCP-mandated; warning under `mcp` |
| `PFMTL-TOOL-006` | **Yes** | MCP `description` type string | |
| `PFMTL-TOOL-007` | **Yes** | MCP required `inputSchema` object | |
| `PFMTL-TOOL-008` | **Yes** | MCP `inputSchema.type` const `"object"` | |
| `PFMTL-TOOL-009` | **Yes** | MCP schema shape for `properties` | |
| `PFMTL-TOOL-010` | **Yes** | MCP schema shape for `required` | |
| `PFMTL-TOOL-011` | **Yes** | MCP optional `outputSchema` same object shape | Presence alone never fails |
| `PFMTL-TOOL-012` | **Yes** | MCP optional `title` string | |
| `PFMTL-TOOL-013` | **Yes** | MCP + composition annotations object | |
| `PFMTL-ANN-001` | **Yes** | MCP `ToolAnnotations` field types | |
| `PFMTL-ANN-002` | **Yes** | Forward-compat warning | Unknown annotation keys |
| `PFMTL-SCHEMA-001` | **Yes (quality)** | Ajv compile | Stricter than MCP wire; error under PF |
| `PFMTL-SCHEMA-002` | **Yes (quality)** | Ajv compile | Same for `outputSchema` |
| `PFMTL-SCHEMA-003` | **Yes (info)** | Heuristic warning | Empty `properties` |
| `PFMTL-META-001` | **Yes** | 2025-06-18 known Tool keys | Keys beyond that pin warn (newer specs add `icons`/`execution`) |
| `PFMTL-META-002` | **Removed** | — | Never implemented; reserved for multi-version mode |
| `PFMTL-ENV-001` | **Yes (PF)** | Composition envelope | Skip under pure `mcp` list |
| `PFMTL-ENV-002` | **Yes (PF)** | Composition envelope | |
| `PFMTL-SEC-001` | **Yes (heuristic)** | Best-effort warning | Never fail-closed by default |

Monorepo composition and contracts `$defs/toolName` use the same SEP-986 rule.

## Name rules (normative)

```text
MCP tool name = 1..64 chars from [A-Za-z0-9_./-]
```

Examples valid: `get_weather`, `user-profile/update`, `DATA_EXPORT_v2`, `admin.tools.list`  
Examples invalid: `bad name`, `create.item:v1` (colon), names longer than 64

## Rule catalog

| ruleId | code | mcp | plugin-federation | Check |
|---|---|---|---|---|
| PFMTL-PAGE-001 | pfmtl_page_001 | warning | warning | Incomplete list (`nextCursor`) |
| PFMTL-CAT-001 | pfmtl_cat_001 | warning | **error** | Too many tools (default 5000) |
| PFMTL-CAT-002 | pfmtl_cat_002 | error | error | Duplicate tool names |
| PFMTL-TOOL-001 | pfmtl_tool_001 | error | error | Tool entry is object |
| PFMTL-TOOL-002 | pfmtl_tool_002 | error | error | `name` present and string |
| PFMTL-TOOL-014 | pfmtl_tool_014 | error | error | `name` non-empty |
| PFMTL-TOOL-003 | pfmtl_tool_003 | error | error | SEP-986 charset |
| PFMTL-TOOL-004 | pfmtl_tool_004 | error | error | name ≤ **64** |
| PFMTL-TOOL-005 | pfmtl_tool_005 | warning | **error** | description ≤ 4000 |
| PFMTL-TOOL-006 | pfmtl_tool_006 | error | error | description type |
| PFMTL-TOOL-007 | pfmtl_tool_007 | error | error | inputSchema object required |
| PFMTL-TOOL-008 | pfmtl_tool_008 | error | error | inputSchema.type === object |
| PFMTL-TOOL-009 | pfmtl_tool_009 | error | error | properties object |
| PFMTL-TOOL-010 | pfmtl_tool_010 | error | error | required string[] |
| PFMTL-TOOL-011 | pfmtl_tool_011 | error | error | outputSchema shape |
| PFMTL-TOOL-012 | pfmtl_tool_012 | error | error | title string |
| PFMTL-TOOL-013 | pfmtl_tool_013 | error | error | annotations object |
| PFMTL-ANN-001 | pfmtl_ann_001 | error | error | annotation field types |
| PFMTL-ANN-002 | pfmtl_ann_002 | warning | warning | unknown annotation keys |
| PFMTL-SCHEMA-001 | pfmtl_schema_001 | warning | **error** | Ajv inputSchema |
| PFMTL-SCHEMA-002 | pfmtl_schema_002 | warning | **error** | Ajv outputSchema |
| PFMTL-SCHEMA-003 | pfmtl_schema_003 | warning | warning | empty properties |
| PFMTL-META-001 | pfmtl_meta_001 | warning | warning | unknown tool keys |
| PFMTL-ENV-001 | pfmtl_env_001 | skip | **error** | sourceId UUID |
| PFMTL-ENV-002 | pfmtl_env_002 | skip | **error** | sourceVersion 1–255 |
| PFMTL-SEC-001 | pfmtl_sec_001 | warning | warning | secret-like heuristic |

## Anchors

### pfmtl-page-001
### pfmtl-cat-001
### pfmtl-cat-002
### pfmtl-tool-001
### pfmtl-tool-002
### pfmtl-tool-014
### pfmtl-tool-003
### pfmtl-tool-004
### pfmtl-tool-005
### pfmtl-tool-006
### pfmtl-tool-007
### pfmtl-tool-008
### pfmtl-tool-009
### pfmtl-tool-010
### pfmtl-tool-011
### pfmtl-tool-012
### pfmtl-tool-013
### pfmtl-ann-001
### pfmtl-ann-002
### pfmtl-schema-001
### pfmtl-schema-002
### pfmtl-schema-003
### pfmtl-meta-001
### pfmtl-env-001
### pfmtl-env-002
### pfmtl-sec-001
