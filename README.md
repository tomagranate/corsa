# corsa

A Terminal User Interface (TUI) for managing multiple local development processes. View real-time logs, monitor status, and control all your dev servers from a single dashboard.

Built with [OpenTUI](https://github.com/anomalyco/opentui).

## Why corsa?

When working on a full-stack project, you often need to run multiple processes simultaneously—a frontend dev server, a backend API, database containers, workers, etc. corsa gives you:

- **Single dashboard** for all your processes with tabbed log viewing
- **Real-time logs** with search and ANSI color support
- **Status monitoring** to see at a glance what's running, stopped, or crashed
- **Health checks** to monitor service availability
- **AI integration** via MCP to let your IDE assistant read logs and control processes

## Installation

### Homebrew (macOS and Linux)

```bash
brew install tomagranate/tap/corsa
```

### NPM

```bash
npm install -g @tomagranate/corsa
```

### curl (macOS and Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/tomagranate/corsa/main/install.sh | bash
```

### Manual Download

Download the latest binary for your platform from [Releases](https://github.com/tomagranate/corsa/releases).

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `corsa-darwin-arm64.tar.gz` |
| macOS (Intel) | `corsa-darwin-x64.tar.gz` |
| Linux (x64) | `corsa-linux-x64.tar.gz` |
| Linux (ARM64) | `corsa-linux-arm64.tar.gz` |
| Windows (x64) | `corsa-windows-x64.zip` |

## Quick Start

1. Create a config file in your project:

```bash
corsa init
```

2. Edit `corsa.config.toml` to add your processes:

```toml
[[tools]]
name = "frontend"
command = "npm"
args = ["run", "dev"]
cwd = "./frontend"

[[tools]]
name = "backend"
command = "python"
args = ["-m", "uvicorn", "main:app", "--reload"]
cwd = "./backend"
```

3. Start the dashboard:

```bash
corsa
```

4. Optional: install the `corsa` AI skill from this repository:

```bash
npx skills add tomagranate/corsa
```

## CLI Reference

### Commands

| Command | Description |
|---------|-------------|
| `corsa` | Start the TUI dashboard |
| `corsa init` | Create a sample config file in the current directory |
| `corsa mcp` | Start the MCP server for AI agent integration |
| `corsa ctl <subcommand>` | Control running processes through the MCP API |

### Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file (default: `corsa.config.toml`) |
| `--id <id>` | Instance ID for TUI registration or MCP/CLI targeting |
| `-h, --help` | Show help message |
| `-v, --version` | Show version information |

### `ctl` Subcommands

| Subcommand | Description |
|------------|-------------|
| `corsa ctl list` | List processes with compact status metadata (`ps`/`ls` aliases) |
| `corsa ctl instances` | List live API-enabled corsa instances |
| `corsa ctl logs <name>` | Get recent logs for a process |
| `corsa ctl stop <name>` | Stop a running process (`rm` alias) |
| `corsa ctl restart <name>` | Restart a process |
| `corsa ctl clear <name>` | Clear process logs |
| `corsa ctl send-keys <name> --key <value>` | Send keypresses/text to an interactive process |
| `corsa ctl reload` | Reload config and restart processes |

### Examples

```bash
# Start with default config
corsa

# Use a custom config file
corsa --config ./configs/dev.toml
corsa -c ./configs/dev.toml

# Create a new config file
corsa init

# Start MCP server for AI integration
corsa mcp

# Start or target a named instance
corsa --id web
corsa mcp --id web
corsa ctl --id web list

# List processes via CLI control API
corsa ctl list
corsa ctl ls
corsa ctl list --name backend --fields name,status,healthStatus --logs 2

# Read logs with filtering
corsa ctl logs backend --lines 200 --search ERROR --search-type substring

# Stop a process (alias)
corsa ctl rm backend

# Send interactive input
corsa ctl send-keys repl --key "help" --key return

# Machine-readable output for agents/scripts
corsa ctl list --json
```

## Configuration

corsa is configured via a TOML file. By default, it looks for `corsa.config.toml` in the current directory.

### Minimal Example

```toml
[[tools]]
name = "server"
command = "npm"
args = ["run", "dev"]
```

### Full Example

```toml
[home]
enabled = true
title = "My Project"

[ui]
theme = "mist"
showTabNumbers = true

[mcp]
enabled = true

[[tools]]
name = "web"
command = "npm"
args = ["run", "dev"]
cwd = "./web"
description = "Next.js frontend"

[tools.ui]
label = "Open App"
url = "http://localhost:3000"

[tools.healthCheck]
url = "http://localhost:3000/api/health"
interval = 5000

[[tools]]
name = "api"
command = "cargo"
args = ["watch", "-x", "run"]
cwd = "./api"
description = "Rust API server"
cleanup = ["pkill -f 'target/debug/api'"]

[tools.env]
RUST_LOG = "debug"
```

For a complete reference of all configuration options, see the [sample config file](src/sample-config.toml).



## Themes

corsa includes several built-in themes. Set in your config:

```toml
[ui]
theme = "mist"
```

Available themes: `default` (Moss), `mist`, `cappuccino`, `synthwave`, `terminal` (auto-detect from your terminal).

## MCP Integration

corsa can expose an HTTP API for AI agents (Cursor, Claude, etc.) via the Model Context Protocol.

### Enable in Config

```toml
[mcp]
enabled = true
port = 18765
```

### Configure Your IDE

Add to your MCP configuration (e.g., `~/.cursor/mcp.json`):

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

If multiple corsa instances are running, give each one an explicit ID and target
that ID from MCP or `ctl`:

```bash
corsa --id web
corsa mcp --id web
corsa ctl --id web list
corsa ctl instances
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_processes` | List processes with compact status metadata by default; supports field, status, name, and opt-in log preview filters |
| `get_logs` | Get recent logs (default 50 lines; supports search and explicit line limits) |
| `stop_process` | Stop a running process |
| `restart_process` | Restart a process |
| `clear_logs` | Clear logs for a process |
| `send_keys` | Send virtual keypresses to an interactive process |
| `reload_config` | Reload config file and restart all processes |

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
