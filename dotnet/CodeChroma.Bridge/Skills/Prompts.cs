using System.Reflection;
using System.Text;

namespace CodeChroma.Bridge.Skills;

/// <summary>Loads the shipped prompts/*.yaml (embedded) and renders them like Python's render_prompt.</summary>
public static class Prompts
{
    private static readonly Dictionary<string, Dictionary<string, string>> Cache = [];

    /// <summary>The key's template, with {name} placeholders filled only when variables are given.</summary>
    public static string Render(string name, params (string Name, string Value)[] variables) => Render(name, "prompt", variables);

    public static string Render(string name, string key, params (string Name, string Value)[] variables)
    {
        var template = Load(name)[key];
        return variables.Length > 0 ? Format(template, variables) : template;
    }

    /// <summary>str.format for simple names: {x} substitutes, {{ and }} are literal braces.</summary>
    public static string Format(string template, IReadOnlyList<(string Name, string Value)> variables)
    {
        if (variables.Count == 0) return template;
        var result = new StringBuilder(template.Length);
        for (var i = 0; i < template.Length; i++)
        {
            var c = template[i];
            if (c == '{' && i + 1 < template.Length && template[i + 1] == '{') { result.Append('{'); i++; }
            else if (c == '}' && i + 1 < template.Length && template[i + 1] == '}') { result.Append('}'); i++; }
            else if (c == '{')
            {
                var end = template.IndexOf('}', i);
                var key = template[(i + 1)..end];
                result.Append(variables.First(v => v.Name == key).Value);
                i = end;
            }
            else result.Append(c);
        }
        return result.ToString();
    }

    private static Dictionary<string, string> Load(string name)
    {
        lock (Cache)
        {
            if (Cache.TryGetValue(name, out var cached)) return cached;
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"prompts/{name}.yaml")
                ?? throw new KeyNotFoundException($"unknown prompt: {name}");
            using var reader = new StreamReader(stream, Encoding.UTF8);
            return Cache[name] = Parse(reader.ReadToEnd());
        }
    }

    /// <summary>The block-scalar subset the prompt files use: `key: |-` followed by two-space-indented lines.</summary>
    internal static Dictionary<string, string> Parse(string yaml)
    {
        var values = new Dictionary<string, string>();
        string? key = null;
        List<string>? lines = null;
        void Flush()
        {
            if (key is not null && lines is not null) values[key] = string.Join("\n", lines).TrimEnd('\n');
        }
        foreach (var raw in yaml.Replace("\r\n", "\n").Split('\n'))
        {
            if (raw.Length > 0 && !char.IsWhiteSpace(raw[0]) && raw.Contains(':'))
            {
                Flush();
                key = raw[..raw.IndexOf(':')];
                lines = [];
                var rest = raw[(raw.IndexOf(':') + 1)..].Trim();
                if (rest is not ("|-" or "|" or "")) { lines.Add(rest); }
            }
            else lines?.Add(raw.Length >= 2 ? raw[2..] : raw.TrimStart());
        }
        Flush();
        return values;
    }
}
