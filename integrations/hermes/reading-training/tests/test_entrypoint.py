"""Tests for the plugin entrypoint import layout (Task 10B2).

Pins the two loading shapes the top-level ``__init__.py`` must support:

* synthetic package load — the Hermes loader imports the plugin directory as
  ``hermes_plugins.<slug>`` with the directory on the search path (verified
  against the real ``hermes_cli.plugins`` loader, which produced the module
  ``hermes_plugins.reading_training.nostos_reading_connector.hooks``);
* direct file import — pytest/diagnostics load ``__init__.py`` standalone,
  where no parent package exists and the fallback must import the package
  by its plain name.

In both shapes exactly one ``register`` function is exposed — the package's
own, never a second conflicting definition — and calling it registers both
hooks on a real ``PluginContext``.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest

pytest.importorskip(
    "hermes_cli.plugins", reason="requires the Hermes venv (hermes_cli importable)"
)
from hermes_cli.plugins import (  # noqa: E402  # type: ignore[reportMissingImports]
    PluginContext,
    PluginManifest,
    PluginManager,
)

PLUGIN_DIR = Path(__file__).resolve().parents[1]
ENTRYPOINT = PLUGIN_DIR / "__init__.py"


@pytest.fixture
def manager() -> PluginManager:
    return PluginManager()


def _load_file(name: str, path: Path, submodule_search_locations=None) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(
        name, path, submodule_search_locations=submodule_search_locations
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _hermetic_config(monkeypatch) -> None:
    """Never read the real Hermes config during entrypoint tests."""
    monkeypatch.setattr(
        "hermes_cli.config.load_config_readonly", lambda: {}
    )


class TestSyntheticPackageLoad:
    """The loader shape: ``hermes_plugins.<slug>`` with the dir on sys.path."""

    def test_relative_import_resolves_inside_synthetic_package(self, monkeypatch, manager):
        _hermetic_config(monkeypatch)
        parent = types.ModuleType("hermes_plugins")
        parent.__path__ = []
        sys.modules["hermes_plugins"] = parent
        created = [
            "hermes_plugins",
            "hermes_plugins.reading_training",
            "hermes_plugins.reading_training.nostos_reading_connector",
            "hermes_plugins.reading_training.nostos_reading_connector.client",
            "hermes_plugins.reading_training.nostos_reading_connector.routing",
            "hermes_plugins.reading_training.nostos_reading_connector.hooks",
        ]
        try:
            module = _load_file(
                "hermes_plugins.reading_training",
                ENTRYPOINT,
                submodule_search_locations=[str(PLUGIN_DIR)],
            )
            sub = sys.modules["hermes_plugins.reading_training.nostos_reading_connector"]
            # Exactly one register — the package's — no duplicate definition.
            assert module.register is sub.register
            assert callable(module.register)
            assert module.__all__ == ["register"]

            ctx = PluginContext(
                PluginManifest(name="reading-training", key="reading-training", kind="standalone"),
                manager,
            )
            module.register(ctx)
            assert manager.has_hook("pre_gateway_dispatch")
            assert manager.has_hook("pre_llm_call")
            assert manager._hooks["pre_gateway_dispatch"] == [
                sys.modules["hermes_plugins.reading_training.nostos_reading_connector.hooks"]
                .pre_gateway_dispatch
            ]
        finally:
            for name in created:
                sys.modules.pop(name, None)
            assert "nostos_reading_connector" in sys.modules  # top-level copy untouched

    def test_direct_file_import_falls_back_to_plain_package(self):
        # Standalone name, no package context: the relative import cannot
        # exist, so the fallback must reuse the already-importable package.
        module = _load_file("reading_training_plugin", ENTRYPOINT)
        try:
            import nostos_reading_connector

            assert module.register is nostos_reading_connector.register
            assert callable(module.register)
            assert module.__all__ == ["register"]
        finally:
            sys.modules.pop("reading_training_plugin", None)

    def test_direct_file_import_register_works(self, monkeypatch, manager):
        _hermetic_config(monkeypatch)
        module = _load_file("reading_training_plugin", ENTRYPOINT)
        try:
            ctx = PluginContext(
                PluginManifest(name="reading-training", key="reading-training", kind="standalone"),
                manager,
            )
            module.register(ctx)
            assert manager.has_hook("pre_gateway_dispatch")
            assert manager.has_hook("pre_llm_call")
        finally:
            sys.modules.pop("reading_training_plugin", None)
