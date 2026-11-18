## Godot-версия экрана «Просто»: упрощённое объяснение 5-стадийного конвейера.
## Интерфейс строится кодом; данные (схемы и трассы) — из data/simple.json.
extends Control

const Scene := preload("res://scripts/scene.gd")

const BG := Color("fff8ec")
const INK := Color("2b2d42")
const MUTED := Color("7a8196")
const NARROW := 760.0
const TICK_SEC := 1.5
const INTRO := "Процессор выполняет команды как [b]конвейер на заводе[/b]. Каждая команда по очереди проезжает [b]5 станций[/b]: её берут из памяти, разбирают, считают, заглядывают в память и записывают ответ. На каждый «тик» часов все команды сдвигаются на одну станцию вперёд — поэтому в работе сразу несколько команд, и ответы появляются один за другим. Нажми [b]Пуск[/b] и следи за цветными командами."

var data: Dictionary
var program: Dictionary
var idx := 0
var playing := false
var narrow := false
var _timer := 0.0

var font: Font
var bold: Font
var scroll: ScrollContainer
var page: VBoxContainer
var body: BoxContainer
var scene_card: PanelContainer
var scene: Control
var side: BoxContainer
var cmd_list: VBoxContainer
var regs_flow: HFlowContainer
var mem_flow: HFlowContainer
var prog_select: OptionButton
var play_btn: Button
var dots: HBoxContainer
var pos_label: Label
var title_label: Label
var rows: Array = []


func _ready() -> void:
	if OS.has_feature("web"):
		get_window().content_scale_factor = clampf(DisplayServer.screen_get_scale(), 1.0, 3.0)
	font = get_theme_default_font()
	bold = FontVariation.new()
	bold.base_font = font
	bold.variation_embolden = 0.6
	data = JSON.parse_string(FileAccess.get_file_as_string("res://data/simple.json"))
	_build_ui()
	get_viewport().size_changed.connect(_on_resize)
	_on_resize()
	_load_program(0)


# ------------------------------------------------------------------
#  Построение интерфейса
# ------------------------------------------------------------------

func _card(radius := 22, color := Color.WHITE) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	sb.corner_detail = 8
	sb.shadow_color = Color(0.17, 0.18, 0.26, 0.08)
	sb.shadow_size = 10
	sb.shadow_offset = Vector2(0, 4)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 12
	sb.content_margin_bottom = 12
	return sb


func _pill_style(color: Color, radius := 999) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	sb.corner_detail = 8
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	return sb


