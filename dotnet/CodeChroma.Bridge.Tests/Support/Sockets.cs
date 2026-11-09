using System.Net.WebSockets;
using System.Text;

namespace CodeChroma.Bridge.Tests.Support;

/// <summary>Reads a test's events or terminal socket until a message matches.</summary>
public static class Sockets
{
    /// <summary>The first message `done` accepts; fails the test after 20 seconds.</summary>
    public static async Task<string> ReceiveUntil(WebSocket socket, Func<string, bool> done)
    {
        var buffer = new byte[16384];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (done(text)) return text;
        }
    }
}
