# Rule reference (`PFMTL-*`)

Full matrix and product context:
[plugin-federation monorepo component doc](https://github.com/plugin-federation/plugin-federation/blob/main/docs/components/mcp-tools-list-validate-action.md).

| ruleId | code | Meaning |
|---|---|---|
| PFMTL-PAGE-001 | pfmtl_page_001 | Incomplete list (`nextCursor`) |
| PFMTL-CAT-001 | pfmtl_cat_001 | Too many tools |
| PFMTL-CAT-002 | pfmtl_cat_002 | Duplicate tool names |
| PFMTL-TOOL-001 | pfmtl_tool_001 | Tool entry must be object |
| PFMTL-TOOL-002 | pfmtl_tool_002 | `name` present and string |
| PFMTL-TOOL-014 | pfmtl_tool_014 | `name` must not be empty |
| PFMTL-TOOL-003 | pfmtl_tool_003 | PF `toolName` pattern |
| PFMTL-TOOL-004 | pfmtl_tool_004 | name ≤ 255 scalars |
| PFMTL-TOOL-005 | pfmtl_tool_005 | description ≤ 4000 scalars |
| PFMTL-TOOL-006 | pfmtl_tool_006 | description type |
| PFMTL-TOOL-007 | pfmtl_tool_007 | inputSchema object required |
| PFMTL-TOOL-008 | pfmtl_tool_008 | inputSchema.type === object |
| PFMTL-TOOL-009 | pfmtl_tool_009 | properties object |
| PFMTL-TOOL-010 | pfmtl_tool_010 | required string[] |
| PFMTL-TOOL-011 | pfmtl_tool_011 | outputSchema shape |
| PFMTL-TOOL-012 | pfmtl_tool_012 | title string |
| PFMTL-TOOL-013 | pfmtl_tool_013 | annotations object |
| PFMTL-ANN-001 | pfmtl_ann_001 | annotation field types |
| PFMTL-ANN-002 | pfmtl_ann_002 | unknown annotation keys |
| PFMTL-SCHEMA-001 | pfmtl_schema_001 | Ajv inputSchema |
| PFMTL-SCHEMA-002 | pfmtl_schema_002 | Ajv outputSchema |
| PFMTL-SCHEMA-003 | pfmtl_schema_003 | empty properties |
| PFMTL-META-001 | pfmtl_meta_001 | unknown tool keys |
| PFMTL-META-002 | pfmtl_meta_002 | schema version compat |
| PFMTL-ENV-001 | pfmtl_env_001 | sourceId UUID |
| PFMTL-ENV-002 | pfmtl_env_002 | sourceVersion length |
| PFMTL-SEC-001 | pfmtl_sec_001 | secret-like heuristic |

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
### pfmtl-meta-002
### pfmtl-env-001
### pfmtl-env-002
### pfmtl-sec-001
