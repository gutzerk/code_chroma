namespace CodeChroma.Canvas.Geometry;

/// <summary>A point in canvas (model) coordinates.</summary>
public readonly record struct Point(double X, double Y);

/// <summary>An axis-aligned rectangle given by its top-left corner (the connectors' coordinate shape).</summary>
public readonly record struct Rect(double Left, double Top, double Width, double Height)
{
    public double Right => Left + Width;
    public double Bottom => Top + Height;
    public double CenterX => Left + Width / 2;
    public double CenterY => Top + Height / 2;

    /// <summary>True when the interiors overlap; rectangles that merely touch do not intersect.</summary>
    public bool Intersects(Rect other) =>
        Left < other.Right && other.Left < Right && Top < other.Bottom && other.Top < Bottom;
}

/// <summary>An axis-aligned box anchored at its top-left corner (the collision solver's coordinate shape).</summary>
public readonly record struct Box(double X, double Y, double Width, double Height);

public enum Side { Left, Right, Top, Bottom }

internal static class JsMath
{
    /// <summary>JavaScript Math.round: halves round toward positive infinity.</summary>
    public static double Round(double value) => Math.Floor(value + 0.5);

    public static double Round2(double value) => Math.Floor(value * 100 + 0.5) / 100;

    /// <summary>Shortest round-trip invariant text, never "-0" (JavaScript prints negative zero as 0).</summary>
    public static string Format(double value)
    {
        if (value == 0) value = 0;
        return value.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
    }
}
