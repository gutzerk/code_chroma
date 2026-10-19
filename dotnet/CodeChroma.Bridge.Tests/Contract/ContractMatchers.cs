using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Tests.Contract;

/// <summary>C# mirror of tests/contract/bridge_contract.py's matcher semantics; keep them identical.</summary>
public static partial class ContractMatchers
{
    [GeneratedRegex(@"\.\.(\w+)|\.(\w+)|\['([^']+)'\]|\[\*\]|\[(\w+)=([^\]]*)\]|\[(\d+)\]")]
    private static partial Regex Token();

    private static string NormPath(string text) => text.Replace('\\', '/');

    public static bool JsonMatches(JsonNode? expected, JsonNode? actual, string repo)
    {
        if (expected is JsonObject anyBox && anyBox.Count == 1 && anyBox["$any"] is JsonValue any && any.TryGetValue(out bool t) && t)
            return true;
        if (expected is null || actual is null) return expected is null && actual is null;
        switch (expected)
        {
            case JsonValue ev when ev.TryGetValue(out string? es):
                if (actual is not JsonValue av || !av.TryGetValue(out string? s)) return false;
                if (es!.Contains("$REPO"))
                    return string.Equals(NormPath(es.Replace("$REPO", repo)), NormPath(s!), StringComparison.OrdinalIgnoreCase);
                return es == s;
            case JsonValue ev when ev.TryGetValue(out bool eb):
                return actual is JsonValue ab && ab.TryGetValue(out bool b) && eb == b;
            case JsonValue ev:
                return actual is JsonValue an && an.GetValueKind() == System.Text.Json.JsonValueKind.Number
                    && ev.GetValueKind() == System.Text.Json.JsonValueKind.Number
                    && ev.GetValue<double>() == an.GetValue<double>();
            case JsonArray ea:
                return actual is JsonArray aa && ea.Count == aa.Count
                    && ea.Zip(aa).All(pair => JsonMatches(pair.First, pair.Second, repo));
            case JsonObject eo:
                return actual is JsonObject ao && eo.Count == ao.Count
                    && eo.All(kv => ao.ContainsKey(kv.Key) && JsonMatches(kv.Value, ao[kv.Key], repo));
        }
        return false;
    }

    public static (List<JsonNode?> Values, bool Fanned) Select(JsonNode? document, string path)
    {
        if (!path.StartsWith('$')) throw new ArgumentException($"path must start with $: {path}");
        var current = new List<JsonNode?> { document };
        var fanned = false;
        foreach (Match m in Token().Matches(path[1..]))
        {
            var step = new List<JsonNode?>();
            if (m.Groups[1].Success)
            {
                fanned = true;
                foreach (var node in current) Descend(node, m.Groups[1].Value, step);
            }
            else if (m.Groups[2].Success || m.Groups[3].Success)
            {
                var key = m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value;
                foreach (var node in current)
                    if (node is JsonObject o && o.ContainsKey(key)) step.Add(o[key]);
            }
            else if (m.Groups[4].Success)
            {
                fanned = true;
                foreach (var node in current)
                    if (node is JsonArray a)
                        step.AddRange(a.Where(item => item is JsonObject o && o.ContainsKey(m.Groups[4].Value)
                            && ScalarText(o[m.Groups[4].Value]) == m.Groups[5].Value));
            }
            else if (m.Groups[6].Success)
            {
                var index = int.Parse(m.Groups[6].Value);
                foreach (var node in current)
                    if (node is JsonArray a && index < a.Count) step.Add(a[index]);
            }
            else
            {
                fanned = true;
                foreach (var node in current)
                    if (node is JsonArray a) step.AddRange(a);
            }
            current = step;
        }
        return (current, fanned);
    }

    private static string? ScalarText(JsonNode? node) => node switch
    {
        null => "None",
        JsonValue v when v.TryGetValue(out bool b) => b ? "True" : "False",
        JsonValue v => v.ToString(),
        _ => node.ToJsonString(),
    };

    private static void Descend(JsonNode? node, string key, List<JsonNode?> found)
    {
        if (node is JsonObject o)
        {
            if (o.ContainsKey(key)) found.Add(o[key]);
            foreach (var kv in o) Descend(kv.Value, key, found);
        }
        else if (node is JsonArray a)
        {
            foreach (var item in a) Descend(item, key, found);
        }
    }

    public static string JsonType(JsonNode? value) => value switch
    {
        null => "null",
        JsonArray => "array",
        JsonObject => "object",
        JsonValue v when v.TryGetValue(out bool _) => "boolean",
        JsonValue v when v.GetValueKind() == System.Text.Json.JsonValueKind.Number => "number",
        _ => "string",
    };

    public static List<string> CheckFailures(JsonArray? checks, JsonNode? document, string repo)
    {
        var failures = new List<string>();
        foreach (var node in checks ?? [])
        {
            var check = node!.AsObject();
            var path = check["path"]!.GetValue<string>();
            var (values, fanned) = Select(document, path);
            var missing = !fanned && values.Count == 0;
            JsonNode? subject = fanned ? new JsonArray(values.Select(v => v?.DeepClone()).ToArray()) : values.FirstOrDefault();
            if (check.ContainsKey("absent"))
            {
                var wanted = check["absent"]!.GetValue<bool>();
                if ((values.Count == 0) != wanted) failures.Add($"{path}: absent={values.Count == 0}, wanted {wanted}");
            }
            else if (missing) failures.Add($"{path}: missing");
            else if (check.ContainsKey("equals") && !JsonMatches(check["equals"], subject, repo))
                failures.Add($"{path}: {subject?.ToJsonString()} != {check["equals"]?.ToJsonString()}");
            else if (check.ContainsKey("contains") && !Contains(subject, check["contains"]))
                failures.Add($"{path}: {subject?.ToJsonString()} lacks {check["contains"]?.ToJsonString()}");
            else if (check.ContainsKey("count") && (subject switch { JsonArray array => array.Count, JsonObject map => map.Count, _ => (int?)null }) != check["count"]!.GetValue<int>())
                failures.Add($"{path}: count != {check["count"]}");
            else if (check.ContainsKey("type") && JsonType(subject) != check["type"]!.GetValue<string>())
                failures.Add($"{path}: type {JsonType(subject)} != {check["type"]}");
        }
        return failures;
    }

    private static bool Contains(JsonNode? subject, JsonNode? wanted)
    {
        if (subject is JsonValue sv && sv.TryGetValue(out string? text))
            return wanted is JsonValue wv && wv.TryGetValue(out string? part) && text!.Contains(part!);
        if (subject is JsonArray list) return list.Any(item => JsonMatches(wanted, item, ""));
        return false;
    }

    public static List<string> ExpectationFailures(JsonObject expect, JsonNode? body, string repo)
    {
        var failures = new List<string>();
        if (expect.ContainsKey("json") && !JsonMatches(expect["json"], body, repo))
            failures.Add($"json mismatch:\n  expected {expect["json"]?.ToJsonString()}\n  actual   {body?.ToJsonString()}");
        failures.AddRange(CheckFailures(expect["checks"] as JsonArray, body, repo));
        return failures;
    }
}
