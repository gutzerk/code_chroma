using CodeChroma.Core.Analyzers;
using TreeSitter;

namespace CodeChroma.Core.Patterns;

/// <summary>Per-file class-shape extraction for Python and Go; mirrors the extract_class_shapes functions in analyzers/.</summary>
public static class ClassShapeExtractor
{
    /// <summary>Shapes keyed by the symbol id the matching analyzer assigns; empty for languages without a shape hook.</summary>
    public static IReadOnlyDictionary<string, ClassShape> Extract(string filePath, string source) =>
        Path.GetExtension(filePath) switch
        {
            ".py" => Grammars.Parse("Python", source, root => PythonShapes(root, filePath)),
            ".go" => Grammars.Parse("Go", source, root => GoShapes(root, filePath)),
            _ => new Dictionary<string, ClassShape>(),
        };

    /// <summary>Shapes for every Python/Go file among <paramref name="relPaths"/> under <paramref name="root"/>; unreadable files are skipped.</summary>
    public static Dictionary<string, ClassShape> ExtractAll(string root, IEnumerable<string> relPaths)
    {
        var all = new Dictionary<string, ClassShape>();
        foreach (var rel in relPaths.OrderBy(p => p, StringComparer.Ordinal))
        {
            if (Path.GetExtension(rel) is not (".py" or ".go")) continue;
            try
            {
                var source = File.ReadAllText(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                foreach (var (id, shape) in Extract(rel, source)) all[id] = shape;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        return all;
    }

    // ---- Python --------------------------------------------------------------------------

    private static readonly string[] SelfNames = ["self"];
    private static readonly string[] ClsNames = ["cls"];

    private static Dictionary<string, ClassShape> PythonShapes(Node root, string filePath)
    {
        var shapes = new Dictionary<string, ClassShape>();

        void Visit(Node node, string? enclosing)
        {
            foreach (var child in node.Children)
            {
                var (target, decorators) = DecoratedTarget(child);
                if (target.Type == "class_definition")
                {
                    var name = target.Field("name")?.Text ?? "<anonymous>";
                    var qualname = !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name;
                    var classId = $"{filePath}::class::{qualname}";
                    var bases = CollectBases(target);
                    var shape = new ClassShape { Bases = bases, Decorators = decorators };
                    if (target.Field("body") is { } body) CollectClassBody(body, shape);
                    shape.IsAbstract = bases.Contains("ABC") || shape.Methods.Values.Any(m => m.Decorators.Contains("abstractmethod"));
                    shapes[classId] = shape;
                    Visit(target, qualname);
                }
                else if (target.Type == "function_definition")
                {
                    var name = target.Field("name")?.Text ?? "<anonymous>";
                    Visit(target, !string.IsNullOrEmpty(enclosing) ? $"{enclosing}.{name}" : name);
                }
                else Visit(child, enclosing);
            }
        }

        Visit(root, null);
        return shapes;
    }

    private static string? DecoratorName(Node decorator)
    {
        foreach (var child in decorator.Children)
        {
            if (child.Type is "identifier" or "attribute") return child.Text;
            if (child.Type == "call" && child.Field("function") is { } func) return func.Text;
        }
        return null;
    }

    private static (Node Target, List<string> Decorators) DecoratedTarget(Node node)
    {
        if (node.Type != "decorated_definition") return (node, []);
        var decorators = node.Children.Where(c => c.Type == "decorator").Select(DecoratorName).OfType<string>().ToList();
        return (node.Field("definition") ?? node, decorators);
    }

    private static List<string> CollectBases(Node classNode) =>
        classNode.Field("superclasses") is { } supers
            ? supers.Children.Where(c => c.Type is "identifier" or "attribute").Select(c => c.Text).ToList()
            : [];

    private static string AttrValueKind(Node node) => node.Type switch
    {
        "dictionary" => "dict",
        "list" => "list",
        "none" => "none",
        _ => "other",
    };

    private static void CollectClassAttr(Node statement, ClassShape shape)
    {
        var node = statement.Type == "assignment" ? statement : statement.Children.FirstOrDefault();
        if (node is null || node.Type != "assignment") return;
        var left = node.Field("left");
        var right = node.Field("right");
        if (left is { Type: "identifier" } && right is not null) shape.ClassAttrs[left.Text] = AttrValueKind(right);
    }

    private static void CollectClassBody(Node body, ClassShape shape)
    {
        foreach (var child in body.Children)
        {
            var (target, decorators) = DecoratedTarget(child);
            if (target.Type == "function_definition")
            {
                var name = target.Field("name")?.Text ?? "<anonymous>";
                var method = new MethodShape { Decorators = decorators };
                if (target.Field("body") is { } methodBody) CollectAttributeUsage(methodBody, method);
                shape.Methods[name] = method;
            }
            else if (target.Type is "expression_statement" or "assignment") CollectClassAttr(target, shape);
        }
    }

    /// <summary>(base, name) when <paramref name="node"/> is <c>self.x</c> / <c>cls.x</c>, else null.</summary>
    private static (string Base, string Name)? AttrRootAndName(Node? node)
    {
        if (node is null || node.Type != "attribute") return null;
        var obj = node.Field("object");
        var attr = node.Field("attribute");
        if (obj is not { Type: "identifier" } || attr is null) return null;
        var baseName = obj.Text;
        return SelfNames.Contains(baseName) || ClsNames.Contains(baseName) ? (baseName, attr.Text) : null;
    }

    private static void HandleAssignmentTarget(Node? left, MethodShape shape)
    {
        if (left is null) return;
        if (left.Type == "subscript")
        {
            if (AttrRootAndName(left.Field("value")) is { } sub && SelfNames.Contains(sub.Base)) shape.WritesDictAttrs.Add(sub.Name);
            return;
        }
        if (AttrRootAndName(left) is { } info && ClsNames.Contains(info.Base)) shape.SetsClassAttr.Add(info.Name);
    }

    private static void HandleAttributeCall(Node node, MethodShape shape)
    {
        var func = node.Field("function");
        if (func is not { Type: "attribute" }) return;
        var method = func.Field("attribute");
        if (method is null || AttrRootAndName(func.Field("object")) is not { } info || !SelfNames.Contains(info.Base)) return;
        if (!shape.CallsOnAttr.TryGetValue(info.Name, out var calls)) shape.CallsOnAttr[info.Name] = calls = [];
        calls.Add(method.Text);
        if (method.Text == "append") shape.AppendsListAttrs.Add(info.Name);
        else if (method.Text == "get") shape.ReadsDictAttrs.Add(info.Name);
    }

    private static void HandleNoneCheck(Node node, MethodShape shape)
    {
        var operands = node.Children.Where(c => c.IsNamed).ToList();
        if (operands.Count != 2) return;
        var (first, second) = (operands[0], operands[1]);
        Node? noneSide = first.Type == "none" ? first : second.Type == "none" ? second : null;
        if (noneSide is null) return;
        var other = ReferenceEquals(noneSide, first) ? second : first;
        if (AttrRootAndName(other) is { } info && ClsNames.Contains(info.Base)) shape.ChecksNoneClassAttr.Add(info.Name);
    }

    private static void CollectAttributeUsage(Node node, MethodShape shape)
    {
        if (node.Type == "assignment")
        {
            HandleAssignmentTarget(node.Field("left"), shape);
            if (node.Field("right") is { } right) CollectAttributeUsage(right, shape);
            return;
        }
        switch (node.Type)
        {
            case "call":
                HandleAttributeCall(node, shape);
                break;
            case "subscript":
                if (AttrRootAndName(node.Field("value")) is { } sub && SelfNames.Contains(sub.Base)) shape.ReadsDictAttrs.Add(sub.Name);
                break;
            case "for_statement":
                if (AttrRootAndName(node.Field("right")) is { } iter && SelfNames.Contains(iter.Base)) shape.IteratesAttrs.Add(iter.Name);
                break;
            case "comparison_operator":
                HandleNoneCheck(node, shape);
                break;
        }
        foreach (var child in node.Children) CollectAttributeUsage(child, shape);
    }

    // ---- Go ------------------------------------------------------------------------------

    private static Dictionary<string, ClassShape> GoShapes(Node root, string filePath)
    {
        var shapes = new Dictionary<string, ClassShape>();
        var typeIds = new Dictionary<string, string>();

        foreach (var node in root.Children)
        {
            if (node.Type != "type_declaration") continue;
            foreach (var spec in node.Children)
            {
                if (spec.Type != "type_spec") continue;
                var nameNode = spec.Field("name");
                var typeNode = spec.Field("type");
                if (nameNode is null || typeNode is null) continue;
                var name = nameNode.Text;
                var classId = $"{filePath}::class::{name}";
                typeIds[name] = classId;
                var shape = new ClassShape();
                if (typeNode.Type == "struct_type")
                {
                    shape.Kind = "struct";
                    if (typeNode.Children.FirstOrDefault(c => c.Type == "field_declaration_list") is { } body)
                        CollectStructBody(body, shape);
                }
                else if (typeNode.Type == "interface_type")
                {
                    shape.Kind = "interface";
                    shape.IsAbstract = true;
                    foreach (var elem in typeNode.Children.Where(c => c.Type == "method_elem"))
                        if (elem.Field("name") is { } methodName) shape.Methods[methodName.Text] = new MethodShape();
                }
                else shape.Kind = "type";
                shapes[classId] = shape;
            }
        }

        foreach (var node in root.Children)
        {
            if (node.Type != "method_declaration") continue;
            var receiverType = ReceiverTypeName(node);
            if (receiverType is null || !typeIds.TryGetValue(receiverType, out var ownerId)) continue;
            var nameNode = node.Field("name");
            if (nameNode is null) continue;
            var method = new MethodShape();
            var recvVar = ReceiverVarName(node);
            if (node.Field("body") is { } body && recvVar is not null) WalkMethodBody(body, method, recvVar);
            shapes[ownerId].Methods[nameNode.Text] = method;
        }
        return shapes;
    }

    private static Node? FindFirst(Node node, string type)
    {
        if (node.Type == type) return node;
        foreach (var child in node.Children)
            if (FindFirst(child, type) is { } found) return found;
        return null;
    }

    private static string? ReceiverTypeName(Node method) =>
        method.Field("receiver") is { } receiver ? FindFirst(receiver, "type_identifier")?.Text : null;

    private static string? ReceiverVarName(Node method) =>
        method.Field("receiver")?.Children.FirstOrDefault(c => c.Type == "parameter_declaration")?.Field("name")?.Text;

    private static string? GoTypeName(Node? typeNode) => typeNode?.Type switch
    {
        "type_identifier" => typeNode.Text,
        "pointer_type" => GoTypeName(typeNode.Children.FirstOrDefault(c => c.IsNamed)),
        "qualified_type" => typeNode.Field("name")?.Text,
        _ => null,
    };

    private static string FieldKind(Node? typeNode) => typeNode?.Type switch
    {
        "map_type" => "map",
        "slice_type" => "slice",
        "pointer_type" => "pointer",
        _ => "other",
    };

    private static void CollectStructBody(Node body, ClassShape shape)
    {
        foreach (var field in body.Children.Where(c => c.Type == "field_declaration"))
        {
            var typeNode = field.Field("type");
            var names = field.Children.Where(c => c.Type == "field_identifier").ToList();
            if (names.Count == 0)
            {
                if (GoTypeName(typeNode) is { } embedded) shape.Bases.Add(embedded);
                continue;
            }
            foreach (var name in names) shape.ClassAttrs[name.Text] = FieldKind(typeNode);
        }
    }

    private static string? ReceiverAttrName(Node? node, string recvName)
    {
        if (node is not { Type: "selector_expression" }) return null;
        var operand = node.Field("operand");
        var field = node.Field("field");
        return operand is { Type: "identifier" } && field is not null && operand.Text == recvName ? field.Text : null;
    }

    private static bool IsAppendCall(Node value, string attr, string recvName)
    {
        if (value.Type != "call_expression") return false;
        var func = value.Field("function");
        if (func is not { Type: "identifier" } || func.Text != "append") return false;
        var first = value.Field("arguments")?.Children.FirstOrDefault(c => c.IsNamed);
        return first is not null && ReceiverAttrName(first, recvName) == attr;
    }

    private static List<Node> ExpressionListItems(Node? node)
    {
        if (node is null) return [];
        var children = node.Type == "expression_list" ? node.Children : [node];
        return children.Where(c => c.IsNamed).ToList();
    }

    private static void HandleGoAssignment(Node? left, Node? right, MethodShape shape, string recvName)
    {
        var lefts = ExpressionListItems(left);
        var rights = ExpressionListItems(right);
        for (var i = 0; i < lefts.Count; i++)
        {
            var target = lefts[i];
            var value = i < rights.Count ? rights[i] : null;
            if (target.Type == "index_expression")
            {
                if (ReceiverAttrName(target.Field("operand"), recvName) is { } written) shape.WritesDictAttrs.Add(written);
                continue;
            }
            var attr = ReceiverAttrName(target, recvName);
            if (attr is not null && value is not null && IsAppendCall(value, attr, recvName)) shape.AppendsListAttrs.Add(attr);
        }
    }

    private static void WalkMethodBody(Node node, MethodShape shape, string recvName)
    {
        if (node.Type is "assignment_statement" or "short_var_declaration")
        {
            var right = node.Field("right");
            HandleGoAssignment(node.Field("left"), right, shape, recvName);
            foreach (var value in ExpressionListItems(right)) WalkMethodBody(value, shape, recvName);
            return;
        }
        switch (node.Type)
        {
            case "call_expression":
                if (node.Field("function") is { Type: "selector_expression" } func
                    && func.Field("operand") is { } obj && func.Field("field") is { } method
                    && ReceiverAttrName(obj, recvName) is { } attr)
                {
                    if (!shape.CallsOnAttr.TryGetValue(attr, out var calls)) shape.CallsOnAttr[attr] = calls = [];
                    calls.Add(method.Text);
                }
                break;
            case "index_expression":
                if (ReceiverAttrName(node.Field("operand"), recvName) is { } read) shape.ReadsDictAttrs.Add(read);
                break;
            case "range_clause":
                if (ReceiverAttrName(node.Field("right"), recvName) is { } iterated) shape.IteratesAttrs.Add(iterated);
                break;
        }
        foreach (var child in node.Children) WalkMethodBody(child, shape, recvName);
    }
}
