"""Unit coverage for Go's extract_class_shapes: structs/interfaces/receiver methods/embeds."""

from codechroma.analyzers.go_analyzer import GoAnalyzer, extract_class_shapes


def test_struct_fields_become_class_attrs_classified_by_type():
    src = b"""
package widget

type Widget struct {
	items map[string]int
	tags  []string
	next  *Widget
	name  string
}
"""
    shapes = extract_class_shapes("widget.go", src)

    shape = shapes["widget.go::class::Widget"]
    assert shape.kind == "struct"
    assert shape.class_attrs == {
        "items": "map",
        "tags": "slice",
        "next": "pointer",
        "name": "other",
    }


def test_anonymous_embedded_fields_become_bases():
    src = b"""
package widget

type Base struct {
	Name string
}

type Widget struct {
	Base
	*Extra
	shared.Common
}
"""
    shapes = extract_class_shapes("widget.go", src)

    assert shapes["widget.go::class::Widget"].bases == ["Base", "Extra", "Common"]


def test_interface_methods_are_marked_abstract_with_empty_bodies():
    src = b"""
package widget

type Shape interface {
	Area() float64
	Perimeter() float64
}
"""
    shapes = extract_class_shapes("widget.go", src)

    shape = shapes["widget.go::class::Shape"]
    assert shape.kind == "interface"
    assert shape.is_abstract is True
    assert set(shape.methods) == {"Area", "Perimeter"}


def test_receiver_var_based_method_tracks_index_reads_and_writes():
    src = b"""
package widget

type Widget struct {
	items map[string]int
}

func (w *Widget) Use(key string, value int) {
	w.items[key] = value
	found := w.items[key]
	_ = found
}
"""
    shapes = extract_class_shapes("widget.go", src)

    method = shapes["widget.go::class::Widget"].methods["Use"]
    assert method.writes_dict_attrs == ["items"]
    assert method.reads_dict_attrs == ["items"]


def test_receiver_var_based_method_tracks_append_idiom_and_range_iteration():
    src = b"""
package widget

type Widget struct {
	tags []string
}

func (w *Widget) AddTag(tag string) {
	w.tags = append(w.tags, tag)
}

func (w *Widget) ListTags() {
	for _, tag := range w.tags {
		_ = tag
	}
}
"""
    shapes = extract_class_shapes("widget.go", src)

    methods = shapes["widget.go::class::Widget"].methods
    assert methods["AddTag"].appends_list_attrs == ["tags"]
    assert methods["ListTags"].iterates_attrs == ["tags"]


def test_receiver_var_based_method_tracks_calls_on_attr():
    src = b"""
package widget

type Widget struct {
	next *Widget
}

func (w *Widget) Reset() {
	w.next.Clear()
}
"""
    shapes = extract_class_shapes("widget.go", src)

    method = shapes["widget.go::class::Widget"].methods["Reset"]
    assert method.calls_on_attr == {"next": ["Clear"]}


def test_class_id_matches_the_symbol_id_go_analyzer_parse_assigns():
    src = b"""
package widget

type Widget struct{}
"""
    symbols = GoAnalyzer().parse("widget.go", src)
    shapes = extract_class_shapes("widget.go", src)

    class_symbol = next(s for s in symbols if s.name == "Widget")
    assert class_symbol.id in shapes