func _label(text: String, fsize := 15, color := INK, is_bold := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", fsize)
	l.add_theme_color_override("font_color", color)
	if is_bold:
		l.add_theme_font_override("font", bold)
	return l


func _button(text: String, color := Color("eef1f8"), fcolor := INK, minw := 48) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(minw, 48)
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_override("font", bold)
	b.add_theme_font_size_override("font_size", 18)
	for st in ["normal", "hover", "pressed", "focus", "disabled"]:
		var c := color
		if st == "hover":
			c = color.lightened(0.08)
		elif st == "pressed":
			c = color.darkened(0.08)
		b.add_theme_stylebox_override(st, _pill_style(c))
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(st, fcolor)
	return b


## Значок, нарисованный примитивами (у шрифта по умолчанию нет символов ▶ ⏸ ↺ ✓).
func _icon(kind: String, color: Color, sz := 18.0) -> Control:
	var c := Control.new()
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.custom_minimum_size = Vector2(sz, sz)
	c.set_meta("kind", kind)
	c.set_meta("color", color)
	c.draw.connect(_draw_icon.bind(c))
	return c


func _draw_icon(c: Control) -> void:
	var k: String = c.get_meta("kind")
	var col: Color = c.get_meta("color")
	var s := c.size
	var m := s / 2.0
	var r := minf(s.x, s.y) * 0.42
	match k:
		"play":
			c.draw_colored_polygon(PackedVector2Array([m + Vector2(-r * 0.7, -r), m + Vector2(r, 0), m + Vector2(-r * 0.7, r)]), col)
		"back":
			c.draw_colored_polygon(PackedVector2Array([m + Vector2(r * 0.7, -r), m + Vector2(-r, 0), m + Vector2(r * 0.7, r)]), col)
		"pause":
			c.draw_rect(Rect2(m + Vector2(-r * 0.8, -r), Vector2(r * 0.55, r * 2)), col)
			c.draw_rect(Rect2(m + Vector2(r * 0.25, -r), Vector2(r * 0.55, r * 2)), col)
		"restart":
			c.draw_arc(m, r * 0.85, -PI * 0.35, PI * 1.45, 24, col, r * 0.32, true)
			var tip := m + Vector2(cos(-PI * 0.35), sin(-PI * 0.35)) * r * 0.85
			c.draw_colored_polygon(PackedVector2Array([tip + Vector2(-r * 0.55, -r * 0.35), tip + Vector2(r * 0.25, -r * 0.55), tip + Vector2(r * 0.05, r * 0.35)]), col)
		"check":
			c.draw_polyline(PackedVector2Array([m + Vector2(-r * 0.75, 0), m + Vector2(-r * 0.2, r * 0.6), m + Vector2(r * 0.8, -r * 0.6)]), col, r * 0.35, true)


func _set_icon(ic: Control, kind: String, color: Color) -> void:
	ic.set_meta("kind", kind)
	ic.set_meta("color", color)
	ic.queue_redraw()


## Кнопка со значком: значок по центру (без текста) или слева от текста.
func _icon_button(kind: String, text := "", color := Color("eef1f8"), fcolor := INK, minw := 48) -> Button:
	var b := _button(text, color, fcolor, minw)
	var ic := _icon(kind, fcolor)
	ic.name = "Icon"
	if text == "":
		ic.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
		ic.position -= ic.custom_minimum_size / 2.0
	else:
		b.text = "      " + text
		ic.set_anchors_preset(Control.PRESET_CENTER_LEFT)
		ic.position = Vector2(26, -9)
	b.add_child(ic)
	return b


func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 0)
	add_child(root)

	scroll = ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	root.add_child(scroll)

	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side_name in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side_name, 14)
	scroll.add_child(margin)

	page = VBoxContainer.new()
	page.add_theme_constant_override("separation", 12)
	margin.add_child(page)

	# заголовок
	var head := HFlowContainer.new()
	head.add_theme_constant_override("h_separation", 10)
	head.add_theme_constant_override("v_separation", 8)
	page.add_child(head)
	var title_box := HBoxContainer.new()
	title_box.add_theme_constant_override("separation", 10)
	title_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_box.add_child(_toy_icon())
	title_label = _label("Процессор-конвейер", 26, INK, true)
	title_box.add_child(title_label)
	head.add_child(title_box)
	prog_select = OptionButton.new()
	prog_select.focus_mode = Control.FOCUS_NONE
	prog_select.add_theme_font_override("font", bold)
	prog_select.add_theme_font_size_override("font_size", 14)
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		prog_select.add_theme_color_override(st, INK)
	for st in ["normal", "hover", "pressed", "focus"]:
		prog_select.add_theme_stylebox_override(st, _pill_style(Color.WHITE if st != "hover" else Color("f4f6fb")))
	for p in data.programs:
		prog_select.add_item(p.title)
	prog_select.item_selected.connect(_load_program)
	var right := HBoxContainer.new()
	right.add_theme_constant_override("separation", 8)
	right.add_child(prog_select)
	if OS.has_feature("web"):
		# обратно на сайт (Godot-версия лежит в подпапке godot/ рядом с основным приложением)
		var site := _button("Сайт", Color.WHITE, Color("7a8196"), 70)
		site.custom_minimum_size.y = 36
		site.add_theme_font_size_override("font_size", 14)
		site.pressed.connect(func(): JavaScriptBridge.eval("window.location.href = '../#kid'"))
		right.add_child(site)
	head.add_child(right)

	# вступление
	var intro_card := PanelContainer.new()
	intro_card.add_theme_stylebox_override("panel", _card(20))
	var intro := RichTextLabel.new()
	intro.bbcode_enabled = true
	intro.fit_content = true
	intro.scroll_active = false
	intro.text = INTRO
	intro.add_theme_font_override("normal_font", font)
	intro.add_theme_font_override("bold_font", bold)
	intro.add_theme_font_size_override("normal_font_size", 15)
	intro.add_theme_font_size_override("bold_font_size", 15)
	intro.add_theme_color_override("default_color", INK)
	intro_card.add_child(intro)
	page.add_child(intro_card)

	# схема и боковая панель
	scene_card = PanelContainer.new()
	var sc := _card(26)
	sc.content_margin_left = 10
	sc.content_margin_right = 10
	sc.content_margin_top = 10
	sc.content_margin_bottom = 10
	scene_card.add_theme_stylebox_override("panel", sc)
	scene_card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scene = Scene.new()
	scene.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scene_card.add_child(scene)

	side = VBoxContainer.new()
	side.add_theme_constant_override("separation", 14)
	var cmd_card := PanelContainer.new()
	cmd_card.add_theme_stylebox_override("panel", _card())
	var cmd_box := VBoxContainer.new()
	cmd_box.add_child(_label("КОМАНДЫ", 13, MUTED, true))
	cmd_list = VBoxContainer.new()
	cmd_list.add_theme_constant_override("separation", 7)
	cmd_box.add_child(cmd_list)
	cmd_card.add_child(cmd_box)
	side.add_child(cmd_card)

	var st_card := PanelContainer.new()
	st_card.add_theme_stylebox_override("panel", _card())
	var st_box := VBoxContainer.new()
	st_box.add_theme_constant_override("separation", 8)
	st_box.add_child(_label("РЕГИСТРЫ", 13, MUTED, true))
	regs_flow = HFlowContainer.new()
	st_box.add_child(regs_flow)
	st_box.add_child(_label("ПАМЯТЬ", 13, MUTED, true))
	mem_flow = HFlowContainer.new()
	st_box.add_child(mem_flow)
	st_card.add_child(st_box)
	side.add_child(st_card)

	# плеер (закреплён снизу)
	var bar := PanelContainer.new()
	var bsb := StyleBoxFlat.new()
	bsb.bg_color = Color(1, 1, 1, 0.96)
	bsb.shadow_color = Color(0.17, 0.18, 0.26, 0.1)
	bsb.shadow_size = 12
	bsb.content_margin_left = 14
	bsb.content_margin_right = 14
	bsb.content_margin_top = 10
	bsb.content_margin_bottom = 10
	bar.add_theme_stylebox_override("panel", bsb)
	root.add_child(bar)
	var player := HFlowContainer.new()
	player.add_theme_constant_override("h_separation", 18)
	player.add_theme_constant_override("v_separation", 8)
	bar.add_child(player)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	var restart := _icon_button("restart")
	restart.pressed.connect(func(): seek(0))
	var back := _icon_button("back")
	back.pressed.connect(func(): seek(idx - 1))
	play_btn = _icon_button("play", "Пуск", Color("ff8a3d"), Color.WHITE, 150)
	play_btn.pressed.connect(func(): set_playing(not playing))
	var fwd := _icon_button("play")
	fwd.pressed.connect(func(): seek(idx + 1))
	for b in [restart, back, play_btn, fwd]:
		buttons.add_child(b)
	player.add_child(buttons)

	var prog_box := VBoxContainer.new()
	prog_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	prog_box.custom_minimum_size.x = 220
	dots = HBoxContainer.new()
	dots.add_theme_constant_override("separation", 5)
	prog_box.add_child(dots)
	pos_label = _label("", 13, MUTED, true)
	prog_box.add_child(pos_label)
	player.add_child(prog_box)


