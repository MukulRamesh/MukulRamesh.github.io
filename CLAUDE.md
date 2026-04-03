# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal website hosted on GitHub Pages (mukulramesh.com). Static site with three main sections:
- Landing page with personal stories (`/landingpage/`)
- Blog with markdown-to-HTML build system (`/blog/`)
- Interactive mini-projects (`/toys/`)

## Build and Development Commands

### Blog Building
```bash
# Build changed blog posts (uses cache)
python build_blog.py

# Force rebuild all posts
python build_blog.py --force

# Preview what would be built
python build_blog.py --dry-run

# Verbose output for debugging
python build_blog.py --verbose
```

### Python Environment
```bash
# Activate virtual environment
source venv/Scripts/activate  # On Windows Git Bash
venv\Scripts\activate.bat     # On Windows cmd

# Install/update dependencies
pip install -r requirements.txt
```

### Git Submodules
The `toys/crossword` directory is a git submodule. To update:
```bash
git submodule update --init --recursive
```

## Architecture

### Blog System (`build_blog.py`)

**Input**: Markdown files in `blog/markdown files/`
**Output**: 
- Individual post HTML in `blog/posts/{slug}.html`
- Listing page at `blog/blog.html`

**Build Pipeline**:
1. Parse markdown with YAML frontmatter (author, date)
2. Convert to HTML using markdown-it-py
3. Apply Pygments syntax highlighting
4. Convert image links to `<img>` tags (images from `blog/assets/`)
5. Generate excerpt from TLDR section or first paragraph
6. Render with inline styles matching site theme
7. Cache file hashes to skip unchanged posts

**Skipped Files**:
- `template.md` 
- Files starting with `outline-`
- Files in `blog/unfinished/` (gitignored)

**Post Frontmatter Format**:
```yaml
---
author: Mukul Ramesh
date: 2026-02-03  # YYYY-MM-DD or MM/DD/YYYY
---
```

**Slug Generation**: PascalCase filenames convert to kebab-case URLs
- `CognitiveSovereignty.md` → `cognitive-sovereignty.html`

### Site Structure

- `index.html` - Redirects to landing page
- `styles.css` - Global styles shared across all pages
- `landingpage/home.html` - Main landing page with story cards
- `blog/blog.html` - Blog listing page (generated)
- `blog/posts/` - Individual blog posts (generated)
- `toys/` - Interactive JavaScript projects
  - `toys/get3/` - Word game with WebSocket support
  - `toys/crossword/` - Git submodule

**Navigation**: All pages use consistent navbar linking home, blog, and mini-projects

### Styling

No CSS preprocessor or framework. Uses:
- Inline `<style>` blocks for page-specific styles
- `styles.css` for shared components (navbar, footer)
- Brown/tan color palette (`#704214`, `#E8D5C4`, `#FFF8F0`)

## Writing Blog Posts

1. Create markdown file in `blog/markdown files/`
2. Add YAML frontmatter with author and date
3. Use `# Title` as H1 (extracted as post title)
4. Optional TLDR section: `## TLDR:` (used for excerpt)
5. Images: Place in `blog/assets/`, reference by filename
6. Run `python build_blog.py` to generate HTML
7. Commit both markdown and generated HTML files

**Date Formats**: Supports `YYYY-MM-DD`, `MM/DD/YYYY`, or `Month DD, YYYY`

**Image Handling**: Links to image files automatically convert to `<img>` tags with figure wrapper. Images without path prefix are assumed to be in `../assets/` relative to post HTML.

## Deployment

GitHub Pages serves from repository root. No build step required on push - blog HTML is pre-generated and committed.

## Dependencies

Python packages (see `requirements.txt`):
- **markdown-it-py** + **mdit-py-plugins**: Markdown parsing with footnotes
- **Pygments**: Syntax highlighting for code blocks
- **PyYAML**: Frontmatter parsing
- **rich**: CLI output formatting

Heavy ML dependencies (whisper, torch, transformers) suggest audio/speech processing experiments but are not used by blog builder.
