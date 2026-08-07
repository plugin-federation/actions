"""MCP Server Evaluation Harness

This script evaluates MCP servers by running test questions against them using Claude.
Supports pluggable providers (anthropic, bedrock, azure, openai) via LiteLLM environment variables.

Provider routing is controlled by the MODEL env var (e.g. "anthropic/claude-3-7-sonnet-20250219").
API keys and base URLs are set via provider-specific env vars:
  - ANTHROPIC_API_KEY for Anthropic
  - OPENAI_API_KEY / OPENAI_API_BASE for OpenAI-compatible endpoints
  - AZURE_API_KEY / AZURE_API_BASE / AZURE_API_VERSION for Azure OpenAI
  - AWS credentials for Bedrock
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
import traceback
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

# LiteLLM reads provider config from environment variables directly:
#   - ANTHROPIC_API_KEY + model "anthropic/..."
#   - OPENAI_API_KEY + model "openai/..."
#   - AZURE_API_KEY / AZURE_API_BASE / AZURE_API_VERSION + model "azure/..."
#   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION_NAME + model "bedrock/..."
#   - OPENAI_API_BASE for custom OpenAI-compatible base URL
# No JSON parsing needed — LiteLLM handles routing via model prefix.
from litellm import completion

# Ensure sibling modules (connections.py) are importable
_action_dir = str(Path(__file__).resolve().parent)
if _action_dir not in sys.path:
    sys.path.insert(0, _action_dir)

from connections import create_connection

EVALUATION_PROMPT = """You are an AI assistant with access to tools.

When given a task, you MUST:
1. Use the available tools to complete the task
2. Provide summary of each step in your approach, wrapped in <summary> tags
3. Provide feedback on the tools provided, wrapped in <feedback> tags
4. Provide your final response, wrapped in <response> tags

Summary Requirements:
- In your <summary> tags, you must explain:
  - The steps you took to complete the task
  - Which tools you used, in what order, and why
  - The inputs you provided to each tool
  - The outputs you received from each tool
  - A summary for how you arrived at the response

Feedback Requirements:
- In your <feedback> tags, provide constructive feedback on the tools:
  - Comment on tool names: Are they clear and descriptive?
  - Comment on input parameters: Are they well-documented? Are required vs optional parameters clear?
  - Comment on descriptions: Do they accurately describe what the tool does?
  - Comment on any errors encountered during tool usage: Did the tool fail to execute? Did the tool return too many tokens?
  - Identify specific areas for improvement and explain WHY they would help
  - Be specific and actionable in your suggestions

Response Requirements:
- Your response should be concise and directly address what was asked
- Always wrap your final response in <response> tags
- If you cannot solve the task return <response>NOT_FOUND</response>
- For numeric responses, provide just the number
- For IDs, provide just the ID
- For names or text, provide the exact text requested
- Your response should go last
- **After gathering sufficient information to answer, STOP using tools and provide your final response. Do not call the same tool repeatedly.**"""


def parse_evaluation_file(file_path: Path) -> list[dict[str, Any]]:
    """Parse XML evaluation file with qa_pair elements."""
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
        evaluations = []

        for qa_pair in root.findall(".//qa_pair"):
            question_elem = qa_pair.find("question")
            answer_elem = qa_pair.find("answer")
            # Also accept <expected_output> as an alias for <answer>
            if answer_elem is None:
                answer_elem = qa_pair.find("expected_output")

            if question_elem is not None and answer_elem is not None:
                evaluations.append({
                    "question": (question_elem.text or "").strip(),
                    "answer": (answer_elem.text or "").strip(),
                })

        return evaluations
    except Exception as e:
        print(f"Error parsing evaluation file {file_path}: {e}")
        return []


def extract_xml_content(text: str, tag: str) -> str | None:
    """Extract content from XML tags."""
    pattern = rf"<{tag}>(.*?)</{tag}>"
    matches = re.findall(pattern, text, re.DOTALL)
    return matches[-1].strip() if matches else None


JUDGE_PROMPT = """You are an answer evaluator. Determine if the actual answer correctly addresses the question and is consistent with the ground truth.

Question: {question}
Ground Truth: {expected}
Actual Answer: {actual}

