#!/usr/bin/env python3
"""
Blog Builder - Convert markdown blog posts to themed HTML pages

Usage:
    python build_blog.py              # Build all changed posts
    python build_blog.py --force      # Rebuild all posts
    python build_blog.py --verbose    # Show detailed output
    python build_blog.py --dry-run    # Show what would be built
"""

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Optional

import yaml
from markdown_it import MarkdownIt
from mdit_py_plugins.footnote import footnote_plugin
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name, guess_lexer
from pygments.util import ClassNotFound
from rich.console import Console
from rich.panel import Panel

# Initialize Rich console for pretty output (with legacy Windows support)
console = Console(legacy_windows=False, force_terminal=True)

# Configure markdown-it with footnote and strikethrough support
md = MarkdownIt('commonmark', {'breaks': True, 'html': True})
md.enable('table')
md.enable('strikethrough')
md.use(footnote_plugin)


@dataclass
class BlogPost:
    """Data model for a blog post"""
    filename: str
    filepath: Path
    title: str
    slug: str
    author: str
    date: datetime
    content_html: str
    excerpt: str
    frontmatter: dict


class BuildCache:
    """Manage build cache to skip unchanged files"""

    def __init__(self, cache_file: Path):
        self.cache_file = cache_file
        self.cache = self._load_cache()
        self.modified = False

    def _load_cache(self) -> dict:
        """Load cache from file"""
        if self.cache_file.exists():
            try:
                return json.loads(self.cache_file.read_text(encoding='utf-8'))
            except Exception as e:
                console.print(f"[yellow]Warning: Could not load cache: {e}[/yellow]")
                return {}
        return {}

    def needs_rebuild(self, filepath: Path) -> bool:
        """Check if file needs rebuild based on content hash"""
        current_hash = self._file_hash(filepath)
        cached_hash = self.cache.get(str(filepath))
        return current_hash != cached_hash

    def update(self, filepath: Path):
        """Update cache with new hash"""
        self.cache[str(filepath)] = self._file_hash(filepath)
        self.modified = True

    def save(self):
        """Save cache to file"""
        if self.modified:
            self.cache_file.write_text(json.dumps(self.cache, indent=2), encoding='utf-8')

    @staticmethod
    def _file_hash(filepath: Path) -> str:
        """Calculate SHA256 hash of file"""
        return hashlib.sha256(filepath.read_bytes()).hexdigest()


def create_slug(filename: str) -> str:
    """
    Convert filename to URL-friendly slug.

    Examples:
        CognitiveSovereignty.md -> cognitive-sovereignty
        MyBlogPost.md -> my-blog-post
    """
    # Remove extension
    name = filename.replace('.md', '')

    # Insert hyphens before uppercase letters (PascalCase -> kebab-case)
    slug = re.sub(r'(?<!^)(?=[A-Z])', '-', name).lower()

    # Replace spaces and underscores with hyphens
    slug = slug.replace(' ', '-').replace('_', '-')

    # Remove special characters
    slug = re.sub(r'[^a-z0-9-]', '', slug)

    # Collapse multiple hyphens
    slug = re.sub(r'-+', '-', slug)

    # Remove leading/trailing hyphens
    return slug.strip('-')


def extract_title_from_html(html_content: str, fallback: str) -> str:
    """
    Extract the first H1 heading from HTML content.
    Falls back to provided fallback if no H1 found.
    """
    # Find first H1 tag
    h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', html_content, re.IGNORECASE | re.DOTALL)

    if not h1_match:
        return fallback

    # Extract content and strip tags
    h1_content = h1_match.group(1)
    text_only = re.sub(r'<[^>]+>', '', h1_content)

    # Decode HTML entities and clean whitespace
    title = unescape(text_only).strip()

    return title if title else fallback


def parse_date(date_str: Optional[str], filepath: Path) -> datetime:
    """
    Parse date from various formats.

    Supported formats:
    - MM/DD/YYYY (e.g., "02/03/2026")
    - YYYY-MM-DD (e.g., "2026-02-03")

    Fallback: Use file modification time
    """
    if not date_str:
        return datetime.fromtimestamp(filepath.stat().st_mtime)

    # Try MM/DD/YYYY format
    for fmt in ['%m/%d/%Y', '%Y-%m-%d', '%B %d, %Y']:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue

    # Fallback to file mtime
    console.print(f"[yellow]Warning: Could not parse date '{date_str}', using file mtime[/yellow]")
    return datetime.fromtimestamp(filepath.stat().st_mtime)


