namespace CodeChroma.Canvas.Geometry;

public readonly record struct Point(double X, double Y);

public readonly record struct Rect(double Left, double Top, double Width, double Height)
{
    public double Right => Left + Width;
    public double Bottom => Top + Height;
    public double CenterX => Left + Width / 2;
    public double CenterY => Top + Height / 2;
    public bool Intersects(Rect other) => throw new NotImplementedException();
}

public readonly record struct Box(double X, double Y, double Width, double Height);

public enum Side { Left, Right, Top, Bottom }
