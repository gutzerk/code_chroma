using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>The machine-wide canvas style: one file every project's bridge reads and writes.</summary>
public class CanvasStyleRouteTests
{
    private static JsonObject Style(string bg = "#0B1A2A", int opacity = 20) =>
        new() { ["bg"] = bg, ["texture"] = "lines", ["textureColor"] = "#294766", ["opacity"] = opacity, ["spacing"] = 32 };

    [Fact]
    public async Task A_saved_style_is_returned_normalized_and_deleting_it_restores_the_default()
    {
        using var host = new BridgeHost();
        var before = await host.Client.GetStringAsync("/canvas-style");

        var put = await host.Client.PutAsJsonAsync("/canvas-style", Style());
        var saved = await host.Client.GetFromJsonAsync<JsonObject>("/canvas-style");
        await host.Client.DeleteAsync("/canvas-style");
        var after = await host.Client.GetStringAsync("/canvas-style");

        Assert.Equal("null", before);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("#0b1a2a", saved!["bg"]!.GetValue<string>());
        Assert.Equal(32, saved["spacing"]!.GetValue<int>());
        Assert.Equal("null", after);
    }

    [Theory]
    [InlineData("not-a-color", 20)]
    [InlineData("#0b1a2a", 99)]
    public async Task An_invalid_style_is_rejected_and_not_stored(string bg, int opacity)
    {
        using var host = new BridgeHost();

        var response = await host.Client.PutAsJsonAsync("/canvas-style", Style(bg, opacity));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("null", await host.Client.GetStringAsync("/canvas-style"));
    }
}
