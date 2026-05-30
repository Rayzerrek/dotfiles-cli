# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of `@rayzerrek/dot-cli`.

Please upgrade to the newest npm release before reporting an issue, unless the issue prevents upgrading.

## Reporting a Vulnerability

If you discover a security vulnerability, please do **not** open a public GitHub issue.

Instead, please use one of the private contact methods listed on the maintainer's GitHub profile, or open a GitHub security advisory if available for this repository.

Please include as much detail as possible:

- affected version
- operating system
- steps to reproduce
- expected vs actual behavior
- whether the issue can modify, delete, or expose user files
- any relevant config example, with secrets removed

I will try to acknowledge valid reports within 72 hours and follow up with next steps.

## Scope

Security-sensitive areas include:

- filesystem writes, deletes, moves, and symlink creation
- path resolution across Windows, macOS, and Linux
- Git command execution inside the configured dotfiles repository
- config file parsing and migration
- behavior that could unexpectedly expose private dotfiles or credentials

## Disclosure

Please allow time for a fix to be prepared and released before publicly disclosing a vulnerability.