## Значок-пирамидка (детская игрушка).
func _toy_icon() -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(34, 34)
	c.draw.connect(func():
		c.draw_rect(Rect2(15.5, 2, 3, 9), Color("8D99AE"))
		var rings := [[11, 8, 12, "FF6B6B"], [8, 14, 18, "FFB703"], [5, 20, 24, "2DB84D"], [2, 26, 30, "3A86FF"]]
		for r in rings:
			var sb := _pill_style(Color(r[3]))
			sb.content_margin_left = 0
			c.draw_style_box(sb, Rect2(r[0], r[1], r[2], 5.5)))
	return c


func _on_resize() -> void:
	var w := get_viewport_rect().size.x
	var n := w < NARROW
	if n == narrow and body != null:
		return
	narrow = n
	if body:
		body.remove_child(scene_card)
		body.remove_child(side)
		body.queue_free()
	body = VBoxContainer.new() if narrow else HBoxContainer.new()
	body.add_theme_constant_override("separation", 14)
	page.add_child(body)
	body.add_child(scene_card)
	body.add_child(side)
	side.custom_minimum_size.x = 0 if narrow else 300
	title_label.add_theme_font_size_override("font_size", 21 if narrow else 26)
	scene.set_layout(data.vertical if narrow else data.horizontal)
	if program:
		scene.show_step(program.steps[idx], 0)


