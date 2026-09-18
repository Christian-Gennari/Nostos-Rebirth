#!/usr/bin/env python3
"""
build_fixture.py - Build a synthetic SQLite fixture for Nostos Obsidian vault testing.

Contains only invented, fictional data to ensure no private library notes or titles
are published to public repositories. Exercises all integration paths:
- Same-title / multi-edition disambiguation ((physical) and (edition))
- EPUB CFI formatting
- PDF pageNumber JSON formatting
- Audiobook seconds with matching FileDetails_ChaptersJson
- Missing CfiRange
- With and without SelectedText
- Note content with [[wikilinks]]
- Concept referenced by multiple notes (backlink verification)
"""

import sys
import os
import json
import sqlite3
from pathlib import Path

def build_fixture(db_path: str):
    p = Path(db_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        p.unlink()

    conn = sqlite3.connect(str(p))
    cur = conn.cursor()

    # Create minimal schema required by generate_vault.py and validate_vault.py
    cur.execute("""
    CREATE TABLE Books (
        Id TEXT NOT NULL PRIMARY KEY,
        Title TEXT NOT NULL,
        Author TEXT NULL,
        BookType TEXT NOT NULL,
        FileDetails_ChaptersJson TEXT NULL,
        CreatedAt TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE Notes (
        Id TEXT NOT NULL PRIMARY KEY,
        BookId TEXT NOT NULL,
        Content TEXT NOT NULL,
        CreatedAt TEXT NOT NULL,
        CfiRange TEXT NULL,
        SelectedText TEXT NULL,
        FOREIGN KEY (BookId) REFERENCES Books(Id)
    );
    """)

    cur.execute("""
    CREATE TABLE Concepts (
        Id TEXT NOT NULL PRIMARY KEY,
        Concept TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE NoteConcepts (
        NoteId TEXT NOT NULL,
        ConceptId TEXT NOT NULL,
        PRIMARY KEY (NoteId, ConceptId),
        FOREIGN KEY (NoteId) REFERENCES Notes(Id),
        FOREIGN KEY (ConceptId) REFERENCES Concepts(Id)
    );
    """)

    # Chapters JSON for audiobook
    audio_chapters = json.dumps([
        {"Title": "Prologue: Signals", "StartTime": 0.0},
        {"Title": "Chapter 1: The First Resonance", "StartTime": 300.0},
        {"Title": "Chapter 2: Deep Frequencies", "StartTime": 900.0},
    ])

    # 1. Insert Books
    # Books 1 & 2 have the same title to exercise (physical) / (edition) disambiguation
    books = [
        (
            "b1111111-1111-1111-1111-111111111111",
            "The Architecture of Dreams",
            "Corin Mercer",
            "physical",
            None,
            "2026-01-10 09:00:00.0000000"
        ),
        (
            "b2222222-2222-2222-2222-222222222222",
            "The Architecture of Dreams",
            "Corin Mercer",
            "",  # empty BookType triggers 'edition' fallback
            None,
            "2026-01-15 14:30:00.0000000"
        ),
        (
            "b3333333-3333-3333-3333-333333333333",
            "Principles of Stellar Navigation",
            "Dr. Evelyn Thorne",
            "ebook",
            None,
            "2026-02-01 11:15:00.0000000"
        ),
        (
            "b4444444-4444-4444-4444-444444444444",
            "Manual of Cartography",
            "Marcus Vance",
            "pdf",
            None,
            "2026-02-10 16:45:00.0000000"
        ),
        (
            "b5555555-5555-5555-5555-555555555555",
            "Voices in the Void",
            "Aria Sterling",
            "audiobook",
            audio_chapters,
            "2026-03-01 08:20:00.0000000"
        ),
    ]
    cur.executemany("INSERT INTO Books VALUES (?, ?, ?, ?, ?, ?)", books)

    # 2. Insert Concepts
    concepts = [
        ("c1111111-1111-1111-1111-111111111111", "memory-palace"),
        ("c2222222-2222-2222-2222-222222222222", "wayfinding"),
        ("c3333333-3333-3333-3333-333333333333", "resonance"),
        ("c4444444-4444-4444-4444-444444444444", "void-silence"),
    ]
    cur.executemany("INSERT INTO Concepts VALUES (?, ?)", concepts)

    # 3. Insert Notes
    # Note 1: Missing CfiRange, has SelectedText, links to [[memory-palace]]
    # Note 2: Missing CfiRange, NO SelectedText, links to [[wayfinding]]
    # Note 3: EPUB CFI, has SelectedText, links to [[wayfinding]] (wayfinding referenced by 2 notes)
    # Note 4: PDF CfiRange JSON, has SelectedText, links to [[memory-palace]] (memory-palace referenced by 2 notes)
    # Note 5: Audiobook seconds, NO SelectedText, links to [[resonance]]
    # Note 6: Audiobook seconds, has SelectedText, links to [[void-silence]]
    notes = [
        (
            "n1111111-1111-1111-1111-111111111111",
            "b1111111-1111-1111-1111-111111111111",
            "Spatial layout acts as a scaffold for cognitive retrieval, reinforcing the [[memory-palace]] technique across structured spaces.",
            "2026-03-10 10:00:00.0000000",
            None,
            "A structure remembered is a structure inhabited."
        ),
        (
            "n2222222-2222-2222-2222-222222222222",
            "b2222222-2222-2222-2222-222222222222",
            "The revised introduction emphasizes how mental maps facilitate [[wayfinding]] and cognitive anchoring in unfamiliar environments.",
            "2026-03-11 11:30:00.0000000",
            None,
            None
        ),
        (
            "n3333333-3333-3333-3333-333333333333",
            "b3333333-3333-3333-3333-333333333333",
            "Calculating azimuth angles relies on ancient methods of celestial [[wayfinding]] adapted for deep orbital trajectories.",
            "2026-03-12 14:15:00.0000000",
            "epubcfi(/6/4[chap02]!/4/2/10/1:0)",
            "Navigation is the dialogue between where you stand and where the stars beacon."
        ),
        (
            "n4444444-4444-4444-4444-444444444444",
            "b4444444-4444-4444-4444-444444444444",
            "Contour projections preserve relative scale, allowing intuitive spatial [[memory-palace]] mapping.",
            "2026-03-13 09:45:00.0000000",
            '{"pageNumber": 36}',
            "Every map is an argument about what matters in the landscape."
        ),
        (
            "n5555555-5555-5555-5555-555555555555",
            "b5555555-5555-5555-5555-555555555555",
            "Acoustic attenuation in open chambers creates an uncanny [[resonance]] that shifts auditory perception.",
            "2026-03-14 18:00:00.0000000",
            "450.0",
            None
        ),
        (
            "n6666666-6666-6666-6666-666666666666",
            "b5555555-5555-5555-5555-555555555555",
            "In total silence, the mind constructs phantom frequencies to fill the [[void-silence]].",
            "2026-03-15 20:30:00.0000000",
            "950.0",
            "The void does not echo; it absorbs."
        ),
    ]
    cur.executemany("INSERT INTO Notes VALUES (?, ?, ?, ?, ?, ?)", notes)

    # 4. Insert NoteConcepts mappings
    note_concepts = [
        ("n1111111-1111-1111-1111-111111111111", "c1111111-1111-1111-1111-111111111111"), # Note 1 -> memory-palace
        ("n2222222-2222-2222-2222-222222222222", "c2222222-2222-2222-2222-222222222222"), # Note 2 -> wayfinding
        ("n3333333-3333-3333-3333-333333333333", "c2222222-2222-2222-2222-222222222222"), # Note 3 -> wayfinding
        ("n4444444-4444-4444-4444-444444444444", "c1111111-1111-1111-1111-111111111111"), # Note 4 -> memory-palace
        ("n5555555-5555-5555-5555-555555555555", "c3333333-3333-3333-3333-333333333333"), # Note 5 -> resonance
        ("n6666666-6666-6666-6666-666666666666", "c4444444-4444-4444-4444-444444444444"), # Note 6 -> void-silence
    ]
    cur.executemany("INSERT INTO NoteConcepts VALUES (?, ?)", note_concepts)

    conn.commit()
    conn.close()
    print(f"Synthetic fixture database built successfully at: {p}")
    print("  Books:        5 (including same-title physical and edition disambiguation)")
    print("  Notes:        6 (EPUB CFI, PDF pageNumber, audio seconds + chapters, missing CFI, with/without SelectedText)")
    print("  Concepts:     4 (wayfinding & memory-palace referenced by 2 notes each)")
    print("  NoteConcepts: 6")

if __name__ == "__main__":
    default_target = Path(__file__).resolve().parent / "nostos-fixture.db"
    target = sys.argv[1] if len(sys.argv) > 1 else str(default_target)
    build_fixture(target)