def strip_html_tags(html: str) -> str:
    """Remove HTML tags from string"""
    return re.sub(r'<[^>]+>', '', html)


def generate_excerpt(html_content: str, max_length: int = 200) -> str:
    """
    Generate excerpt from content for listing page.

    Strategy:
    1. Look for "TLDR:" section
    2. If not found, use first paragraph
    3. Limit to max_length characters
    4. Add ellipsis if truncated
    """
    # Check for TLDR section
    tldr_match = re.search(
        r'<h2[^>]*>TLDR:?</h2>\s*<p>(.*?)</p>',
        html_content,
        re.IGNORECASE | re.DOTALL
    )

    if tldr_match:
        excerpt = strip_html_tags(tldr_match.group(1))
    else:
        # Use first paragraph after H1
        # Skip the H1, find first <p>
        after_h1 = re.split(r'</h1>', html_content, maxsplit=1)
        if len(after_h1) > 1:
            p_match = re.search(r'<p>(.*?)</p>', after_h1[1], re.DOTALL)
            excerpt = strip_html_tags(p_match.group(1)) if p_match else ""
        else:
            excerpt = ""

    # Clean up whitespace
    excerpt = ' '.join(excerpt.split())

    # Truncate if needed
    if len(excerpt) > max_length:
        excerpt = excerpt[:max_length].rsplit(' ', 1)[0] + '...'

    return excerpt or "Click to read more..."


def convert_image_links_to_images(html: str) -> str:
    """
    Convert markdown links to image files into actual <img> tags.

    Detects links like [alt text](image.jpg) and converts them to <img> tags.
    Also fixes relative paths for images in the assets directory.
    """
    # Pattern: <a href="...image file">text</a>
    # Image extensions: jpg, jpeg, png, gif, svg, webp
    image_extensions = r'\.(jpg|jpeg|png|gif|svg|webp)$'

    def replace_with_img(match):
        href = match.group(1)
        alt_text = match.group(2)

        # Check if href points to an image file
        if re.search(image_extensions, href, re.IGNORECASE):
            # Fix path if it's just a filename (assume it's in assets/)
            if '/' not in href and '\\' not in href:
                # Image is just a filename, prepend ../assets/
                img_path = f'../assets/{href}'
            else:
                # Path is already specified, just use it
                img_path = href

            # Return img tag with figure wrapper for better styling
            return f'<figure class="blog-image"><img src="{img_path}" alt="{alt_text}" /><figcaption>{alt_text}</figcaption></figure>'

        # Not an image, return original link
        return match.group(0)

    # Replace links that point to images
    html_with_images = re.sub(
        r'<a href="([^"]+)">([^<]+)</a>',
        replace_with_img,
        html
    )

    return html_with_images


def apply_syntax_highlighting(html: str) -> tuple[str, str]:
    """
    Apply Pygments syntax highlighting to code blocks.

    Returns:
        Tuple of (highlighted_html, css_styles)
    """
    # Generate Pygments CSS
    formatter = HtmlFormatter(style='friendly', cssclass='highlight')
    css = formatter.get_style_defs('.highlight')

    # Find all code blocks with language specification
    # Pattern: <code class="language-python">...</code>
    def highlight_code(match):
        lang = match.group(1)
        code = match.group(2)

        # Unescape HTML entities in code
        code = unescape(code)

        try:
            lexer = get_lexer_by_name(lang)
        except ClassNotFound:
            # Try to guess the lexer
            try:
                lexer = guess_lexer(code)
            except:
                # If all fails, return original
                return match.group(0)

        # Highlight the code
        highlighted = highlight(code, lexer, formatter)
        return highlighted

    # Apply highlighting to all code blocks
    highlighted_html = re.sub(
        r'<code class="language-(\w+)">(.*?)</code>',
        highlight_code,
        html,
        flags=re.DOTALL
    )

    return highlighted_html, css


