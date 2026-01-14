# Contributing to Sarkar Local Agent

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow

## How to Contribute

### Reporting Bugs

1. **Search existing issues** to avoid duplicates
2. **Create a new issue** with:
   - Clear title describing the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (macOS version, Node version)
   - Relevant logs (with sensitive data removed)

### Suggesting Features

1. **Open an issue** with the `enhancement` label
2. Describe:
   - The problem you're trying to solve
   - Your proposed solution
   - Alternative approaches you considered

### Submitting Code

#### Setup

```bash
# Fork the repository on GitHub
# Clone your fork
git clone https://github.com/YOUR_USERNAME/sarkar-local-agent.git
cd sarkar-local-agent

# Add upstream remote
git remote add upstream https://github.com/sarkar-ai-taken/sarkar-local-agent.git

# Install dependencies
npm install --legacy-peer-deps
```

#### Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make your changes**:
   - Write clear, readable code
   - Add logging for new functionality
   - Update documentation if needed

3. **Test your changes**:
   ```bash
   # Build
   npm run build

   # Test Telegram mode
   npm run dev

   # Test MCP mode (if applicable)
   npm run dev:mcp
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add new command for X"
   # or
   git commit -m "fix: resolve issue with Y"
   ```

5. **Push and create PR**:
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a Pull Request on GitHub.

#### Commit Message Format

We follow conventional commits:

| Prefix | Use for |
|--------|---------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `docs:` | Documentation changes |
| `refactor:` | Code refactoring |
| `chore:` | Maintenance tasks |

Examples:
```
feat: add /help command to Telegram bot
fix: resolve session timeout issue
docs: update README with MCP setup instructions
refactor: extract approval logic into separate module
```

### Pull Request Guidelines

- **One feature/fix per PR** - easier to review
- **Update documentation** if behavior changes
- **Add tests** if applicable
- **Keep changes focused** - avoid unrelated modifications

#### PR Checklist

- [ ] Code builds without errors (`npm run build`)
- [ ] Tested manually in relevant modes
- [ ] Documentation updated (if needed)
- [ ] Commit messages follow convention
- [ ] No sensitive data in code or logs

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer `async/await` over callbacks
- Use meaningful variable names
- Add types for function parameters and returns

### Logging

Use the structured logger instead of `console.log`:

```typescript
import { createLogger } from "../core/logger";
const log = createLogger("ComponentName");

// Good
log.info("Operation completed", { userId, result });
log.error("Failed to execute", { error: err.message });

// Avoid
console.log("something happened");
```

### Error Handling

```typescript
// Good - specific error handling
try {
  await riskyOperation();
} catch (error: any) {
  log.error("Operation failed", { error: error.message });
  // Handle gracefully
}

// Avoid - swallowing errors
try {
  await riskyOperation();
} catch {
  // silent fail
}
```

## Project Structure

```
src/
├── index.ts           # Entry point
├── telegram/          # Telegram bot
├── mcp/               # MCP server
└── core/              # Shared utilities
```

When adding new features:
- **Telegram-specific** → `src/telegram/`
- **MCP-specific** → `src/mcp/`
- **Shared utilities** → `src/core/`

## Security Considerations

This project executes commands on users' machines. Please:

- **Never log sensitive data** (API keys, passwords, file contents)
- **Validate inputs** before execution
- **Document security implications** of new features
- **Avoid introducing new attack vectors**

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open an Issue
- **Security issues**: Email maintainers directly (do not open public issue)

## Recognition

Contributors will be recognized in:
- Git commit history
- GitHub contributors page
- Release notes (for significant contributions)

Thank you for contributing!
