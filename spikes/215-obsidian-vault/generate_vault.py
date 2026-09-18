#!/usr/bin/env python3
"""
generate_vault.py - Generate an Obsidian-compatible Markdown vault from Nostos SQLite database.

Uses Python standard library only.
Reads Nostos.Backend/nostos.db (read-only) and emits notes, concepts, and book indexes.
"""

import os
import sys
import sqlite3
import re
import json
from datetime import datetime
from pathlib import Path
from collections import Counter

ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|#^\[\]]')

def to_iso8601_utc(ts: str | None) -> str:
    """Convert SQLite timestamp string to ISO-8601 UTC format (YYYY-MM-DDTHH:MM:SSZ)."""
    if not ts:
        return ""
    clean = ts.strip().replace(' ', 'T')
    parts = clean.split('.')
    if len(parts) == 2:
        clean = parts[0] + '.' + parts[1][:6]
    try:
        dt = datetime.fromisoformat(clean)
        return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        return clean

def sanitize_filename(name: str) -> str:
    """Sanitize a string to be legal in Obsidian filenames."""
    if not name:
        return "Untitled"
    # Replace illegal characters with a dash
    cleaned = ILLEGAL_CHARS.sub('-', name).strip()
    # Collapse multiple dashes or spaces
    cleaned = re.sub(r'-+', '-', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or "Untitled"

def derive_chapter(cfi_range: str | None, chapters_json: str | None) -> str:
    """Derive chapter title, page number, or location label from CFI or audio timestamp."""
    if not cfi_range:
        return ""
    
    # 1. PDF JSON format: {"pageNumber": 36, ...}
    if cfi_range.startswith('{'):
        try:
            data = json.loads(cfi_range)
            if 'pageNumber' in data:
                return f"Page {data['pageNumber']}"
        except Exception:
            pass
        return ""

    # 2. Audiobook timestamp (float seconds)
    if chapters_json:
        try:
            ts = float(cfi_range)
            chapters = json.loads(chapters_json)
            matching = [c for c in chapters if c.get('StartTime', 0) <= ts]
            if matching:
                return matching[-1].get('Title', '')
        except (ValueError, TypeError, json.JSONDecodeError):
            pass

    # 3. EPUB CFI format: check for page hint like [page_226]
    page_match = re.search(r'\[page_?(\d+)\]', cfi_range, re.IGNORECASE)
    if page_match:
        return f"Page {page_match.group(1)}"

    return ""

def escape_yaml_string(val: str) -> str:
    """Escape a string for safe inclusion as a quoted YAML scalar."""
    if val is None:
        return '""'
    escaped = val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '')
    return f'"{escaped}"'

def format_frontmatter(props: dict[str, str]) -> str:
    """Format a flat dictionary of scalar strings into YAML frontmatter."""
    lines = ["---"]
    for k, v in props.items():
        lines.append(f"{k}: {escape_yaml_string(v)}")
    lines.append("---")
    return "\n".join(lines)