def parse_markdown_file(filepath: Path, verbose: bool = False) -> Optional[BlogPost]:
    """
    Parse a markdown file into a BlogPost object.

    Returns None if file should be skipped.
    """
    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        console.print(f"[red]Error reading {filepath.name}: {e}[/red]")
        return None

    # Split frontmatter and content
    parts = content.split('---', 2)

    if len(parts) >= 3:
        # Has frontmatter
        try:
            frontmatter = yaml.safe_load(parts[1]) or {}
        except Exception as e:
            console.print(f"[yellow]Warning: Could not parse YAML in {filepath.name}: {e}[/yellow]")
            frontmatter = {}
        markdown_content = parts[2].strip()
    else:
        # No frontmatter
        frontmatter = {}
        markdown_content = content.strip()

    if not markdown_content:
        if verbose:
            console.print(f"[yellow]Skipping {filepath.name}: Empty content[/yellow]")
        return None

    # Convert markdown to HTML
    html_content = md.render(markdown_content)

    # Convert image links to actual images
    html_content = convert_image_links_to_images(html_content)

    # Apply syntax highlighting
    html_content, _ = apply_syntax_highlighting(html_content)

    # Extract title from H1 (not from YAML)
    title = extract_title_from_html(html_content, filepath.stem)

    # Generate slug
    slug = create_slug(filepath.name)

    # Parse metadata
    author = frontmatter.get('author', '')
    date = parse_date(frontmatter.get('date'), filepath)

    # Generate excerpt
    excerpt = generate_excerpt(html_content)

    post = BlogPost(
        filename=filepath.name,
        filepath=filepath,
        title=title,
        slug=slug,
        author=author,
        date=date,
        content_html=html_content,
        excerpt=excerpt,
        frontmatter=frontmatter
    )

    if verbose:
        console.print(f"[green]OK[/green] Parsed: {filepath.name} -> {title}")

    return post


def render_post_html(post: BlogPost) -> str:
    """Generate HTML for individual blog post"""

    # Get Pygments CSS
    formatter = HtmlFormatter(style='friendly', cssclass='highlight')
    pygments_css = formatter.get_style_defs('.highlight')

    # Format date
    date_str = post.date.strftime('%B %d, %Y')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{post.title} - Mukul Ramesh</title>
    <link rel="stylesheet" href="../../styles.css">
    <style>
        /* Blog-specific styles */
        .blog-post-container {{
            max-width: 800px;
            margin: 0 auto;
            padding: 32px 24px;
        }}

        .blog-header {{
            margin-bottom: 32px;
            padding: 24px;
            border: 2px solid #E8D5C4;
            border-radius: 12px;
            background: transparent;
        }}

        .blog-title {{
            font-size: 2.5rem;
            color: #704214;
            margin: 0 0 16px 0;
            line-height: 1.2;
        }}

        .blog-meta {{
            color: #8B7355;
            font-size: 1rem;
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }}

        .blog-meta-item {{
            display: flex;
            align-items: center;
            gap: 6px;
        }}

        .blog-content {{
            font-size: 1.1rem;
            line-height: 1.8;
            color: #3E2723;
        }}

        .blog-content h1 {{
            display: none; /* Hide H1 since it's shown in header */
        }}

        .blog-content h2 {{
            color: #704214;
            margin-top: 48px;
            margin-bottom: 16px;
            font-size: 1.8rem;
        }}

        .blog-content h3 {{
            color: #5D4037;
            margin-top: 32px;
            margin-bottom: 12px;
            font-size: 1.4rem;
        }}

        .blog-content p {{
            margin-bottom: 20px;
        }}

        .blog-content a {{
            color: #704214;
            text-decoration: underline;
            transition: color 0.2s;
        }}

        .blog-content a:hover {{
            color: #8B6F47;
        }}

        .blog-content s {{
            text-decoration: line-through;
            opacity: 0.7;
        }}

        .blog-content code {{
            background: #FFF8F0;
            padding: 2px 6px;
            border-radius: 3px;
            border: 1px solid #E8D5C4;
            font-family: 'Fira Code', monospace;
            font-size: 0.95em;
        }}

        .blog-content pre {{
            background: #FFF8F0;
            padding: 16px;
            border-radius: 6px;
            border: 1px solid #E8D5C4;
            overflow-x: auto;
            margin: 24px 0;
        }}

        .blog-content pre code {{
            background: none;
            border: none;
            padding: 0;
        }}

        .blog-content blockquote {{
            border-left: 4px solid #704214;
            margin: 24px 0;
            padding: 16px 24px;
            background: #FFF8F0;
            font-style: italic;
        }}

        /* Blog images */
        .blog-content .blog-image {{
            margin: 32px 0;
            text-align: center;
        }}

        .blog-content .blog-image img {{
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            border: 1px solid #E8D5C4;
            box-shadow: 0 4px 12px rgba(62, 39, 35, 0.15);
        }}

        .blog-content .blog-image figcaption {{
            margin-top: 12px;
            font-size: 0.9rem;
            color: #8B7355;
            font-style: italic;
        }}

        .blog-content ul, .blog-content ol {{
            margin: 16px 0 16px 32px;
        }}

        .blog-content li {{
            margin-bottom: 8px;
        }}

        /* Footnotes styling */
        .blog-content .footnotes {{
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px solid #E8D5C4;
            font-size: 0.95rem;
            color: #5D4037;
        }}

        .blog-content .footnotes ol {{
            margin-left: 20px;
        }}

        .blog-content sup {{
            font-size: 0.75em;
        }}

        .back-to-blog {{
            display: inline-block;
            margin-bottom: 24px;
            color: #704214;
            text-decoration: none;
            padding: 8px 16px;
            background: #FFF8F0;
            border: 1px solid #E8D5C4;
            border-radius: 6px;
            transition: background 0.2s, border-color 0.2s;
        }}

        .back-to-blog:hover {{
            background: #F0E4D7;
            border-color: #704214;
        }}

        /* Pygments syntax highlighting */
        {pygments_css}

        .highlight {{
            background: #FFF8F0 !important;
            border-radius: 6px;
            padding: 16px;
            margin: 24px 0;
            border: 1px solid #E8D5C4;
            overflow-x: auto;
        }}

        @media (max-width: 768px) {{
            .blog-post-container {{
                padding: 24px 16px;
            }}

            .blog-title {{
                font-size: 2rem;
            }}

            .blog-content {{
                font-size: 1.05rem;
            }}
        }}
    </style>
