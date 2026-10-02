"""Unit tests for YamlAnalyzer: workflow / composite action / generic-fallback dialect detection."""

import pytest
import yaml

from codechroma.analyzers.yaml_analyzer import YamlAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_workflow_jobs_and_steps_become_classes_and_functions():
    source = (
        b"jobs:\n"
        b"  build:\n"
        b"    name: Build it\n"
        b"    steps:\n"
        b"      - name: Checkout\n"
        b"        uses: actions/checkout@v4\n"
        b"      - run: pytest\n"
        b"  test:\n"
        b"    steps:\n"
        b"      - run: pytest\n"
    )
    symbols = YamlAnalyzer().parse(".github/workflows/ci.yml", source)

    build = by_kind_name(symbols, SymbolKind.CLASS, "build")
    test_job = by_kind_name(symbols, SymbolKind.CLASS, "test")
    checkout = by_kind_name(symbols, SymbolKind.FUNCTION, "build.step_1")
    second_step = by_kind_name(symbols, SymbolKind.FUNCTION, "build.step_2")
    assert build.name == "Build it"
    assert test_job.name == "test"
    assert checkout.name == "Checkout" and checkout.parent_symbol_id == build.id
    assert second_step.name == "pytest"


def test_composite_action_with_steps_gets_a_class_and_step_functions():
    source = (
        b"name: My Action\n"
        b"description: Does a thing\n"
        b"runs:\n"
        b"  using: composite\n"
        b"  steps:\n"
        b"    - name: Step One\n"
        b"      run: echo hi\n"
        b"    - uses: actions/checkout@v4\n"
    )
    symbols = YamlAnalyzer().parse(".github/actions/my-action/action.yml", source)

    action = by_kind_name(symbols, SymbolKind.CLASS, "My Action")
    step_one = by_kind_name(symbols, SymbolKind.FUNCTION, "My Action.step_1")
    step_two = by_kind_name(symbols, SymbolKind.FUNCTION, "My Action.step_2")
    assert action.docstring == "Does a thing"
    assert step_one.name == "Step One" and step_one.parent_symbol_id == action.id
    assert step_two.name == "actions/checkout@v4"


def test_composite_action_without_composite_using_has_no_step_functions():
    source = b"name: Node Action\nruns:\n  using: node20\n  main: index.js\n"
    symbols = YamlAnalyzer().parse(".github/actions/node-action/action.yml", source)

    kinds = [s.kind for s in symbols]
    action = by_kind_name(symbols, SymbolKind.CLASS, "Node Action")
    assert kinds.count(SymbolKind.CLASS) == 1
    assert SymbolKind.FUNCTION not in kinds
    assert action.name == "Node Action"


def test_generic_fallback_reads_root_keys_of_a_non_action_yaml():
    source = (
        b'version: "3"\n'
        b"services:\n"
        b"  web:\n"
        b"    image: nginx\n"
        b"tags:\n"
        b"  - name: one\n"
        b"  - name: two\n"
    )
    symbols = YamlAnalyzer().parse("docker-compose.yml", source)

    kinds = [s.kind for s in symbols]
    services = by_kind_name(symbols, SymbolKind.CLASS, "services")
    tags = by_kind_name(symbols, SymbolKind.CLASS, "tags")
    item_one = by_kind_name(symbols, SymbolKind.FUNCTION, "tags.item_1")
    assert kinds.count(SymbolKind.CLASS) == 2
    assert services.name == "services"
    assert tags.name == "tags"
    assert item_one.name == "one"


def test_flat_yaml_without_nesting_has_only_a_module_symbol():
    source = b"key: value\nother: 123\n"
    symbols = YamlAnalyzer().parse("flat.yaml", source)

    assert len(symbols) == 1
    assert symbols[0].kind == SymbolKind.MODULE


def test_broken_yaml_raises_instead_of_failing_silently():
    with pytest.raises(yaml.YAMLError):
        YamlAnalyzer().parse("broken.yml", b"a: [1, 2\n")


def test_a_duplicate_top_level_key_uses_the_last_entry_like_real_yaml_semantics():
    source = b"name: First Action\nname: Second Action\nruns:\n  using: node20\n  main: index.js\n"
    symbols = YamlAnalyzer().parse(".github/actions/dup/action.yml", source)

    action = by_kind_name(symbols, SymbolKind.CLASS, "Second Action")
    assert action.name == "Second Action"


def test_multi_document_yaml_parses_each_document_instead_of_raising():
    source = (
        b"apiVersion: v1\n"
        b"kind: Service\n"
        b"metadata:\n"
        b"  name: svc\n"
        b"---\n"
        b"apiVersion: networking.k8s.io/v1\n"
        b"kind: NetworkPolicy\n"
        b"metadata:\n"
        b"  name: np\n"
    )
    symbols = YamlAnalyzer().parse("networkpolicy.yaml", source)

    qualnames = {s.qualified_name for s in symbols}
    assert "networkpolicy" in qualnames
    assert {"doc1.metadata", "doc2.metadata"} <= qualnames
