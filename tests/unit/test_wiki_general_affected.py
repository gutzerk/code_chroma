"""_diff_manifest()'s Update state-machine delta."""

from codechroma.bridge.wiki_general_agent import _diff_manifest
from codechroma.dependencies.clustering import ClusterResult, ComponentCluster, ContainerCluster


def test_a_file_moved_between_components_marks_both_old_and_new_component_rewritten():
    # billing keeps 2 untouched files so the vote isn't a 1-1 tie with auth's remaining file.
    old_manifest = {
        "containers": [
            {"id": "backend", "name": "Backend", "files": ["a.py", "b.py", "c.py", "e.py"]}
        ],
        "components": [
            {"id": "auth", "name": "Auth", "container": "backend", "files": ["a.py", "b.py"]},
            {"id": "billing", "name": "Billing", "container": "backend", "files": ["c.py", "e.py"]},
        ],
        "edges": [],
    }
    # b.py moves from auth into billing
    fresh = ClusterResult(
        components=[
            ComponentCluster(id="g0", container_id="c0", files=["a.py"]),
            ComponentCluster(id="g1", container_id="c0", files=["b.py", "c.py", "e.py"]),
        ],
        containers=[ContainerCluster(id="c0", component_ids=["g0", "g1"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    rewritten_ids = {entry["id"] for entry in delta["components"]["rewritten"]}
    assert rewritten_ids == {"auth", "billing"}
    assert delta["components"]["deleted"] == []
    assert delta["components"]["created"] == []


def test_an_emptied_component_is_marked_deleted():
    old_manifest = {
        "containers": [{"id": "backend", "name": "Backend", "files": ["a.py", "b.py"]}],
        "components": [
            {"id": "auth", "name": "Auth", "container": "backend", "files": ["a.py"]},
            {"id": "billing", "name": "Billing", "container": "backend", "files": ["b.py"]},
        ],
        "edges": [],
    }
    # billing's file b.py is deleted from the repo entirely; auth is untouched
    fresh = ClusterResult(
        components=[ComponentCluster(id="g0", container_id="c0", files=["a.py"])],
        containers=[ContainerCluster(id="c0", component_ids=["g0"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    assert delta["components"]["deleted"] == ["billing"]
    assert delta["components"]["unaffected"] == ["auth"]


def test_an_unrelated_component_stays_unaffected():
    old_manifest = {
        "containers": [
            {
                "id": "backend",
                "name": "Backend",
                "files": ["a.py", "b.py", "c.py", "e.py", "z.py"],
            },
        ],
        "components": [
            {"id": "auth", "name": "Auth", "container": "backend", "files": ["a.py", "b.py"]},
            {"id": "billing", "name": "Billing", "container": "backend", "files": ["c.py", "e.py"]},
            {"id": "unrelated", "name": "Unrelated", "container": "backend", "files": ["z.py"]},
        ],
        "edges": [],
    }
    # b.py moves from auth into billing; unrelated's z.py is never touched
    fresh = ClusterResult(
        components=[
            ComponentCluster(id="g0", container_id="c0", files=["a.py"]),
            ComponentCluster(id="g1", container_id="c0", files=["b.py", "c.py", "e.py"]),
            ComponentCluster(id="g2", container_id="c0", files=["z.py"]),
        ],
        containers=[ContainerCluster(id="c0", component_ids=["g0", "g1", "g2"])],
    )

    delta = _diff_manifest(fresh, old_manifest)

    assert delta["components"]["unaffected"] == ["unrelated"]
    assert {"auth", "billing"} == {e["id"] for e in delta["components"]["rewritten"]}
