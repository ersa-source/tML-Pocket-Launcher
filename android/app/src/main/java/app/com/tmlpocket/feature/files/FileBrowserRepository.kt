package app.com.tmlpocket.feature.files

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/** Browses only explicitly supplied public roots; never exposes launcher-internal storage. */
internal class FileBrowserRepository(private val roots: List<BrowserRoot>) {
    fun roots(): JSONArray =
        JSONArray(
            roots.map {
                JSONObject()
                    .put("id", it.id)
                    .put("label", it.label)
                    .put("path", it.directory.absolutePath)
            }
        )

    fun resolve(rootId: String, path: String, directory: Boolean = false): File {
        val root = roots.singleOrNull { it.id == rootId } ?: error("存储位置不可用，请检查文件访问权限")
        require(
            path.length <= 4096 &&
                !path.startsWith('/') &&
                !path.contains('\\') &&
                !path.contains(':') &&
                !path.contains('\u0000')
        ) {
            "无效文件路径"
        }
        val parts = if (path.isEmpty()) emptyList() else path.split('/')
        require(parts.none { it.isEmpty() || it == "." || it == ".." }) { "文件路径不能越界" }
        if (root.shared && parts.firstOrNull().equals("Android", true)) {
            require(
                parts.size < 2 ||
                    parts[1].lowercase(Locale.ROOT) !in setOf("data", "obb", "sandbox")
            ) {
                "Android 限制访问此目录，请将文件放到 Download 或 Documents"
            }
        }
        val base = root.directory.canonicalFile
        var target = base
        for (part in parts) {
            target = File(target, part)
            require(!Files.isSymbolicLink(target.toPath())) { "不支持符号链接" }
        }
        require(target.canonicalFile.toPath().startsWith(base.toPath())) { "文件路径不能越界" }
        require(if (directory) target.isDirectory else target.isFile) { "文件或目录不存在，请刷新后重试" }
        require(target.canRead()) { "没有读取权限" }
        return target
    }

    fun list(params: JSONObject): JSONObject {
        val root = params.getString("root")
        val path = params.optString("path")
        val kind = params.getString("kind")
        extensions(kind)
        val query = params.optString("query").take(200).lowercase(Locale.ROOT)
        val directory = resolve(root, path, true)
        val candidates = directory.listFiles() ?: error("无法读取目录，请检查存储权限")
        val sort = params.optString("sort", "name")
        val comparator =
            when (sort) {
                "modified" -> compareByDescending<File> { it.lastModified() }
                "size" -> compareByDescending<File> { if (it.isFile) it.length() else 0 }
                else -> compareBy { it.name.lowercase(Locale.ROOT) }
            }
        val entries =
            candidates
                .asSequence()
                .filter {
                    !it.name.startsWith('.') &&
                        it.name.lowercase(Locale.ROOT).contains(query) &&
                        !Files.isSymbolicLink(it.toPath()) &&
                        (it.isDirectory || accepts(kind, it)) &&
                        runCatching {
                                resolve(
                                    root,
                                    listOf(path, it.name)
                                        .filter(String::isNotEmpty)
                                        .joinToString("/"),
                                    it.isDirectory,
                                )
                            }
                            .isSuccess
                }
                .sortedWith(
                    compareByDescending<File> { it.isDirectory }.then(comparator).thenBy { it.name }
                )
                .toList()
        val offset = params.optInt("offset").coerceAtLeast(0)
        return JSONObject()
            .put("root", root)
            .put("path", path)
            .put("total", entries.size)
            .put(
                "entries",
                JSONArray(
                    entries.drop(offset).take(100).map {
                        JSONObject()
                            .put("name", it.name)
                            .put(
                                "path",
                                listOf(path, it.name).filter(String::isNotEmpty).joinToString("/"),
                            )
                            .put("directory", it.isDirectory)
                            .put("size", if (it.isFile) it.length() else 0)
                            .put("modified", it.lastModified())
                    }
                ),
            )
            .put("hasMore", offset.toLong() + 100 < entries.size)
    }

    fun selection(kind: String, selected: JSONArray): List<File> {
        require(selected.length() in 1..(if (kind == "mod") 100 else 1)) { "请选择文件；模组最多可选择 100 个" }
        return (0 until selected.length())
            .map {
                val value = selected.getJSONObject(it)
                resolve(value.getString("root"), value.getString("path")).also { file ->
                    require(accepts(kind, file)) { "文件格式不匹配：${file.name}" }
                }
            }
            .also {
                require(it.map(File::getCanonicalPath).distinct().size == it.size) { "不能重复选择文件" }
            }
    }

    fun export(root: String, path: String, name: String, text: String): JSONObject {
        require(text.toByteArray(Charsets.UTF_8).size <= 200_000) { "导出内容过长" }
        require(
            name.length in 1..128 &&
                name.endsWith(".json", true) &&
                !name.startsWith('.') &&
                name.none { it.code < 32 || it in "\\/:*?\"<>|" } &&
                !name.endsWith(' ')
        ) {
            "请输入有效的 JSON 文件名"
        }
        val directory = resolve(root, path, true)
        val destination = File(directory, name)
        require(!destination.exists()) { "同名文件已存在，请更换名称" }
        // CREATE_NEW prevents a race from overwriting an existing file or following a link.
        Files.newOutputStream(
                destination.toPath(),
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE,
            )
            .use {
                try {
                    it.write(text.toByteArray(Charsets.UTF_8))
                } catch (failure: Exception) {
                    destination.delete()
                    throw failure
                }
            }
        return JSONObject().put("name", name).put("path", destination.absolutePath)
    }

    companion object {
        fun extensions(kind: String): Set<String> =
            when (kind) {
                "terraria",
                "terraria-steam",
                "tml" -> setOf("zip")
                "terraria-gog" -> setOf("sh")
                "terraria-gog-zip" -> setOf("zip")
                "mod" -> setOf("tmod")
                "patch",
                "pack",
                "export" -> setOf("json")
                "image" -> setOf("png", "jpg", "jpeg", "webp")
                else -> error("不支持的文件类型")
            }

        private fun accepts(kind: String, file: File) =
            file.extension.lowercase(Locale.ROOT) in extensions(kind)
    }
}

internal data class BrowserRoot(
    val id: String,
    val label: String,
    val directory: File,
    val shared: Boolean = false,
)
