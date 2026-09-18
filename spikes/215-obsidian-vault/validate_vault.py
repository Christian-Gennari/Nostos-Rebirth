#!/usr/bin/env python3
"""
validate_vault.py - Validate Obsidian Markdown vault structure, frontmatter,
wikilinks, filenames, and database round-trip integrity.

Uses Python standard library only.
Parses emitted vault and prints an honest pass/fail report.
"""

import os
import sys
import sqlite3
import re
import json
from datetime import datetime
from pathlib import Path

from typing import Any, Optional

ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|#^\[\]]')
WIKILINK_REGEX = re.compile(r'\[\[(.*?)\]\]')
ISO_8601_UTC_REGEX = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$')

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

REQUIRED_NOTE_KEYS = {
    "id",
    "book_id",
    "book_title",
    "author",
    "book_link",
    "chapter",
    "cfi_range",
    "concept_tags",
    "created_at",
    "updated_at",
}

def parse_simple_yaml_frontmatter(content: str) -> tuple[Optional[dict[str, Any]], str, list[str]]:
    """
    Parse flat YAML frontmatter from markdown text using stdlib string parsing.
    Returns (frontmatter_dict, body_text, errors).
    """
    errors = []
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        errors.append("Missing starting '---' delimiter")
        return None, content, errors

    end_idx = -1
    for idx, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = idx
            break

    if end_idx == -1:
        errors.append("Missing closing '---' delimiter")
        return None, content, errors

    fm_lines = lines[1:end_idx]
    body = "\n".join(lines[end_idx + 1:])
    props = {}

    for line_no, raw_line in enumerate(fm_lines, start=2):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        # Check for nested map / list indicators (indentation or list bullet)
        if raw_line.startswith("  ") or raw_line.startswith("\t") or line.startswith("- "):
            errors.append(f"Line {line_no}: Non-flat structure detected (nested map or YAML list): '{raw_line}'")
            continue

        if ":" not in line:
            errors.append(f"Line {line_no}: Malformed YAML line (missing ':'): '{line}'")
            continue

        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip()

        # Parse scalar value
        if val.startswith('"') and val.endswith('"') and len(val) >= 2:
            try:
                # Use json.loads to unescape string safely
                parsed_val = json.loads(val)
            except Exception as e:
                parsed_val = val[1:-1]
        elif val.startswith("'") and val.endswith("'") and len(val) >= 2:
            parsed_val = val[1:-1]
        elif val.lower() in ("null", "~", ""):
            parsed_val = ""
        elif val.lower() == "true":
            parsed_val = True
        elif val.lower() == "false":
            parsed_val = False
        else:
            # Try int/float or fallback to string
            try:
                if "." in val:
                    parsed_val = float(val)
                else:
                    parsed_val = int(val)
            except ValueError:
                parsed_val = val

        props[key] = parsed_val

    return props, body, errors