def generate_vault(db_path: str, out_dir: str):
    """Main generator routine."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at: {db_path}")

    out_path = Path(out_dir)
    notes_dir = out_path / "Notes"
    books_dir = out_path / "Books"
    concepts_dir = out_path / "Concepts"

    notes_dir.mkdir(parents=True, exist_ok=True)
    books_dir.mkdir(parents=True, exist_ok=True)
    concepts_dir.mkdir(parents=True, exist_ok=True)

    # Open SQLite in read-only mode
    conn = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 1. Fetch Books
    cursor.execute("""
        SELECT Id, Title, Author, BookType, FileDetails_ChaptersJson, CreatedAt
        FROM Books
    """)
    book_rows = cursor.fetchall()
    books = {r["Id"]: dict(r) for r in book_rows}

    # Resolve unique, deterministic book filenames
    title_counts = Counter(b["Title"].lower() for b in books.values())
    book_filenames = {}
    for bid, b in books.items():
        clean = sanitize_filename(b["Title"])
        if title_counts[b["Title"].lower()] > 1:
            book_filenames[bid] = f"{clean} ({b.get('BookType') or 'edition'})"
        else:
            book_filenames[bid] = clean

    # 2. Fetch Concepts
    cursor.execute("SELECT Id, Concept FROM Concepts")
    concept_rows = cursor.fetchall()
    concepts = {r["Id"]: dict(r) for r in concept_rows}

    # 3. Fetch Notes with joined concept names
    cursor.execute("""
        SELECT n.Id, n.BookId, n.Content, n.CreatedAt, n.CfiRange, n.SelectedText,
               group_concat(c.Concept, '||') as ConceptList
        FROM Notes n
        LEFT JOIN NoteConcepts nc ON n.Id = nc.NoteId
        LEFT JOIN Concepts c ON nc.ConceptId = c.Id
        GROUP BY n.Id
        ORDER BY n.CreatedAt ASC
    """)
    note_rows = cursor.fetchall()

    # Track relationships for backlink generation
    book_notes_map: dict[str, list[dict]] = {bid: [] for bid in books}
    concept_notes_map: dict[str, list[dict]] = {c["Concept"]: [] for c in concepts.values()}

    emitted_notes = 0

    # 4. Generate Note markdown files
    for nr in note_rows:
        note_id = nr["Id"]
        book_id = nr["BookId"]
        book = books.get(book_id, {
            "Title": "Unknown Book",
            "Author": "",
            "FileDetails_ChaptersJson": None,
            "CreatedAt": nr["CreatedAt"]
        })
        book_file_base = book_filenames.get(book_id, sanitize_filename(book["Title"]))
        
        # Note filename: deterministic and unique
        note_file_base = f"{book_file_base} - Note {note_id[:8]}"
        note_file_path = notes_dir / f"{note_file_base}.md"

        # Concept tags as flat comma-separated scalar
        concept_raw = nr["ConceptList"] or ""
        concept_items = [c for c in concept_raw.split("||") if c]
        concept_tags = ", ".join(concept_items)

        # Derived chapter
        chapter = derive_chapter(nr["CfiRange"], book.get("FileDetails_ChaptersJson"))

        # Frontmatter properties (all flat scalars for Dataview compatibility)
        # Note: NoteModel has no UpdatedAt column in Nostos schema, so updated_at
        # mirrors created_at as an ISO-8601 UTC fallback.
        iso_created = to_iso8601_utc(nr["CreatedAt"])
        frontmatter_props = {
            "id": note_id,
            "book_id": book_id,
            "book_title": book["Title"],
            "author": book["Author"] or "",
            "book_link": f"[[{book_file_base}]]",
            "chapter": chapter,
            "cfi_range": nr["CfiRange"] or "",
            "concept_tags": concept_tags,
            "created_at": iso_created,
            "updated_at": iso_created,
        }

        frontmatter = format_frontmatter(frontmatter_props)

        # Body adhering to formatNotesMarkdown() conventions
        body_lines = [
            frontmatter,
            "",
            f"# Note — [[{book_file_base}|{book['Title']}]]" + (f" by {book['Author']}" if book.get('Author') else ""),
            "",
        ]

        selected_text = nr["SelectedText"]
        if selected_text and selected_text.strip():
            for line in selected_text.strip().splitlines():
                body_lines.append(f"> {line}")
            body_lines.append("")

        body_lines.append(nr["Content"])
        body_lines.append("")
        body_lines.append(f"*{nr['CreatedAt']}*")
        body_lines.append("")
        body_lines.append("---")
        body_lines.append("")

        note_file_path.write_text("\n".join(body_lines), encoding="utf-8")
        emitted_notes += 1

        # Record backlink info
        note_meta = {
            "id": note_id,
            "file_base": note_file_base,
            "book_title": book["Title"],
            "book_file_base": book_file_base,
            "created_at": nr["CreatedAt"],
            "concepts": concept_items,
        }
        if book_id in book_notes_map:
            book_notes_map[book_id].append(note_meta)
        for c in concept_items:
            if c in concept_notes_map:
                concept_notes_map[c].append(note_meta)

    # 5. Generate Book markdown notes
    emitted_books = 0
    for bid, b in books.items():
        linked_notes = book_notes_map.get(bid, [])
        if not linked_notes:
            continue  # Only generate book index notes for books with notes in this vault

        b_base = book_filenames[bid]
        b_path = books_dir / f"{b_base}.md"

        b_frontmatter = format_frontmatter({
            "id": bid,
            "type": "book",
            "title": b["Title"],
            "author": b["Author"] or "",
            "book_type": b.get("BookType") or "ebook",
            "created_at": to_iso8601_utc(b.get("CreatedAt")),
            "notes_count": str(len(linked_notes)),
        })

        b_lines = [
            b_frontmatter,
            "",
            f"# {b['Title']}",
            "",
            f"**Author:** {b['Author'] or 'Unknown'}" if b.get('Author') else "",
            f"**Format:** {b.get('BookType') or 'ebook'}",
            "",
            "## Notes",
            "",
        ]
        for idx, n in enumerate(linked_notes, 1):
            b_lines.append(f"- [[{n['file_base']}|Note {idx} ({n['id'][:8]})]] — *{n['created_at']}*")

        b_lines.append("")
        b_path.write_text("\n".join(b_lines), encoding="utf-8")
        emitted_books += 1

    # 6. Generate Concept markdown notes
    emitted_concepts = 0
    for c in concepts.values():
        c_name = c["Concept"]
        c_clean = sanitize_filename(c_name)
        c_path = concepts_dir / f"{c_clean}.md"
        linked_notes = concept_notes_map.get(c_name, [])

        c_frontmatter = format_frontmatter({
            "id": c["Id"],
            "type": "concept",
            "name": c_name,
            "references_count": str(len(linked_notes)),
        })

        c_lines = [
            c_frontmatter,
            "",
            f"# {c_name}",
            "",
            "Concept extracted from Nostos Second Brain.",
            "",
            "## Linked Notes",
            "",
        ]
        if linked_notes:
            for n in linked_notes:
                c_lines.append(f"- [[{n['file_base']}|Note in {n['book_title']}]]")
        else:
            c_lines.append("_No active note references._")

        c_lines.append("")
        c_path.write_text("\n".join(c_lines), encoding="utf-8")
        emitted_concepts += 1

    # 7. Generate Root Index
    index_path = out_path / "Index.md"
    index_lines = [
        "---",
        "type: \"vault_index\"",
        "source: \"Nostos Second Brain\"",
        f"notes_count: \"{emitted_notes}\"",
        f"books_count: \"{emitted_books}\"",
        f"concepts_count: \"{emitted_concepts}\"",
        "---",
        "",
        "# Nostos Second Brain Vault",
        "",
        "Exported from Nostos SQLite database.",
        "",
        "## Books",
        "",
    ]
    for bid, b in books.items():
        if bid in book_notes_map and book_notes_map[bid]:
            b_base = book_filenames[bid]
            index_lines.append(f"- [[{b_base}|{b['Title']}]] ({len(book_notes_map[bid])} notes)")

    index_lines.append("")
    index_lines.append("## Concepts")
    index_lines.append("")
    for c in sorted(concepts.values(), key=lambda x: x["Concept"].lower()):
        c_clean = sanitize_filename(c["Concept"])
        ref_count = len(concept_notes_map.get(c["Concept"], []))
        index_lines.append(f"- [[{c_clean}|{c['Concept']}]] ({ref_count} references)")

    index_lines.append("")
    index_path.write_text("\n".join(index_lines), encoding="utf-8")

    conn.close()

    print(f"Vault generation complete:")
    print(f"  Notes generated:    {emitted_notes}")
    print(f"  Books generated:    {emitted_books}")
    print(f"  Concepts generated: {emitted_concepts}")
    print(f"  Index note:         {index_path}")
    print(f"  Total markdown files: {emitted_notes + emitted_books + emitted_concepts + 1}")

if __name__ == "__main__":
    worktree_root = Path(__file__).resolve().parent.parent.parent
    default_db = worktree_root / "Nostos.Backend" / "nostos.db"
    default_out = Path(__file__).resolve().parent / "out"

    db = sys.argv[1] if len(sys.argv) > 1 else str(default_db)
    out = sys.argv[2] if len(sys.argv) > 2 else str(default_out)

    generate_vault(db, out)
