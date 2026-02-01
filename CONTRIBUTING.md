# Contributing to corsa

Thank you for your interest in contributing to corsa! This guide will help you get set up for development.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0 or later)
- Node.js 18+ (for compatibility testing)

## Development Setup

1. Clone the repository:

```bash
git clone https://github.com/tomagranate/corsa.git
cd corsa
```

2. Install dependencies:

```bash
bun install
```

3. Start development mode:

```bash
bun dev
```

This runs corsa using the `corsa.config.toml` in the project root, which includes test scripts for development.

## Available Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Run in development mode |
| `bun test` | Run test suite |
| `bun test:watch` | Run tests in watch mode |
| `bun run typecheck` | Type check with TypeScript |
| `bun run check` | Lint and format with Biome |
| `bun run build` | Build binary for current platform |
| `bun run build:all` | Build binaries for all platforms |

## Code Quality

Before submitting a PR, ensure your code passes all checks:

```bash
bun run typecheck && bun run check
```

The CI pipeline runs these checks automatically on all pull requests.

## Project Structure

```
src/
├── cli.ts              # CLI argument parsing
├── index.tsx           # Main entry point
├── App.tsx             # Root React component
├── commands/           # CLI subcommands (init, mcp, update)
├── components/         # React components
│   ├── CommandPalette/ # Command palette UI
│   ├── HelpBar/        # Bottom help bar
│   ├── HomeTab/        # Home tab with overview
│   ├── LogViewer/      # Log display component
│   ├── TabBar/         # Tab navigation
│   └── ...
├── hooks/              # React hooks
├── lib/                # Core libraries
│   ├── api/            # HTTP API server
│   ├── clipboard/      # Clipboard utilities
│   ├── config/         # Config loading/parsing
│   ├── health/         # Health check logic
│   ├── processes/      # Process management
│   ├── search/         # Fuzzy search
│   ├── text/           # ANSI text processing
│   ├── theme/          # Theme management
│   └── time/           # Time formatting
└── types.ts            # Shared types
```

## Testing

Tests are located in `__tests__` directories next to the code they test. Run with:

```bash
bun test
```

When adding new features, please include tests. The test files follow the naming convention `*.test.ts`.

## Test Scripts

The `test-scripts/` directory contains various scripts for manual testing of the log viewer and process management:

- `ansi-rainbow.js` - ANSI color output
- `rapid-burst.js` - High-volume log output
- `slow-start-server.js` - Delayed startup
- `flaky-server.js` - Intermittent crashes
- And many more...

These are useful for testing edge cases in the UI.

## Architecture

corsa is built with:

- **[OpenTUI](https://github.com/anomalyco/opentui)** - Terminal UI framework for React
- **React** - Component model
- **Bun** - Runtime, bundler, and test runner
- **TOML** - Configuration format
- **MCP SDK** - AI agent integration

### Key Concepts

- **Tools**: The processes managed by corsa, defined in the config file
- **Process Manager**: Handles spawning, stopping, and monitoring child processes
- **Log Viewer**: Virtualized log display with ANSI support and search
- **MCP API**: HTTP API + MCP server for external integrations

## Release Infrastructure

Releases are automated via GitHub Actions. Binaries are hosted on GitHub Releases.

## Pull Request Guidelines

1. Fork the repository and create a feature branch
2. Make your changes with clear, focused commits
3. Add tests for new functionality
4. Ensure all checks pass (`bun run typecheck && bun run check`)
5. Update documentation if needed
6. Submit a pull request with a clear description

## Reporting Issues

When reporting bugs, please include:

- corsa version (`corsa --help` shows version info)
- Operating system and terminal
- Steps to reproduce
- Expected vs actual behavior
- Relevant config (sanitized of secrets)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
