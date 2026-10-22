using System.Net;
using System.Text;

// Stand-in for the bundled bridge: same CLI (--repo-path, --port), same "bridge ready at" line, answers /health and /.
string? repo = null;
var port = 0;
for (var i = 0; i < args.Length - 1; i++)
{
    if (args[i] == "--repo-path") repo = args[i + 1];
    if (args[i] == "--port") port = int.Parse(args[i + 1]);
}

var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
listener.Start();
Console.WriteLine($"analyzing {repo}");
Console.WriteLine($"[codechroma-live] bridge ready at http://127.0.0.1:{port}");
Console.Out.Flush();

while (true)
{
    var context = await listener.GetContextAsync();
    try
    {
        var body = Encoding.UTF8.GetBytes(context.Request.Url!.AbsolutePath == "/health" ? "ok" : $"<html><body id=\"root\" data-repo=\"{repo}\">{repo}</body></html>");
        context.Response.ContentType = context.Request.Url.AbsolutePath == "/health" ? "text/plain" : "text/html";
        await context.Response.OutputStream.WriteAsync(body);
        context.Response.Close();
    }
    catch (Exception e) when (e is HttpListenerException or IOException or ObjectDisposedException)
    {
        // a client that aborted mid-response (e.g. a timed-out health probe) must not take the bridge down
    }
}
