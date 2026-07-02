---
name: corsa
description: Help users install, configure, and operate corsa for local development process management. Use when the user asks about corsa setup, corsa.config.toml authoring, process status/log debugging, MCP integration, or controlling running processes via corsa CLI or MCP tools.
---

# corsa User Guide

Use this skill when the user is working with `corsa` as an end user.

## Scope

- Setup and installation guidance
- `corsa.config.toml` authoring and updates
- Process inspection and debugging via `corsa ctl`
- MCP setup and usage through `corsa mcp`

## Preferred Workflow

1. Identify the user goal:
   - First-time setup
   - Config authoring/editing
   - Process/log debugging
   - MCP/AI integration
2. For automation/agent use cases, prefer the CLI, but mention MCP tools as an option.
3. Keep changes minimal and verify with one clear command.

## Quickstart (Default Path)

Use this sequence unless the user needs something more specific:

```bash
corsa init
# edit corsa.config.toml to define at least one [[tools]] entry
corsa
```

If the user wants an MCP integration:

1. Enable MCP in config:
   - `[mcp]`
   - `enabled = true`
   - optional `port = 18765`
2. Start MCP server:
   - `corsa mcp`
   - use `corsa mcp --id <id>` when more than one API-enabled corsa instance is running.
3. Configure MCP client to launch `corsa mcp`.

## Core Commands

Use these stable commands for process operations. For AI automation, use these commands directly to read logs or control processes:

- `corsa ctl instances` to list live API-enabled corsa instances and their IDs
- `corsa ctl list` (aliases: `ps`, `ls`) to inspect compact process status
- `corsa ctl list --name <name> --fields name,status,healthStatus --logs <n>` for a limited status/log preview
- `corsa ctl logs <name> --lines <n> --search <query> --search-type substring|fuzzy`
- `corsa ctl stop <name>` (alias: `rm`)
- `corsa ctl restart <name>`
- `corsa ctl clear <name>`
- `corsa ctl send-keys <name> --key <value>` (repeatable)
- `corsa ctl reload` after config changes
- Add `--json` for machine-readable output

## MCP Tools (Stable)

When the user is using MCP, map tasks to these tools:

- `list_processes`
- `get_logs`
- `stop_process`
- `restart_process`
- `clear_logs`
- `send_keys`
- `reload_config`

Prefer the smallest tool call that answers the user question. `list_processes` is compact by default; request logs or extra fields only when needed.

## Config Authoring Rules

1. Start from `corsa init` output for new projects.
2. Keep each `[[tools]]` block explicit:
   - required: `name`, `command`
   - common: `args`, `cwd`, `description`
3. Add `dependsOn` for startup ordering.
4. Add `[tools.healthCheck]` for readiness-sensitive services.
5. Use `[tools.env]` for per-tool environment variables.
6. Use `[mcp] enabled = true` only when API/MCP access is needed.

## Config Schema Rules

When authoring or editing `corsa.config.toml`, use this source-of-truth order:

1. `schemas/corsa.schema.json` for allowed keys and overall shape.
2. `src/lib/config/schema.ts` for runtime constraints (types, enums, ranges).
3. `src/sample-config.toml` and `src/sample-config-full.toml` for valid patterns.

Guardrails:

- Do not invent undocumented keys.
- If a requested key is not in schema, call it unsupported and offer the nearest supported alternative.
- Prefer schema-backed keys over speculative options.

Before finalizing config guidance, verify:

- Only schema-backed sections/keys are used.
- Examples match established `corsa` config patterns.
- If the user changed config on a running setup, include `corsa ctl reload` and a follow-up `corsa ctl list` verification step.

## Troubleshooting Playbook

Use this order:

1. Confirm process list:
   - `corsa ctl list`
2. Inspect logs:
   - `corsa ctl logs <name> --lines 200`
3. Filter likely errors:
   - `--search error --search-type substring`
4. Restart a bad process:
   - `corsa ctl restart <name>`
5. If config changed:
   - `corsa ctl reload`

If `corsa ctl` cannot connect, check that `corsa` is running and `[mcp].enabled = true` in config.
If multiple live instances are listed, rerun the command with `--id <id>`.

## Additional Resources

- For copy-paste setup snippets and workflow examples, see [reference.md](reference.md)
