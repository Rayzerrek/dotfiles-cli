# Contributing to Dotfiles CLI

Thanks for your interest in contributing to `@rayzerrek/dot-cli`.

This project is a lightweight cross-platform CLI for keeping dotfiles and system configuration in sync across Windows, macOS, and Linux.

## Ways to Contribute

You can help by:

- reporting bugs
- improving documentation
- testing behavior on different operating systems
- suggesting small usability improvements
- fixing issues related to config loading, symlinks, Git workflows, or path handling

## Before You Start

For larger changes, please open an issue first so we can agree on the direction before you spend time implementing it.

Good first contributions are usually:

- README improvements
- clearer error messages
- additional tests for existing behavior
- small cross-platform compatibility fixes

## Development Setup

```bash
git clone https://github.com/Rayzerrek/dot-cli.git
cd dot-cli
npm install
npm run build
npm test
```

To try the CLI locally:

```bash
npm link
dot status
```

## Project Scripts

```bash
npm run build   # compile TypeScript
npm test        # build and run tests
```

## Pull Request Guidelines

Please keep pull requests focused and small.

Before opening a PR:

1. Run `npm test`.
2. Make sure the change works on your OS.
3. Update documentation if the CLI behavior changes.
4. Add or update tests when changing logic.
5. Avoid unrelated formatting or refactoring.

## Code Style

- Keep the CLI simple and predictable.
- Prefer clear error messages over silent fallbacks.
- Be careful with filesystem operations.
- Avoid platform-specific assumptions unless they are explicitly guarded.
- Do not introduce new runtime dependencies unless there is a strong reason.

## Reporting Bugs

When reporting a bug, please include:

- package version from `dot --version` or npm
- operating system
- command you ran
- relevant config snippet, with secrets removed
- expected behavior
- actual behavior

## Security Issues

Please do not report security issues publicly. See [SECURITY.md](./SECURITY.md) for private reporting instructions.