# ------------------------------------------------------------------
#  Программа и воспроизведение
# ------------------------------------------------------------------

func _load_program(i: int) -> void:
	playing = false
	program = data.programs[i]
	prog_select.select(i)
	idx = 0
	for ch in dots.get_children():
		ch.queue_free()
	var steps: Array = program.steps
	for k in steps.size():
		var d := Button.new()
		d.focus_mode = Control.FOCUS_NONE
		if k == 0 or k == steps.size() - 1:
			var ic := _icon("play" if k == 0 else "check", Color("9a5b00"), 14)
			ic.name = "Icon"
			ic.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
			ic.position -= ic.custom_minimum_size / 2.0
			d.add_child(ic)
		else:
			d.text = steps[k].tick
		d.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		d.custom_minimum_size = Vector2(0, 28)
		d.add_theme_font_override("font", bold)
		d.add_theme_font_size_override("font_size", 12)
		d.clip_text = true
		d.pressed.connect(seek.bind(k))
		dots.add_child(d)
	_build_rows()
	scene.show_step(steps[0], 0)
	_render()


func _build_rows() -> void:
	for ch in cmd_list.get_children():
		ch.queue_free()
	rows.clear()
	var steps: Array = program.steps
	for ins in program.instrs:
		var first := -1
		var last := -1
		var uid := 0
		var text: String = ins.text
		var done := ""
		for k in steps.size():
			for sid in steps[k].stages:
				var sl: Dictionary = steps[k].stages[sid]
				if sl.status != "instr" or sl.idx == null or int(sl.idx) != int(ins.idx):
					continue
				if first < 0:
					first = k
				last = k
				uid = int(sl.uid)
				text = sl.text
				if sid == "W":
					done = sl.detail
		var row := HFlowContainer.new()
		row.add_theme_constant_override("h_separation", 8)
		var pill := PanelContainer.new()
		pill.add_theme_stylebox_override("panel", _pill_style(Scene.instr_color(uid)))
		pill.add_child(_label(text, 14, Color.WHITE, true))
		row.add_child(pill)
		var status := _label("", 13, MUTED, true)
		status.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(status)
		cmd_list.add_child(row)
		rows.append({"pill": pill, "status": status, "first": first, "last": last, "uid": uid, "done": done})


func seek(i: int) -> void:
	var n: int = program.steps.size()
	var next := clampi(i, 0, n - 1)
	if next == idx:
		return
	var dir := signi(next - idx) if absi(next - idx) == 1 else 0
	idx = next
	scene.show_step(program.steps[idx], dir)
	_render()


func set_playing(p: bool) -> void:
	if p and idx >= program.steps.size() - 1:
		idx = 0
		scene.show_step(program.steps[0], 0)
	playing = p
	_timer = 0.0
	if p and narrow:
		scroll.ensure_control_visible(scene_card)
	_render()


func _process(delta: float) -> void:
	if not playing:
		return
	_timer += delta
	if _timer >= TICK_SEC:
		_timer = 0.0
		if idx >= program.steps.size() - 1:
			set_playing(false)
		else:
			seek(idx + 1)
			if idx >= program.steps.size() - 1:
				set_playing(false)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_RIGHT:
				seek(idx + 1)
			KEY_LEFT:
				seek(idx - 1)
			KEY_SPACE:
				set_playing(not playing)
			KEY_HOME:
				seek(0)