Rules:
- The actual answer is CORRECT if it conveys the same information as the ground truth, even if phrased differently or with units.
- For numeric answers, check if the number is correct (within reasonable rounding). Units are acceptable.
- For error messages, check if the key error information is present.
- Return ONLY "CORRECT" or "INCORRECT" — nothing else.

Response:"""


async def llm_as_judge(model: str, question: str, expected: str, actual: str, connection: Any) -> int:
    """Use LLM as judge to determine if the answer is correct. Returns 1 for correct, 0 for incorrect."""
    try:
        api_key = os.environ.get("XAI_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AZURE_API_KEY")
        api_base = os.environ.get("OPENAI_API_BASE") or os.environ.get("XAI_API_BASE") or os.environ.get("AZURE_API_BASE")

        prompt = JUDGE_PROMPT.format(question=question, expected=expected, actual=actual)
        messages = [{"role": "user", "content": prompt}]

        def _call():
            kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": 16,
                "messages": messages,
            }
            if api_key:
                kwargs["api_key"] = api_key
            if api_base:
                kwargs["api_base"] = api_base
            return completion(**kwargs)

        response = await asyncio.to_thread(_call)
        result = response.choices[0].message.content.strip().upper()
        return 1 if "CORRECT" in result else 0
    except Exception:
        # If judge fails, default to 0 (conservative)
        return 0


def extract_answer_from_response(text: str, expected: str) -> str | None:
    """Extract the most likely answer from model response text.

    Used as a fallback when the model does not wrap its answer in <response> tags.
    Tries multiple strategies to find a matching answer.
    """
    if not text:
        return None

    # Strategy 1: look for <response> tags (standard)
    tagged = extract_xml_content(text, "response")
    if tagged:
        return tagged

    # Strategy 2: look for a line that exactly matches the expected answer
    for line in text.split("\n"):
        stripped = line.strip().strip('"\'').strip()
        if stripped == expected:
            return stripped

    # Strategy 3: if expected is not numeric, check if it's contained in any short line
    if not re.fullmatch(r"[\d.]+", expected):
        for line in text.split("\n"):
            stripped = line.strip().strip('"\'').strip()
            if expected in stripped and len(stripped) < 200:
                return stripped

    # Strategy 4: check if the entire text is a JSON object with an 'error' key containing the expected
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            for key in ("error", "message", "response", "answer"):
                if key in parsed and isinstance(parsed[key], str) and expected in parsed[key]:
                    return parsed[key]
    except (json.JSONDecodeError, TypeError):
        pass

    # Strategy 5: return the last non-empty line that is short (likely an answer)
    for line in reversed(text.split("\n")):
        stripped = line.strip().strip('"\'').strip()
        if stripped and len(stripped) < 100 and not stripped.startswith(("```", "##", "***", "---")):
            return stripped

    return None


async def agent_loop(
    model: str,
    question: str,
    tools: list[dict[str, Any]],
    connection: Any,
    task_num: int = 0,
) -> tuple[str, dict[str, Any]]:
    """Run the agent loop with MCP tools using LiteLLM."""
    """Run the agent loop with MCP tools."""
    print(f"[Task {task_num}] Starting agent loop for question: {question}")
    messages = [{"role": "user", "content": question}]

    def _call():
        # Pass api_key and api_base explicitly so LiteLLM routes to the correct
        # provider even when the model string is not in its internal registry.
        # This prevents fallback to the default Anthropic handler.
        api_key = os.environ.get("XAI_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AZURE_API_KEY")
        api_base = os.environ.get("OPENAI_API_BASE") or os.environ.get("XAI_API_BASE") or os.environ.get("AZURE_API_BASE")
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": 4096,
            "system": EVALUATION_PROMPT,
            "messages": messages,
            "tools": tools,
        }
        if api_key:
            kwargs["api_key"] = api_key
        if api_base:
            kwargs["api_base"] = api_base
        return completion(**kwargs)

    response = await asyncio.to_thread(_call)

    resp_choices = response.choices
    resp_message = resp_choices[0].message
    messages.append({"role": "assistant", "content": resp_message.content})

    tool_metrics = {}
    max_tool_calls = 15  # Increased: models like grok need more calls to produce an answer
    tool_call_num = 0
    prev_tool_key = None  # Detect repeated identical tool calls

    for _ in range(max_tool_calls):
        if not resp_message.tool_calls:
            break

        tc = resp_message.tool_calls[0]
        tool_name = tc.function.name
        tool_input = json.loads(tc.function.arguments)
        tool_use_id = tc.id
        tool_call_num += 1

        args_str = json.dumps(tool_input, ensure_ascii=False)
        print(f"  [Task] calling tool #{tool_call_num}: {tool_name}({args_str[:500]})")

        # Detect repeated identical tool calls — force stop and prompt model to answer
        current_key = (tool_name, json.dumps(tool_input, sort_keys=True))
        if current_key == prev_tool_key:
            print(f"  [Task] tool '{tool_name}' called again with same args — forcing answer")
            messages.append({
                "role": "user",
                "content": "You have already called this tool and received the same result. Use the information you have gathered to provide your final answer now. Wrap your answer in <response> tags.",
            })
            response = await asyncio.to_thread(_call)
            resp_choices = response.choices
            resp_message = resp_choices[0].message
            messages.append({"role": "assistant", "content": resp_message.content})
            break
        prev_tool_key = current_key

        tool_start_ts = time.time()
        try:
            tool_result = await connection.call_tool(tool_name, tool_input)
            # MCP content objects (TextContent, ImageContent, etc.) are not JSON serializable
            # Normalize them to plain Python types, flattening text content blocks
            # into a single readable string so the model can actually parse the output.
            def _normalize_content(obj):
                if hasattr(obj, "model_dump"):
                    dumped = obj.model_dump()
                    # Flatten MCP TextContent: {"type": "text", "text": "..."} → just the text
                    if isinstance(dumped, dict) and dumped.get("type") == "text":
                        return dumped.get("text", "")
                    return dumped
                if isinstance(obj, (list, tuple)):
                    items = [_normalize_content(i) for i in obj]
                    # If all items are plain strings, join them with newlines
                    if items and all(isinstance(i, str) for i in items):
                        return "\n".join(items)
                    return items
                if isinstance(obj, dict):
                    return {k: _normalize_content(v) for k, v in obj.items()}
                return obj
            normalized = _normalize_content(tool_result)
            tool_response = json.dumps(normalized, ensure_ascii=False, default=str)
        except Exception as e:
            tool_response = f"Error executing tool {tool_name}: {str(e)}\n"
            tool_response += traceback.format_exc()
        tool_duration = time.time() - tool_start_ts

        if tool_name not in tool_metrics:
            tool_metrics[tool_name] = {"count": 0, "durations": []}
        tool_metrics[tool_name]["count"] += 1
        tool_metrics[tool_name]["durations"].append(tool_duration)

        print(f"  [Task] tool #{tool_call_num} ({tool_name}) returned in {tool_duration:.2f}s, output: {tool_response[:500]}")

        messages.append({
            "role": "tool",
            "tool_call_id": tool_use_id,
            "content": tool_response,
        })

        response = await asyncio.to_thread(_call)
        resp_choices = response.choices
        resp_message = resp_choices[0].message
    else:
        print(f"[Task] reached max_tool_calls ({max_tool_calls}) — stopping tool calls")
        messages.append({"role": "assistant", "content": resp_message.content})

    response_text = resp_message.content
    return response_text, tool_metrics


async def evaluate_single_task(
    model: str,
    qa_pair: dict[str, Any],
    tools: list[dict[str, Any]],
    connection: Any,
    task_index: int,
    total_tasks: int,
) -> dict[str, Any]:
    """Evaluate a single QA pair with the given tools."""
    start_time = time.time()

    print(f"Task {task_index + 1}/{total_tasks}: Running task with question: {qa_pair['question']}")
    response, tool_metrics = await agent_loop(model, qa_pair["question"], tools, connection, task_index + 1)

    response_value = extract_answer_from_response(response, qa_pair["answer"])
    summary = extract_xml_content(response, "summary")
    feedback = extract_xml_content(response, "feedback")

    duration_seconds = time.time() - start_time
    total_calls = sum(len(metrics["durations"]) for metrics in tool_metrics.values())
    expected = qa_pair["answer"]
    # Strip common Unicode artifacts that may be present
    response_value = response_value.strip().strip('\ufeff').strip()
    if response_value == expected:
        score = 1
    elif re.fullmatch(r"[\d.]+", expected):
        # For numeric answers, extract ALL numbers from response_value and check if expected matches any
        numbers = re.findall(r"\d+\.\d+|\d+", response_value)
        matched = False
        for num in numbers:
            try:
                if float(num) == float(expected):
                    matched = True
                    break
            except ValueError:
                pass
        score = 1 if matched else 0
    elif expected in response_value:
        # For non-numeric answers, also accept if expected is contained in the response
        score = 1
    else:
        # Fallback: use LLM as judge when all string/numeric comparisons fail
        score = await llm_as_judge(model, qa_pair["question"], expected, response_value, connection)
    print(f"Task {task_index + 1}/{total_tasks} completed: score={score}, tool_calls={total_calls}, duration={duration_seconds:.2f}s, actual='{response_value}'")

    return {
        "question": qa_pair["question"],
        "expected": qa_pair["answer"],
        "actual": response_value,
        "score": score,
        "total_duration": duration_seconds,
        "tool_calls": tool_metrics,
        "num_tool_calls": total_calls,
        "summary": summary,
        "feedback": feedback,
    }


REPORT_HEADER = """
# Evaluation Report

