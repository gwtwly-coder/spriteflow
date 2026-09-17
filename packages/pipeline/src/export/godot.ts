export function godotScript(baseName: string): string {
  return `@tool
extends EditorScript

func _run() -> void:
    var directory: String = get_script().resource_path.get_base_dir()
    var destination: String = directory.path_join(${JSON.stringify(`${baseName}.tres`)})
    if FileAccess.file_exists(destination):
        push_error("Output already exists. Move or delete the previous .tres before running again.")
        return
    var manifest_path: String = directory.path_join("sequence.json")
    var file := FileAccess.open(manifest_path, FileAccess.READ)
    if file == null:
        push_error("Cannot read sequence.json.")
        return
    var parser := JSON.new()
    if parser.parse(file.get_as_text()) != OK:
        push_error("Invalid sequence.json.")
        return
    var document: Variant = parser.data
    if not document is Dictionary or document.get("schemaVersion") != "spriteflow-sequence/1":
        push_error("Unsupported sequence schema.")
        return
    if not document.get("frames") is Array or not document.get("animations") is Array:
        push_error("Missing frames or animations.")
        return
    var textures: Dictionary = {}
    for entry in document.frames:
        if not entry is Dictionary or not entry.get("id") is String or not entry.get("file") is String:
            push_error("Invalid frame entry.")
            return
        var relative: String = entry.file
        if not relative.begins_with("frames/") or not relative.ends_with(".png") or relative.contains("..") or relative.contains("\\\\") or relative.contains(":") or relative.split("/").size() != 2:
            push_error("Unsafe frame path.")
            return
        if textures.has(entry.id):
            push_error("Duplicate frame id.")
            return
        var texture := load(directory.path_join(relative)) as Texture2D
        if texture == null:
            push_error("Cannot load a frame. Wait for PNG import to finish, then retry.")
            return
        textures[entry.id] = texture
    var sprite_frames := SpriteFrames.new()
    sprite_frames.remove_animation("default")
    for animation in document.animations:
        if not animation is Dictionary or not animation.get("name") is String or not animation.get("frameIds") is Array or not animation.get("loop") is bool:
            push_error("Invalid animation entry.")
            return
        if not (animation.get("fps") is float or animation.get("fps") is int):
            push_error("Invalid animation speed.")
            return
        var fps: float = animation.fps
        if not is_finite(fps) or fps < 1.0 or fps > 120.0 or animation.frameIds.is_empty() or sprite_frames.has_animation(animation.name):
            push_error("Invalid animation configuration.")
            return
        sprite_frames.add_animation(animation.name)
        sprite_frames.set_animation_speed(animation.name, fps)
        sprite_frames.set_animation_loop(animation.name, animation.loop)
        for frame_id in animation.frameIds:
            if not frame_id is String or not textures.has(frame_id):
                push_error("Animation references an unknown frame.")
                return
            sprite_frames.add_frame(animation.name, textures[frame_id], 1.0)
    var status := ResourceSaver.save(sprite_frames, destination)
    if status != OK:
        push_error("Could not save SpriteFrames resource (error %s)." % status)
        return
    print("SpriteFrames saved: ", destination)
`;
}
export const godotReadme = `SpriteFlow M1 — Godot 4.4.x

将整个解压目录放入 Godot 项目的 res:// 内，等待 PNG 导入完成。
在脚本编辑器打开 build_spriteframes.gd，执行 Run（Ctrl+Shift+X）。
生成的 SpriteFrames .tres 保存在脚本同一目录，文件名采用导出时的 baseName。
在 AnimatedSprite2D 的 Sprite Frames 属性中选择该资源即可播放动画。
若目标 .tres 已存在，请先移动或删除旧文件；脚本不会静默覆盖。
若读取、JSON 解析、纹理导入或保存失败，请查看编辑器错误信息，修正后重试。
仅完整验证后才保存资源；不要移动 frames/ 或 sequence.json 的相对位置。
`;
