# Dotfiles CLI (`dot`)

A lightweight, high-performance, cross-platform CLI manager to keep system configurations (`dotfiles`) in sync across Windows, macOS, and Linux.

## Installation

Compile the TypeScript source into a standalone executable using Bun:

```bash
# Windows
bun build ./src/index.ts --compile --outfile=C:\Users\<username>\.local\bin\dot.exe

# macOS / Linux
bun build ./src/index.ts --compile --outfile=~/.local/bin/dot
```

*Note: Ensure the output directory is in your system's `PATH` to access `dot` globally.*

## Configuration

The CLI supports dynamic links and custom repository locations using a JSON configuration file.

1. Create a configuration folder at `~/.config/dot/` (or use `~/.dotrc.json` in your home directory).
2. Copy `config.example.json` from this repository to `~/.config/dot/config.json`:
   ```bash
   cp config.example.json ~/.config/dot/config.json
   ```
3. Edit `~/.config/dot/config.json` to define your own links.

### Configuration Format

```json
{
  "dotfilesDir": "~/dotfiles",
  "links": [
    {
      "name": "nvim",
      "systemPath": {
        "windows": "~/AppData/Local/nvim",
        "macos": "~/.config/nvim",
        "linux": "~/.config/nvim"
      }
    }
  ]
}
```
- **`dotfilesDir`**: The absolute path to your central dotfiles repository (defaults to `~/dotfiles` or `DOTFILES_DIR` environment variable).
- **`links`**: An array of folders to link:
  - **`name`**: The directory name in your dotfiles repository and the label shown in the CLI.
  - **`systemPath`**: The destination path where the link should sit on the system (can be a plain string, or a platform-specific object supporting `windows`, `macos`, and `linux`).

## Usage

```bash
# Check the state of system links and the git repository
dot status

# Restore or recreate missing system links natively (junctions on Win, symlinks on macOS/Linux)
dot link

# Stage, commit, and push changes to your dotfiles repository
dot update [optional_message]

# Display help
dot help
```
