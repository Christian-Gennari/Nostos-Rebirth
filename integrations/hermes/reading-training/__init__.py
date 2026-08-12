"""Hermes plugin entrypoint for the optional Nostos reading connector.

Required by the Hermes plugin loader: a directory plugin must contain a
``plugin.yaml`` manifest (``entrypoint: __init__.py``) and an ``__init__.py``
exposing ``register(ctx)``. The loader imports this file as
``hermes_plugins.<slug>`` with the plugin directory on the search path, so
the package-relative import below resolves to
``hermes_plugins.<slug>.nostos_reading_connector``. The fallback branch
exists only for direct-file imports (pytest, diagnostics) where there is no
parent package at all.

Exactly one ``register`` is ever exposed here — the package's own — never a
second definition, and the fallback is chosen deterministically from the
presence of a package context rather than from catching ``ImportError``
(which could mask a genuine import failure and silently load a duplicate
module instance under a second name).
"""

if __package__:  # Normal Hermes loader: package name is hermes_plugins.<slug>.
    from .nostos_reading_connector import register
else:  # Direct-file import used by pytest and diagnostics (no parent package).
    import sys as _sys
    from pathlib import Path as _Path

    _plugin_dir = str(_Path(__file__).resolve().parent)
    if _plugin_dir not in _sys.path:
        _sys.path.insert(0, _plugin_dir)
    from nostos_reading_connector import register

__all__ = ["register"]