func _render() -> void:
	var steps: Array = program.steps
	var n := steps.size()
	var st: Dictionary = steps[idx]

	var finished := idx >= n - 1
	play_btn.text = "      " + ("Пауза" if playing else ("Ещё раз" if finished else "Пуск"))
	_set_icon(play_btn.get_node("Icon"), "pause" if playing else ("restart" if finished else "play"), Color.WHITE)
	var pc := Color("6c63ff") if playing else Color("ff8a3d")
	for s in ["normal", "hover", "pressed", "focus"]:
		play_btn.add_theme_stylebox_override(s, _pill_style(pc.lightened(0.08) if s == "hover" else pc))

	if idx == 0:
		pos_label.text = "Старт"
	elif idx == n - 1:
		pos_label.text = "Готово! Все ответы записаны"
	else:
		pos_label.text = "Тик %d из %d" % [int(st.cycle), n - 2]
	var dl := dots.get_children()
	for k in dl.size():
		var c := Color("ff9f1c") if k == idx else (Color("ffd9a0") if k < idx else Color("e6eaf2"))
		var fc := Color.WHITE if k == idx else (Color("9a5b00") if k < idx else Color("8b93a8"))
		for s in ["normal", "hover", "pressed", "focus"]:
			var sb := _pill_style(c.lightened(0.05) if s == "hover" else c)
			sb.content_margin_left = 0
			sb.content_margin_right = 0
			dl[k].add_theme_stylebox_override(s, sb)
		if dl[k].has_node("Icon"):
			_set_icon(dl[k].get_node("Icon"), "play" if k == 0 else "check", fc)
		for s in ["font_color", "font_hover_color", "font_pressed_color"]:
			dl[k].add_theme_color_override(s, fc)

	for r in rows:
		var state := "wait" if idx < r.first else ("done" if idx > r.last else "run")
		var status: Label = r.status
		match state:
			"wait":
				status.text = "ждёт"
				status.add_theme_color_override("font_color", MUTED)
				r.pill.modulate = Color(1, 1, 1, 0.4)
			"done":
				status.text = "готово · " + r.done
				status.add_theme_color_override("font_color", Color("1f9d3f"))
				r.pill.modulate = Color(1, 1, 1, 0.75)
			_:
				var k := 0
				var pos := 0
				for sid in ["F", "D", "E", "M", "W"]:
					k += 1
					if int(st.stages[sid].uid) == r.uid and st.stages[sid].status == "instr":
						pos = k
				status.text = "станция %d" % pos
				status.add_theme_color_override("font_color", INK)
				r.pill.modulate = Color.WHITE

	_chips(regs_flow, _reg_items(st))
	_chips(mem_flow, _mem_items(st))


func _reg_items(st: Dictionary) -> Array:
	var used := {}
	# регистры, которые встречаются в программе: берём из текста команд (xN)
	var re := RegEx.new()
	re.compile("x(\\d+)")
	for ins in program.instrs:
		for m in re.search_all(ins.text):
			var n := int(m.get_string(1))
			if n != 0:
				used[n] = true
	var keys := used.keys()
	keys.sort()
	var out := []
	for k in keys:
		out.append(["x%d" % k, str(int(st.regs[k])), int(st.changedReg) == k])
	return out


func _mem_items(st: Dictionary) -> Array:
	var out := []
	var keys: Array = st.mem.keys()
	keys.sort_custom(func(a, b): return int(a) < int(b))
	for a in keys:
		out.append(["ячейка %s" % a, str(int(st.mem[a])), int(st.changedMem) == int(a)])
	return out


func _chips(flow: HFlowContainer, items: Array) -> void:
	for ch in flow.get_children():
		ch.queue_free()
	for it in items:
		var p := PanelContainer.new()
		var sb := _pill_style(Color("ffe066") if it[2] else Color("f1f4fa"), 12)
		sb.content_margin_left = 10
		sb.content_margin_right = 10
		p.add_theme_stylebox_override("panel", sb)
		var hb := HBoxContainer.new()
		hb.add_theme_constant_override("separation", 5)
		hb.add_child(_label(it[0], 14, Color("5b6278")))
		hb.add_child(_label(it[1], 14, INK, true))
		p.add_child(hb)
		flow.add_child(p)
		if it[2]:
			p.pivot_offset = Vector2(30, 12)
			p.scale = Vector2(1.25, 1.25)
			create_tween().tween_property(p, "scale", Vector2.ONE, 0.4).set_trans(Tween.TRANS_BACK)
