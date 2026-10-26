namespace CodeChroma.Shell.Tests;

public class FileSaverTests
{
    private sealed class FakePicker(string? path) : ISaveFilePicker
    {
        public string? SuggestedName { get; private set; }

        public Task<string?> PickAsync(string suggestedName, string mime)
        {
            SuggestedName = suggestedName;
            return Task.FromResult(path);
        }
    }

    [Fact]
    public async Task Chosen_path_receives_the_decoded_bytes()
    {
        var target = Path.Combine(Path.GetTempPath(), $"cc-save-{Guid.NewGuid():N}.png");
        var picker = new FakePicker(target);

        var reply = await new FileSaver(picker).SaveAsync("../map.png", "image/png", Convert.ToBase64String([1, 2, 3]));

        try
        {
            Assert.Equal([1, 2, 3], await File.ReadAllBytesAsync(target));
            Assert.Equal("map.png", picker.SuggestedName);
            Assert.Contains("\"saved\":true", reply);
        }
        finally
        {
            File.Delete(target);
        }
    }

    [Fact]
    public async Task Cancelled_dialog_saves_nothing()
    {
        var reply = await new FileSaver(new FakePicker(null)).SaveAsync("map.png", "image/png", "AQID");

        Assert.Contains("\"saved\":false", reply);
    }

    [Fact]
    public async Task Missing_content_is_rejected()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => new FileSaver(new FakePicker("x")).SaveAsync("map.png", "image/png", null));
    }
}
