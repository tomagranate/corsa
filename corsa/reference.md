# corsa Skill Reference

This file provides copy-paste snippets for common user workflows.

## 1) First-Time Setup

```bash
# Install (choose one)
brew install tomagranate/tap/corsa
# or
npm install -g @tomagranate/corsa

# In your project:
corsa init
```

Minimal `corsa.config.toml`:

```toml
[[tools]]
name = "app"
command = "npm"
args = ["run", "dev"]
```

Start dashboard:

```bash
corsa
```

## 2) Process Inspection and Debugging

List processes:

```bash
corsa ctl list
```

Get logs:

```bash
corsa ctl logs app --lines 200
```

Search logs:

```bash
corsa ctl logs app --search ERROR --search-type substring
corsa ctl logs app --search database --search-type fuzzy
```

Recover process:

```bash
corsa ctl restart app
```

## 3) Apply Config Changes

After editing `corsa.config.toml`:

```bash
corsa ctl reload
```

## 4) MCP Setup for AI Clients

Enable MCP in config:

```toml
[mcp]
enabled = true
port = 18765
```

Start MCP server:

```bash
corsa mcp
```

When multiple API-enabled corsa instances are running, start or target a named instance:

```bash
corsa --id web
corsa mcp --id web
corsa ctl instances
corsa ctl --id web list
```

Example MCP client entry:

```json
{
  "mcpServers": {
    "corsa": {
      "command": "corsa",
      "args": ["mcp"]
    }
  }
}
```

## 5) MCP Tool Mapping

- Inspect compact process status -> `list_processes`
- Inspect logs -> `get_logs`
- Stop/restart process -> `stop_process`, `restart_process`
- Clear logs -> `clear_logs`
- Send input to interactive process -> `send_keys`
- Apply config edits -> `reload_config`