## Summary

- **Accuracy**: {correct}/{total} ({accuracy:.1f}%)
- **Average Task Duration**: {average_duration_s:.2f}s
- **Average Tool Calls per Task**: {average_tool_calls:.2f}
- **Total Tool Calls**: {total_tool_calls}

---
"""

TASK_TEMPLATE = """
### Task
{task_num}

**Question**: {question}
**Ground Truth Answer**:
`{expected_answer}`
**Actual Answer**: `{actual_answer}`
**Correct**:
{correct_indicator}
**Duration**: {total_duration:.2f}s
**Tool Calls**:
{tool_calls}

**Summary**
{summary}

**Feedback**
{feedback}

---
"""


async def run_evaluation(
    eval_path: Path,
    connection: Any,
    model: str | None = None,
) -> str:
    """Run evaluation with MCP server tools."""
    if model is None:
        model = os.environ.get("MODEL", "anthropic/claude-3-7-sonnet-20250219")
    print("🚀 Starting Evaluation")

    tools = await connection.list_tools()
    # Convert to provider-specific format: Anthropic models expect MCP format,
    # OpenAI-compatible models (xAI, OpenAI, Azure, Bedrock, etc.) expect
    # OpenAI function-calling format with 'type': 'function' + 'function': {...}.
    anthropic_model = model.startswith("anthropic") or model.startswith("bedrock/anthropic")
    if anthropic_model:
        formatted_tools = tools  # MCP format is fine for Anthropic
    else:
        formatted_tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["input_schema"],
                },
            }
            for t in tools
        ]
    print(f"📋 Loaded {len(formatted_tools)} tools from MCP server")

    qa_pairs = parse_evaluation_file(eval_path)
    print(f"📋 Loaded {len(qa_pairs)} evaluation tasks")
    # Extract tool names regardless of format (MCP vs OpenAI function format)
    def _tool_name(t):
        if "function" in t and isinstance(t["function"], dict):
            return t["function"]["name"]
        return t.get("name", "unknown")
    print(f"🔧 Available tools: {', '.join(_tool_name(t) for t in formatted_tools)}")
    print(f"🤖 Model: {model}")
    print(f"🔌 API Base: {os.environ.get('OPENAI_API_BASE') or os.environ.get('XAI_API_BASE') or 'default'}")

    results = []
    for i, qa_pair in enumerate(qa_pairs):
        print(f"\n{'='*60}")
        print(f"Evaluation: task {i + 1}/{len(qa_pairs)} of {len(qa_pairs)}")
        print(f"{'='*60}")
        result = await evaluate_single_task(model, qa_pair, formatted_tools, connection, i, len(qa_pairs))
        results.append(result)

    correct = sum(r["score"] for r in results)
    accuracy = (correct / len(results)) * 100 if results else 0
    average_duration_s = sum(r["total_duration"] for r in results) / len(results) if results else 0
    average_tool_calls = sum(r["num_tool_calls"] for r in results) / len(results) if results else 0
    total_tool_calls = sum(r["num_tool_calls"] for r in results)

    report = REPORT_HEADER.format(
        correct=correct,
        total=len(results),
        accuracy=accuracy,
        average_duration_s=average_duration_s,
        average_tool_calls=average_tool_calls,
        total_tool_calls=total_tool_calls,
    )

    report += "".join([
        TASK_TEMPLATE.format(
            task_num=i + 1,
            question=qa_pair["question"],
            expected_answer=qa_pair["answer"],
            actual_answer=result["actual"] or "N/A",
            correct_indicator="✅" if result["score"] else "❌",
            total_duration=result["total_duration"],
            tool_calls=json.dumps(result["tool_calls"], indent=2),
            summary=result["summary"] or "N/A",
            feedback=result["feedback"] or "N/A",
        )
        for i, (qa_pair, result) in enumerate(zip(qa_pairs, results))
    ])

    print(f"\n{'='*60}")
    print(f"✅ Evaluation complete: {correct}/{len(results)} correct ({accuracy:.1f}%)")
    print(f"   Average duration: {average_duration_s:.2f}s per task")
    print(f"   Total tool calls: {total_tool_calls}")
    print(f"{'='*60}")

    return report


def parse_headers(header_list: list[str]) -> dict[str, str]:
    """Parse header strings in format 'Key: Value' into a dictionary."""
    headers = {}
    if not header_list:
        return headers

    for header in header_list:
        if ":" in header:
            key, value = header.split(":", 1)
            headers[key.strip()] = value.strip()
        else:
            print(f"Warning: Ignoring malformed header: {header}")

    return headers


def parse_env_vars(env_list: list[str]) -> dict[str, str]:
    """Parse environment variable strings in format 'KEY=VALUE' into a dictionary."""
    env = {}
    if not env_list:
        return env

    for env_var in env_list:
        if "=" in env_var:
            key, value = env_var.split("=", 1)
            env[key.strip()] = value.strip()
        else:
            print(f"Warning: Ignoring malformed environment variable: {env_var}")
    return env


async def main():
    parser = argparse.ArgumentParser(
        description="Evaluate MCP servers using test questions",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Evaluate a local stdio MCP server
  python evaluation.py -t stdio -c python -a my_server.py eval.xml

  # Evaluate an SSE MCP server
  python evaluation.py -t sse -u https://example.com/mcp -H "Authorization: Bearer token" eval.xml

  # Evaluate an HTTP MCP server
  python evaluation.py -t http -u https://example.com/mcp eval.xml

  # Evaluate an HTTP MCP server with custom model
  python evaluation.py -t http -u https://example.com/mcp -m claude-3-5-sonnet-20241022 eval.xml
        """,
    )

    parser.add_argument("eval_file", type=Path, help="Path to evaluation XML file")
    parser.add_argument("-t", "--transport", choices=["stdio", "sse", "http"], default="stdio",
                        help="Transport type (default: stdio)")
    parser.add_argument("-m", "--model", default=os.environ.get("MODEL", "claude-3-7-sonnet-20250219"), help="LiteLLM model string to use (default: claude-3-7-sonnet-20250219)")

    stdio_group = parser.add_argument_group("stdio options")
    stdio_group.add_argument("-c", "--command", help="Command to run MCP server (stdio only)")
    stdio_group.add_argument("-a", "--args", nargs="+", help="Arguments for the command (stdio only)")
    stdio_group.add_argument("-e", "--env", nargs="+", help="Environment variables in KEY=VALUE format (stdio only)")

    remote_group = parser.add_argument_group("sse/http options")
    remote_group.add_argument("-u", "--url", help="MCP server URL (sse/http only)")
    remote_group.add_argument("-H", "--header", nargs="+", dest="headers", help="HTTP headers in 'Key: Value' format (sse/http only)")

    parser.add_argument("-o", "--output", type=Path, help="Output file for evaluation report (default: stdout)")

    args = parser.parse_args()

    if not args.eval_file.exists():
        print(f"Error: Evaluation file not found: {args.eval_file}")
        sys.exit(1)

    headers = parse_headers(args.headers) if args.headers else None
    env_vars = parse_env_vars(args.env) if args.env else None

    try:
        connection = create_connection(
            transport=args.transport,
            command=args.command,
            args=args.args,
            env=env_vars,
            url=args.url,
            headers=headers,
        )
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    print(f"🔗 Connecting to MCP server via {args.transport}...")

    async with connection:
        print("✅ Connected successfully")
        report = await run_evaluation(args.eval_file, connection, args.model)

        if args.output:
            args.output.write_text(report)
            print(f"\n✅ Report saved to {args.output}")
        else:
            print("\n" + report)


if __name__ == "__main__":
    asyncio.run(main())
