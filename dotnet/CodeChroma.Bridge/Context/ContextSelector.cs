namespace CodeChroma.Bridge.Context;

public sealed record Selection(IReadOnlyList<PageInfo> Seeds, IReadOnlyList<PageInfo> Neighbours);

/// <summary>Phrase → components: per-phrase z-score of cosine similarity to the page titles, max over phrases, then import-edge neighbours.</summary>
public static class ContextSelector
{
    public static Selection Select(ContextData data, float[][] titleEmbeddings, float[][] phraseEmbeddings)
    {
        var scores = Score(titleEmbeddings, phraseEmbeddings);
        var order = Enumerable.Range(0, data.Pages.Count).OrderByDescending(i => scores[i]).ToList();
        var seeds = order.Take(ContextLimits.Seeds).Select(i => data.Pages[i]).ToList();
        var seedIds = seeds.Select(p => p.Id).ToHashSet();
        var weights = new Dictionary<string, int>();
        foreach (var edge in data.Edges)
        {
            if (seedIds.Contains(edge.From) && !seedIds.Contains(edge.To)) weights[edge.To] = weights.GetValueOrDefault(edge.To) + edge.Count;
            if (seedIds.Contains(edge.To) && !seedIds.Contains(edge.From)) weights[edge.From] = weights.GetValueOrDefault(edge.From) + edge.Count;
        }
        var rank = order.Select((index, position) => (data.Pages[index].Id, position)).ToDictionary(x => x.Id, x => x.position);
        var neighbours = data.Pages.Where(p => weights.GetValueOrDefault(p.Id) >= ContextLimits.MinEdgeWeight)
            .OrderBy(p => rank[p.Id]).Take(ContextLimits.MaxNeighbours).ToList();
        return new Selection(seeds, neighbours);
    }

    /// <summary>Best z-scored similarity of each page over all phrases.</summary>
    public static double[] Score(float[][] titles, float[][] phrases)
    {
        var best = Enumerable.Repeat(double.NegativeInfinity, titles.Length).ToArray();
        foreach (var phrase in phrases)
        {
            var sims = titles.Select(t => (double)Dot(t, phrase)).ToArray();
            var mean = sims.Average();
            var deviation = Math.Sqrt(sims.Sum(s => (s - mean) * (s - mean)) / sims.Length);
            for (var i = 0; i < sims.Length; i++) best[i] = Math.Max(best[i], deviation == 0 ? 0 : (sims[i] - mean) / deviation);
        }
        return best;
    }

    private static float Dot(float[] a, float[] b)
    {
        float sum = 0;
        for (var i = 0; i < a.Length; i++) sum += a[i] * b[i];
        return sum;
    }
}