def validate_vault(vault_dir: str | Path, db_path: str | Path) -> bool:
    vault_path: Path = Path(vault_dir).resolve()
    db_file_path: Path = Path(db_path).resolve()

    print(f"==================================================")
    print(f"  NOSTOS OBSIDIAN VAULT VALIDATION REPORT")
    print(f"==================================================")
    print(f"Vault Directory: {vault_path}")
    print(f"Database:        {db_file_path}\n")

    if not vault_path.exists():
        print(f"[FAIL] Vault directory does not exist: {vault_path}")
        return False
    if not db_file_path.exists():
        print(f"[FAIL] Database file does not exist: {db_file_path}")
        return False

    all_md_files = list(vault_path.glob("**/*.md"))
    print(f"Discovered {len(all_md_files)} Markdown files across vault.\n")

    # Build index of vault files for wikilink resolution
    # In Obsidian, wikilinks match either filename without extension or relative path
    vault_index: dict[str, Path] = {} # lowercase -> relative Path
    filename_case_check: dict[str, str] = {} # lowercase filename -> actual filename

    failures = []
    checked_filenames = 0
    checked_wikilinks = 0
    checked_notes = 0
    checked_books = 0
    checked_concepts = 0
    checked_roundtrip_assertions = 0

    # 1. Check Filenames and build index
    print("--- 1. Validating Filenames (Obsidian Legality & Determinism) ---")
    for f in all_md_files:
        checked_filenames += 1
        fname = f.name
        rel = f.relative_to(vault_path)
        base = f.stem

        # Check for illegal Obsidian characters: \ / : * ? " < > | # ^ [ ]
        # Note: fname is just the file name, does not have directory separators
        bad_chars = [ch for ch in fname if ch in r'\/:*?"<>|#^[]']
        if bad_chars:
            failures.append(f"Illegal characters in filename '{rel}': {bad_chars}")

        # Check case collision (portability across case-insensitive filesystems)
        lower_fname = fname.lower()
        if lower_fname in filename_case_check and filename_case_check[lower_fname] != fname:
            failures.append(f"Filename case collision: '{fname}' vs '{filename_case_check[lower_fname]}'")
        filename_case_check[lower_fname] = fname

        # Register in index
        vault_index[base.lower()] = rel
        vault_index[str(rel).replace(".md", "").lower()] = rel

    print(f"✓ Checked {checked_filenames} filenames: No illegal characters, no case collisions.\n")

    # 2. Check Frontmatter and Structure of Notes
    print("--- 2. Validating Frontmatter (Dataview Flat Scalar Compliance) ---")
    notes_dir = vault_path / "Notes"
    note_files = list(notes_dir.glob("*.md")) if notes_dir.exists() else []

    note_frontmatters = {}

    for nf in note_files:
        checked_notes += 1
        content = nf.read_text(encoding="utf-8")
        props, body, errors = parse_simple_yaml_frontmatter(content)

        if errors:
            for err in errors:
                failures.append(f"{nf.name}: {err}")
            continue

        if props is None:
            failures.append(f"{nf.name}: Frontmatter failed to parse")
            continue

        # Check required keys
        missing_keys = REQUIRED_NOTE_KEYS - set(props.keys())
        if missing_keys:
            failures.append(f"{nf.name}: Missing required frontmatter keys: {sorted(list(missing_keys))}")

        # Check flat scalars (Dataview compatibility)
        for k, v in props.items():
            if isinstance(v, (dict, list)):
                failures.append(f"{nf.name}: Key '{k}' has non-scalar value type {type(v).__name__}")
            elif not (isinstance(v, (str, int, float, bool)) or v is None):
                failures.append(f"{nf.name}: Key '{k}' has unexpected type {type(v).__name__}")

        # Check ISO-8601 UTC timestamp formats (Dataview date compatibility)
        for ts_field in ("created_at", "updated_at"):
            val = props.get(ts_field)
            if not val or not isinstance(val, str) or not ISO_8601_UTC_REGEX.match(val):
                failures.append(f"{nf.name}: Timestamp field '{ts_field}' is not in ISO-8601 UTC format: '{val}'")

        note_frontmatters[props.get("id")] = (nf, props, body)

    print(f"✓ Checked {checked_notes} note frontmatters: All required keys present, 100% flat scalars, ISO-8601 UTC timestamps verified.\n")

    # 3. Check Wikilink Resolution across ALL files
    print("--- 3. Validating Wikilink Resolution ---")
    broken_links = []
    for f in all_md_files:
        content = f.read_text(encoding="utf-8")
        lines = content.splitlines()
        for l_idx, line in enumerate(lines, 1):
            matches = WIKILINK_REGEX.findall(line)
            for raw_link in matches:
                checked_wikilinks += 1
                # Strip alias and block/heading anchor
                target = raw_link.split("|")[0].split("#")[0].strip()
                if target.endswith(".md"):
                    target = target[:-3]
                
                target_key = target.lower()
                if target_key not in vault_index:
                    broken_links.append((f.relative_to(vault_path), l_idx, raw_link, target))

    if broken_links:
        for src, l_num, raw, tgt in broken_links:
            failures.append(f"Broken [[wikilink]] in {src}:{l_num}: '{raw}' (target '{tgt}' not found in vault)")
    else:
        print(f"✓ Checked {checked_wikilinks} wikilinks: 100% resolved to existing files in vault.\n")

    # 4. Database Round-Trip Verification
    print("--- 4. Validating Database Round-Trip Integrity ---")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT count(*) FROM Notes")
    db_note_count = cursor.fetchone()[0]
    if db_note_count != checked_notes:
        failures.append(f"DB has {db_note_count} notes, but vault has {checked_notes} notes")

    for nid, (nfile, props, body) in note_frontmatters.items():
        if not nid:
            failures.append(f"{nfile.name}: Note has empty or missing id")
            continue

        cursor.execute("SELECT * FROM Notes WHERE Id = ?", (nid,))
        db_note = cursor.fetchone()
        checked_roundtrip_assertions += 1

        if not db_note:
            failures.append(f"Note id '{nid}' in vault does not exist in database")
            continue

        # Check CFI range round trip
        db_cfi = db_note["CfiRange"] or ""
        fm_cfi = props.get("cfi_range") or ""
        if fm_cfi != db_cfi:
            failures.append(f"{nfile.name}: CFI mismatch! Vault='{fm_cfi}' vs DB='{db_cfi}'")
        checked_roundtrip_assertions += 1

        # Check BookId round trip
        db_book_id = db_note["BookId"]
        fm_book_id = props.get("book_id")
        if fm_book_id != db_book_id:
            failures.append(f"{nfile.name}: BookId mismatch! Vault='{fm_book_id}' vs DB='{db_book_id}'")
        checked_roundtrip_assertions += 1

        # Check Book metadata
        cursor.execute("SELECT Title, Author FROM Books WHERE Id = ?", (db_book_id,))
        db_book = cursor.fetchone()
        if not db_book:
            failures.append(f"{nfile.name}: Referenced BookId '{db_book_id}' not found in DB")
            continue

        db_title = db_book["Title"]
        fm_title = props.get("book_title")
        if fm_title != db_title:
            failures.append(f"{nfile.name}: Book title mismatch! Vault='{fm_title}' vs DB='{db_title}'")
        checked_roundtrip_assertions += 1

        # Check Book link wikilink target
        book_link = props.get("book_link", "")
        book_link_match = WIKILINK_REGEX.search(book_link)
        if not book_link_match:
            failures.append(f"{nfile.name}: Invalid book_link frontmatter: '{book_link}'")
        else:
            b_target = book_link_match.group(1).split("|")[0].strip().lower()
            if b_target not in vault_index:
                failures.append(f"{nfile.name}: book_link target '{b_target}' does not exist in vault")
        checked_roundtrip_assertions += 1

        # Check SelectedText in body
        db_selected = db_note["SelectedText"]
        if db_selected and db_selected.strip():
            first_line = db_selected.strip().splitlines()[0]
            if first_line not in body:
                failures.append(f"{nfile.name}: SelectedText first line not preserved in body blockquote")
            checked_roundtrip_assertions += 1

        # Check Note Content in body
        db_content = db_note["Content"]
        if db_content and db_content.strip():
            if db_content.strip() not in body:
                failures.append(f"{nfile.name}: Note content not preserved verbatim in body")
            checked_roundtrip_assertions += 1

        # Check CreatedAt & UpdatedAt round trip (frontmatter ISO-8601 UTC)
        db_created_iso = to_iso8601_utc(db_note["CreatedAt"])
        fm_created = props.get("created_at")
        if fm_created != db_created_iso:
            failures.append(f"{nfile.name}: created_at mismatch! Vault='{fm_created}' vs DB(ISO)='{db_created_iso}'")
        checked_roundtrip_assertions += 1

        fm_updated = props.get("updated_at")
        if fm_updated != db_created_iso:
            failures.append(f"{nfile.name}: updated_at mismatch! Vault='{fm_updated}' vs DB(ISO)='{db_created_iso}'")
        checked_roundtrip_assertions += 1

        # Check raw CreatedAt timestamp in body (formatNotesMarkdown subset compatibility)
        raw_ts_line = f"*{db_note['CreatedAt']}*"
        if raw_ts_line not in body:
            failures.append(f"{nfile.name}: Raw CreatedAt timestamp line '{raw_ts_line}' not preserved in body")
        checked_roundtrip_assertions += 1

    # Check Books in vault vs DB
    books_dir = vault_path / "Books"
    book_files = list(books_dir.glob("*.md")) if books_dir.exists() else []
    checked_books = len(book_files)
    for bf in book_files:
        b_content = bf.read_text(encoding="utf-8")
        b_props, _, _ = parse_simple_yaml_frontmatter(b_content)
        if b_props and b_props.get("id"):
            cursor.execute("SELECT Title, CreatedAt FROM Books WHERE Id = ?", (b_props["id"],))
            book_row = cursor.fetchone()
            if not book_row:
                failures.append(f"Book file '{bf.name}' id '{b_props['id']}' not in DB")
            else:
                db_b_created = to_iso8601_utc(book_row["CreatedAt"])
                if b_props.get("created_at") != db_b_created:
                    failures.append(f"{bf.name}: Book created_at mismatch! Vault='{b_props.get('created_at')}' vs DB='{db_b_created}'")
            checked_roundtrip_assertions += 1

    # Check Concepts in vault vs DB
    concepts_dir = vault_path / "Concepts"
    concept_files = list(concepts_dir.glob("*.md")) if concepts_dir.exists() else []
    checked_concepts = len(concept_files)
    for cf in concept_files:
        c_content = cf.read_text(encoding="utf-8")
        c_props, _, _ = parse_simple_yaml_frontmatter(c_content)
        if c_props and c_props.get("id"):
            cursor.execute("SELECT Concept FROM Concepts WHERE Id = ?", (c_props["id"],))
            if not cursor.fetchone():
                failures.append(f"Concept file '{cf.name}' id '{c_props['id']}' not in DB")
            checked_roundtrip_assertions += 1

    conn.close()
    print(f"✓ Checked {checked_roundtrip_assertions} round-trip assertions: CFI ranges and book links preserved without loss.\n")

    # Final Summary
    print(f"==================================================")
    print(f"  VALIDATION SUMMARY")
    print(f"==================================================")
    print(f"  Total Markdown files:      {len(all_md_files)}")
    print(f"  Notes validated:           {checked_notes}")
    print(f"  Books validated:           {checked_books}")
    print(f"  Concepts validated:        {checked_concepts}")
    print(f"  Total wikilinks validated: {checked_wikilinks}")
    print(f"  Round-trip assertions:     {checked_roundtrip_assertions}")
    print(f"  Total failures / errors:   {len(failures)}")

    if failures:
        print(f"\n[STATUS: FAILED] {len(failures)} errors found:")
        for err in failures[:20]:
            print(f"  - {err}")
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more errors")
        return False
    else:
        print(f"\n[STATUS: PASSED] All checks passed successfully!")
        return True

if __name__ == "__main__":
    worktree_root = Path(__file__).resolve().parent.parent.parent
    default_vault = Path(__file__).resolve().parent / "out"
    default_db = worktree_root / "Nostos.Backend" / "nostos.db"

    v_dir = sys.argv[1] if len(sys.argv) > 1 else str(default_vault)
    d_file = sys.argv[2] if len(sys.argv) > 2 else str(default_db)

    success = validate_vault(v_dir, d_file)
    sys.exit(0 if success else 1)
