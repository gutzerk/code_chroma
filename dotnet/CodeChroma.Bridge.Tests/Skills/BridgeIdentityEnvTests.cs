using CodeChroma.Bridge.Http;

namespace CodeChroma.Bridge.Tests.Skills;

public sealed class BridgeIdentityEnvTests
{
    [Fact]
    public void The_workspace_id_and_bridge_url_are_exported_under_their_upper_case_names()
    {
        var env = new Dictionary<string, string> { ["PATH"] = "/usr/bin" };

        BridgeAddress.ExportIdentity(env, "agent1", "http://127.0.0.1:51802");

        Assert.Equal("agent1", env["CODECHROMA_WORKSPACE_ID"]);
        Assert.Equal("http://127.0.0.1:51802", env["CODECHROMA_BRIDGE_URL"]);
        Assert.DoesNotContain("codechroma_WORKSPACE_ID", env.Keys);
    }

    [Fact]
    public void An_unknown_bridge_url_exports_only_the_workspace_id()
    {
        var env = new Dictionary<string, string>();

        BridgeAddress.ExportIdentity(env, "agent1", null);

        Assert.Equal(["CODECHROMA_WORKSPACE_ID"], env.Keys.ToList());
    }
}