</head>
<body>

<nav class="main-navbar">
    <a href="../../landingpage/home.html" id="nav-home">Home</a>
    <a href="../blog.html" id="nav-blog" class="active">Blog</a>
    <a href="../../toys/toys.html" id="nav-toys">Mini-Projects</a>
</nav>

<main class="blog-post-container">
    <a href="../blog.html" class="back-to-blog">← Back to Blog</a>

    <article>
        <header class="blog-header">
            <h1 class="blog-title">{post.title}</h1>
            <div class="blog-meta">
                {f'<span class="blog-meta-item"><strong>By</strong> {post.author}</span>' if post.author else ''}
                <span class="blog-meta-item">
                    <strong>Published</strong> {date_str}
                </span>
            </div>
        </header>

        <div class="blog-content">
            {post.content_html}
        </div>
    </article>
</main>

<footer class="site-footer" role="contentinfo">
    <div class="footer-inner">
        <p class="contact-icons">
            <a href="mailto:mukulplace@gmail.com" aria-label="Email">
                <img src="../../landingpage/assets/email.png" alt="Email">
            </a>
            <a href="https://www.linkedin.com/in/mukul-ramesh/" target="_blank" rel="noopener" aria-label="LinkedIn">
                <img src="../../landingpage/assets/linkedin.png" alt="LinkedIn">
            </a>
            <a href="https://github.com/mukulramesh" target="_blank" rel="noopener" aria-label="GitHub">
                <img src="../../landingpage/assets/github.png" alt="GitHub">
            </a>
        </p>
        <div class="attributions">
            <a href="https://www.flaticon.com/free-icons/email" title="email icons">Email icons created by Uniconlabs</a>
            <span class="dot">•</span>
            <a href="https://www.flaticon.com/free-icons/linkedin" title="linkedin icons">Linkedin icons created by Freepik</a>
            <span class="dot">•</span>
            <a href="https://www.flaticon.com/free-icons/github" title="github icons">Github icons created by Pixel perfect</a>
        </div>
    </div>
</footer>

