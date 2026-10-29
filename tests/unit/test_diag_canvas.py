from fastapi.testclient import TestClient


def test_drag_survives_a_reanalyze_with_real_file_change(bridge):
    add = {"ops": [{"op": "add_element", "temp_id": "t1", "render": "custom", "layer": "c1",
                     "label": "Box", "position": {"x": 10, "y": 20}}]}
    with TestClient(bridge.app) as client:
        r = client.patch("/repos/default/canvas", json=add)
        real_id = r.json()["id_map"]["t1"]

        move = {"ops": [{"op": "update_element", "id": real_id, "position": {"x": 500, "y": 600}}]}
        r2 = client.patch("/repos/default/canvas", json=move)
        print("PATCH move ok:", r2.json())

        # Make a real code change, like editing a file while the canvas is open.
        (bridge.repo / "new_file.py").write_text("x = 1\n", encoding="utf-8")

        ws = bridge.registry.get("default")
        changed = ws.sync()
        print("sync() changed:", changed)

        r3 = client.get("/repos/default/canvas")
        pos = r3.json()["elements"][real_id]["position"]
        print("position after reanalyze:", pos)
        assert pos == {"x": 500.0, "y": 600.0}
