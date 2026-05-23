# Dotfiles CLI (`dot`)

A lightweight CLI manager to keep system configurations (`dotfiles`) in sync on Windows.

## Installation

Compile the TypeScript source into a standalone executable using Bun:

```bash
bun build ./src/index.ts --compile --outfile=C:\Users\kacpe\.local\bin\dot.exe
```

*Note: Ensure `C:\Users\kacpe\.local\bin` is in your system's `PATH` to access `dot` globally.*

## Usage

```bash
# Check the state of directory junctions and the git repository
dot status

# Restore or recreate missing system junctions (.agents, nvim, VS Code)
dot link

# Stage, commit, and push changes to your dotfiles repository
dot update [optional_message]

# Display help
dot help
```
