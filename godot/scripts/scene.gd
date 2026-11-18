## Сцена конвейера: станции, блоки, линия данных и «жетоны» команд.
## Рисует упрощённую схему из data/simple.json (её строит TypeScript-движок)
## и плавно перевозит жетоны со станции на станцию.
extends Control

const INK := Color("2b2d42")
const MUTED := Color("6b7288")
const WIRE := Color("d5dbe8")
const GATE := Color("e6eaf2")
const COLORS := ["#FF6B6B", "#3A86FF", "#2DB84D", "#B565F5", "#FF9F1C", "#00B4D8", "#F15BB5"]

var layout: Dictionary = {}
var step: Dictionary = {}
var font: Font
var bold: Font

## uid → {pos, target, alpha, alpha_target, text, detail, color}
var tokens := {}
var _boxes := {}
var _t := 0.0
var _gate_flash := 0.0


static func instr_color(uid: int) -> Color:
	if uid <= 0:
		return Color("c9d1e0")
	return Color(COLORS[(uid - 1) % COLORS.size()])


func _ready() -> void:
	font = get_theme_default_font()
	bold = FontVariation.new()
	bold.base_font = font
	bold.variation_embolden = 0.6
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_layout(l: Dictionary) -> void:
	layout = l
	tokens.clear()
	_update_min_size()
	if not step.is_empty():
		show_step(step, 0)
	queue_redraw()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		_update_min_size()


func _update_min_size() -> void:
	if layout.is_empty() or size.x <= 0:
		return
	var h := size.x * float(layout.height) / float(layout.width)
	if absf(custom_minimum_size.y - h) > 1.0:
		custom_minimum_size.y = h


func _stage(id: String) -> Dictionary:
	for s in layout.stages:
		if s.id == id:
			return s
	return {}


func _anchor(s: Dictionary) -> Vector2:
	return Vector2(s.anchor[0], s.anchor[1])


## Точка «за краем» конвейера: откуда приезжают и куда уезжают команды.
func _edge(end: bool) -> Vector2:
	var vertical: bool = layout.height > layout.width
	var st: Dictionary = layout.stages[layout.stages.size() - 1 if end else 0]
	var a := _anchor(st)
	var d := 1.0 if end else -1.0
	return a + (Vector2(0, 70 * d) if vertical else Vector2(110 * d, 0))


## dir: 1 — шаг вперёд, -1 — назад, 0 — прыжок без анимации.
func show_step(s: Dictionary, dir: int) -> void:
	step = s
	if layout.is_empty():
		return
	var seen := {}
	for st in layout.stages:
		var slot: Dictionary = s.stages.get(st.id, {})
		if slot.get("status", "") != "instr":
			continue
		var uid := int(slot.uid)
		seen[uid] = true
		var target := _anchor(st)
		if not tokens.has(uid):
			var start := target
			if dir != 0:
				start = _edge(dir < 0 and st.id == "W")
			tokens[uid] = {"pos": start, "alpha": 0.0 if dir != 0 else 1.0}
		var t: Dictionary = tokens[uid]
		t.target = target
		t.alpha_target = 1.0
		t.text = slot.text
		t.detail = slot.detail
		t.color = instr_color(uid)
		if dir == 0:
			t.pos = target
			t.alpha = 1.0
	for uid in tokens.keys():
		if seen.has(uid):
			continue
		var t: Dictionary = tokens[uid]
		t.detail = ""
		if dir == 0:
			tokens.erase(uid)
		else:
			t.target = _edge(dir > 0)
			t.alpha_target = 0.0
	if dir > 0:
		_gate_flash = 1.0
	queue_redraw()


func _process(delta: float) -> void:
	_t += delta
	var k := 1.0 - exp(-delta * 7.0)
	for uid in tokens.keys():
		var t: Dictionary = tokens[uid]
		t.pos = t.pos.lerp(t.target, k)
		t.alpha = lerpf(t.alpha, t.alpha_target, k)
		if t.alpha_target == 0.0 and t.alpha < 0.02:
			tokens.erase(uid)
	_gate_flash = maxf(0.0, _gate_flash - delta * 1.8)
	queue_redraw()


func _box(color: Color, radius: float, border := Color.TRANSPARENT, bw := 0.0) -> StyleBoxFlat:
	var key := "%s/%s/%s/%s" % [color.to_html(), radius, border.to_html(), bw]
	if not _boxes.has(key):
		var sb := StyleBoxFlat.new()
		sb.bg_color = color
		sb.set_corner_radius_all(int(radius))
		sb.corner_detail = 8
		sb.anti_aliasing = true
		if bw > 0.0:
			sb.border_color = border
			sb.set_border_width_all(int(bw))
		_boxes[key] = sb
	return _boxes[key]


