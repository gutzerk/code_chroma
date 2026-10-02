namespace Polyglot
{
    public class Greeter
    {
        /// <summary>
        /// Builds the greeting for a name.
        /// </summary>
        public string Hello(string name)
        {
            return "hi " + name;
        }

        private string Helper()
        {
            return "unused";
        }
    }
}
