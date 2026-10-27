using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Skills;

public sealed class WikiGeneralUpdateTests
{
    private static JsonObject Manifest() => JsonNode.Parse("""
        {"containers":[{"id":"app","name":"App","path":"c2/app.md","files":["app/a.py","app/b.py"]},
                       {"id":"gone","name":"Gone","path":"c2/gone.md","files":["old/x.py"]}],
         "components":[{"id":"alpha","name":"Alpha","container":"app","path":"c3/alpha.md","files":["app/a.py"]},
                       {"id":"beta","name":"Beta","container":"app","path":"c3/beta.md","files":["app/b.py"]},
                       {"id":"dead","name":"Dead","container":"gone","path":"c3/dead.md","files":["old/x.py"]}],
         "edges":[]}
        """)!.AsObject();

    private static List<string> Ids(JsonNode? list) => list!.AsArray().Select(n => n is JsonObject o ? o["id"]!.GetValue<string>() : n!.GetValue<string>()).ToList();

    [Fact]
    public void An_unchanged_grouping_leaves_every_page_unaffected_and_drops_the_vanished_ones()
    {
        var fresh = WikiGeneralTestData.Clusters(("c1", "top::app", ["app/a.py"]), ("c2", "top::app", ["app/b.py"]));

        var delta = WikiGeneralUpdate.DiffManifest(fresh, Manifest());

        Assert.Equal(["alpha", "beta"], Ids(delta["components"]!["unaffected"]));
        Assert.Equal(["dead"], Ids(delta["components"]!["deleted"]));
        Assert.Equal(["gone"], Ids(delta["containers"]!["deleted"]));
        Assert.Empty(Ids(delta["components"]!["created"]));
    }

    [Fact]
    public void A_group_whose_files_changed_is_rewritten_and_a_group_with_no_old_match_is_created()
    {
        var fresh = WikiGeneralTestData.Clusters(
            ("c1", "top::app", ["app/a.py", "app/extra.py"]), ("c2", "top::app", ["app/b.py"]), ("c3", "top::lib", ["lib/new.py"]));

        var delta = WikiGeneralUpdate.DiffManifest(fresh, Manifest());

        Assert.Equal(["alpha"], Ids(delta["components"]!["rewritten"]));
        var created = delta["components"]!["created"]!.AsArray().Single()!.AsObject();
        Assert.Equal("lib", created["id"]!.GetValue<string>());
        Assert.Equal("Lib", created["name"]!.GetValue<string>());
        Assert.Equal("lib", created["container"]!.GetValue<string>());
        Assert.Null(created["internal_id"]);
        Assert.Equal("lib", delta["containers"]!["created"]!.AsArray().Single()!["id"]!.GetValue<string>());
    }

    [Fact]
    public void Applying_a_delta_removes_deleted_pages_and_links_and_records_created_entries()
    {
        using var host = new BridgeHost();
        var dir = WikiGeneral.Dir(host.Root);
        Directory.CreateDirectory(Path.Combine(dir, "c2"));
        Directory.CreateDirectory(Path.Combine(dir, "c3"));
        File.WriteAllText(Path.Combine(dir, "manifest.json"), Manifest().ToJsonString());
        File.WriteAllText(Path.Combine(dir, "index.md"), "# Repo\n\n- [App](c2/app.md) — App.\n- [Gone](c2/gone.md) — Gone.\n");
        File.WriteAllText(Path.Combine(dir, "c2", "gone.md"), "# Gone\n\n- [Dead](../c3/dead.md) — Dead.\n");
        File.WriteAllText(Path.Combine(dir, "c3", "dead.md"), "# Dead\n");
        var fresh = WikiGeneralTestData.Clusters(("c1", "top::app", ["app/a.py"]), ("c2", "top::app", ["app/b.py"]), ("c3", "top::lib", ["lib/new.py"]));
        var delta = WikiGeneralUpdate.DiffManifest(fresh, Manifest());
        var workspace = host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get("main");

        WikiGeneralUpdate.ApplyDelta(workspace, delta);

        var manifest = (JsonObject)JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "manifest.json")))!;
        Assert.False(File.Exists(Path.Combine(dir, "c3", "dead.md")));
        Assert.False(File.Exists(Path.Combine(dir, "c2", "gone.md")));
        Assert.DoesNotContain("gone.md", File.ReadAllText(Path.Combine(dir, "index.md")));
        Assert.Equal(["alpha", "beta", "lib"], Ids(manifest["components"]));
        Assert.Equal(["app", "lib"], Ids(manifest["containers"]));
        Assert.Equal("c3/lib.md", manifest["components"]!.AsArray()[2]!["path"]!.GetValue<string>());
    }

    [Fact]
    public void A_new_group_reuses_the_id_of_a_component_that_no_longer_exists_and_a_clash_suffixes_the_name()
    {
        var fresh = WikiGeneralTestData.Clusters(("c1", "top::app", ["app/a.py"]), ("c2", "top::app", ["app/b.py"]), ("c3", "top::dead", ["z/dead/new.py"]), ("c4", "top::dead", ["y/dead/other.py"]));

        var delta = WikiGeneralUpdate.DiffManifest(fresh, Manifest());

        var created = delta["components"]!["created"]!.AsArray().Select(n => n!.AsObject()).ToList();
        Assert.Equal(["dead", "dead-2"], created.Select(c => c["id"]!.GetValue<string>()).ToList());
        Assert.Equal(["Dead", "Dead 2"], created.Select(c => c["name"]!.GetValue<string>()).ToList());
    }

    [Fact]
    public void Verifying_the_pages_reports_missing_and_untouched_pages_but_accepts_a_fresh_write()
    {
        using var host = new BridgeHost();
        var dir = WikiGeneral.Dir(host.Root);
        Directory.CreateDirectory(Path.Combine(dir, "c3"));
        var started = DateTime.UtcNow.AddSeconds(-1);
        string[] pages = ["c3/a.md", "c3/b.md"];
        File.WriteAllText(Path.Combine(dir, "c3", "a.md"), "# A\n");

        var missing = WikiGeneralUpdate.VerifyPagesWritten(host.Root, pages, started);
        File.WriteAllText(Path.Combine(dir, "c3", "b.md"), "# B\n");
        var fresh = WikiGeneralUpdate.VerifyPagesWritten(host.Root, pages, started);
        var untouched = WikiGeneralUpdate.VerifyPagesWritten(host.Root, pages, DateTime.UtcNow.AddMinutes(5));

        Assert.Contains("did not write 1 of 2", missing);
        Assert.Null(fresh);
        Assert.Contains("did not refresh 2 of 2", untouched);
        Assert.Null(WikiGeneralUpdate.VerifyPagesWritten(host.Root, [], started));
    }
}