func _text(pos: Vector2, text: String, fsize: int, color: Color, f: Font = null, center := true, outline := 0, ocolor := Color.WHITE) -> void:
	var fnt := f if f else font
	var w := fnt.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fsize).x
	var p := pos - Vector2(w / 2.0 if center else 0.0, 0)
	if outline > 0:
		draw_string_outline(fnt, p, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fsize, outline, ocolor)
	draw_string(fnt, p, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fsize, color)


func _draw() -> void:
	if layout.is_empty():
		return
	var k := size.x / float(layout.width)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(k, k))
	var busy := {}
	var uid_at := {}
	if not step.is_empty():
		for id in step.stages:
			var sl: Dictionary = step.stages[id]
			busy[id] = sl.status == "instr"
			uid_at[id] = int(sl.uid)

	# станции
	var n := 0
	for st in layout.stages:
		n += 1
		var c := Color(st.color)
		var r := Rect2(st.x0, st.y0, st.x1 - st.x0, st.y1 - st.y0)
		draw_style_box(_box(Color.WHITE.lerp(c, 0.26 if busy.get(st.id, false) else 0.14), 22), r)
		var o := Vector2(st.x0, st.y0)
		draw_circle(o + Vector2(30, 34), 17, c)
		_text(o + Vector2(30, 41), str(n), 19, Color.WHITE, bold)
		_text(o + Vector2(56, 33), st.label, 19, INK, bold, false)
		_text(o + Vector2(56, 52), st.hint, 12, MUTED, null, false)

	# линия данных
	var active: Array = step.get("active", [])
	for w in layout.wires:
		var pts := PackedVector2Array()
		for p in w.points:
			pts.append(Vector2(p[0], p[1]))
		var on := active.has(w.signal)
		var col := instr_color(uid_at.get(w.stage, 0)) if on else WIRE
		draw_polyline(pts, WIRE, 6.0, true)
		if on:
			_flow(pts, col)
		var a := pts[pts.size() - 2]
		var b := pts[pts.size() - 1]
		var dirv := (b - a).normalized()
		var nrm := Vector2(-dirv.y, dirv.x)
		draw_colored_polygon(PackedVector2Array([b, b - dirv * 11 + nrm * 7, b - dirv * 11 - nrm * 7]), col)

	# блоки
	var blocks_on: Array = step.get("blocks", [])
	for bl in layout.blocks:
		var r := Rect2(bl.x, bl.y, bl.w, bl.h)
		if bl.type == "pipereg":
			var g := GATE.lerp(INK, _gate_flash * 0.85)
			draw_style_box(_box(g, 4), r)
			continue
		var on := blocks_on.has(bl.id)
		var c := instr_color(uid_at.get(bl.stage, 0)) if on else Color("c9d1e0")
		draw_style_box(_box(Color(0, 0, 0, 0.07), 16), Rect2(r.position + Vector2(0, 3), r.size))
		draw_style_box(_box(Color.WHITE.lerp(c, 0.1) if on else Color.WHITE, 16, c, 3), r)
		var lines: PackedStringArray = bl.label.split("\n")
		var fs := 12 if bl.type == "register" else 15
		var y0: float = bl.y + bl.h / 2.0 + 5 - (lines.size() - 1) * 8
		for i in lines.size():
			_text(Vector2(bl.x + bl.w / 2.0, y0 + i * 16), lines[i], fs, INK, bold)

	# жетоны команд
	for uid in tokens:
		var t: Dictionary = tokens[uid]
		var c: Color = t.color
		c.a = t.alpha
		var p: Vector2 = t.pos
		var r := Rect2(p - Vector2(92, 21), Vector2(184, 42))
		var shadow := c.darkened(0.2)
		shadow.a = 0.35 * t.alpha
		draw_style_box(_box(shadow, 21), Rect2(r.position + Vector2(0, 4), r.size))
		draw_style_box(_box(c, 21), r)
		var tc := Color(1, 1, 1, t.alpha)
		_text(p + Vector2(0, 5), t.text, 15, tc, bold)
		if t.detail != "":
			_text(p + Vector2(0, 42), t.detail, 14, Color(INK, t.alpha), bold, true, 4, Color(1, 1, 1, t.alpha))


## «Бегущие» точки вдоль активного провода.
func _flow(pts: PackedVector2Array, col: Color) -> void:
	var gap := 14.0
	var off := fmod(_t * 26.0, gap)
	var acc := 0.0
	for i in range(pts.size() - 1):
		var a := pts[i]
		var b := pts[i + 1]
		var len := a.distance_to(b)
		var d := gap - fmod(acc - off + gap * 100.0, gap)
		while d < len:
			draw_circle(a + (b - a) * (d / len), 3.2, col)
			d += gap
		acc += len