</body>
</html>"""

    return html


def render_listing_html(posts: list[BlogPost]) -> str:
    """Generate HTML for blog listing page"""

    # Sort posts by date (newest first)
    sorted_posts = sorted(posts, key=lambda p: p.date, reverse=True)

    # Generate post cards
    if sorted_posts:
        post_cards = []
        for post in sorted_posts:
            date_str = post.date.strftime('%B %d, %Y')
            author_html = f'<span>•</span><span>By {post.author}</span>' if post.author else ''

            card = f"""        <a href="posts/{post.slug}.html" class="blog-post-card">
            <h2 class="blog-post-card-title">{post.title}</h2>
            <div class="blog-post-card-meta">
                <span>{date_str}</span>
                {author_html}
            </div>
            <p class="blog-post-card-excerpt">{post.excerpt}</p>
        </a>"""
            post_cards.append(card)

        posts_html = '\n'.join(post_cards)
    else:
        posts_html = """        <div class="no-posts-message">
            <p>No blog posts yet. Check back soon!</p>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blog - Mukul Ramesh</title>
    <link rel="stylesheet" href="../styles.css">
    <style>
        /* Blog listing specific styles */
        .blog-container {{
            max-width: 960px;
            margin: 0 auto;
            padding: 32px 24px;
        }}

        .blog-header {{
            text-align: center;
            margin-bottom: 48px;
            padding: 24px;
            border: 2px solid #E8D5C4;
            border-radius: 12px;
            background: transparent;
        }}

        .blog-header h1 {{
            font-size: 3rem;
            color: #704214;
            margin: 0 0 16px 0;
        }}

        .blog-header p {{
            font-size: 1.2rem;
            color: #5D4037;
            margin: 0;
        }}

        .blog-posts-list {{
            display: flex;
            flex-direction: column;
            gap: 24px;
        }}

        .blog-post-card {{
            display: block;
            background: linear-gradient(135deg, #F0E4D7 0%, #FFF8F0 100%);
            border-radius: 12px;
            padding: 32px;
            text-decoration: none;
            color: inherit;
            box-shadow: 0 4px 16px rgba(62, 39, 35, 0.1);
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid #E8D5C4;
        }}

        .blog-post-card:hover {{
            transform: translateY(-4px);
            box-shadow: 0 8px 24px rgba(112, 66, 20, 0.2);
        }}

        .blog-post-card-title {{
            font-size: 1.8rem;
            color: #704214;
            margin: 0 0 12px 0;
            font-weight: 700;
        }}

        .blog-post-card-meta {{
            display: flex;
            gap: 16px;
            color: #8B7355;
            font-size: 0.95rem;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }}

        .blog-post-card-excerpt {{
            color: #5D4037;
            font-size: 1.05rem;
            line-height: 1.6;
            margin: 0;
        }}

        .no-posts-message {{
            text-align: center;
            padding: 64px 24px;
            color: #8B7355;
            font-size: 1.2rem;
        }}

        @media (max-width: 768px) {{
            .blog-container {{
                padding: 24px 16px;
            }}

            .blog-header h1 {{
                font-size: 2.5rem;
            }}

            .blog-post-card {{
                padding: 24px;
            }}

            .blog-post-card-title {{
                font-size: 1.5rem;
            }}
        }}
    </style>
</head>
<body>

<nav class="main-navbar">
    <a href="../landingpage/home.html" id="nav-home">Home</a>
    <a href="blog.html" id="nav-blog" class="active">Blog</a>
    <a href="../toys/toys.html" id="nav-toys">Mini-Projects</a>
</nav>

<main class="blog-container">
    <header class="blog-header">
        <h1>Blog</h1>
        <p>Thoughts, essays, and explorations</p>
    </header>

    <div class="blog-posts-list">
{posts_html}
    </div>
</main>

<footer class="site-footer" role="contentinfo">
    <div class="footer-inner">
        <p class="contact-icons">
            <a href="mailto:mukulplace@gmail.com" aria-label="Email">
                <img src="../landingpage/assets/email.png" alt="Email">
            </a>
            <a href="https://www.linkedin.com/in/mukul-ramesh/" target="_blank" rel="noopener" aria-label="LinkedIn">
                <img src="../landingpage/assets/linkedin.png" alt="LinkedIn">
            </a>
            <a href="https://github.com/mukulramesh" target="_blank" rel="noopener" aria-label="GitHub">
                <img src="../landingpage/assets/github.png" alt="GitHub">
            </a>
        </p>
        <div class="attributions">
            <a href="https://www.flaticon.com/free-icons/email" title="email icons">Email icons created by Uniconlabs</a>
            <span class="dot">•</span>
            <a href="https://www.flaticon.com/free-icons/linkedin" title="linkedin icons">Linkedin icons created by Freepik</a>
            <span class="dot">•</span>
            <a href="https://www.flaticon.com/free-icons/github" title="github icons">Github icons created by Pixel perfect</a>
        </div>
    </div>
</footer>

</body>
</html>"""

    return html


def should_skip_file(filename: str) -> bool:
    """Determine if a markdown file should be skipped"""
    # Skip template files
    if filename == 'template.md':
        return True

    # Skip outline files
    if filename.startswith('outline-'):
        return True

    return False


def main():
    """Main build function"""
    parser = argparse.ArgumentParser(description='Build blog from markdown files')
    parser.add_argument('--force', action='store_true', help='Force rebuild all posts')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be built without building')
    args = parser.parse_args()

    # Setup paths
    base_dir = Path(__file__).parent
    markdown_dir = base_dir / 'blog' / 'markdown files'
    posts_dir = base_dir / 'blog' / 'posts'
    listing_file = base_dir / 'blog' / 'blog.html'
    cache_file = base_dir / '.blog_cache.json'

    # Ensure markdown directory exists
    if not markdown_dir.exists():
        console.print(f"[red]Error: Markdown directory not found: {markdown_dir}[/red]")
        return 1

    # Load build cache
    cache = BuildCache(cache_file)

    # Discover markdown files
    md_files = list(markdown_dir.glob('*.md'))

    # Filter files
    md_files = [f for f in md_files if not should_skip_file(f.name)]

    if not md_files:
        console.print("[yellow]No markdown files found to process[/yellow]")
        return 0

    console.print(Panel(
        f"[bold]Blog Builder[/bold]\n\n"
        f"Found [cyan]{len(md_files)}[/cyan] markdown file(s)",
        border_style="blue"
    ))

    # Parse markdown files
    posts = []
    skipped = []
    errors = []

    for md_file in md_files:
        # Check cache unless force rebuild
        if not args.force and not cache.needs_rebuild(md_file):
            if args.verbose:
                console.print(f"[dim]-- Skipped (cached): {md_file.name}[/dim]")
            skipped.append(md_file.name)

            # Still need to parse for listing (but don't write HTML)
            post = parse_markdown_file(md_file, verbose=False)
            if post:
                posts.append(post)
            continue

        # Parse markdown
        post = parse_markdown_file(md_file, verbose=args.verbose)

        if post is None:
            errors.append(md_file.name)
            continue

        posts.append(post)

        if args.dry_run:
            console.print(f"[cyan]Would build:[/cyan] {post.slug}.html")
            continue

        # Ensure posts directory exists
        posts_dir.mkdir(parents=True, exist_ok=True)

        # Generate and write post HTML
        try:
            post_html = render_post_html(post)
            post_file = posts_dir / f'{post.slug}.html'
            post_file.write_text(post_html, encoding='utf-8')

            # Update cache
            cache.update(md_file)

            console.print(f"[green]OK[/green] Generated: {post.slug}.html")
        except Exception as e:
            console.print(f"[red]Error generating {post.slug}.html: {e}[/red]")
            errors.append(md_file.name)

    if args.dry_run:
        console.print("\n[cyan]Dry run complete. No files were written.[/cyan]")
        return 0

    # Generate listing page (always regenerate)
    if posts:
        try:
            listing_html = render_listing_html(posts)
            listing_file.write_text(listing_html, encoding='utf-8')
            console.print(f"[green]OK[/green] Generated: blog.html (listing page)")
        except Exception as e:
            console.print(f"[red]Error generating blog.html: {e}[/red]")
            return 1

    # Save cache
    cache.save()

    # Print summary
    console.print("\n" + "="*50)
    console.print(Panel(
        f"[bold green]Build Complete![/bold green]\n\n"
        f"Posts generated: [cyan]{len(posts) - len(skipped)}[/cyan]\n"
        f"Cached (skipped): [dim]{len(skipped)}[/dim]\n"
        f"Errors: [{'red' if errors else 'green'}]{len(errors)}[/{'red' if errors else 'green'}]",
        border_style="green"
    ))

    if errors:
        console.print(f"\n[yellow]Files with errors:[/yellow]")
        for err in errors:
            console.print(f"  • {err}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
